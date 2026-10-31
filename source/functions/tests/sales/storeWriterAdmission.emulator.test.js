"use strict";
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
const admin = require("firebase-admin");
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
const admission = require("../../sales/storeWriterAdmission");
const {seedAdmission} = require("./fixtures/storeWriterAdmissionFixture.cjs");
const {confirmSaleV2, getSaleMutationResultV1} = require("../../sales/confirmSaleV2");
const {syncOfflineSale} = require("../../sales/syncOfflineSale");
const {updateProduct} = require("../../products/updateProduct");
const {updateProductV2, adjustProductStockV1} = require("../../products/productMutationV2");
const {archiveProduct} = require("../../products/archiveProduct");
const {restoreProduct} = require("../../products/restoreProduct");
const offlineFixture = require("./fixtures/currentSale");
after(() => db.terminate());
async function fixture(mode) {
  const uid = randomUUID(), operatorUid = randomUUID(), store = db.collection("stores").doc(randomUUID());
  const user = db.collection("users").doc(uid), product = store.collection("products").doc("p");
  await Promise.all([store.set({ownerId: uid, subscriptionStatus: "active", subscriptionType: "pro"}),
    user.set({storeId: store.id, role: "admin"}),
    product.set({name: "Original", price: 0.29, quantidade: 5, lotes: [], minimumStock: 0, imageUrl: ""}),
    db.collection("writerAdmissionOperators").doc(operatorUid).set({enabled: true, storeId: store.id})]);
  if (mode) await seedAdmission(db, store.id, mode);
  const saleId = randomUUID();
  const command = {schemaVersion: 2, requestId: saleId, saleId,
    scope: {projectId: db.projectId, storeId: store.id, uid}, origin: "online", saleKind: "instant",
    items: [{productId: "p", quantity: 1, expectedUnitPriceCents: 29}], expectedTotalCents: 29, paymentMethod: "Dinheiro"};
  return {uid, operatorUid, store, user, product, command, control: admission.controlRef(db, store.id)};
}
const send = f => confirmSaleV2.run({auth: {uid: f.uid}, data: f.command});
const query = f => getSaleMutationResultV1.run({auth: {uid: f.uid}, data: f.command});
const denied = promise => assert.rejects(promise, error => error.details?.reason === "writer-admission-denied");
const transition = (f, mode, expectedEpoch, extra = {}) => admission.transitionStoreWriterAdmission(db,
  {auth: {uid: f.operatorUid}, data: {storeId: f.store.id, requestId: randomUUID(), mode,
    expectedEpoch, reason: "Synthetic directed transition", ...extra}});
async function proof(f, epoch, overrides = {}) {
  const id = randomUUID();
  await db.collection("writerAdmissionEvidence").doc(id).set({storeId: f.store.id, epoch,
    schemaVersion: 1, policyRevision: admission.POLICY_REVISION, projectId: db.projectId,
    actorUid: f.operatorUid, createdAt: admin.firestore.Timestamp.now(),
    drainStartedAt: admin.firestore.Timestamp.now(), drainCompletedAt: admin.firestore.Timestamp.now(),
    inventoryRef: "synthetic-only-inventory", artifactSha256: "a".repeat(64),
    coveredWriters: admission.DRAIN_WRITERS, unresolvedOperationCount: 0, legacyClientsBlocked: true,
    legacyAdminDrained: true, pendingOperationsResolved: true, offlineReady: true,
    receivablesReady: true, cashReady: true, variantsReady: true, allWritersReviewed: true, ...overrides});
  return id;
}
async function counts(f) {
  return {quantity: (await f.product.get()).data().quantidade,
    sales: (await f.store.collection("sales").get()).size,
    receipts: (await f.store.collection("auditLogs").get()).size,
    cash: (await f.store.collection("cash_flow").get()).size};
}
const version = snapshot => ({seconds: String(snapshot.updateTime.seconds), nanoseconds: snapshot.updateTime.nanoseconds});

