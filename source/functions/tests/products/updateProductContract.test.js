"use strict";

const assert = require("node:assert/strict");
const {test} = require("node:test");
const {validateUpdateProductInput} = require("../../products/updateProductContract");
const payload = () => ({requestId: "r", productId: "p", product: {
  name: " Item ", cod: " ca-0001 ", price: 1, quantidade: 0, lotes: [], minimumStock: 0, imageUrl: "",
}});
test("update validates shared commercial schema and normalizes COD", () => {
  const input = payload(); const result = validateUpdateProductInput(input);
  assert.equal(result.product.name, "Item"); assert.equal(result.product.cod, "CA-0001");
  assert.equal(result.codSupplied, true); assert.equal(input.product.cod, " ca-0001 ");
});
test("explicit empty COD and omitted COD remain distinct intentions", () => {
  const input = payload(); input.product.cod = "  ";
  assert.equal(validateUpdateProductInput(input).codSupplied, true);
  assert.equal(validateUpdateProductInput(input).product.cod, undefined);
  delete input.product.cod;
  assert.equal(validateUpdateProductInput(input).codSupplied, false);
});
test("rejects malformed payload and unexpected client storeId", () => {
  for (const input of [null, [], 1, {...payload(), storeId: "other"}]) {
    assert.throws(() => validateUpdateProductInput(input), TypeError);
  }
});
test("rejects invalid product IDs", () => {
  for (const productId of [null, "", " p", "p ", "a/b", 12]) {
    assert.throws(() => validateUpdateProductInput({...payload(), productId}), TypeError);
  }
});
test("rejects missing or invalid requestId", () => {
  for (const requestId of [undefined, null, "", "  ", 12]) {
    assert.throws(() => validateUpdateProductInput({...payload(), requestId}), TypeError);
  }
});
test("rejects fields owned by other backend operations", () => {
  for (const field of ["categoryIds", "categoryId", "categoryName", "isArchived", "archivedAt", "name_lowercase", "storeId"]) {
    const input = payload(); input.product[field] = "x";
    assert.throws(() => validateUpdateProductInput(input), TypeError);
  }
});
test("COD accepts arbitrary text, enforces type and normalized length", () => {
  const input = payload(); input.product.cod = "  a / b . c  ";
  assert.equal(validateUpdateProductInput(input).product.cod, "A / B . C");
  input.product.cod = "a".repeat(40); validateUpdateProductInput(input);
  for (const value of ["a".repeat(41), 12, null]) {
    input.product.cod = value;
    assert.throws(() => validateUpdateProductInput(input), TypeError);
  }
});
test("fiscal server timestamps and invalid lot dates cannot be supplied", () => {
  const input = payload(); input.product.fiscal = {updatedAt: 1};
  assert.throws(() => validateUpdateProductInput(input), TypeError);
  delete input.product.fiscal; input.product.lotes = [{quantidade: 1, validadeMs: "tomorrow"}];
  assert.throws(() => validateUpdateProductInput(input), TypeError);
});
