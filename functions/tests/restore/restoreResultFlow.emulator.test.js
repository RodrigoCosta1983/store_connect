"use strict";

const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {Firestore} = require("firebase-admin/firestore");
const {COLLECTION_NAMES, SETTING_NAMES} = require("../../backups/storeSnapshotContract");
const {canonicalState} = require("../../backups/storeRestoreTransform");
const {buildStoreRestorePlan: build} = require("../../backups/storeRestorePlanner");
const {restoreStoreToEmulator: restore} = require("../../backups/storeRestoreEmulator");
const {verifyStoreRestoreInEmulator: verify} = require("../../backups/storeRestoreVerifier");
const {buildStoreRestoreResult: result} = require("../../backups/storeRestoreResult");
const projectId = "demo-store-connect-restore";
assert.ok(["127.0.0.1:8080", "localhost:8080", "[::1]:8080"].includes(process.env.FIRESTORE_EMULATOR_HOST));
const db = new Firestore({projectId, host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false});
after(() => db.terminate());
const namespace = (n) => n === "cashFlow" ? "cash_flow" : n;
async function read(storeId) {
  const root = db.doc("stores/" + storeId); const rawRoot = (await root.get()).data() || {};
  const state = {storeSettings: Object.fromEntries(SETTING_NAMES.filter((k) => Object.hasOwn(rawRoot, k)).map((k) => [k, rawRoot[k]])), collections: {}};
  for (const n of COLLECTION_NAMES) {
    const docs = await root.collection(namespace(n)).get();
    state.collections[n] = docs.docs.map((d) => ({id: d.id, data: d.data()}));
  }
  return {rawRoot, state: canonicalState(state)};
}
async function fixture(label, mode, existing, count = 1) {
  const sourceStoreId = "R1F-A-" + label; const targetStoreId = "R1F-B-" + label;
  const snapshot = {snapshotVersion: 1, metadata: {storeId: sourceStoreId},
    storeSettings: Object.fromEntries(SETTING_NAMES.map((k) => [k, null])),
    collections: Object.fromEntries(COLLECTION_NAMES.map((n) => [n, Array.from({length: count}, (_, i) =>
      ({id: "doc-" + i, data: {name: "expected", ...(n === "sales" ? {storeId: sourceStoreId} : {})}}))]))};
  const ops = [[db.doc("stores/" + sourceStoreId), {...snapshot.storeSettings, ownerId: "source-owner"}]];
  for (const n of COLLECTION_NAMES) for (const d of snapshot.collections[n]) ops.push([db.doc(`stores/${sourceStoreId}/${namespace(n)}/${d.id}`), d.data]);
  if (existing) {
    ops.push([db.doc("stores/" + targetStoreId), {name: "old", ownerId: "target-owner"}]);
    for (const n of COLLECTION_NAMES) for (const id of ["doc-0", "extra"]) ops.push([db.doc(`stores/${targetStoreId}/${namespace(n)}/${id}`), {name: "old"}]);
  }
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch(); for (const [ref, data] of ops.slice(i, i + 400)) batch.set(ref, data); await batch.commit();
  }
  const sourceBefore = await read(sourceStoreId); const baselineState = (await read(targetStoreId)).state;
  const plan = build({snapshot, sourceStoreId, targetStoreId, targetState: baselineState, mode});
  return {plan, desiredState: plan.desiredState, targetStoreId, projectId, baselineState, sourceStoreId, sourceBefore};
}
for (const mode of ["MERGE_A1", "REPLACE"]) for (const existing of [false, true]) test(`flow ${mode} existing=${existing}`, async () => {
  const f = await fixture(mode + existing, mode, existing);
  const execution = await restore(f); const verification = await verify(f);
  const beforeB = await read(f.targetStoreId);
  const r = result({plan: f.plan, execution, verification});
  assert.equal(r.status, "SUCCESS"); assert.equal(r.summary.materializedOperations, execution.writes);
  assert.equal(r.summary.plannedOperations, execution.writes);
  assert.equal(r.plan.planHash, f.plan.planHash);
  assert.deepEqual(await read(f.sourceStoreId), f.sourceBefore); assert.deepEqual(await read(f.targetStoreId), beforeB);
});
test("tampered B produces VERIFICATION_FAILED without repair", async () => {
  const f = await fixture("tamper", "REPLACE", true); const execution = await restore(f);
  await db.doc(`stores/${f.targetStoreId}/products/doc-0`).update({name: "wrong"});
  const verification = await verify(f); const before = await read(f.targetStoreId);
  const r = result({plan: f.plan, execution, verification});
  assert.equal(r.status, "VERIFICATION_FAILED"); assert.equal(r.summary.mismatchedDocuments, 1);
  assert.deepEqual(await read(f.targetStoreId), before); assert.deepEqual(await read(f.sourceStoreId), f.sourceBefore);
});
for (const mode of ["MERGE_A1", "REPLACE"]) test("flow >500 operations " + mode, async () => {
  const f = await fixture("scale-" + mode, mode, true, 105);
  const execution = await restore(f); assert.ok(execution.writes > 500); assert.ok(execution.batches > 1);
  const verification = await verify(f); const r = result({plan: f.plan, execution, verification});
  assert.equal(r.status, "SUCCESS"); assert.equal(r.summary.plannedOperations, execution.writes);
  assert.equal(r.summary.matchedDocuments, verification.summary.expectedDocuments);
  assert.deepEqual(await read(f.sourceStoreId), f.sourceBefore);
});
for (const failingChunk of [1, 2]) test("controlled chunk failure " + failingChunk, async () => {
  const f = await fixture("failure-" + failingChunk, "REPLACE", false, 170);
  const proto = Object.getPrototypeOf(db.batch()); const original = proto.commit;
  let attempted = 0; let committed = 0; let executionError;
  proto.commit = async function(...args) {
    attempted++; if (attempted === failingChunk) throw new Error("R1F_INJECTED_SECRET_FAILURE");
    const value = await original.apply(this, args); committed++; return value;
  };
  try { await restore(f); assert.fail("executor must fail"); }
  catch (error) { executionError = error; }
  finally { proto.commit = original; }
  assert.match(executionError.message, /R1F_INJECTED_SECRET_FAILURE/);
  assert.equal(attempted, failingChunk); assert.equal(committed, failingChunk - 1);
  const beforeB = await read(f.targetStoreId);
  const r = result({plan: f.plan, executionError});
  assert.equal(r.status, "EXECUTION_FAILED"); assert.equal(r.summary.materializedOperations, null);
  assert.ok(!JSON.stringify(r).includes("SECRET"));
  if (failingChunk === 2) assert.ok(beforeB.state.collections.products.length > 0);
  assert.deepEqual(await read(f.targetStoreId), beforeB); assert.deepEqual(await read(f.sourceStoreId), f.sourceBefore);
});