test("operator authentication, per-store scope and local-only management are mandatory", async () => {
  const f = await fixture();
  await assert.rejects(admission.transitionStoreWriterAdmission(db, {data: {}}), {code: "unauthenticated"});
  await assert.rejects(admission.transitionStoreWriterAdmission(db, {auth: {uid: f.uid}, data: {
    storeId: f.store.id, requestId: randomUUID(), expectedEpoch: 0, mode: "legacy", reason: "No operator grant"}}), {code: "permission-denied"});
  await assert.rejects(transition(f, "legacy", 0, {storeId: "foreign-store"}), {code: "permission-denied"});
  const previous = process.env.FIRESTORE_EMULATOR_HOST;
  try { delete process.env.FIRESTORE_EMULATOR_HOST;
    await assert.rejects(transition(f, "legacy", 0), error => error.details.reason === "admission-management-local-only");
  } finally { process.env.FIRESTORE_EMULATOR_HOST = previous; }
  assert.equal((await f.control.get()).exists, false);
});
test("transition receipt and control commit once; lost response replays after later mode changes", async () => {
  const f = await fixture(), requestId = randomUUID();
  const result = await transition(f, "legacy", 0, {requestId});
  assert.equal(result.epoch, 1);
  await transition(f, "draining", 1);
  assert.deepEqual(await transition(f, "legacy", 0, {requestId}), {...result, replayed: true});
  await assert.rejects(transition(f, "legacy", 0, {requestId, reason: "Divergent original identity"}), {code: "already-exists"});
  assert.equal((await f.control.get()).data().epoch, 2);
  assert.equal((await f.control.collection("changes").get()).size, 2);
});
test("concurrent transition writers cannot both advance the same expected epoch", async () => {
  const f = await fixture("legacy");
  const outcomes = await Promise.allSettled([transition(f, "draining", 1), transition(f, "draining", 1)]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.find(outcome => outcome.status === "rejected").reason.code, "aborted");
  assert.equal((await f.control.get()).data().epoch, 2);
  assert.equal((await f.control.collection("changes").get()).size, 1);
});
test("closing/reopening and safe rollback monotonically increase epoch; legacy reopening is forbidden", async () => {
  const f = await fixture();
  await transition(f, "legacy", 0); await transition(f, "draining", 1);
  assert.equal((await transition(f, "authoritative", 2, {evidenceId: await proof(f, 2)})).epoch, 3);
  assert.equal((await transition(f, "draining", 3)).epoch, 4);
  await assert.rejects(transition(f, "legacy", 4), error => error.details.reason === "invalid-admission-transition");
  await assert.rejects(transition(f, "authoritative", 4, {evidenceId: await proof(f, 2)}), error => error.details.reason === "drain-evidence-incomplete");
  assert.equal((await transition(f, "authoritative", 4, {evidenceId: await proof(f, 4)})).epoch, 5);
});
test("incomplete readiness or wrong store attestation cannot enable authoritative", async () => {
  const f = await fixture("draining");
  await assert.rejects(transition(f, "authoritative", 1), error => error.details.reason === "drain-evidence-required");
  for (const data of [{offlineReady: false}, {receivablesReady: false}, {cashReady: false},
    {variantsReady: false}, {legacyAdminDrained: false}, {storeId: "foreign"},
    {coveredWriters: []}, {unresolvedOperationCount: 1}, {artifactSha256: "missing"}, {inventoryRef: ""}]) {
    await assert.rejects(transition(f, "authoritative", 1, {evidenceId: await proof(f, 1, data)}),
      error => error.details.reason === "drain-evidence-incomplete");
  }
  assert.equal((await f.control.get()).data().mode, "draining");
  assert.equal((await f.control.collection("changes").get()).size, 0);
});
test("missing, malformed and obsolete revision controls deny V2 new effects without sealing identity", async () => {
  const f = await fixture(); await denied(send(f));
  for (const data of [{}, {schemaVersion: 1, mode: "authoritative", epoch: 1},
    {schemaVersion: 1, mode: "authoritative", epoch: 1, policyRevision: "old"}]) {
    await f.control.set(data); await denied(send(f));
  }
  assert.deepEqual(await counts(f), {quantity: 5, sales: 0, receipts: 0, cash: 0});
  assert.equal((await query(f)).status, "not-recorded");
  await seedAdmission(db, f.store.id); assert.equal((await send(f)).status, "confirmed");
});
test("quarantined legacy offline preserves historical replay while V2 follows writer admission", async () => {
  const f = await fixture("legacy");
  // Reuse the real approved S03 command/product shape, preserving its price.
  await f.product.set(offlineFixture.product);
  const data = {...structuredClone(offlineFixture.command), storeId: f.store.id, localSaleId: randomUUID()};
  const offline = body => syncOfflineSale.run({auth: {uid: f.uid}, data: body});
  await denied(send(f));
  const quarantined = body => assert.rejects(offline(body), error =>
    error.details?.reason === "legacy-offline-intent-unproven");
  const beforeLegacy = await counts(f);
  await quarantined(data);
  assert.deepEqual(await counts(f), beforeLegacy);
  // Synthetic evidence of a sale committed by an earlier release. The test
  // never creates this evidence by reopening the quarantined writer.
  await f.store.collection('sales').doc(data.localSaleId).create({
    localSaleId: data.localSaleId, isPaid: false, synthetic: true,
  });
  assert.equal((await offline(data)).alreadyProcessed, true);
  await transition(f, "draining", 1);
  assert.equal((await offline(data)).alreadyProcessed, true);
  await quarantined({...data, localSaleId: randomUUID()}); await denied(send(f));
  await transition(f, "authoritative", 2, {evidenceId: await proof(f, 2)});
  await quarantined({...data, localSaleId: randomUUID()});
  assert.equal((await offline(data)).alreadyProcessed, true);
  const price = offlineFixture.product.price;
  f.command.items[0].expectedUnitPriceCents = Math.round(price * 100);
  f.command.expectedTotalCents = Math.round(price * 100);
  assert.equal((await send(f)).status, "confirmed");
  await transition(f, "draining", 3);
  const before = await counts(f);
  assert.equal((await send(f)).replayed, true); assert.equal((await query(f)).status, "confirmed");
  assert.deepEqual(await counts(f), before);
});
test("V1 receipt survives cut; new V1 is denied and V2/stock remain authoritative", async () => {
  const f = await fixture("legacy");
  const product = {name: "Legacy", price: 0.29, quantidade: 5, lotes: [], minimumStock: 0, imageUrl: ""};
  const data = {productId: "p", requestId: randomUUID(), product};
  await updateProduct.run({auth: {uid: f.uid}, data});
  await transition(f, "draining", 1);
  await transition(f, "authoritative", 2, {evidenceId: await proof(f, 2)});
  assert.equal((await updateProduct.run({auth: {uid: f.uid}, data})).replayed, true);
  await denied(updateProduct.run({auth: {uid: f.uid}, data: {...data, requestId: randomUUID()}}));
  await updateProductV2.run({auth: {uid: f.uid}, data: {schemaVersion: 2, requestId: randomUUID(), productId: "p",
    expectedUpdateTime: version(await f.product.get()), changes: {set: {name: "Authoritative"}}}});
  await adjustProductStockV1.run({auth: {uid: f.uid}, data: {schemaVersion: 1, requestId: randomUUID(), productId: "p",
    expectedUpdateTime: version(await f.product.get()), reason: "Synthetic count", stockChange: {kind: "setManualQuantity", quantity: 2}}});
  await send(f); assert.equal((await f.product.get()).data().quantidade, 1);
});
test("Admin SDK retry cannot silently refresh epoch across A-B-A or change store", async () => {
  const f = await fixture("authoritative");
  const guard = admission.createStoreWriterAdmission(db, "confirmSaleV2", f.uid);
  let attempts = 0;
  await denied(db.runTransaction(async transaction => {
    attempts++;
    if (attempts === 2) await seedAdmission(db, f.store.id, "authoritative", 3);
    await guard(transaction, f.store.id);
    transaction.update(f.product, {quantidade: 4});
    throw Object.assign(new Error("synthetic ABORTED"), {code: 10});
  }, {maxAttempts: 3}));
  assert.equal(attempts, 2); assert.equal((await f.product.get()).data().quantidade, 5);
  await f.user.update({storeId: "other"});
  await assert.rejects(db.runTransaction(transaction => guard(transaction, f.store.id)), {code: "permission-denied"});
});
test("archive/restore new effects obey admission while already-applied state remains readable", async () => {
  const f = await fixture("legacy");
  const request = {auth: {uid: f.uid}, data: {storeId: f.store.id, productId: "p"}};
  await archiveProduct.run(request);
  await transition(f, "draining", 1);
  await archiveProduct.run(request);
  await denied(restoreProduct.run(request));
  assert.equal((await f.product.get()).data().isArchived, true);
});
test("failure after transition callback but before commit leaves neither control nor audit; same identity can resume", async () => {
  const f = await fixture(), requestId = randomUUID();
  const original = db.runTransaction;
  try {
    db.runTransaction = function(callback, options) {
      return original.call(this, async transaction => {
        await callback(transaction);
        throw new Error("synthetic failure before transition commit");
      }, options);
    };
    await assert.rejects(transition(f, "legacy", 0, {requestId}), /synthetic failure before transition commit/);
  } finally { db.runTransaction = original; }
  assert.equal((await f.control.get()).exists, false);
  assert.equal((await f.control.collection("changes").get()).size, 0);
  assert.equal((await transition(f, "legacy", 0, {requestId})).epoch, 1);
});
