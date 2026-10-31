"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict");
const {STORE, planStore, policy} = require("./plan.cjs");
const str = stringValue => ({stringValue});
const doc = (path, fields) => ({path, fields, updateTime: "2026-10-25T00:00:00Z"});
function fixture() {
  const root = doc(`stores/${STORE}`, {ownerId: str("owner"), subscriptionStatus: str("active"), subscriptionType: str("business"), blockedAt: str("old"), name: str("Synthetic")});
  return {source: [root, doc(`stores/${STORE}/products/p`, {quantidade: {integerValue: "37"}, image: str("https://firebasestorage.googleapis.com/prod"), name: str("Product")}),
    doc(`stores/${STORE}/sales/s`, {total: {integerValue: "10"}, customerName: str("PRIVATE"), asaasPaymentId: str("PRIVATE")})],
  target: [root, doc(`stores/${STORE}/products/p`, {quantidade: {integerValue: "37"}})], owner: {uid: "owner", role: "admin", storeId: STORE}};
}
test("deterministic idempotent plan, preserving stock/entitlement and excluding financial identifiers", () => {
  const f = fixture(), a = planStore(f), b = planStore(f);
  assert.deepEqual(a, b); assert.equal(a.applyEnabled, false);
  assert.equal(a.entries[0].fields.find(x => x.field === "subscriptionStatus").action, "PRESERVE_HML");
  assert.equal(a.entries[1].fields.find(x => x.field === "quantidade").action, "PRESERVE_HML");
  assert.equal(a.entries[1].fields.find(x => x.field === "image").action, "REMAP_STORAGE");
  assert.equal(a.entries[2].fields.find(x => x.field === "total").action, "ARCHIVE_ONLY_REVIEW");
  assert.equal(a.entries[2].fields.find(x => x.field === "asaasPaymentId").action, "EXCLUDE");
  assert.ok(!JSON.stringify(a).includes("PRIVATE"));
});
for (const overrides of [{targetProject: "store-connect-app"}, {storeId: "other"}, {owner: {role: "gerente"}}, {owner: {uid: "other", role: "admin", storeId: STORE}}]) {
  test(`rejects crossed project/store/owner guard ${JSON.stringify(overrides)}`, () => assert.throws(() => planStore({...fixture(), ...overrides})));
}
test("unknown fields and credentials fail closed; nested stock preserved", () => {
  assert.equal(policy(`stores/${STORE}`, "mystery", str("x"))[0], "REVIEW_UNKNOWN");
  assert.equal(policy(`stores/${STORE}/products/p/variants/v`, "stock", {integerValue: "2"})[0], "PRESERVE_HML");
  assert.equal(policy(`stores/${STORE}`, "apiSecret", str("x"))[0], "EXCLUDE");
});
test("duplicate, foreign paths and missing versions are rejected", () => {
  for (const kind of ["duplicate", "foreign", "unversioned"]) {
    const f = fixture();
    if (kind === "duplicate") f.source.push(f.source[0]);
    if (kind === "foreign") f.source[1].path = "stores/foreign/products/p";
    if (kind === "unversioned") delete f.target[0].updateTime;
    assert.throws(() => planStore(f), /snapshot_path_or_version_guard/);
  }
});
test("version drift changes plan identity; target-only fields are preserved", () => {
  const f = fixture(), before = planStore(f).planDigest;
  f.target[1].updateTime = "2026-10-25T01:00:00Z";
  f.target[1].fields.hmlOnly = str("keep");
  const after = planStore(f);
  assert.notEqual(after.planDigest, before);
  assert.deepEqual(after.entries[1].targetOnlyFields, ["hmlOnly"]);
});
