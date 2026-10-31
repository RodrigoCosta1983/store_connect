"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {evaluateProductEligibility} = require("../../contracts/productEligibilityC5");
const {validateUpdateProductInput} = require("../../products/updateProductContract");
const evaluate = data => evaluateProductEligibility({protocol: "legacyV1", operation: "cadastral",
  scope: {projectId: "demo-e4c", storeId: "store"}, identity: {productId: "p", variantId: null},
  entity: {exists: true, data, updateTime: {seconds: "1", nanoseconds: 1}}, commercial: {exists: false}});
test("legacyV1 cadastral is contracted and does not demand sale price", () => {
  assert.equal(evaluate({}).status, "compatible");
  assert.equal(evaluate({productKind: "simple", variantSchemaVersion: 1}).status, "compatible");
  assert.equal(evaluate({productKind: "variantParent", variantSchemaVersion: 1}).status, "blocked");
  assert.equal(evaluate({attributeDefinitions: []}).status, "blocked");
});
test("frozen V1 input rejects enumerable structure and monetary authorities without changing contract", () => {
  for (const key of ["productKind", "variantSchemaVersion", "productId", "variantId", "attributes", "attributeDefinitions",
    "priceCents", "costCents", "commercial", "commercialProfiles"]) {
    assert.throws(() => validateUpdateProductInput({requestId: "r", productId: "p", product: {
      name: "Simple", price: 1, quantidade: 0, lotes: [], minimumStock: 0, imageUrl: "", [key]: null,
    }}), TypeError);
  }
});
