"use strict";

const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {Firestore, Timestamp, GeoPoint, DocumentReference} = require("firebase-admin/firestore");
const {COLLECTION_NAMES, SETTING_NAMES} = require("../../backups/storeSnapshotContract");
const {buildStoreRestorePlan: build} = require("../../backups/storeRestorePlanner");
const {transformStoreSnapshot, canonicalState} = require("../../backups/storeRestoreTransform");
const {decodeStoreSnapshotValue: decode} = require("../../backups/storeSnapshotDecoder");
const {restoreStoreToEmulator: restore} = require("../../backups/storeRestoreEmulator");

const projectId = "demo-store-connect-restore";
assert.ok(["127.0.0.1:8080", "localhost:8080", "[::1]:8080"].includes(process.env.FIRESTORE_EMULATOR_HOST));
const db = new Firestore({projectId, host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false});
after(() => db.terminate());
const namespace = (n) => n === "cashFlow" ? "cash_flow" : n;
const marker = (type, fields) => ({__storeConnectType: type, ...fields});
const clone = (v) => JSON.parse(JSON.stringify(v));
function encode(v) {
  if (v instanceof Timestamp) return marker("timestamp", {seconds: v.seconds, nanoseconds: v.nanoseconds});
  if (v instanceof GeoPoint) return marker("geoPoint", {latitude: v.latitude, longitude: v.longitude});
  if (v instanceof DocumentReference) return marker("documentReference", {path: v.path});
  if (Buffer.isBuffer(v)) return marker("bytes", {base64: v.toString("base64")});
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}
async function read(store) {
  const root = db.doc("stores/" + store);
  const rawRoot = encode((await root.get()).data() || {});
  const state = {storeSettings: Object.fromEntries(SETTING_NAMES.filter((k) => Object.hasOwn(rawRoot, k))
    .map((k) => [k, rawRoot[k]])), collections: {}};
  for (const n of COLLECTION_NAMES) {
    const docs = await root.collection(namespace(n)).get();
    state.collections[n] = docs.docs.map((d) => ({id: d.id, data: encode(d.data())}));
  }
  return {state: canonicalState(state), rawRoot};
}
function sdk(value, store) {
  const approvedReferencePaths = [];
  function visit(v) {
    if (!v || typeof v !== "object") return;
    if (v.__storeConnectType === "documentReference") approvedReferencePaths.push(v.path);
    else Object.values(v).forEach(visit);
  }
  visit(value);
  return decode(value, {targetStoreId: store, approvedReferencePaths, referenceFactory: (p) => db.doc(p)});
}
async function seed(store, state, rootExtras) {
  const decoded = sdk(state, store);
  const operations = [[db.doc("stores/" + store), {...decoded.storeSettings, ...rootExtras}]];
  for (const n of COLLECTION_NAMES) for (const d of decoded.collections[n]) {
    operations.push([db.doc(`stores/${store}/${namespace(n)}/${d.id}`), d.data]);
  }
  for (let i = 0; i < operations.length; i += 400) {
    const batch = db.batch();
    for (const [ref, data] of operations.slice(i, i + 400)) batch.set(ref, data);
    await batch.commit();
  }
}
async function fixture(label, count = 1) {
  const sourceStoreId = "R1D-A-" + label; const targetStoreId = "R1D-B-" + label;
  const snapshot = {snapshotVersion: 1, metadata: {storeId: sourceStoreId},
    storeSettings: Object.fromEntries(SETTING_NAMES.map((k) => [k, null])), collections: {}};
  snapshot.storeSettings.name = "Approved name";
  snapshot.storeSettings.lowStockThreshold = 7;
  snapshot.storeSettings.pixQrCodeUpdatedAt = marker("timestamp", {seconds: 100, nanoseconds: 123000});
  function data(n, i) {
    return {name: n + i, at: marker("timestamp", {seconds: 200, nanoseconds: 987000}),
      nested: {items: [null, true, {point: marker("geoPoint", {latitude: -23, longitude: 45})}]},
      bytes: marker("bytes", {base64: "AAH/"}),
      ref: marker("documentReference", {path: `stores/${sourceStoreId}/products/same`}),
      ...(n === "sales" ? {storeId: sourceStoreId} : {})};
  }
  for (const n of COLLECTION_NAMES) {
    snapshot.collections[n] = [{id: "same", data: data(n, "same")}];
    for (let i = 0; i < count; i++) snapshot.collections[n].push(
      {id: "create-" + i, data: data(n, i)}, {id: "update-" + i, data: data(n, i)});
  }
  const desired = transformStoreSnapshot({snapshot, sourceStoreId, targetStoreId}).desiredState;
  const baseline = clone(desired);
  baseline.storeSettings.name = "Previous name";
  baseline.storeSettings.phone = "Previous phone";
  for (const n of COLLECTION_NAMES) {
    baseline.collections[n] = baseline.collections[n].filter((d) => !d.id.startsWith("create-"));
    for (const d of baseline.collections[n]) if (d.id.startsWith("update-")) {
      d.data.name = "Previous content"; d.data.onlyBefore = "must disappear on overwrite";
    }
    for (let i = 0; i < count; i++) baseline.collections[n].push({id: "extra-" + i, data: {extra: i,
      at: marker("timestamp", {seconds: 300, nanoseconds: 1000}), nullable: null}});
  }
  await seed(sourceStoreId, snapshot, {ownerId: "source-owner", subscription: {status: "source"}});
  await seed(targetStoreId, baseline, {ownerId: "target-owner", subscription: {status: "target"}});
  const outsidePaths = [`stores/${targetStoreId}/auditLogs/keep`,
    `stores/${targetStoreId}/catalogs/keep`, `stores/${targetStoreId}/products/extra-0/notes/keep`,
    `stores/${sourceStoreId}/auditLogs/keep`];
  for (const path of outsidePaths) await db.doc(path).set({sentinel: path});
  return {snapshot, sourceStoreId, targetStoreId, outsidePaths};
}
async function outside(paths) {
  return Promise.all(paths.map(async (path) => ({path, data: encode((await db.doc(path).get()).data())})));
}
function plannedOperations(plan) {
  const operations = [];
  if (plan.settings.set.length) operations.push({kind: "set", path: "stores/" + plan.targetStoreId});
  for (const n of COLLECTION_NAMES) for (const action of ["create", "overwrite", "delete"]) {
    for (const id of plan.collections[n][action]) operations.push({kind: action === "overwrite" ? "set" : action,
      path: `stores/${plan.targetStoreId}/${namespace(n)}/${id}`});
  }
  return operations;
}
// Expectations interpret action lists only: no diff or mode-specific merge rules.
function expectedFromPlan(before, plan) {
  const expected = clone(before);
  for (const k of plan.settings.set) expected.storeSettings[k] = clone(plan.desiredState.storeSettings[k]);
  for (const n of COLLECTION_NAMES) {
    const docs = new Map(expected.collections[n].map((d) => [d.id, d]));
    const desired = new Map(plan.desiredState.collections[n].map((d) => [d.id, d]));
    for (const action of ["create", "overwrite"]) for (const id of plan.collections[n][action]) docs.set(id, clone(desired.get(id)));
    for (const id of plan.collections[n].delete) docs.delete(id);
    expected.collections[n] = [...docs.values()];
  }
  return canonicalState(expected);
}
// Observe real SDK commits; the only injection is a test-scoped fatal error.
// The executor still constructs its own guarded Emulator client.
async function observe(run, failAt = 0) {
  const prototype = Object.getPrototypeOf(db.batch());
  const originals = Object.fromEntries(["create", "set", "delete", "commit"].map((k) => [k, prototype[k]]));
  const recorded = new WeakMap(); const attempted = []; const committed = [];
  for (const kind of ["create", "set", "delete"]) prototype[kind] = function(ref, ...args) {
    const ops = recorded.get(this) || []; ops.push({kind, path: ref.path}); recorded.set(this, ops);
    return originals[kind].call(this, ref, ...args);
  };
  prototype.commit = async function(...args) {
    const ops = recorded.get(this) || []; attempted.push(ops);
    assert.ok(ops.length <= 400 && ops.length > 0);
    if (attempted.length === failAt) throw new Error("R1D_INJECTED_CHUNK_FAILURE");
    const result = await originals.commit.apply(this, args); committed.push(ops); return result;
  };
  try { return {result: await run(), attempted, committed}; }
  finally { for (const [key, original] of Object.entries(originals)) prototype[key] = original; }
}
async function checkSdk(plan) {
  for (const n of COLLECTION_NAMES) for (const d of plan.desiredState.collections[n]) {
    const actual = (await db.doc(`stores/${plan.targetStoreId}/${namespace(n)}/${d.id}`).get()).data();
    assert.ok(actual.at instanceof Timestamp); assert.ok(actual.bytes instanceof Buffer);
    assert.ok(actual.nested.items[2].point instanceof GeoPoint); assert.ok(actual.ref instanceof DocumentReference);
    assert.equal(actual.ref.path, `stores/${plan.targetStoreId}/products/same`);
    assert.deepEqual(encode(actual), d.data);
  }
}
for (const mode of ["MERGE_A1", "REPLACE"]) for (const count of [1, 70]) {
  test(`${mode} existing destination, ${count === 1 ? "all actions and SDK" : ">500 mixed operations"}, repeat deterministically`, async () => {
    const f = await fixture(mode + "-" + count, count);
    const sourceBefore = await read(f.sourceStoreId); const outsideBefore = await outside(f.outsidePaths);
    const before = await read(f.targetStoreId);
    const plan = build({snapshot: f.snapshot, sourceStoreId: f.sourceStoreId, targetStoreId: f.targetStoreId,
      targetState: before.state, mode});
    assert.equal(plan.blockers.length, 0);
    for (const n of COLLECTION_NAMES) {
      assert.equal(plan.collections[n].create.length, count);
      assert.equal(plan.collections[n].overwrite.length, count);
      assert.equal(plan.collections[n].unchanged.length, 1);
    }
    assert.ok(plan.plannedCounts.totals[mode === "MERGE_A1" ? "preserve" : "delete"] > 0);
    const expected = expectedFromPlan(before.state, plan);
    const args = {plan, desiredState: plan.desiredState, targetStoreId: f.targetStoreId, projectId};
    const observed = await observe(() => restore(args));
    const operations = plannedOperations(plan);
    assert.deepEqual(observed.committed.flat(), operations);
    assert.deepEqual(observed.attempted, observed.committed);
    assert.equal(new Set(operations.map((op) => op.path)).size, operations.length);
    assert.deepEqual(observed.result, {writes: operations.length, batches: observed.committed.length});
    if (count > 1) {
      assert.ok(operations.length > 500);
      assert.ok(observed.committed.length > 1);
    }
    const actual = await read(f.targetStoreId);
    for (const n of COLLECTION_NAMES) assert.deepEqual(actual.state.collections[n], expected.collections[n], n);
    assert.deepEqual(actual.state.storeSettings, expected.storeSettings);
    assert.deepEqual(actual.rawRoot, {...before.rawRoot, ...expected.storeSettings});
    assert.deepEqual(await read(f.sourceStoreId), sourceBefore);
    assert.deepEqual(await outside(f.outsidePaths), outsideBefore);
    await checkSdk(plan);
    const nextPlan = build({snapshot: f.snapshot, sourceStoreId: f.sourceStoreId, targetStoreId: f.targetStoreId,
      targetState: actual.state, mode});
    const repeated = await observe(() => restore({...args, plan: nextPlan, desiredState: nextPlan.desiredState}));
    assert.deepEqual(repeated.committed.flat(), plannedOperations(nextPlan));
    assert.equal(repeated.result.writes, plannedOperations(nextPlan).length);
    assert.deepEqual(await read(f.targetStoreId), actual);
    assert.deepEqual(await read(f.sourceStoreId), sourceBefore);
    assert.deepEqual(await outside(f.outsidePaths), outsideBefore);
  });
}

