"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");
const {assertOfflineItems, assertOfflineProduct} = require("../../sales/offlineSaleEligibilityE4D");
const {evaluateProductEligibility} = require("../../contracts/productEligibilityC5");
const scope = {projectId: "demo-offline-policy", storeId: "s"};
const time = {seconds: 1, nanoseconds: 123456000};
const snapshot = data => ({exists: true, data: () => data, updateTime: time});
const check = (data = {}, commercial = {exists: false}) => assertOfflineProduct({scope,
  productId: "p", product: snapshot(data), commercial});
const fails = fn => assert.throws(fn, e => e.code === "failed-precondition");

test("dedicated predicates accept legacy and explicit simple, never reprice or mutate history", () => {
  for (const data of [{price: 999, legacy: new admin.firestore.Timestamp(1, 2)},
    {productKind: "simple", variantSchemaVersion: 1, price: null}]) {
    Object.freeze(data); check(data);
  }
  const raw = Object.freeze([Object.freeze({productId: " p ", name: "Old", price: 10})]);
  const normalized = Object.freeze([Object.freeze({productId: "p", name: "Old", price: 10})]);
  assertOfflineItems(raw, normalized);
  assert.equal(normalized[0].price, 10); assert.equal(raw[0].productId, " p ");
});
test("parents, variants, mixed and partial identity fail closed", () => {
  for (const data of [{productKind: "variantParent", variantSchemaVersion: 1, attributeDefinitions: []},
    {attributeDefinitions: []}, {variantSchemaVersion: 1, productId: "p", attributes: {}},
    {productKind: "simple"}, {variantSchemaVersion: 1},
    {productKind: "simple", variantSchemaVersion: 1, attributes: {}}]) fails(() => check(data));
});
test("all ten markers preserve own presence including malformed/SDK values", () => {
  const fields = ["productKind", "variantSchemaVersion", "productId", "variantId", "attributes",
    "attributeDefinitions", "priceCents", "costCents", "commercial", "commercialProfiles"];
  for (const key of fields) for (const value of [null, undefined, NaN, {}, [], new admin.firestore.Timestamp(1, 1)]) {
    const data = Object.freeze({[key]: value}); fails(() => check(data));
    assert.ok(Object.hasOwn(data, key)); assert.ok(Object.is(data[key], value));
  }
});
test("any commercial document including empty or SDK fails; money authorities never authorize", () => {
  for (const data of [{}, {schemaVersion: 1}, {stamp: new admin.firestore.Timestamp(1, 1)}]) {
    fails(() => check({}, snapshot(data)));
  }
  for (const key of ["priceCents", "costCents", "commercial", "commercialProfiles"]) fails(() => check({[key]: 100}));
});
test("raw explicit variantId including undefined/null and normalized duplicates fail", () => {
  for (const variantId of [undefined, null, "v"]) {
    assert.throws(() => assertOfflineItems([{productId: "p", variantId}], [{productId: "p"}]), e => e.code === "invalid-argument");
  }
  assert.throws(() => assertOfflineItems([{productId: "p"}, {productId: " p "}],
    [{productId: "p"}, {productId: "p"}]), e => e.code === "invalid-argument");
});
test("original C5 offline remains blocked; inspection is explicitly non-authorizing", () => {
  const input = {protocol: "legacyV1", operation: "offline", scope, identity: {productId: "p", variantId: null},
    entity: {exists: true, data: {}, updateTime: {seconds: "1", nanoseconds: 0}}, commercial: {exists: false}};
  const result = evaluateProductEligibility(input);
  assert.equal(result.status, "blocked"); assert.equal(result.reason, "offline-history-context-required");
});
