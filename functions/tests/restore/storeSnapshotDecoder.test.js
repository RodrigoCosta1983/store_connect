"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const {Firestore, Timestamp, GeoPoint} = require("firebase-admin/firestore");
const {decodeStoreSnapshotValue: decode} = require("../../backups/storeSnapshotDecoder");
const marker = (type, fields) => ({__storeConnectType: type, ...fields});

for (const value of [null, true, false, 0, -2.5, "text", [], {nested: [null, {a: 3}]}]) {
  test("primitive/container " + JSON.stringify(value), () => {
    assert.deepEqual(decode(value), value);
    assert.deepEqual(decode(value), decode(value));
  });
}
test("Timestamp nanosecond precision and nested arrays", () => {
  const result = decode({a: [marker("timestamp", {seconds: 123, nanoseconds: 987654321})]});
  assert.ok(result.a[0] instanceof Timestamp);
  assert.ok(result.a[0].isEqual(new Timestamp(123, 987654321)));
});
test("GeoPoint", () => assert.ok(decode(marker("geoPoint", {latitude: -23, longitude: 180})).isEqual(new GeoPoint(-23, 180))));
test("Bytes", () => assert.deepEqual(decode(marker("bytes", {base64: "AAH/"})), Buffer.from([0, 1, 255])));
test("approved internal reference and deterministic decode", async () => {
  const db = new Firestore({projectId: "demo-store-connect-restore", host: "127.0.0.1:8080", ssl: false});
  try {
    const path = "stores/B/products/p";
    const options = {targetStoreId: "B", approvedReferencePaths: [path], referenceFactory: (p) => db.doc(p)};
    const value = marker("documentReference", {path});
    assert.equal(decode(value, options).path, path);
    assert.ok(decode(value, options).isEqual(decode(value, options)));
  } finally { await db.terminate(); }
});
for (const value of [undefined, NaN, Infinity, new Date(), marker("unknown", {}),
  marker("timestamp", {seconds: 0, nanoseconds: -1}), marker("timestamp", {seconds: 0, nanoseconds: 0, extra: 1}),
  marker("geoPoint", {latitude: 91, longitude: 0}), marker("bytes", {base64: "bad"}),
  marker("documentReference", {path: "stores//products/p"}), [, 1]]) {
  test("invalid value " + String(value), () => assert.throws(() => decode(value)));
}
for (const path of ["stores/A/products/p", "stores/B/catalogs/c", "users/u", "stores/B", "stores/C/products/p", "stores/B/products/p"]) {
  test("blocked/unapproved reference " + path, () => assert.throws(() => decode(marker("documentReference", {path}),
    {targetStoreId: "B", approvedReferencePaths: path.endsWith("/p") && !path.includes("/B/") ? [path] : []}), /BLOCKED_REFERENCE/));
}
test("accessors and cycles rejected without invoking getters", () => {
  let calls = 0; const value = {get x() { calls++; return 1; }};
  assert.throws(() => decode(value)); assert.equal(calls, 0);
  const cycle = {}; cycle.x = cycle; assert.throws(() => decode(cycle));
});
