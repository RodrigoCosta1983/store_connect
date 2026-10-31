"use strict";

const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const {seedAdmission} = require("./fixtures/storeWriterAdmissionFixture.cjs");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
const admin = require("firebase-admin");
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
const {requireTransactionalWriterAdmission} = require("../../sales/transactionalWriterAdmission");
const {createLocalAdmittedSaleHandlers, confirmSaleV2} = require("../../sales/confirmSaleV2");
after(() => db.terminate());

// Fixture schema/path ONLY. No rollout schema or production modes are selected.
async function fixture() {
  const uid = randomUUID();
  const store = db.collection("stores").doc(randomUUID());
  const user = db.collection("users").doc(uid);
  const product = store.collection("products").doc("p");
  const control = db.collection("localAdmissionTestFixtures").doc(store.id);
  await Promise.all([store.set({ownerId: uid, subscriptionStatus: "active"}),
    user.set({storeId: store.id, role: "admin"}),
    product.set({name: "Synthetic", price: 1, quantidade: 5, lotes: []}),
    control.set({fixtureWriter: "v2", fixtureEpoch: 1})]);
  const saleId = randomUUID();
  await seedAdmission(db, store.id);
  const data = {schemaVersion: 2, requestId: saleId, saleId,
    scope: {projectId: process.env.GCLOUD_PROJECT, uid, storeId: store.id},
    origin: "online", saleKind: "instant", paymentMethod: "Dinheiro",
    items: [{productId: "p", quantity: 1, expectedUnitPriceCents: 100}], expectedTotalCents: 100};
  return {uid, store, user, product, control, data, calls: 0};
}
function composed(f, writer = "v2", epoch = 1, policy) {
  return createLocalAdmittedSaleHandlers({
    controlForStore: store => {
      assert.equal(store.path, f.store.path); // Derived only after real V2 authorization.
      return f.control;
    },
    admits: async snapshot => {
      f.calls++;
      if (policy) return policy(snapshot);
      const data = snapshot.data();
      return data.fixtureWriter === writer && data.fixtureEpoch === epoch;
    },
  });
}
const request = (f, data = f.data, uid = f.uid) => ({auth: uid ? {uid} : null, data});
const send = (f, handler = composed(f)) => handler.confirmSaleV2(request(f));
const query = (f, handler = composed(f)) => handler.getSaleMutationResultV1(request(f));
const denied = promise => assert.rejects(promise, error => error.code === "failed-precondition" &&
  error.details?.reason === "writer-admission-denied");
async function untouched(f) {
  assert.equal((await f.product.get()).data().quantidade, 5);
  assert.equal((await f.store.collection("sales").get()).size, 0);
  assert.equal((await f.store.collection("auditLogs").get()).size, 0);
  assert.equal((await f.store.collection("cash_flow").get()).size, 0);
}
function another(f) {
  const saleId = randomUUID();
  return {...f.data, requestId: saleId, saleId};
}

