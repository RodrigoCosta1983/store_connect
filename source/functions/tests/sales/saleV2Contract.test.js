"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const c = require("../../sales/saleV2Contract");
const command = () => ({schemaVersion: 2, requestId: "sale", saleId: "sale",
  scope: {projectId: "demo-test", uid: "u", storeId: "s"}, origin: "online", saleKind: "instant",
  items: [{productId: "p", quantity: 1, expectedUnitPriceCents: 29}], expectedTotalCents: 29, paymentMethod: "PIX"});
test("exact decimal prices without silent rounding; legacy roundtrip", () => {
  for (const [price, cents] of [[0, 0], [0.29, 29], [19.99, 1999], [1e7, 1e9], [0.01, 1]]) assert.equal(c.priceCents(price), cents);
  for (const bad of ["1", null, NaN, Infinity, -1, -0, 1.005, 1e-7, Number.MAX_SAFE_INTEGER]) assert.throws(() => c.priceCents(bad));
});
test("strict cents, quantities and overflow", () => {
  for (const bad of ["1", true, null, -1, -0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const data = command(); data.items[0].quantity = bad; assert.throws(() => c.normalize(data));
    const price = command(); price.items[0].expectedUnitPriceCents = bad; assert.throws(() => c.normalize(price));
  }
  const zero = command(); zero.items[0].quantity = 0; assert.throws(() => c.normalize(zero));
  const overflow = command(); overflow.items[0].quantity = Number.MAX_SAFE_INTEGER; assert.throws(() => c.normalize(overflow));
});
test("unknown effect fields, unsupported modes and duplicate IDs reject", () => {
  for (const extra of [{isPaid: true}, {fiscal: {}}, {installments: []}, {saleKind: "deferred"}, {origin: "offline"}, {paymentMethod: "A prazo"}, {saleId: "other"}]) {
    assert.throws(() => c.normalize({...command(), ...extra}));
  }
  const duplicate = command(); duplicate.items.push({...duplicate.items[0]}); assert.throws(() => c.normalize(duplicate));
  const total = command(); total.expectedTotalCents++; assert.throws(() => c.normalize(total));
});
test("canonical order and optional null normalize consistently; scope participates in hash", () => {
  const data = command(); data.items.push({productId: "a", quantity: 1, expectedUnitPriceCents: 1}); data.expectedTotalCents++;
  assert.equal(c.hash(c.normalize(data)), c.hash(c.normalize({...data, notes: null, customerId: null, items: data.items.slice().reverse()})));
  assert.notEqual(c.hash(c.normalize(data)), c.hash(c.normalize({...data, scope: {...data.scope, uid: "other"}})));
});
test("IDs obey Firestore constraints without illustrative 128-character limit", () => {
  assert.equal(c.id("x".repeat(1500)).length, 1500);
  assert.equal(c.id("😀"), "😀");
  for (const bad of ["", ".", "..", "a/b", " x", "__reserved__", "x".repeat(1501), "\u0000", "\ud800"]) assert.throws(() => c.id(bad));
});
