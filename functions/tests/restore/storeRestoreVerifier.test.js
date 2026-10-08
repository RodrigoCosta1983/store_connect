"use strict";

const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {Firestore, Timestamp, GeoPoint} = require("firebase-admin/firestore");
const {COLLECTION_NAMES, SETTING_NAMES} = require("../../backups/storeSnapshotContract");
const {buildStoreRestorePlan: build} = require("../../backups/storeRestorePlanner");
const {decodeStoreSnapshotValue: decode} = require("../../backups/storeSnapshotDecoder");
const {hash} = require("../../backups/storeRestoreTransform");
const {compareStoreRestoreState: verify} = require("../../backups/storeRestoreVerifier");

// This client only creates local SDK reference objects, never performs I/O.
const db = new Firestore({projectId: "demo-store-connect-restore", host: "127.0.0.1:8080", ssl: false});
after(() => db.terminate());
const marker = (type, fields) => ({__storeConnectType: type, ...fields});
function fixture(mode = "REPLACE") {
  const baselineState = {storeSettings: {}, collections: Object.fromEntries(COLLECTION_NAMES.map((n) =>
    [n, [{id: "preserved", data: {name: "old"}}]]))};
  const data = {name: "correct", nullable: null, nested: {a: 1, b: [true, null, {x: "v"}]},
    at: marker("timestamp", {seconds: 20, nanoseconds: 123000}),
    point: marker("geoPoint", {latitude: -23, longitude: 45}),
    bytes: marker("bytes", {base64: "AAH/"}),
    ref: marker("documentReference", {path: "stores/unit-A/products/doc"})};
  const snapshot = {snapshotVersion: 1, metadata: {storeId: "unit-A"},
    storeSettings: Object.fromEntries(SETTING_NAMES.map((k) => [k, null])),
    collections: Object.fromEntries(COLLECTION_NAMES.map((n) => [n, [{id: "doc", data}]]))};
  const plan = build({snapshot, sourceStoreId: "unit-A", targetStoreId: "unit-B", targetState: baselineState, mode});
  const actualState = decode(plan.desiredState, {targetStoreId: "unit-B",
    approvedReferencePaths: ["stores/unit-B/products/doc"], referenceFactory: (p) => db.doc(p)});
  if (mode === "MERGE_A1") for (const n of COLLECTION_NAMES) actualState.collections[n].push({id: "preserved", data: {name: "old"}});
  return {plan, baselineState, actualState};
}
const product = (f) => f.actualState.collections.products[0].data;
const mismatch = (f, type, path) => {
  const report = verify(f); assert.equal(report.ok, false);
  assert.ok(report.mismatches.some((m) => m.type === type && (path === undefined || m.path === path)));
  return report;
};
test("identical SDK state, arrays, nested objects, null and all four SDK types", () => {
  const f = fixture(); const report = verify(f);
  assert.equal(report.ok, true); assert.deepEqual(report.summary, {expectedDocuments: 6, actualDocuments: 6,
    matchedDocuments: 6, missingDocuments: 0, unexpectedDocuments: 0, mismatchedDocuments: 0});
});
test("missing document", () => { const f = fixture(); f.actualState.collections.products = [];
  assert.equal(mismatch(f, "MISSING_DOCUMENT").summary.missingDocuments, 1); });
test("REPLACE residual explicitly deleted by plan", () => { const f = fixture();
  f.actualState.collections.products.push({id: "preserved", data: {name: "old"}});
  assert.equal(mismatch(f, "UNEXPECTED_DOCUMENT").summary.unexpectedDocuments, 1); });
test("REPLACE new residual outside desired collection", () => { const f = fixture();
  f.actualState.collections.products.push({id: "new", data: {}}); mismatch(f, "UNEXPECTED_DOCUMENT"); });
test("value mismatch", () => { const f = fixture(); product(f).name = "bad"; mismatch(f, "VALUE_MISMATCH", "/name"); });
test("type mismatch", () => { const f = fixture(); product(f).at = "20"; mismatch(f, "TYPE_MISMATCH", "/at"); });
test("encoded marker map cannot impersonate SDK Timestamp", () => { const f = fixture();
  product(f).at = f.plan.desiredState.collections.products[0].data.at; mismatch(f, "TYPE_MISMATCH", "/at"); });
test("missing field", () => { const f = fixture(); delete product(f).name; mismatch(f, "MISSING_FIELD", "/name"); });
test("unexpected field", () => { const f = fixture(); product(f).extra = true; mismatch(f, "UNEXPECTED_FIELD", "/extra"); });
test("Timestamp nanoseconds compared exactly", () => { const f = fixture(); product(f).at = new Timestamp(20, 124000);
  mismatch(f, "VALUE_MISMATCH", "/at"); });
test("GeoPoint coordinates", () => { const f = fixture(); product(f).point = new GeoPoint(23, 45);
  mismatch(f, "VALUE_MISMATCH", "/point"); });
test("bytes content", () => { const f = fixture(); product(f).bytes = Buffer.from([0]); mismatch(f, "VALUE_MISMATCH", "/bytes"); });
test("DocumentReference equality uses path", () => { const f = fixture(); product(f).ref = db.doc("stores/unit-B/products/doc");
  assert.equal(verify(f).ok, true); });
test("DocumentReference wrong store", () => { const f = fixture(); product(f).ref = db.doc("stores/wrong/products/doc");
  mismatch(f, "VALUE_MISMATCH", "/ref"); });
