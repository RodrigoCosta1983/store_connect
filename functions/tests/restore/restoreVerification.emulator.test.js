"use strict";

const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {Firestore, Timestamp, GeoPoint, DocumentReference, FieldValue} = require("firebase-admin/firestore");
const {COLLECTION_NAMES, SETTING_NAMES} = require("../../backups/storeSnapshotContract");
const {canonicalState} = require("../../backups/storeRestoreTransform");
const {buildStoreRestorePlan: build} = require("../../backups/storeRestorePlanner");
const {restoreStoreToEmulator: restore} = require("../../backups/storeRestoreEmulator");
const {decodeStoreSnapshotValue: decode} = require("../../backups/storeSnapshotDecoder");
const {verifyStoreRestoreInEmulator: verify} = require("../../backups/storeRestoreVerifier");

const projectId = "demo-store-connect-restore";
assert.ok(["127.0.0.1:8080", "localhost:8080", "[::1]:8080"].includes(process.env.FIRESTORE_EMULATOR_HOST));
const db = new Firestore({projectId, host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false});
after(() => db.terminate());
const namespace = (n) => n === "cashFlow" ? "cash_flow" : n;
const marker = (type, fields) => ({__storeConnectType: type, ...fields});
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
  const root = db.doc("stores/" + store); const rawRoot = encode((await root.get()).data() || {});
  const state = {storeSettings: Object.fromEntries(SETTING_NAMES.filter((k) => Object.hasOwn(rawRoot, k))
    .map((k) => [k, rawRoot[k]])), collections: {}};
  for (const n of COLLECTION_NAMES) {
    const docs = await root.collection(namespace(n)).get();
    state.collections[n] = docs.docs.map((d) => ({id: d.id, data: encode(d.data())}));
  }
  return {state: canonicalState(state), rawRoot};
}
async function fixture(label, mode = "REPLACE", existing = false, count = 1) {
  const sourceStoreId = "R1E-A-" + label; const targetStoreId = "R1E-B-" + label;
  const snapshot = {snapshotVersion: 1, metadata: {storeId: sourceStoreId},
    storeSettings: Object.fromEntries(SETTING_NAMES.map((k) => [k, null])), collections: {}};
  snapshot.storeSettings.name = "Approved";
  for (const n of COLLECTION_NAMES) snapshot.collections[n] = Array.from({length: count}, (_, i) => ({id: "doc-" + i,
    data: {name: "expected", nullable: null, nested: {items: [true, null, {x: 1}]},
      at: marker("timestamp", {seconds: 100, nanoseconds: 123000}),
      point: marker("geoPoint", {latitude: -23, longitude: 45}), bytes: marker("bytes", {base64: "AAH/"}),
      ref: marker("documentReference", {path: `stores/${sourceStoreId}/products/doc-0`}),
      ...(n === "sales" ? {storeId: sourceStoreId} : {})}}));
  const sdk = decode(snapshot, {targetStoreId: sourceStoreId,
    approvedReferencePaths: [`stores/${sourceStoreId}/products/doc-0`], referenceFactory: (p) => db.doc(p)});
  const ops = [[db.doc("stores/" + sourceStoreId), {...sdk.storeSettings, ownerId: "source-owner"}]];
  for (const n of COLLECTION_NAMES) for (const d of sdk.collections[n]) ops.push([db.doc(`stores/${sourceStoreId}/${namespace(n)}/${d.id}`), d.data]);
  if (existing) {
    ops.push([db.doc("stores/" + targetStoreId), {name: "old", ownerId: "target-owner"}]);
    for (const n of COLLECTION_NAMES) {
      ops.push([db.doc(`stores/${targetStoreId}/${namespace(n)}/doc-0`), {name: "old", obsolete: true}]);
      ops.push([db.doc(`stores/${targetStoreId}/${namespace(n)}/extra`), {name: "preserve", nullable: null}]);
    }
  }
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch(); for (const [ref, data] of ops.slice(i, i + 400)) batch.set(ref, data); await batch.commit();
  }
  const sourceBefore = await read(sourceStoreId); const baselineState = (await read(targetStoreId)).state;
  const plan = build({snapshot, sourceStoreId, targetStoreId, targetState: baselineState, mode});
  await restore({plan, desiredState: plan.desiredState, targetStoreId, projectId});
  return {plan, baselineState, targetStoreId, projectId, sourceStoreId, sourceBefore};
}

// Instrument real SDK entry points during verification only. Mutations throw;
// no simulated reader/client can hide writes or production transport bypasses.
async function readOnly(run, noReads = false) {
  const originals = []; let writes = 0; let reads = 0;
  function patch(proto, key, wrapper) {
    if (typeof proto[key] !== "function") return;
    const original = proto[key]; originals.push(() => { proto[key] = original; }); proto[key] = wrapper(original);
  }
  const ref = db.doc("stores/instrument"); const query = ref.collection("products");
  const batch = db.batch();
  for (const [proto, keys] of [[Firestore.prototype, ["batch", "bulkWriter", "runTransaction"]],
    [Object.getPrototypeOf(ref), ["create", "set", "update", "delete"]],
    [Object.getPrototypeOf(query), ["add"]],
    [Object.getPrototypeOf(batch), ["create", "set", "update", "delete", "commit"]]]) {
    for (const key of keys) patch(proto, key, () => function() { writes++; throw new Error("R1E_WRITE_FORBIDDEN"); });
  }
  for (const proto of [Object.getPrototypeOf(ref), Object.getPrototypeOf(Object.getPrototypeOf(query))]) {
    patch(proto, "get", (original) => function(...args) {
      reads++; if (noReads) throw new Error("R1E_READ_FORBIDDEN"); return original.apply(this, args);
    });
  }
  try { const result = await run(); assert.equal(writes, 0); if (noReads) assert.equal(reads, 0);
    else assert.ok(reads >= 6); return result; }
  finally { originals.reverse().forEach((restoreMethod) => restoreMethod()); }
}

