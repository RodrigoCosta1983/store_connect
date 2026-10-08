"use strict";

const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {Firestore} = require("firebase-admin/firestore");
const {COLLECTION_NAMES, SETTING_NAMES} = require("../../backups/storeSnapshotContract");
const {canonicalState} = require("../../backups/storeRestoreTransform");
const {buildStoreRestorePlan} = require("../../backups/storeRestorePlanner");
const executor = require("../../backups/storeRestoreEmulator");
const verifier = require("../../backups/storeRestoreVerifier");
const {runStoreRestoreFlow: run} = require("../../backups/storeRestoreFlow");
const projectId = "demo-store-connect-restore";
assert.ok(["127.0.0.1:8080", "localhost:8080", "[::1]:8080"].includes(process.env.FIRESTORE_EMULATOR_HOST));
const db = new Firestore({projectId, host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false});
after(() => db.terminate());
const namespace = (n) => n === "cashFlow" ? "cash_flow" : n;
async function read(storeId) {
  const root = db.doc("stores/" + storeId); const rawRoot = (await root.get()).data() || {};
  const state = {storeSettings: Object.fromEntries(SETTING_NAMES.filter((k) => Object.hasOwn(rawRoot, k))
    .map((k) => [k, rawRoot[k]])), collections: {}};
  for (const name of COLLECTION_NAMES) {
    const docs = await root.collection(namespace(name)).get();
    state.collections[name] = docs.docs.map((d) => ({id: d.id, data: d.data()}));
  }
  return {rawRoot, state: canonicalState(state)};
}
async function fixture(label, mode, existing = false, count = 1) {
  const sourceStoreId = "R1G-A-" + label; const targetStoreId = "R1G-B-" + label;
  const snapshot = {snapshotVersion: 1, metadata: {storeId: sourceStoreId},
    storeSettings: Object.fromEntries(SETTING_NAMES.map((k) => [k, null])),
    collections: Object.fromEntries(COLLECTION_NAMES.map((name) => [name, Array.from({length: count}, (_, i) =>
      ({id: "doc-" + i, data: {name: "expected", ...(name === "sales" ? {storeId: sourceStoreId} : {})}}))]))};
  const ops = [[db.doc("stores/" + sourceStoreId), {...snapshot.storeSettings, ownerId: "source-owner"}]];
  for (const name of COLLECTION_NAMES) for (const doc of snapshot.collections[name]) {
    ops.push([db.doc(`stores/${sourceStoreId}/${namespace(name)}/${doc.id}`), doc.data]);
  }
  if (existing) {
    ops.push([db.doc("stores/" + targetStoreId), {name: "old", ownerId: "target-owner"}]);
    for (const name of COLLECTION_NAMES) for (const id of ["doc-0", "extra"]) {
      ops.push([db.doc(`stores/${targetStoreId}/${namespace(name)}/${id}`), {name: "old"}]);
    }
  }
  // Test fixture preparation only; R1G delegates all restore batching to R1C/D.
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch(); for (const [ref, data] of ops.slice(i, i + 400)) batch.set(ref, data); await batch.commit();
  }
  const sourceBefore = await read(sourceStoreId); const targetBefore = await read(targetStoreId);
  return {input: {snapshot, sourceStoreId, targetStoreId, targetState: targetBefore.state, mode, projectId},
    sourceBefore, targetBefore};
}
for (const mode of ["MERGE_A1", "REPLACE"]) for (const existing of [false, true]) {
  test(`real flow ${mode} existing=${existing}`, async () => {
    const f = await fixture(mode + existing, mode, existing);
    const {projectId: ignored, ...planning} = f.input; const plan = buildStoreRestorePlan(planning);
    const r = await run(f.input);
    assert.equal(r.status, "SUCCESS"); assert.equal(r.plan.planHash, plan.planHash);
    assert.equal(r.summary.materializedOperations, r.summary.plannedOperations);
    for (const [key, action] of [["created", "create"], ["updated", "overwrite"], ["deleted", "delete"], ["preserved", "preserve"]]) {
      assert.equal(r.summary[key], plan.plannedCounts.totals[action]);
    }
    assert.deepEqual(await read(f.input.sourceStoreId), f.sourceBefore);
    if (existing) assert.equal((await read(f.input.targetStoreId)).rawRoot.ownerId, "target-owner");
  });
}
test("tamper between real execution and real verifier; no repair or retry", async () => {
  const f = await fixture("tamper", "REPLACE", true);
  const original = executor.restoreStoreToEmulator; let calls = 0;
  executor.restoreStoreToEmulator = async (input) => {
    calls++; const execution = await original(input);
    await db.doc(`stores/${input.targetStoreId}/products/doc-0`).update({name: "tampered"});
    return execution;
  };
  let r;
  try { r = await run(f.input); } finally { executor.restoreStoreToEmulator = original; }
  assert.equal(calls, 1); assert.equal(r.status, "VERIFICATION_FAILED");
  assert.equal(r.summary.mismatchedDocuments, 1); assert.ok(r.verification.divergenceCount > 0);
  assert.equal((await db.doc(`stores/${f.input.targetStoreId}/products/doc-0`).get()).data().name, "tampered");
  assert.deepEqual(await read(f.input.sourceStoreId), f.sourceBefore);
});
for (const chunk of [1, 2]) test("real executor fail-fast chunk " + chunk, async () => {
  const f = await fixture("failure-" + chunk, "REPLACE", false, 170);
  const proto = Object.getPrototypeOf(db.batch()); const originalCommit = proto.commit;
  const originalVerify = verifier.verifyStoreRestoreInEmulator;
  let attempts = 0; let committed = 0; let verified = 0;
  proto.commit = async function(...args) {
    attempts++; if (attempts === chunk) throw new Error("SECRET_EXECUTOR_FAILURE");
    const value = await originalCommit.apply(this, args); committed++; return value;
  };
  verifier.verifyStoreRestoreInEmulator = async () => { verified++; throw new Error("MUST_NOT_VERIFY"); };
  let r;
  try { r = await run(f.input); }
  finally { proto.commit = originalCommit; verifier.verifyStoreRestoreInEmulator = originalVerify; }
  assert.equal(r.status, "EXECUTION_FAILED"); assert.equal(r.summary.materializedOperations, null);
  assert.equal(attempts, chunk); assert.equal(committed, chunk - 1); assert.equal(verified, 0);
  assert.ok(!JSON.stringify(r).includes("SECRET"));
  if (chunk === 2) assert.ok((await read(f.input.targetStoreId)).state.collections.products.length > 0);
  assert.deepEqual(await read(f.input.sourceStoreId), f.sourceBefore);
});
for (const mode of ["MERGE_A1", "REPLACE"]) test(">500 operations complete " + mode, async () => {
  const f = await fixture("scale-" + mode, mode, true, 105); const r = await run(f.input);
  assert.equal(r.status, "SUCCESS"); assert.ok(r.summary.plannedOperations > 500); assert.ok(r.execution.batches > 1);
  assert.equal(r.summary.materializedOperations, r.summary.plannedOperations);
  assert.equal(r.summary.matchedDocuments, r.verification.summary.expectedDocuments);
  const actual = await read(f.input.targetStoreId);
  for (const name of COLLECTION_NAMES) {
    const docs = actual.state.collections[name]; assert.equal(docs.length, mode === "REPLACE" ? 105 : 106);
    assert.equal(new Set(docs.map((d) => d.id)).size, docs.length);
  }
  assert.deepEqual(await read(f.input.sourceStoreId), f.sourceBefore);
});
for (const mode of ["MERGE_A1", "REPLACE"]) test("equivalent baseline deterministic " + mode, async () => {
  const label = "repeat-" + mode; const first = await fixture(label, mode, true);
  const r1 = await run(first.input); const state1 = await read(first.input.targetStoreId);
  const second = await fixture(label, mode, true); const r2 = await run(second.input);
  assert.deepEqual(r1, r2); assert.deepEqual(await read(second.input.targetStoreId), state1);
  assert.deepEqual(await read(second.input.sourceStoreId), first.sourceBefore);
});
for (const kind of ["host", "project", "target", "same-store"]) test("fail closed before writes " + kind, async () => {
  const f = await fixture("guard-" + kind, "MERGE_A1", true);
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const proto = Object.getPrototypeOf(db.batch()); const original = proto.commit;
  let writes = 0; proto.commit = async () => { writes++; throw new Error("MUST_NOT_WRITE"); };
  try {
    if (kind === "host") process.env.FIRESTORE_EMULATOR_HOST = "prod.example:8080";
    if (kind === "project") f.input.projectId = "store-connect-app";
    if (kind === "target") f.input.targetStoreId = "bad/id";
    if (kind === "same-store") f.input.targetStoreId = f.input.sourceStoreId;
    if (["target", "same-store"].includes(kind)) await assert.rejects(run(f.input));
    else assert.equal((await run(f.input)).status, "EXECUTION_FAILED");
  } finally { process.env.FIRESTORE_EMULATOR_HOST = host; proto.commit = original; }
  assert.equal(writes, 0);
  assert.deepEqual(await read("R1G-B-guard-" + kind), f.targetBefore);
  assert.deepEqual(await read(f.input.sourceStoreId), f.sourceBefore);
});
