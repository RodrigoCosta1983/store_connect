"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const contract = require("../../products/productMutationContract");
const {evaluateProductEligibility} = require("../../contracts/productEligibilityC5");
const domainFields = ["productKind", "variantSchemaVersion", "productId", "variantId", "attributes",
  "attributeDefinitions", "priceCents", "costCents", "commercial", "commercialProfiles"];
const base = changes => ({schemaVersion: 2, requestId: "r", productId: "p",
  expectedUpdateTime: {seconds: "1900000000", nanoseconds: 0}, changes});

test("frozen cadastral allowlists cannot change current or resulting C5 domain fields", () => {
  // REMOVE_FIELDS is private: verify removals through the frozen public API.
  const removals = contract.validateUpdateProductV2(base({remove: ["cod", "barcode", "costPrice"]})).changes.remove;
  for (const fields of [contract.SET_FIELDS, removals, contract.FISCAL_FIELDS]) {
    assert.deepEqual(fields.filter(key => domainFields.includes(key)), []);
  }
  // Derived writes in F9 are name_lowercase, fiscal.updatedAt and taxonomy;
  // no commercial profile is created by any accepted patch.
  for (const key of ["name_lowercase", "fiscal", "categoryIds", "categoryId", "categoryName"]) {
    assert.ok(!domainFields.includes(key));
  }
});

test("all structural/new-money patch attempts reject without altering the command", () => {
  for (const key of domainFields) {
    for (const changes of [{set: {[key]: null}}, {remove: [key]}, {fiscal: {set: {[key]: "x"}}},
      {set: {[key + ".nested"]: "x"}}]) {
      const data = base(changes), frozen = structuredClone(data);
      assert.throws(() => contract.validateUpdateProductV2(data), TypeError);
      assert.deepEqual(data, frozen);
    }
  }
});

test("cadastral domain view remains compatible through legacy invalid-price corrections", () => {
  for (const price of [NaN, Infinity, -Infinity, "bad", null]) {
    const before = {price, productKind: "simple", variantSchemaVersion: 1};
    const data = base({set: {price: 2, name: "Fixed"}});
    const normalized = contract.validateUpdateProductV2(data);
    const after = {...before, ...normalized.changes.set};
    const view = v => Object.fromEntries(domainFields.filter(k => Object.hasOwn(v, k)).map(k => [k, v[k]]));
    assert.deepEqual(view(before), view(after));
    for (const entity of [before, after]) {
      assert.equal(evaluateProductEligibility({protocol: "legacyV2", operation: "cadastral",
        scope: {projectId: "demo-e2-b", storeId: "s"}, identity: {productId: "p", variantId: null},
        entity: {exists: true, data: view(entity), updateTime: {seconds: "1900000000", nanoseconds: 0}},
        commercial: {exists: false}}).status, "compatible");
    }
    assert.ok(Object.is(before.price, price));
  }
});