for (const mode of ["MERGE_A1", "REPLACE"]) for (const existing of [false, true]) {
  test(`${mode}, ${existing ? "existing" : "empty"} target, all SDK types, zero writes and untouched A/B`, async () => {
    const f = await fixture(mode + "-" + existing, mode, existing);
    const beforeB = await read(f.targetStoreId);
    const report = await readOnly(() => verify(f)); assert.equal(report.ok, true);
    assert.equal(report.summary.matchedDocuments, mode === "MERGE_A1" && existing ? 11 : 6);
    for (const key of ["missingDocuments", "mismatchedDocuments", "unexpectedDocuments"]) assert.equal(report.summary[key], 0);
    assert.deepEqual(await read(f.sourceStoreId), f.sourceBefore); assert.deepEqual(await read(f.targetStoreId), beforeB);
    assert.deepEqual(await readOnly(() => verify(f)), report);
  });
}
const corruptions = [
  ["removed document", "MISSING_DOCUMENT", (ref) => ref.delete()],
  ["altered value", "VALUE_MISMATCH", (ref) => ref.update({name: "corrupt"})],
  ["Timestamp string", "TYPE_MISMATCH", (ref) => ref.update({at: "100"})],
  ["missing field", "MISSING_FIELD", (ref) => ref.update({name: FieldValue.delete()})],
  ["extra field", "UNEXPECTED_FIELD", (ref) => ref.update({extra: "bad"})],
  ["wrong reference", "VALUE_MISMATCH", (ref) => ref.update({ref: db.doc("stores/wrong/products/doc-0")})],
  ["SDK marker stored as map", "TYPE_MISMATCH", (ref) => ref.update({at: marker("timestamp", {seconds: 100, nanoseconds: 123000})})],
];
for (const [label, type, corrupt] of corruptions) test("detect " + label, async () => {
  const f = await fixture(label.replace(/ /g, "-")); assert.equal((await readOnly(() => verify(f))).ok, true);
  await corrupt(db.doc(`stores/${f.targetStoreId}/products/doc-0`));
  const beforeB = await read(f.targetStoreId); const report = await readOnly(() => verify(f));
  assert.equal(report.ok, false); assert.ok(report.mismatches.some((m) => m.type === type && m.collection === "products"));
  assert.deepEqual(await read(f.targetStoreId), beforeB); assert.deepEqual(await read(f.sourceStoreId), f.sourceBefore);
});
test("REPLACE detects reintroduced explicitly deleted residual", async () => {
  const f = await fixture("residual", "REPLACE", true);
  await db.doc(`stores/${f.targetStoreId}/cash_flow/extra`).set({name: "residual"});
  const report = await readOnly(() => verify(f)); assert.equal(report.ok, false);
  assert.equal(report.summary.unexpectedDocuments, 1);
  assert.ok(report.mismatches.some((m) => m.collection === "cash_flow" && m.type === "UNEXPECTED_DOCUMENT"));
});
for (const mode of ["MERGE_A1", "REPLACE"]) test(mode + " verifies >500 documents without truncating late mismatches", async () => {
  const f = await fixture("scale-" + mode, mode, true, 105);
  const report = await readOnly(() => verify(f)); assert.equal(report.ok, true);
  assert.equal(report.summary.expectedDocuments, mode === "MERGE_A1" ? 531 : 526);
  assert.equal(report.summary.actualDocuments, report.summary.expectedDocuments);
  assert.equal(report.summary.matchedDocuments, report.summary.expectedDocuments);
  await db.doc(`stores/${f.targetStoreId}/sales/doc-104`).update({name: "late corruption"});
  await db.doc(`stores/${f.targetStoreId}/products/doc-99`).delete();
  const corrupted = await readOnly(() => verify(f)); assert.equal(corrupted.summary.missingDocuments, 1);
  assert.equal(corrupted.summary.mismatchedDocuments, 1);
  assert.equal(corrupted.summary.matchedDocuments, report.summary.expectedDocuments - 2);
  assert.equal(JSON.stringify(await readOnly(() => verify(f))), JSON.stringify(corrupted));
  assert.deepEqual(await read(f.sourceStoreId), f.sourceBefore);
});
for (const scenario of ["missing-host", "unexpected-host", "project", "target", "plan", "baseline"]) {
  test("fail closed before reads/writes: " + scenario, async () => {
    const f = await fixture("guard-" + scenario); const originalHost = process.env.FIRESTORE_EMULATOR_HOST;
    try {
      if (scenario === "missing-host") delete process.env.FIRESTORE_EMULATOR_HOST;
      if (scenario === "unexpected-host") process.env.FIRESTORE_EMULATOR_HOST = "remote.example:8080";
      if (scenario === "project") f.projectId = "store-connect-app";
      if (scenario === "target") f.targetStoreId = f.sourceStoreId;
      if (scenario === "plan") f.plan.mode = "MERGE_A1";
      if (scenario === "baseline") f.baselineState.storeSettings.name = "wrong";
      await readOnly(() => assert.rejects(verify(f), (error) => ["INVALID_EMULATOR_HOST", "INVALID_EMULATOR_PROJECT",
        "INVALID_RESTORE_PLAN"].includes(error.code)), true);
    } finally { process.env.FIRESTORE_EMULATOR_HOST = originalHost; }
    assert.deepEqual(await read(f.sourceStoreId), f.sourceBefore);
  });
}
