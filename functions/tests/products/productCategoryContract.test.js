"use strict";

const assert = require("assert");
const {
  validateCategoryIds,
  captureTaxonomyState,
  projectLegacyCategories,
} = require("../../products/productCategoryContract");

let passed = 0;
let failed = 0;
function test(name, run) {
  try {
    run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`, error);
  }
}

for (const count of [0, 1, 10]) {
  test(`accept ${count} IDs`, () => {
    const ids = Array.from({ length: count }, (_, i) => `id${i}`);
    assert.deepStrictEqual(validateCategoryIds(ids), ids);
  });
}
test("reject 11 IDs", () => {
  assert.throws(() => validateCategoryIds(Array.from({ length: 11 }, (_, i) => `id${i}`)));
});
for (const [name, value] of [
  ["null", null], ["scalar string", "id"], ["number", 1], ["object", {}],
  ["null element", [null]], ["numeric element", [1]], ["empty ID", [""]],
  ["blank ID", [" \t\n"]], ["leading space", [" id"]],
  ["trailing space", ["id "]], ["slash", ["a/b"]], ["duplicate", ["a", "a"]],
]) {
  test(`reject ${name}`, () => assert.throws(() => validateCategoryIds(value)));
}
test("case-sensitive IDs retain order", () => {
  assert.deepStrictEqual(validateCategoryIds(["z", "A", "a"]), ["z", "A", "a"]);
});
test("no invented ID limits or pattern", () => {
  const ids = ["a b", "__id__", "á", "x".repeat(2000)];
  assert.deepStrictEqual(validateCategoryIds(ids), ids);
});
test("validator does not mutate or alias the input array", () => {
  const ids = Object.freeze(["b", "a"]);
  const result = validateCategoryIds(ids);
  result.reverse();
  assert.deepStrictEqual(ids, ["b", "a"]);
});
test("absent fields remain absent", () => {
  assert.deepStrictEqual(captureTaxonomyState({}), {
    categoryIds: { present: false }, categoryId: { present: false },
    categoryName: { present: false },
  });
});
for (const [name, value] of [
  ["null", null], ["empty array", []], ["existing array", ["a"]],
  ["invalid object", { invalid: true }], ["invalid scalar", 7],
  ["invalid array", [null]], ["explicit undefined", undefined],
]) {
  test(`state preserves categoryIds ${name}`, () => {
    assert.deepStrictEqual(captureTaxonomyState({ categoryIds: value }).categoryIds,
      { present: true, value });
  });
}
test("categoryId absent differs from null", () => {
  assert.notDeepStrictEqual(captureTaxonomyState({}).categoryId,
    captureTaxonomyState({ categoryId: null }).categoryId);
});
test("categoryName absent differs from empty string", () => {
  assert.deepStrictEqual(captureTaxonomyState({ categoryName: "" }).categoryName,
    { present: true, value: "" });
  assert.notDeepStrictEqual(captureTaxonomyState({}).categoryName,
    captureTaxonomyState({ categoryName: "" }).categoryName);
});
test("state preserves invalid legacy values without mutating input", () => {
  const product = Object.freeze({ categoryId: 3, categoryName: false });
  assert.deepStrictEqual(captureTaxonomyState(product), {
    categoryIds: { present: false }, categoryId: { present: true, value: 3 },
    categoryName: { present: true, value: false },
  });
});
test("inherited fields are not document fields", () => {
  assert.deepStrictEqual(captureTaxonomyState(Object.create({ categoryId: "a" })),
    captureTaxonomyState({}));
});
test("invalid product root rejected", () => {
  for (const value of [null, [], "product", undefined]) {
    assert.throws(() => captureTaxonomyState(value));
  }
});

const resolved = new Map([
  ["a", Object.freeze({ name: "Alpha", categoryName: "Old Alpha" })],
  ["b", Object.freeze({ name: "Beta" })],
]);
test("empty projection explicitly clears legacy fields", () => {
  assert.deepStrictEqual(projectLegacyCategories([], new Map()),
    { categoryIds: [], categoryId: null, categoryName: null });
});
test("single category projection uses canonical name", () => {
  assert.deepStrictEqual(projectLegacyCategories(["a"], resolved),
    { categoryIds: ["a"], categoryId: "a", categoryName: "Alpha" });
});
test("multiple categories preserve order and use first", () => {
  assert.deepStrictEqual(projectLegacyCategories(["b", "a"], resolved),
    { categoryIds: ["b", "a"], categoryId: "b", categoryName: "Beta" });
});
test("changing order changes legacy projection", () => {
  assert.strictEqual(projectLegacyCategories(["a", "b"], resolved).categoryName, "Alpha");
  assert.strictEqual(projectLegacyCategories(["b", "a"], resolved).categoryName, "Beta");
});
test("projection does not mutate inputs or alias IDs", () => {
  const ids = Object.freeze(["b", "a"]);
  const before = Array.from(resolved.entries());
  const result = projectLegacyCategories(ids, resolved);
  result.categoryIds.pop();
  assert.deepStrictEqual(ids, ["b", "a"]);
  assert.deepStrictEqual(Array.from(resolved.entries()), before);
});
test("missing first category never falls back to another", () => {
  assert.throws(() => projectLegacyCategories(["missing", "a"], resolved));
});
test("missing subsequent category also rejected", () => {
  assert.throws(() => projectLegacyCategories(["a", "missing"], resolved));
});
for (const [name, value] of [
  ["undefined", undefined], ["null", null], ["number", 1],
  ["empty", ""], ["blank", " \t"], ["array", []],
]) {
  test(`reject canonical name ${name}`, () => {
    assert.throws(() => projectLegacyCategories(["a"], new Map([["a", { name: value }]])));
  });
}
test("invalid subsequent name rejected", () => {
  assert.throws(() => projectLegacyCategories(["a", "b"],
    new Map([["a", { name: "Alpha" }], ["b", { name: "" }]])));
});
test("legacy name is not a canonical fallback", () => {
  assert.throws(() => projectLegacyCategories(["a"],
    new Map([["a", { categoryName: "Legacy" }]])));
});
test("canonical name is not normalized", () => {
  assert.strictEqual(projectLegacyCategories(["a"],
    new Map([["a", { name: " Alpha " }]])).categoryName, " Alpha ");
});
test("resolved collection must be Map", () => {
  assert.throws(() => projectLegacyCategories(["a"], { a: { name: "Alpha" } }));
});
test("projection defensively validates IDs", () => {
  assert.throws(() => projectLegacyCategories(["a", "a"], resolved));
});

console.log(`Tests: ${passed} passed; ${failed} failed`);
if (failed > 0) process.exitCode = 1;