test("fatal second chunk error propagates; first chunk remains; third never runs; no partial success", async () => {
  const f = await fixture("fail-fast", 70);
  const sourceBefore = await read(f.sourceStoreId); const before = await read(f.targetStoreId);
  const outsideBefore = await outside(f.outsidePaths);
  const plan = build({snapshot: f.snapshot, sourceStoreId: f.sourceStoreId, targetStoreId: f.targetStoreId,
    targetState: before.state, mode: "REPLACE"});
  const operations = plannedOperations(plan);
  assert.ok(operations.length > 800);
  let success = false;
  const observed = await observe(async () => {
    await assert.rejects(async () => {
      await restore({plan, desiredState: plan.desiredState, targetStoreId: f.targetStoreId, projectId});
      success = true;
    }, /R1D_INJECTED_CHUNK_FAILURE/);
  }, 2);
  assert.equal(success, false);
  assert.equal(observed.attempted.length, 2);
  assert.equal(observed.committed.length, 1);
  assert.deepEqual(observed.committed.flat(), operations.slice(0, 400));
  assert.deepEqual(observed.attempted.flat(), operations.slice(0, 800));
  const executed = new Set(observed.committed.flat().map((op) => op.path));
  const partial = clone(plan);
  if (!executed.has("stores/" + f.targetStoreId)) partial.settings.set = [];
  for (const n of COLLECTION_NAMES) for (const action of ["create", "overwrite", "delete"]) {
    partial.collections[n][action] = partial.collections[n][action].filter((id) =>
      executed.has(`stores/${f.targetStoreId}/${namespace(n)}/${id}`));
  }
  // No global rollback is promised: only the committed prefix is materialized.
  assert.deepEqual((await read(f.targetStoreId)).state, expectedFromPlan(before.state, partial));
  assert.deepEqual(await read(f.sourceStoreId), sourceBefore);
  assert.deepEqual(await outside(f.outsidePaths), outsideBefore);
});

