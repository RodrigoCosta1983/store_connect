"use strict";

const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {Firestore, Timestamp, GeoPoint, DocumentReference} = require("firebase-admin/firestore");
const {gzipSync} = require("node:zlib");
const {createHash} = require("node:crypto");
const {COLLECTION_NAMES, SETTING_NAMES} = require("../../backups/storeSnapshotContract");
const {buildStoreRestorePlan} = require("../../backups/storeRestorePlanner");
const {hash} = require("../../backups/storeRestoreTransform");
const {restoreStoreToEmulator: restore} = require("../../backups/storeRestoreEmulator");
const {decodeStoreSnapshotValue} = require("../../backups/storeSnapshotDecoder");
const {parseStoreSnapshotV1} = require("../../backups/storeSnapshotParser");
const projectId = "demo-store-connect-restore";
assert.ok(["127.0.0.1:8080", "localhost:8080", "[::1]:8080"].includes(process.env.FIRESTORE_EMULATOR_HOST), "Emulator required");
const db = new Firestore({projectId, host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false});
after(() => db.terminate());
const empty = () => ({storeSettings: {}, collections: Object.fromEntries(COLLECTION_NAMES.map((n) => [n, []]))});
const marker = (type, fields) => ({__storeConnectType: type, ...fields});
function fixture(sourceStoreId, targetStoreId, mode = "MERGE_A1", count = 1) {
  const snapshot = {snapshotVersion: 1, metadata: {storeId: sourceStoreId}, ...empty()};
  snapshot.storeSettings = Object.fromEntries(SETTING_NAMES.map((k) => [k, null]));
  snapshot.storeSettings.name = "Synthetic store";
  snapshot.storeSettings.lowStockThreshold = 3;
  snapshot.storeSettings.pixQrCodeUpdatedAt = marker("timestamp", {seconds: 100, nanoseconds: 123456000});
  for (const name of COLLECTION_NAMES) snapshot.collections[name] = [{id: "same-id", data: {
    label: name, nested: {array: [true, null, 2, marker("geoPoint", {latitude: 1, longitude: -2})]},
    bytes: marker("bytes", {base64: "AAH/"}), at: marker("timestamp", {seconds: 456, nanoseconds: 987654000}),
    ref: marker("documentReference", {path: `stores/${sourceStoreId}/products/same-id`}),
    ...(name === "sales" ? {storeId: sourceStoreId} : {}),
  }}];
  for (let i = 1; i < count; i++) snapshot.collections.products.push({id: "p-" + i, data: {i}});
  const plan = buildStoreRestorePlan({snapshot, sourceStoreId, targetStoreId, targetState: empty(), mode});
  return {snapshot, plan, args: {plan, desiredState: plan.desiredState, targetStoreId, projectId}};
}
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
  const state = {storeSettings: encode((await root.get()).data() || {}), collections: {}};
  for (const name of COLLECTION_NAMES) {
    const result = await root.collection(name === "cashFlow" ? "cash_flow" : name).get();
    state.collections[name] = result.docs.map((d) => ({id: d.id, data: encode(d.data())})).sort((a, b) => a.id.localeCompare(b.id));
  }
  return state;
}
for (const mode of ["MERGE_A1", "REPLACE"]) test(mode + " full A -> empty B, SDK round trip, IDs, source intact and chunks", async () => {
  const source = "R1C-A-" + mode; const target = "R1C-B-" + mode;
  const f = fixture(source, target, mode, 505);
  const paths = [`stores/${source}/products/same-id`];
  const decoded = decodeStoreSnapshotValue({storeSettings: f.snapshot.storeSettings, collections: f.snapshot.collections},
    {targetStoreId: source, approvedReferencePaths: paths, referenceFactory: (p) => db.doc(p)});
  const operations = [[db.doc("stores/" + source), {...decoded.storeSettings, ownerId: "synthetic-owner"}]];
  for (const name of COLLECTION_NAMES) for (const doc of decoded.collections[name]) {
    operations.push([db.doc(`stores/${source}/${name === "cashFlow" ? "cash_flow" : name}/${doc.id}`), doc.data]);
  }
  for (let offset = 0; offset < operations.length; offset += 400) {
    const batch = db.batch(); for (const [ref, data] of operations.slice(offset, offset + 400)) batch.set(ref, data);
    await batch.commit();
  }
  const before = await read(source);
  // Exercise the actual R1A parser before the R1B -> R1C pipeline.
  const snapshot = {...f.snapshot, metadata: {storeId: source,
    createdAt: marker("timestamp", {seconds: 1, nanoseconds: 0}), createdBy: "synthetic",
    createdByRole: "admin", type: "manual", reason: null,
    counts: Object.fromEntries(COLLECTION_NAMES.map((n) => [n, f.snapshot.collections[n].length]))}};
  const compressed = gzipSync(Buffer.from(JSON.stringify(snapshot)));
  const parsed = parseStoreSnapshotV1(compressed, {expectedMetadata: {
    checksumSha256: createHash("sha256").update(compressed).digest("hex")}});
  assert.ok(parsed.snapshot);
  const plan = buildStoreRestorePlan({snapshot: parsed.snapshot, sourceStoreId: source, targetStoreId: target, targetState: empty(), mode});
  const result = await restore({plan, desiredState: plan.desiredState, targetStoreId: target, projectId});
  assert.deepEqual(result, {writes: 510, batches: 2});
  assert.deepEqual(await read(source), before);
  const actual = await read(target);
  assert.deepEqual(actual.storeSettings, plan.desiredState.storeSettings);
  for (const name of COLLECTION_NAMES) {
    const expected = [...plan.desiredState.collections[name]].sort((a, b) => a.id.localeCompare(b.id));
    assert.equal(actual.collections[name].length, expected.length);
    for (let i = 0; i < expected.length; i++) assert.deepEqual(actual.collections[name][i], expected[i]);
    const data = (await db.doc(`stores/${target}/${name === "cashFlow" ? "cash_flow" : name}/same-id`).get()).data();
    assert.ok(data.at instanceof Timestamp); assert.ok(data.bytes instanceof Buffer);
    assert.ok(data.nested.array[3] instanceof GeoPoint); assert.ok(data.ref instanceof DocumentReference);
    assert.equal(data.ref.path, `stores/${target}/products/same-id`);
  }
});
for (const host of [undefined, "", "prod.example:8080", "127.0.0.1:443", "localhost:8080/path"]) {
  test("reject host before effects: " + host, async () => {
    const f = fixture("guard-A", "guard-host"); const original = process.env.FIRESTORE_EMULATOR_HOST;
    try {
      if (host === undefined) delete process.env.FIRESTORE_EMULATOR_HOST; else process.env.FIRESTORE_EMULATOR_HOST = host;
      await assert.rejects(restore(f.args), /INVALID_EMULATOR_HOST/);
    } finally { process.env.FIRESTORE_EMULATOR_HOST = original; }
    assert.deepEqual(await read("guard-host"), empty());
  });
}
for (const id of [undefined, "store-connect-app", "demo-other", "prod"]) test("reject project before effects: " + id, async () => {
  const f = fixture("guard-A", "guard-project");
  await assert.rejects(restore({...f.args, projectId: id}), /INVALID_EMULATOR_PROJECT/);
  assert.deepEqual(await read("guard-project"), empty());
});
const mutations = {
  hash: (p) => { p.planHash = "0".repeat(64); },
  count: (p) => { p.plannedCounts.totals.create++; },
  duplicate: (p) => { p.collections.products.create.push("same-id"); },
  action: (p) => { p.collections.products.create = []; },
  blockers: (p) => { p.blockers.push({code: "FISCAL_HISTORY_REQUIRES_POLICY"}); },
  sameStore: (p) => { p.sourceStoreId = p.targetStoreId; },
  version: (p) => { p.planVersion = 2; },
  baseline: (p) => { p.baselineHash = "0".repeat(64); },
  external: (p) => { p.desiredState.collections.products[0].data.ref.path = "users/u"; },
  fiscal: (p) => { p.desiredState.collections.sales[0].data.fiscal = null; },
  unknown: (p) => { p.desiredState.collections.products[0].data.invalid = marker("unknown", {}); },
  approval: (p) => { p.warnings = []; },
  precision: (p) => { p.desiredState.collections.products[0].data.at.nanoseconds = 1; },
};
for (const [name, change] of Object.entries(mutations)) test("invalid plan zero writes: " + name, async () => {
  const f = fixture("guard-A", "guard-plan-" + name); change(f.plan);
  if (!["hash", "unknown"].includes(name)) {
    f.plan.desiredStateHash = hash(f.plan.desiredState);
    const {planHash, ...body} = f.plan; f.plan.planHash = hash(body);
  }
  await assert.rejects(restore(f.args));
  assert.deepEqual(await read(f.args.targetStoreId), empty());
});
test("root unrelated fields preserved and stale baseline writes nothing", async () => {
  const f = fixture("guard-A", "guard-root");
  await db.doc("stores/guard-root").set({ownerId: "synthetic-owner", subscription: {status: "synthetic"}});
  await restore(f.args);
  const root = (await db.doc("stores/guard-root").get()).data();
  assert.equal(root.ownerId, "synthetic-owner"); assert.deepEqual(root.subscription, {status: "synthetic"});
  const before = await read("guard-root");
  await assert.rejects(restore(f.args), /STALE_RESTORE_BASELINE/);
  assert.deepEqual(await read("guard-root"), before);
});
test("SDK serialization failure in a later chunk occurs before all writes", async () => {
  const f = fixture("guard-A", "guard-serialization", "MERGE_A1", 505);
  f.snapshot.collections.products.push({id: "zz-invalid", data: {nested: [[1]]}});
  const plan = buildStoreRestorePlan({snapshot: f.snapshot, sourceStoreId: "guard-A",
    targetStoreId: "guard-serialization", targetState: empty(), mode: "MERGE_A1"});
  await assert.rejects(restore({...f.args, plan, desiredState: plan.desiredState}), /UNSUPPORTED_NESTED_ARRAY/);
  assert.deepEqual(await read("guard-serialization"), empty());
});
