"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const {gzipSync} = require("node:zlib");
const {createHash} = require("node:crypto");
const Module = require("node:module");
const fs = require("node:fs");
const net = require("node:net");
const contractPath = require.resolve("../../backups/storeSnapshotContract");
const parserPath = require.resolve("../../backups/storeSnapshotParser");
const {COLLECTION_NAMES, SETTING_NAMES, DEFAULT_LIMITS} = require(contractPath);
const {parseStoreSnapshotV1: parse, StoreSnapshotValidationError} = require(parserPath);
const timestamp = (seconds = 0, nanoseconds = 0) => ({__storeConnectType: "timestamp", seconds, nanoseconds});
const marker = (type, fields) => ({__storeConnectType: type, ...fields});
function fixture() {
  return {
    snapshotVersion: 1,
    metadata: {storeId: "synthetic", createdAt: timestamp(), createdBy: "system",
      createdByRole: "system", type: "automatic", reason: null,
      counts: Object.fromEntries(COLLECTION_NAMES.map((name) => [name, 0]))},
    storeSettings: Object.fromEntries(SETTING_NAMES.map((name) => [name, null])),
    collections: Object.fromEntries(COLLECTION_NAMES.map((name) => [name, []])),
  };
}
function add(snapshot, data, name = "products", id = "doc") {
  snapshot.collections[name].push({id, data});
  snapshot.metadata.counts[name]++;
  return snapshot;
}
function zipped(snapshot) { return gzipSync(Buffer.from(JSON.stringify(snapshot))); }
function rejects(bytes, code, options) {
  assert.throws(() => parse(bytes, options), (error) => {
    assert.ok(error instanceof StoreSnapshotValidationError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.equal(error.cause, undefined);
    return true;
  });
}
function bad(name, code, change, options) {
  test(name, () => { const snapshot = fixture(); change(snapshot); rejects(zipped(snapshot), code, options); });
}
function badValue(name, code, value) { bad(name, code, (s) => add(s, {value})); }
function raw(name, code, text, options) { test(name, () => rejects(gzipSync(Buffer.from(text)), code, options)); }

test("imports have no side effects and only approved pure dependencies", () => {
  const beforeEnv = {...process.env};
  const beforeHandles = process._getActiveHandles().slice();
  const originalLoad = Module._load;
  const timers = ["setTimeout", "setInterval", "setImmediate"];
  const saved = timers.map((name) => global[name]);
  const blocked = [[global, "fetch"], [process, "getBuiltinModule"],
    [fs, "writeFile"], [fs, "writeFileSync"], [fs, "appendFile"], [fs, "appendFileSync"],
    [fs, "createWriteStream"], [net, "connect"], [net, "createConnection"],
    [net.Server.prototype, "listen"]];
  const originals = blocked.map(([target, key]) => target[key]);
  const permitted = new Set([contractPath, parserPath, "./storeSnapshotContract", "node:zlib", "node:crypto", "node:util"]);
  try {
    Module._load = function(request, ...args) {
      assert.ok(permitted.has(request), "Unexpected import dependency");
      return originalLoad.call(this, request, ...args);
    };
    for (const name of timers) global[name] = () => { throw new Error("IMPORT_TIMER"); };
    blocked.forEach(([target, key]) => { target[key] = () => { throw new Error("IMPORT_IO"); }; });
    delete require.cache[contractPath]; delete require.cache[parserPath];
    require(contractPath); require(parserPath);
    assert.deepEqual({...process.env}, beforeEnv);
    assert.deepEqual(process._getActiveHandles(), beforeHandles);
  } finally {
    Module._load = originalLoad;
    timers.forEach((name, index) => { global[name] = saved[index]; });
    blocked.forEach(([target, key], index) => { target[key] = originals[index]; });
  }
});
test("defaults are approved restore guardrails", () => {
  assert.deepEqual(DEFAULT_LIMITS, {MAX_COMPRESSED_BYTES: 33554432, MAX_ORIGINAL_BYTES: 134217728,
    MAX_EXPANSION_RATIO: 50, MAX_DOCUMENTS_TOTAL: 100000, MAX_DOCUMENTS_PER_COLLECTION: 100000,
    MAX_DOCUMENT_JSON_BYTES: 1048576, MAX_DEPTH: 20});
});
test("minimal snapshot, five empty collections and safe maps", () => {
  const result = parse(zipped(fixture()));
  assert.equal(result.inventory.totalDocuments, 0);
  assert.equal(Object.getPrototypeOf(result.snapshot), null);
  assert.equal(Object.getPrototypeOf(result.snapshot.collections), null);
  assert.deepEqual(Object.keys(result.snapshot.collections), COLLECTION_NAMES);
});
test("complete synthetic snapshot preserves intermediate types, arrays and null", () => {
  const snapshot = fixture();
  snapshot.storeSettings = {name: "Synthetic", phone: "123", logoUrl: "local-text",
    lowStockThreshold: 0.5, pixQrCodePath: "text", pixQrCodeUrl: "text", pixQrCodeUpdatedAt: timestamp(1, 123456789)};
  const values = [timestamp(-62135596800), timestamp(253402300799, 999999999),
    marker("geoPoint", {latitude: -90, longitude: -180}),
    marker("geoPoint", {latitude: 90, longitude: 180}), marker("bytes", {base64: ""}),
    marker("bytes", {base64: Buffer.from([0, 255, 128]).toString("base64")}),
    marker("documentReference", {path: "stores/source/products/doc"}), null,
    {nested: [true, 1.25, "escaped \\\" {} []", {deeper: null}]}];
  for (const name of COLLECTION_NAMES) add(snapshot, {values}, name);
  const result = parse(zipped(snapshot));
  assert.equal(JSON.stringify(result.snapshot), JSON.stringify(snapshot));
  assert.equal(result.inventory.totalDocuments, 5);
  assert.equal(result.inventory.typeCounts.bytes, 10);
  assert.equal(result.inventory.documentReferences.length, 5);
  assert.equal(result.snapshot.collections.products[0].data.values[1].nanoseconds, 999999999);
});
test("pixQrCodeUpdatedAt accepts producer's encoded legacy map", () => {
  const s = fixture(); s.storeSettings.pixQrCodeUpdatedAt = {legacy: ["text"]};
  parse(zipped(s));
});
test("custom limits exactly at byte/document boundaries and correct expected metadata", () => {
  const s = add(fixture(), {value: "á"}); const bytes = zipped(s);
  const originalSizeBytes = Buffer.byteLength(JSON.stringify(s));
  const result = parse(new Uint8Array(bytes), {limits: {
    MAX_COMPRESSED_BYTES: bytes.length, MAX_ORIGINAL_BYTES: originalSizeBytes,
    MAX_DOCUMENT_JSON_BYTES: Buffer.byteLength(JSON.stringify(s.collections.products[0])),
    MAX_DOCUMENTS_TOTAL: 1, MAX_DOCUMENTS_PER_COLLECTION: 1,
  }, expectedMetadata: {checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    compressedSizeBytes: bytes.length, originalSizeBytes, snapshotVersion: 1, storeId: "synthetic"}});
  assert.equal(result.technicalMetadata.originalSizeBytes, originalSizeBytes);
});
function nested(depth) { let result = {}; for (let n = 1; n < depth; n++) result = {child: [result]}; return result; }
test("depth exactly 20 (root=1, document data=5)", () => {
  // data=5; child map=6; seven additional map/array pairs end at 20.
  parse(zipped(add(fixture(), {child: nested(8)})));
});
bad("depth 21 rejected", "DEPTH_LIMIT", (s) => add(s, {child: [nested(8)]}));
test("custom depth boundary", () => {
  parse(zipped(add(fixture(), {})), {limits: {MAX_DEPTH: 5}});
  rejects(zipped(add(fixture(), {array: []})), "DEPTH_LIMIT", {limits: {MAX_DEPTH: 5}});
});
test("large injected depth uses explicit traversal stacks", () => {
  const s = add(fixture(), {child: nested(150)});
  parse(zipped(s), {limits: {MAX_DEPTH: 304, MAX_EXPANSION_RATIO: 100}});
});
test("large canonical bytes marker does not exhaust regexp stack", () => {
  parse(zipped(add(fixture(), {value: marker("bytes", {base64: Buffer.alloc(200000, 123).toString("base64")})})),
      {limits: {MAX_EXPANSION_RATIO: 1000}});
});
test("invalid input", () => rejects("not bytes", "INVALID_INPUT"));
test("null options sanitized", () => rejects(zipped(fixture()), "INVALID_INPUT", null));
test("unknown options rejected", () => rejects(zipped(fixture()), "INVALID_INPUT", {unknown: true}));
test("fractional expansion ratio allowed", () => parse(zipped(fixture()), {limits: {MAX_EXPANSION_RATIO: 49.5}}));
test("empty compressed input", () => rejects(Buffer.alloc(0), "GZIP_INVALID"));
test("compressed limit", () => rejects(zipped(fixture()), "COMPRESSED_SIZE_LIMIT", {limits: {MAX_COMPRESSED_BYTES: 1}}));
test("invalid gzip", () => rejects(Buffer.from("invalid"), "GZIP_INVALID"));
test("truncated gzip", () => rejects(zipped(fixture()).subarray(0, 30), "GZIP_INVALID"));
test("gzip bomb bounded during decompression", () => rejects(gzipSync(Buffer.alloc(2 * 1024 * 1024)), "ORIGINAL_SIZE_LIMIT", {limits: {MAX_ORIGINAL_BYTES: 1024}}));
test("original limit", () => rejects(zipped(fixture()), "ORIGINAL_SIZE_LIMIT", {limits: {MAX_ORIGINAL_BYTES: 1}}));
test("expansion ratio", () => rejects(zipped(fixture()), "EXPANSION_RATIO_LIMIT", {limits: {MAX_EXPANSION_RATIO: 1}}));
for (const [key, value, code] of [["checksumSha256", "0".repeat(64), "CHECKSUM_MISMATCH"],
  ["compressedSizeBytes", 1, "COMPRESSED_SIZE_MISMATCH"], ["originalSizeBytes", 1, "ORIGINAL_SIZE_MISMATCH"],
  ["snapshotVersion", 2, "SNAPSHOT_VERSION_MISMATCH"], ["storeId", "other", "STORE_ID_MISMATCH"]]) {
  test(code, () => rejects(zipped(fixture()), code, {expectedMetadata: {[key]: value}}));
}
test("invalid UTF8", () => rejects(gzipSync(Buffer.from([0xc3, 0x28])), "UTF8_INVALID"));
raw("invalid JSON", "JSON_INVALID", '{"payload":"PRIVATE"');
for (const text of ['{"a":1,}', '[1,]', '{"a" 1}', '{"a":01}', 'true false',
  '{"a":"\\x01"}', '{"a":1e}', '[}', '{"a":undefined}', '"raw\nnewline"']) {
  raw(`malformed JSON ${JSON.stringify(text)}`, "JSON_INVALID", text);
}
raw("duplicate key", "JSON_DUPLICATE_KEY", '{"a":1,"a":2}');
raw("escaped unicode duplicate nested in array", "JSON_DUPLICATE_KEY", '[{"a":1,"\\u0061":2}]');
raw("escaped string duplicate", "JSON_DUPLICATE_KEY", '{"a\\\"b":1,"a\\u0022b":2}');
test("scanner respects string delimiters and separate objects", () => {
  parse(zipped(add(fixture(), {values: [{a: 1}, {a: 2}], text: '"a":1,"a":2 \\ {} []'})));
});
for (const version of [0, 2, "1", null]) bad(`unsupported version ${version}`, "UNSUPPORTED_VERSION", (s) => { s.snapshotVersion = version; });
bad("root missing", "INVALID_ROOT", (s) => { delete s.storeSettings; });
bad("root extra", "INVALID_ROOT", (s) => { s.extra = true; });
raw("root null", "INVALID_ROOT", "null");
bad("metadata missing", "INVALID_METADATA", (s) => { delete s.metadata.createdBy; });
bad("metadata extra", "INVALID_METADATA", (s) => { s.metadata.extra = 1; });
bad("metadata createdAt wrong", "INVALID_METADATA", (s) => { s.metadata.createdAt = "date"; });
bad("metadata storeId invalid", "INVALID_METADATA", (s) => { s.metadata.storeId = "a/b"; });
bad("metadata type invalid", "INVALID_METADATA", (s) => { s.metadata.type = null; });
bad("settings missing", "INVALID_SETTINGS", (s) => { delete s.storeSettings.name; });
bad("settings extra", "INVALID_SETTINGS", (s) => { s.storeSettings.extra = 1; });
bad("settings string invalid", "INVALID_SETTINGS", (s) => { s.storeSettings.phone = 2; });
bad("settings threshold invalid", "INVALID_SETTINGS", (s) => { s.storeSettings.lowStockThreshold = "2"; });
bad("collection missing", "INVALID_COLLECTIONS", (s) => { delete s.collections.sales; });
bad("collection extra", "INVALID_COLLECTIONS", (s) => { s.collections.extra = []; });
bad("collection not array", "INVALID_COLLECTIONS", (s) => { s.collections.sales = {}; });
for (const key of ["id", "data"]) bad(`envelope missing ${key}`, "INVALID_DOCUMENT", (s) => { add(s, {}); delete s.collections.products[0][key]; });
bad("envelope extra", "INVALID_DOCUMENT", (s) => { add(s, {}); s.collections.products[0].extra = 1; });
for (const value of ["", "a/b", ".", "..", "a\0b", 1]) bad(`invalid id ${JSON.stringify(value)}`, "INVALID_DOCUMENT", (s) => add(s, {}, "products", value));
bad("duplicate ID", "DUPLICATE_DOCUMENT_ID", (s) => { add(s, {}); add(s, {}); });
test("same ID across collections permitted", () => parse(zipped(add(add(fixture(), {}), {}, "sales"))));
bad("null data", "INVALID_DOCUMENT", (s) => add(s, null));
bad("array data", "INVALID_DOCUMENT", (s) => add(s, []));
bad("negative count", "INVALID_METADATA", (s) => { s.metadata.counts.products = -1; });
bad("fractional count", "INVALID_METADATA", (s) => { s.metadata.counts.products = 0.5; });
bad("counts extra", "INVALID_METADATA", (s) => { s.metadata.counts.extra = 0; });
bad("counts missing", "INVALID_METADATA", (s) => { delete s.metadata.counts.sales; });
bad("counts mismatch", "COUNTS_MISMATCH", (s) => { s.metadata.counts.products = 1; });
bad("total documents limit", "DOCUMENTS_TOTAL_LIMIT", (s) => { add(s, {}); add(s, {}, "sales"); }, {limits: {MAX_DOCUMENTS_TOTAL: 1}});
bad("collection documents limit", "DOCUMENTS_PER_COLLECTION_LIMIT", (s) => { add(s, {}); add(s, {}, "products", "two"); }, {limits: {MAX_DOCUMENTS_PER_COLLECTION: 1}});
bad("document byte limit", "DOCUMENT_SIZE_LIMIT", (s) => add(s, {value: "á"}), {limits: {MAX_DOCUMENT_JSON_BYTES: 1}});
for (const key of ["__proto__", "prototype", "constructor"]) {
  bad(`dangerous ${key} nested array`, "DANGEROUS_KEY", (s) => add(s, {array: [JSON.parse(`{"${key}":1}`)]}));
}
badValue("unknown marker", "UNKNOWN_TYPE_MARKER", marker("future", {}));
badValue("non-string marker", "UNKNOWN_TYPE_MARKER", marker(1, {}));
for (const [type, fields] of [["timestamp", {seconds: 0, nanoseconds: 0}],
  ["geoPoint", {latitude: 0, longitude: 0}], ["bytes", {base64: ""}], ["documentReference", {path: "a/b"}]]) {
  badValue(`${type} extra field`, "INVALID_TYPE_MARKER", marker(type, {...fields, extra: true}));
  const missing = {...fields}; delete missing[Object.keys(fields)[0]];
  badValue(`${type} missing field`, "INVALID_TYPE_MARKER", marker(type, missing));
}
for (const seconds of [-62135596801, 253402300800, 0.5, "0", Number.MAX_SAFE_INTEGER]) badValue(`timestamp seconds ${seconds}`, "INVALID_TIMESTAMP", timestamp(seconds));
for (const nanos of [-1, 1000000000, 0.5, "0"]) badValue(`timestamp nanos ${nanos}`, "INVALID_TIMESTAMP", timestamp(0, nanos));
for (const fields of [{latitude: 91, longitude: 0}, {latitude: 0, longitude: -181}, {latitude: "0", longitude: 0}]) badValue(`geopoint ${JSON.stringify(fields)}`, "INVALID_GEOPOINT", marker("geoPoint", fields));
for (const base64 of ["!", "YQ", "YQ==\n", "YR==", "YWJ=", "====", 1]) badValue(`base64 ${JSON.stringify(base64)}`, "INVALID_BYTES", marker("bytes", {base64}));
for (const path of ["a", "a/b/c", "a//b/c", "./b", "a/..", "a/b\0", "", "/a/b/", 1]) badValue(`reference ${JSON.stringify(path)}`, "INVALID_DOCUMENT_REFERENCE", marker("documentReference", {path}));
test("JSON exponent becomes nonfinite and is rejected", () => {
  const text = JSON.stringify(add(fixture(), {value: "EXTREME"})).replace('"EXTREME"', "1e400");
  rejects(gzipSync(Buffer.from(text)), "INVALID_NUMBER");
});
for (const limits of [{MAX_DEPTH: 0}, {MAX_DEPTH: 0.5}, {unknown: 1}, {MAX_ORIGINAL_BYTES: 0.5}]) {
  test(`invalid limits ${JSON.stringify(limits)}`, () => rejects(zipped(fixture()), "INVALID_INPUT", {limits}));
}
test("invalid expected metadata", () => rejects(zipped(fixture()), "INVALID_INPUT", {expectedMetadata: {checksumSha256: "bad"}}));
