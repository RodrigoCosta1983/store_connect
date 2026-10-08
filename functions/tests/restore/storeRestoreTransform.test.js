"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const {gzipSync} = require("node:zlib");
const {parseStoreSnapshotV1} = require("../../backups/storeSnapshotParser");
const {COLLECTION_NAMES, SETTING_NAMES} = require("../../backups/storeSnapshotContract");
const {transformStoreSnapshot} = require("../../backups/storeRestoreTransform");

function fixture() {
  return {snapshotVersion: 1, metadata: {storeId: "A", createdAt:
    {__storeConnectType: "timestamp", seconds: 0, nanoseconds: 0}, createdBy: "system",
  createdByRole: "system", type: "automatic", reason: null,
  counts: Object.fromEntries(COLLECTION_NAMES.map((name) => [name, 0]))},
  storeSettings: Object.fromEntries(SETTING_NAMES.map((name) => [name, null])),
  collections: Object.fromEntries(COLLECTION_NAMES.map((name) => [name, []]))};
}
function run(data = {}, collection = "sales", targetStoreId = "B", settings = {}) {
  const raw = fixture(); raw.collections[collection].push({id: "synthetic", data});
  raw.metadata.counts[collection]++; Object.assign(raw.storeSettings, settings);
  const snapshot = parseStoreSnapshotV1(gzipSync(Buffer.from(JSON.stringify(raw)))).snapshot;
  const before = JSON.stringify(snapshot);
  const result = transformStoreSnapshot({snapshot, sourceStoreId: "A", targetStoreId});
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(snapshot.metadata.storeId, "A");
  return result;
}
function has(result, kind, code) { return result[kind].some((item) => item.code === code); }
test("same-store preserves storeId including legacy third-store value", () => {
  for (const storeId of ["A", "B", "C", 3]) {
    const r = run({storeId}, "sales", "A");
    assert.equal(r.desiredState.collections.sales[0].data.storeId, storeId);
    assert.equal(r.blockers.length, 0);
  }
});
test("cross-store sales source remaps, target accepted, missing stays absent", () => {
  const r = run({storeId: "A"});
  assert.equal(r.desiredState.collections.sales[0].data.storeId, "B");
  assert.ok(has(r, "warnings", "SALES_STORE_ID_REMAPPED"));
  const target = run({storeId: "B"});
  assert.equal(target.desiredState.collections.sales[0].data.storeId, "B");
  assert.ok(has(target, "warnings", "SALES_STORE_ID_ALREADY_TARGET"));
  assert.ok(!Object.hasOwn(run().desiredState.collections.sales[0].data, "storeId"));
});
for (const storeId of ["C", 4, null]) test("sales conflict sanitized " + typeof storeId, () => {
  const r = run({storeId});
  assert.ok(has(r, "blockers", "SALES_STORE_ID_CONFLICT"));
  assert.deepEqual(r.blockers[0], {code: "SALES_STORE_ID_CONFLICT", collection: "sales",
    documentId: "synthetic", path: "/data/storeId"});
});
const ref = (path) => ({__storeConnectType: "documentReference", path});
for (const namespace of ["products", "customers", "categories", "sales", "cash_flow"]) {
  test("internal reference remaps " + namespace, () => {
    const r = run({nested: [{reference: ref("stores/A/" + namespace + "/doc")}]});
    assert.equal(r.desiredState.collections.sales[0].data.nested[0].reference.path, "stores/B/" + namespace + "/doc");
    assert.ok(has(r, "warnings", "CROSS_STORE_REFERENCE_REMAPPED"));
  });
}
for (const [path, code] of [["stores/A", "SOURCE_STORE_ROOT_REFERENCE"],
  ...["catalogs", "catalogRequests", "auditLogs", "unknown"].map((n) => ["stores/A/" + n + "/doc", "UNSUPPORTED_SOURCE_NAMESPACE"]),
  ...["users/u", "stores/C/products/doc", "stores/B/products/doc", "global/doc", "stores/AA/products/doc"].map((p) => [p, "EXTERNAL_DOCUMENT_REFERENCE"])]) {
  test("blocked reference " + path, () => {
    const r = run({ref: ref(path)});
    assert.ok(has(r, "blockers", code));
    assert.equal(r.desiredState.collections.sales[0].data.ref.path, path);
    assert.equal(run({ref: ref(path)}, "sales", "A").blockers.length, 0);
  });
}
test("strings, relative IDs, arrays, lots, installments and four markers preserved", () => {
  const data = {text: "stores/A/products/doc", productId: "A", customerId: "A", categoryId: "A",
    parentCategoryId: "A", categoryIds: ["A", "B"], categoryName: "A", products: [{productId: "A"}],
    parcelas: [{n: 2}, {n: 1}], lotes: ["B", "A"], types: [
      {__storeConnectType: "timestamp", seconds: 1, nanoseconds: 12},
      {__storeConnectType: "geoPoint", latitude: 1, longitude: 2},
      {__storeConnectType: "bytes", base64: "YQ=="}]};
  assert.deepEqual(run(data).desiredState.collections.sales[0].data, data);
});
test("fiscal is blocked and preserved even when null", () => {
  for (const fiscal of [null, {status: "synthetic", url: "synthetic", ref: ref("stores/A/sales/doc")}]) {
    const r = run({fiscal});
    assert.ok(has(r, "blockers", "FISCAL_HISTORY_REQUIRES_POLICY"));
    assert.deepEqual(r.desiredState.collections.sales[0].data.fiscal, fiscal);
  }
});
test("invalid transform input sanitized", () => {
  for (const value of [undefined, null, [], "synthetic"]) {
    assert.throws(() => transformStoreSnapshot(value), {code: "INVALID_PLANNER_INPUT", message: "INVALID_PLANNER_INPUT"});
  }
});
for (const [key, code] of [["logoUrl", "SOURCE_SCOPED_MEDIA_REFERENCE"],
  ["pixQrCodePath", "PIX_REFERENCE_REQUIRES_POLICY"], ["pixQrCodeUrl", "PIX_REFERENCE_REQUIRES_POLICY"]]) {
  test("setting dependency " + key, () => {
    const r = run({}, "sales", "B", {[key]: "synthetic"});
    assert.ok(has(r, "blockers", code));
    assert.equal(r.desiredState.storeSettings[key], "synthetic");
    assert.equal(run({}, "sales", "B", {[key]: ""}).blockers.length, 0);
    assert.equal(run({}, "sales", "A", {[key]: "synthetic"}).blockers.length, 0);
  });
}
for (const name of ["products", "categories"]) test("media dependency " + name, () => {
  const r = run({imageUrl: "synthetic"}, name);
  assert.ok(has(r, "blockers", "SOURCE_SCOPED_MEDIA_REFERENCE"));
  assert.equal(r.desiredState.collections[name][0].data.imageUrl, "synthetic");
});
test("exact UID field inventory recursive, no UID remap or substring search", () => {
  const data = {createdBy: "A", nested: [{updatedBy: "A", archivedBy: "A", syncedBy: "A"}],
    notCreatedBy: "A", free: "createdBy"};
  const r = run(data);
  assert.equal(r.warnings.filter((i) => i.code === "UID_HISTORY_PRESENT").length, 4);
  assert.deepEqual(r.desiredState.collections.sales[0].data, data);
  assert.equal(run(data, "sales", "A").warnings.length, 1);
});
test("policy closed v1 and snapshot provenance source must agree", () => {
  const snapshot = fixture();
  for (const policy of [null, {}, {version: 2}, {version: 1, allowExternal: true}]) {
    assert.throws(() => transformStoreSnapshot({snapshot, sourceStoreId: "A", targetStoreId: "B", policy}),
      {code: "INVALID_TRANSFORM_POLICY", message: "INVALID_TRANSFORM_POLICY"});
  }
  assert.throws(() => transformStoreSnapshot({snapshot, sourceStoreId: "C", targetStoreId: "B"}),
    {code: "INVALID_SNAPSHOT_CONTRACT"});
});