test("array order is significant", () => { const f = fixture(); product(f).nested.b.reverse(); mismatch(f, "TYPE_MISMATCH"); });
test("array missing element", () => { const f = fixture(); product(f).nested.b.pop(); mismatch(f, "MISSING_FIELD", "/nested/b/2"); });
test("nested value", () => { const f = fixture(); product(f).nested.b[2].x = "bad"; mismatch(f, "VALUE_MISMATCH", "/nested/b/2/x"); });
test("null versus absent", () => { const f = fixture(); delete product(f).nullable; mismatch(f, "MISSING_FIELD", "/nullable"); });
test("null versus object", () => { const f = fixture(); product(f).nullable = {}; mismatch(f, "TYPE_MISMATCH", "/nullable"); });
test("field order irrelevant", () => { const f = fixture(); product(f).nested = {b: product(f).nested.b, a: 1}; assert.equal(verify(f).ok, true); });
test("multiple mismatches sorted and byte deterministic regardless document and field order", () => {
  const f = fixture(); product(f).z = 1; product(f).name = "bad";
  f.actualState.collections.sales = []; delete f.actualState.storeSettings.name;
  const before = JSON.stringify(verify(f));
  for (const docs of Object.values(f.actualState.collections)) docs.reverse();
  f.actualState.storeSettings = Object.fromEntries(Object.entries(f.actualState.storeSettings).reverse());
  assert.equal(JSON.stringify(verify(f)), before);
  const rows = verify(f).mismatches.map((m) => [m.collection, m.documentId, m.path, m.type].join("\0"));
  assert.deepEqual(rows, [...rows].sort());
});
test("MERGE_A1 preserved documents checked against authenticated baseline", () => {
  const f = fixture("MERGE_A1"); assert.equal(verify(f).ok, true); assert.equal(verify(f).summary.expectedDocuments, 11);
  f.actualState.collections.products[1].data.name = "corrupt"; mismatch(f, "VALUE_MISMATCH", "/name");
});
test("MERGE_A1 missing preserved document detected", () => { const f = fixture("MERGE_A1");
  f.actualState.collections.products.pop(); mismatch(f, "MISSING_DOCUMENT"); });
test("MERGE_A1 does not infer delete for new extra IDs", () => { const f = fixture("MERGE_A1");
  f.actualState.collections.products.push({id: "later", data: {}}); assert.equal(verify(f).ok, true);
  assert.equal(verify(f).summary.actualDocuments, 12); });
test("root fields outside settings remain outside contract", () => { const f = fixture();
  f.actualState.storeSettings.ownerId = "owner"; assert.equal(verify(f).ok, true); });
test("missing root document", () => { const f = fixture(); f.actualState.rootExists = false; mismatch(f, "MISSING_DOCUMENT"); });
test("sensitive field differences are redacted", () => { const f = fixture("MERGE_A1");
  // Preserved arbitrary snapshot fields can contain credentials; never report them.
  f.baselineState.collections.products[0].data.apiToken = "expected-secret";
  const snapshot = {snapshotVersion: 1, metadata: {storeId: "unit-A"},
    ...JSON.parse(JSON.stringify(f.plan.desiredState))};
  for (const n of COLLECTION_NAMES) snapshot.collections[n][0].data.ref.path = "stores/unit-A/products/doc";
  f.plan = build({snapshot, sourceStoreId: "unit-A", targetStoreId: "unit-B", targetState: f.baselineState, mode: "MERGE_A1"});
  f.actualState.collections.products[1].data.apiToken = "actual-secret";
  const report = mismatch(f, "VALUE_MISMATCH", "/apiToken");
  assert.ok(!JSON.stringify(report).includes("expected-secret")); assert.ok(!JSON.stringify(report).includes("actual-secret"));
});
test("inputs not mutated", () => { const f = fixture(); const before = hash({plan: f.plan, baseline: f.baselineState});
  verify(f); assert.equal(hash({plan: f.plan, baseline: f.baselineState}), before); });
test("tampered plan hash rejected", () => { const f = fixture(); f.plan.mode = "MERGE_A1";
  assert.throws(() => verify(f), /INVALID_RESTORE_PLAN/); });
test("wrong baseline rejected", () => { const f = fixture(); f.baselineState.storeSettings.name = "wrong";
  assert.throws(() => verify(f), /INVALID_RESTORE_PLAN/); });
test("inconsistent rehashed action plan rejected", () => { const f = fixture(); f.plan.collections.products.create = [];
  const {planHash, ...body} = f.plan; f.plan.planHash = hash(body); assert.throws(() => verify(f), /INVALID_RESTORE_PLAN/); });
test("duplicate actual IDs rejected", () => { const f = fixture(); f.actualState.collections.products.push(f.actualState.collections.products[0]);
  assert.throws(() => verify(f), /INVALID_VERIFICATION_STATE/); });
test("unsupported SDK types fail closed", () => { const f = fixture(); product(f).name = new Date();
  assert.throws(() => verify(f), /UNSUPPORTED_VERIFICATION_TYPE/); });
test("JSON pointer escaping", () => { const f = fixture(); product(f)["a/b~c"] = 1; mismatch(f, "UNEXPECTED_FIELD", "/a~1b~0c"); });
test("malformed rehashed plan fails with sanitized technical error", () => { const f = fixture();
  f.plan.settings = null; const {planHash, ...body} = f.plan; f.plan.planHash = hash(body);
  assert.throws(() => verify(f), (e) => e.code === "INVALID_RESTORE_PLAN" && e.message === e.code); });
