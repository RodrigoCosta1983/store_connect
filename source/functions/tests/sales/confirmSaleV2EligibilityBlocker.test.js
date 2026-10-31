"use strict";

// D1 regression of the E1 blocker. Pure contract only, NOT installed protection.
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {evaluateProductEligibility} = require("../../contracts/productEligibilityC5");
const snapshot = data => ({exists: true, data,
  updateTime: {seconds: "1792100000", nanoseconds: 123456000}});
const definitions = [{attributeId: "size", label: "Tamanho", values: [{valueId: "m", label: "M"}]}];
function input(data) {
  return {protocol: "legacyV2", operation: "sale",
    scope: {projectId: "demo-c5-e1", storeId: "s"}, identity: {productId: "p", variantId: null},
    entity: snapshot(data), commercial: {exists: false}};
}
test("D1 rejects the E1 parent-shaped document after both discriminators are removed", () => {
  const parent = {productKind: "variantParent", variantSchemaVersion: 1, attributeDefinitions: definitions,
    name: "Pai sintético", price: 0.29, quantidade: 5, lotes: [], isArchived: false};
  assert.equal(evaluateProductEligibility(input(parent)).status, "blocked");
  const demoted = {...parent};
  delete demoted.productKind;
  delete demoted.variantSchemaVersion;
  const before = JSON.stringify(demoted);
  const observed = evaluateProductEligibility(input(demoted));
  assert.equal(observed.status, "blocked");
  assert.equal(observed.reason, "invalid-kind-or-identity");
  assert.equal(Object.hasOwn(observed, "kind"), false);
  assert.deepEqual(demoted.attributeDefinitions, definitions);
  assert.equal(JSON.stringify(demoted), before);
});