test("primitive requires explicit transaction, reference and backend policy", async () => {
  assert.throws(() => createLocalAdmittedSaleHandlers({}), TypeError);
  await assert.rejects(requireTransactionalWriterAdmission(null, {}, () => true), TypeError);
});
test("missing control denies before policy and persists no rejection receipt", async () => {
  const f = await fixture(); await f.control.delete();
  await denied(send(f)); assert.equal(f.calls, 0); await untouched(f);
});
test("policy must explicitly return true; malformed fixture fails closed", async () => {
  const f = await fixture();
  for (const decision of [false, undefined, null, 1, "true", {}]) {
    await denied(send(f, composed(f, "v2", 1, () => decision)));
  }
  await f.control.set({fixtureWriter: "v2", fixtureEpoch: "1"});
  await denied(send(f)); await untouched(f);
});
test("closed admission and policy exceptions never seal the sale identity", async () => {
  const f = await fixture(); await f.control.update({fixtureWriter: "paused"});
  await denied(send(f));
  await assert.rejects(send(f, composed(f, "v2", 1, () => { throw new Error("synthetic policy failure"); })),
    /synthetic policy failure/);
  await untouched(f);
  const result = await query(f);
  assert.equal(result.status, "not-recorded"); assert.equal(result.definitive, false);
});
test("same frozen command can confirm after a denied admission without a new identity", async () => {
  const f = await fixture(); const original = JSON.stringify(f.data);
  await f.control.update({fixtureWriter: "paused"}); await denied(send(f));
  await f.control.update({fixtureWriter: "v2"});
  assert.equal((await send(f)).saleId, f.data.saleId);
  assert.equal(JSON.stringify(f.data), original);
  assert.equal((await f.product.get()).data().quantidade, 4);
});
test("concurrent duplicate commands share the existing receipt and debit once", async () => {
  const f = await fixture(); const handler = composed(f);
  const results = await Promise.all([send(f, handler), send(f, handler)]);
  assert.equal(results.filter(result => !result.replayed).length, 1);
  assert.equal((await f.product.get()).data().quantidade, 4);
  assert.equal((await f.store.collection("sales").get()).size, 1);
  assert.equal((await f.store.collection("auditLogs").get()).size, 1);
});
test("lost response recovers and replays after close without consulting admission", async () => {
  const f = await fixture();
  await assert.rejects(async () => { await send(f); throw new Error("lost after commit"); }, /lost after commit/);
  const sale = f.store.collection("sales").doc(f.data.saleId);
  await sale.update({fiscal: {preserved: true}, paidAmount: 0.5});
  const before = await sale.get();
  await f.control.delete();
  const handler = composed(f, "v2", 1, () => { throw new Error("must not run on replay"); });
  const calls = f.calls;
  assert.equal((await query(f, handler)).status, "confirmed");
  assert.equal((await send(f, handler)).replayed, true);
  assert.equal(f.calls, calls);
  assert.ok((await sale.get()).updateTime.isEqual(before.updateTime));
  assert.equal((await f.product.get()).data().quantidade, 4);
});
test("terminal business rejection remains recoverable under closed admission", async () => {
  const f = await fixture(); await f.product.update({quantidade: 0});
  assert.equal((await send(f)).status, "rejected");
  await f.control.update({fixtureWriter: "paused"}); await f.product.update({quantidade: 5});
  assert.equal((await send(f)).status, "rejected");
  assert.equal((await query(f)).status, "rejected");
  assert.equal((await f.product.get()).data().quantidade, 5);
  assert.equal((await f.store.collection("sales").get()).size, 0);
});
test("auth, revocation, cross-store and result ownership precede admission", async () => {
  const f = await fixture(); const handler = composed(f);
  await assert.rejects(handler.confirmSaleV2(request(f, f.data, null)), {code: "unauthenticated"});
  await assert.rejects(handler.confirmSaleV2(request(f, {...f.data,
    scope: {...f.data.scope, storeId: "other"}})), {code: "permission-denied"});
  await f.user.update({accessStatus: "revoked"});
  await assert.rejects(send(f, handler), {code: "permission-denied"});
  assert.equal(f.calls, 0); await untouched(f);
  await f.user.update({accessStatus: "active"}); await send(f, handler);
  await f.user.update({accessStatus: "revoked"}); const calls = f.calls;
  await assert.rejects(query(f, handler), {code: "permission-denied"});
  assert.equal(f.calls, calls);
  const other = randomUUID(); await db.collection("users").doc(other).set({role: "admin", storeId: f.store.id});
  await assert.rejects(handler.getSaleMutationResultV1(request(f, {...f.data,
    scope: {...f.data.scope, uid: other}}, other)), {code: "permission-denied"});
});
test("mode ABA with a different epoch denies stale unrecorded admission", async () => {
  const f = await fixture(); const stale = composed(f);
  await f.control.update({fixtureWriter: "paused", fixtureEpoch: 2});
  await denied(send(f, stale));
  await f.control.update({fixtureWriter: "v2", fixtureEpoch: 3});
  await denied(send(f, stale)); await untouched(f);
  assert.equal((await send(f, composed(f, "v2", 3))).status, "confirmed");
});
test("fixture transition admits one writer family at a time, retaining V2 replay", async () => {
  const f = await fixture();
  await f.control.update({fixtureWriter: "legacy-fixture"});
  await denied(send(f)); await untouched(f);
  await f.control.update({fixtureWriter: "paused", fixtureEpoch: 2});
  await denied(send(f, composed(f, "legacy-fixture")));
  await f.control.update({fixtureWriter: "v2", fixtureEpoch: 3});
  await denied(send(f, composed(f, "legacy-fixture", 3)));
  assert.equal((await send(f, composed(f, "v2", 3))).status, "confirmed");
  await f.control.update({fixtureWriter: "paused", fixtureEpoch: 4});
  assert.equal((await query(f)).status, "confirmed");
  assert.equal((await f.product.get()).data().quantidade, 4);
});
test("control change races a real admitted transaction with a serializable outcome", async () => {
  const f = await fixture();
  let observed; const read = new Promise(resolve => { observed = resolve; });
  let release; const held = new Promise(resolve => { release = resolve; });
  let first = true;
  const handler = composed(f, "v2", 1, async snapshot => {
    if (first) { first = false; observed(); await held; }
    const data = snapshot.data();
    return data.fixtureWriter === "v2" && data.fixtureEpoch === 1;
  });
  const sending = send(f, handler).then(result => ({result}), error => ({error}));
  await read;
  const closing = f.control.update({fixtureWriter: "paused", fixtureEpoch: 2});
  release();
  const [outcome, cut] = await Promise.all([sending, closing]);
  if (outcome.error) {
    assert.equal(outcome.error.details?.reason, "writer-admission-denied"); await untouched(f);
  } else {
    assert.equal(outcome.result.status, "confirmed");
    const sale = await f.store.collection("sales").doc(f.data.saleId).get();
    assert.ok(sale.updateTime.seconds < cut.writeTime.seconds ||
      sale.updateTime.seconds === cut.writeTime.seconds &&
      sale.updateTime.nanoseconds <= cut.writeTime.nanoseconds);
    assert.equal((await f.product.get()).data().quantidade, 4);
  }
  await denied(handler.confirmSaleV2(request(f, another(f))));
});
test("Firestore retry rereads admission after a cut and never commits the first attempt's queued write", async () => {
  const f = await fixture(); let attempts = 0; let reads = 0;
  await denied(db.runTransaction(async transaction => {
    attempts++;
    // Fixture scheduling ONLY: previous attempt has rolled back; this callback
    // has not read/locked anything yet. No such control writer exists in source.
    if (attempts === 2) await f.control.update({fixtureWriter: "paused", fixtureEpoch: 2});
    await requireTransactionalWriterAdmission(transaction, f.control, snapshot => {
      reads++;
      return snapshot.data().fixtureWriter === "v2" && snapshot.data().fixtureEpoch === 1;
    });
    transaction.update(f.product, {quantidade: 4});
    // Real Admin SDK retry path, not a manually repeated transaction callback.
    throw Object.assign(new Error("synthetic ABORTED before commit"), {code: 10});
  }, {maxAttempts: 3}));
  assert.equal(attempts, 2); assert.equal(reads, 2); await untouched(f);
});
test("default handler requires official admission independently of an extra fixture policy", async () => {
  const f = await fixture(); await f.control.update({fixtureWriter: "paused"});
  await denied(send(f));
  await db.collection("storeWriterAdmission").doc(f.store.id).delete();
  await denied(confirmSaleV2.run(request(f))); await untouched(f);
  await seedAdmission(db, f.store.id);
  assert.equal((await confirmSaleV2.run(request(f))).status, "confirmed");
  assert.equal((await f.product.get()).data().quantidade, 4);
});
test("local composition preserves the mandatory demo/loopback execution gate", async () => {
  const f = await fixture(); const previous = process.env.FIRESTORE_EMULATOR_HOST;
  try {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    await assert.rejects(send(f), error => error.details?.reason === "local-emulator-only");
  } finally { process.env.FIRESTORE_EMULATOR_HOST = previous; }
  assert.equal(f.calls, 0); await untouched(f);
});
