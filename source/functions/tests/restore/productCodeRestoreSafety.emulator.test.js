"use strict";

const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const {Firestore, WriteBatch} = require("firebase-admin/firestore");
const {COLLECTION_NAMES, SETTING_NAMES} = require("../../backups/storeSnapshotContract");
const {buildStoreRestorePlan} = require("../../backups/storeRestorePlanner");
const {restoreStoreToEmulator} = require("../../backups/storeRestoreEmulator");
const {hash} = require("../../backups/storeRestoreTransform");
const projectId = "demo-store-connect-restore";
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):8080$/);
const db = new Firestore({projectId, host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false});
after(() => db.terminate());
const empty = () => ({storeSettings: {}, collections: Object.fromEntries(COLLECTION_NAMES.map((name) => [name, []]))});
function plan(targetStoreId, targetState, products = []) {
  const snapshot = {snapshotVersion: 1, metadata: {storeId: "source"}, ...empty()};
  snapshot.storeSettings = Object.fromEntries(SETTING_NAMES.map((name) => [name, null]));
  snapshot.collections.products = products;
  return buildStoreRestorePlan({snapshot, sourceStoreId: "source", targetStoreId, targetState, mode: "REPLACE"});
}
for (const isArchived of [false, true]) test("COD snapshot blocks dry-run readiness and executor; archived=" + isArchived, async () => {
  const targetStoreId = randomUUID();
  const p = plan(targetStoreId, empty(), [{id: "p", data: {cod: "CODE", isArchived}}]);
  assert.ok(p.blockers.some((b) => b.code === "PRODUCT_CODES_REQUIRE_RESTORE_POLICY"));
  // Even a forged plan with rehashed blockers cannot reach writes.
  p.blockers = []; delete p.planHash; p.planHash = hash(p);
  await assert.rejects(restoreStoreToEmulator({plan: p, desiredState: p.desiredState, targetStoreId, projectId}),
    /RESTORE_EXECUTION_BLOCKED_INTEGRITY/);
  assert.equal((await db.doc("stores/" + targetStoreId).get()).exists, false);
});
for (const owner of ["legacy", "product", "variant"]) test("existing " + owner + " reservation is preserved; no partial commits", async () => {
  const targetStoreId = randomUUID(); const root = db.doc("stores/" + targetStoreId);
  const reservation = {cod: "CODE", productId: "p", ...(owner === "legacy" ? {} :
    {ownerType: owner, variantId: owner === "variant" ? "v" : null})};
  await root.set({sentinel: true});
  await root.collection("productCodes").doc("reservation").set(reservation);
  const p = plan(targetStoreId, empty(), [{id: "p", data: {name: "Without COD"}}]);
  const original = WriteBatch.prototype.commit; let commits = 0;
  WriteBatch.prototype.commit = async function() { commits++; throw new Error("INJECTED_FAILURE"); };
  try {
    await assert.rejects(restoreStoreToEmulator({plan: p, desiredState: p.desiredState, targetStoreId, projectId}),
      /RESTORE_EXECUTION_BLOCKED_INTEGRITY/);
  } finally { WriteBatch.prototype.commit = original; }
  assert.equal(commits, 0);
  assert.deepEqual((await root.get()).data(), {sentinel: true});
  assert.deepEqual((await root.collection("productCodes").doc("reservation").get()).data(), reservation);
  assert.equal((await root.collection("products").get()).size, 0);
});
test("multi-batch restore is blocked before first commit", async () => {
  const targetStoreId = randomUUID();
  const p = plan(targetStoreId, empty(), Array.from({length: 850}, (_, i) => ({id: "p" + i, data: {name: "P"}})));
  await assert.rejects(restoreStoreToEmulator({plan: p, desiredState: p.desiredState, targetStoreId, projectId}),
    /RESTORE_EXECUTION_BLOCKED_INTEGRITY/);
  assert.equal((await db.doc("stores/" + targetStoreId).collection("products").get()).size, 0);
});
