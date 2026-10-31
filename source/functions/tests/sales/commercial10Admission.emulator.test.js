"use strict";
const {test, after} = require("node:test"), assert = require("node:assert/strict"), {randomUUID, createHash} = require("node:crypto");
const {Timestamp} = require("firebase-admin/firestore");
const {admin, db, fixture, call, state} = require("./fixtures/commercial08Fixture.cjs");
const {transitionStoreWriterAdmission, createStoreWriterAdmission, DRAIN_WRITERS, POLICY_REVISION} = require("../../sales/storeWriterAdmission");
after(async () => { await db.terminate(); await admin.app().delete(); });
async function setup() {
  const f = await fixture(); f.operatorUid = "operator-" + randomUUID();
  await db.collection("writerAdmissionOperators").doc(f.operatorUid).set({storeId: f.store.id, enabled: true});
  f.transition = (mode, expectedEpoch, extra = {}) => transitionStoreWriterAdmission(db, {auth: {uid: f.operatorUid},
    data: {storeId: f.store.id, requestId: randomUUID(), mode, expectedEpoch, reason: "Synthetic HML rehearsal", ...extra}});
  return f;
}
async function evidence(f, epoch, override = {}) {
  const id = randomUUID(), inventory = JSON.stringify({storeId: f.store.id, writers: DRAIN_WRITERS});
  await db.collection("writerAdmissionEvidence").doc(id).set({schemaVersion: 1, storeId: f.store.id, epoch,
    policyRevision: POLICY_REVISION, projectId: db.projectId, actorUid: f.operatorUid, createdAt: Timestamp.now(),
    drainStartedAt: Timestamp.now(), drainCompletedAt: Timestamp.now(), inventoryRef: "synthetic-only-inventory",
    artifactSha256: createHash("sha256").update(inventory).digest("hex"), coveredWriters: DRAIN_WRITERS,
    unresolvedOperationCount: 0, legacyClientsBlocked: true, legacyAdminDrained: true,
    pendingOperationsResolved: true, offlineReady: true, receivablesReady: true, cashReady: true,
    variantsReady: true, allWritersReviewed: true, ...override});
  return id;
}
test("reviewed transition legacy -> draining -> authoritative requires complete bound evidence and preserves epochs", async () => {
  const f = await setup(); assert.equal((await f.transition("draining", 1)).epoch, 2);
  const bad = await evidence(f, 2, {offlineReady: false});
  await assert.rejects(f.transition("authoritative", 2, {evidenceId: bad}), e => e.details.reason === "drain-evidence-incomplete");
  for (const patch of [{projectId: "store-connect-hml"}, {storeId: "foreign"}, {epoch: 1}, {actorUid: "other"}, {coveredWriters: []}]) {
    const wrong = await evidence(f, 2, patch);
    await assert.rejects(f.transition("authoritative", 2, {evidenceId: wrong}), e => e.details.reason === "drain-evidence-incomplete");
  }
  const proof = await evidence(f, 2), stable = randomUUID();
  const first = await f.transition("authoritative", 2, {evidenceId: proof, requestId: stable});
  assert.equal(first.epoch, 3); assert.equal(first.mode, "authoritative");
  assert.equal((await f.transition("authoritative", 2, {evidenceId: proof, requestId: stable})).replayed, true);
  for (const writer of ["syncOfflineSale", "updateProduct"]) {
    const guard = createStoreWriterAdmission(db, writer, f.scope.uid);
    await assert.rejects(db.runTransaction(tx => guard(tx, f.store.id)), e => e.details.reason === "writer-admission-denied");
  }
  const r = await call(f, "createDeferredSaleV1", f.deferred); assert.equal(r.body.result.status, "confirmed");
});
test("concurrent management at same epoch has one winner; no owner privilege or forged epoch bypass", async () => {
  const f = await setup();
  const replies = await Promise.allSettled([f.transition("draining", 1), f.transition("draining", 1)]);
  assert.equal(replies.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await db.collection("storeWriterAdmission").doc(f.store.id).get()).data().epoch, 2);
  await assert.rejects(f.transition("authoritative", 1), e => e.code === "aborted");
  await db.collection("writerAdmissionOperators").doc(f.operatorUid).update({enabled: false});
  await assert.rejects(f.transition("authoritative", 2), e => e.code === "permission-denied");
  const s = await state(f); assert.equal(s.sales.length, 0); assert.equal(s.product.quantidade, 5);
});