for (const scenario of ["host", "project", "same-store"]) test("existing destination guard rejects before writes: " + scenario, async () => {
  const f = await fixture("guard-" + scenario);
  const sourceBefore = await read(f.sourceStoreId); const before = await read(f.targetStoreId);
  const plan = build({snapshot: f.snapshot, sourceStoreId: f.sourceStoreId, targetStoreId: f.targetStoreId,
    targetState: before.state, mode: "MERGE_A1"});
  const args = {plan, desiredState: plan.desiredState, targetStoreId: f.targetStoreId, projectId};
  const originalHost = process.env.FIRESTORE_EMULATOR_HOST;
  const observed = await observe(async () => {
    try {
      if (scenario === "host") delete process.env.FIRESTORE_EMULATOR_HOST;
      if (scenario === "project") args.projectId = "store-connect-app";
      if (scenario === "same-store") args.targetStoreId = f.sourceStoreId;
      await assert.rejects(restore(args), (error) => ["INVALID_EMULATOR_HOST", "INVALID_EMULATOR_PROJECT",
        "INVALID_RESTORE_PLAN"].includes(error.code));
    } finally { process.env.FIRESTORE_EMULATOR_HOST = originalHost; }
  });
  assert.equal(observed.attempted.length, 0);
  assert.deepEqual(await read(f.sourceStoreId), sourceBefore);
  assert.deepEqual(await read(f.targetStoreId), before);
});
