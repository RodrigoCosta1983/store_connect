"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const c = require("../../contracts/productCommercialC5");
const b = require("../../contracts/productVariantsV1");
const parent = raw => new c.ProductCommercialDto(raw);
const variant = raw => new c.VariantCommercialDto(raw);
const resolve = (p, v) => c.resolveCommercial(parent(p), variant(v));
const override = value => ({mode: "override", value});
const exception = value => ({...override(value), reason: "Exceção sintética documentada"});

test("base price inheritance is explicit, preserves zero and tracks omitted policy", () => {
  const v = variant({});
  assert.deepEqual(v.priceCents, {state: "omitted"});
  assert.deepEqual(c.resolveCommercial(parent({priceCents: 0}), v).priceCents,
      {source: "parent", state: "value", value: 0});
  assert.deepEqual(resolve({priceCents: 1234}, {priceCents: {mode: "inherit"}}).priceCents,
      {source: "parent", state: "value", value: 1234});
});
test("variant price overrides base without changing it", () => {
  const p = parent({priceCents: 1234});
  assert.equal(c.resolveCommercial(p, variant({priceCents: override(0)})).priceCents.value, 0);
  assert.equal(p.priceCents.value, 1234);
});
test("absent parent and explicit null never become zero or inheritance", () => {
  assert.deepEqual(resolve({}, {}).priceCents, {source: "parent", state: "omitted"});
  assert.deepEqual(resolve({priceCents: null}, {}).priceCents, {source: "parent", state: "null", value: null});
  assert.deepEqual(resolve({priceCents: 100}, {priceCents: null}).priceCents,
      {source: "unresolved", state: "null", value: null});
  assert.throws(() => variant({priceCents: override(null)}), TypeError);
});
test("cent amounts and minimum stock reject coercion, fractions and unsafe integers", () => {
  for (const bad of [-1, -0, 0.01, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "10", true, undefined]) {
    for (const key of ["priceCents", "costCents", "minimumStock"]) {
      assert.throws(() => parent({[key]: bad}), TypeError);
    }
    assert.throws(() => variant({priceCents: override(bad)}), TypeError);
    assert.throws(() => variant({minimumStock: bad}), TypeError);
    assert.throws(() => variant({costCents: exception(bad)}), TypeError);
  }
  assert.equal(parent({priceCents: Number.MAX_SAFE_INTEGER}).priceCents.value, Number.MAX_SAFE_INTEGER);
});
test("single image distinguishes inheritance, own image, null, absence and explicit removal", () => {
  assert.equal(resolve({imageUrl: "parent"}, {}).imageUrl.value, "parent");
  assert.deepEqual(resolve({}, {}).imageUrl, {source: "parent", state: "omitted"});
  assert.deepEqual(resolve({imageUrl: null}, {}).imageUrl, {source: "parent", state: "null", value: null});
  assert.equal(resolve({imageUrl: "parent"}, {imageUrl: override("variant")}).imageUrl.value, "variant");
  assert.deepEqual(resolve({imageUrl: "parent"}, {imageUrl: {mode: "remove"}}).imageUrl,
      {source: "variant", state: "removed"});
  assert.equal(resolve({imageUrl: "parent"}, {imageUrl: null}).imageUrl.source, "unresolved");
  for (const value of ["", " ", [], 123, undefined]) assert.throws(() => parent({imageUrl: value}), TypeError);
  assert.throws(() => variant({imageUrl: {mode: "remove", value: "x"}}), TypeError);
});
test("cost and fiscal inherit; exceptions require explicit rationale and do not merge fiscal", () => {
  const p = {costCents: 55, fiscal: {ncm: "0101", origem: null, cfop: "5102"}};
  assert.equal(resolve(p, {}).costCents.value, 55);
  assert.deepEqual(resolve(p, {}).fiscal.value, p.fiscal);
  assert.deepEqual(resolve(p, {fiscal: exception({ncm: "0202"})}).fiscal.value, {ncm: "0202"});
  assert.equal(resolve(p, {costCents: exception(0)}).costCents.value, 0);
  for (const key of ["costCents", "fiscal"]) {
    const value = key === "costCents" ? 10 : {};
    assert.throws(() => variant({[key]: override(value)}), TypeError);
    assert.throws(() => variant({[key]: {...exception(value), reason: " "}}), TypeError);
    assert.throws(() => variant({[key]: {...exception(value), trusted: true}}), TypeError);
    assert.throws(() => variant({[key]: {mode: "remove"}}), TypeError);
  }
});
test("fiscal whitelist follows existing fields without inventing tax validation", () => {
  const all = Object.fromEntries(c.FISCAL_FIELDS.map(k => [k, ""]));
  assert.deepEqual(parent({fiscal: all}).fiscal.value, all);
  assert.deepEqual(parent({fiscal: {ncm: null}}).fiscal.value, {ncm: null});
  for (const fiscal of [{taxRate: 10}, {ncm: 123}, {ncm: undefined}, [], new Date()]) {
    assert.throws(() => parent({fiscal}), TypeError);
  }
});
test("minimum stock belongs to variant and never inherits or changes operational stock", () => {
  assert.deepEqual(resolve({minimumStock: 99}, {}).minimumStock, {source: "variant", state: "omitted"});
  assert.equal(resolve({minimumStock: 99}, {minimumStock: 0}).minimumStock.value, 0);
  assert.deepEqual(resolve({}, {minimumStock: null}).minimumStock, {source: "variant", state: "null", value: null});
  assert.throws(() => variant({minimumStock: {mode: "inherit"}}), TypeError);
});
test("commercial boundary rejects balance, lots, COD and protocol fields at all supported levels", () => {
  for (const key of ["quantidade", "lotes", "stock", "saldo", "cod", "receipt", "expectedUpdateTime", "scope", "discount", "images"]) {
    assert.throws(() => parent({[key]: 1}), TypeError);
    assert.throws(() => variant({[key]: 1}), TypeError);
    assert.throws(() => variant({priceCents: {...override(1), [key]: 1}}), TypeError);
    assert.throws(() => parent({fiscal: {[key]: 1}}), TypeError);
  }
});
test("DTOs copy nested input and freeze results without freezing caller", () => {
  const raw = {fiscal: exception({ncm: "01", origem: null})};
  const dto = variant(raw);
  const result = c.resolveCommercial(parent({}), dto);
  raw.fiscal.value.ncm = "changed";
  assert.equal(result.fiscal.value.ncm, "01");
  assert.equal(Object.isFrozen(raw.fiscal.value), false);
  assert.throws(() => { dto.fiscal.value.value.ncm = "bad"; }, TypeError);
  assert.throws(() => { result.fiscal.reason = "bad"; }, TypeError);
  assert.throws(() => { result.priceCents = {}; }, TypeError);
});
test("legacy money conversion is exact decimal parsing without binary multiplication or rounding", () => {
  for (const [value, cents] of [[0, 0], [0.29, 29], [19.99, 1999], [1.1, 110], [123, 12300]]) {
    assert.equal(c.legacyMoneyToCents(value), cents);
  }
  for (const bad of [1.005, 0.1 + 0.2, 1e-7, 1e20, Number.MAX_SAFE_INTEGER, -0, -1, NaN, Infinity, "1.00", null]) {
    assert.throws(() => c.legacyMoneyToCents(bad), TypeError);
  }
});
test("legacy observation preserves absence, null, empty image and unknown fiscal without migration", () => {
  const raw = {price: 19.99, costPrice: null, imageUrl: "", fiscal: {customLegacy: "opaque"}, quantidade: 7, lotes: []};
  const dto = b.productDto("p", raw);
  const observed = c.observeLegacyCommercial(dto);
  assert.deepEqual(observed.price, {state: "value", value: 19.99});
  assert.deepEqual(observed.costPrice, {state: "null", value: null});
  assert.deepEqual(observed.barcode, {state: "omitted"});
  assert.equal(observed.imageUrl.value, "");
  assert.equal(observed.fiscal.value.customLegacy, "opaque");
  assert.deepEqual(dto.data, raw);
  assert.equal(has(observed, "quantidade"), false);
  assert.equal(dto.stock().quantidade, 7);
  assert.throws(() => c.observeLegacyCommercial({data: raw}), TypeError);
});
const has = (v, key) => Object.hasOwn(v, key);
test("F10-B variant snapshot remains opaque and identity and combination remain unchanged", () => {
  const p = b.productDto("p", {productKind: "variantParent", variantSchemaVersion: 1, attributeDefinitions: []});
  const v = new b.VariantDto("v", {variantSchemaVersion: 1, productId: "p", attributes: [], price: null, quantidade: 3}, p);
  resolve({priceCents: 100}, {});
  assert.deepEqual(v.field("price"), {state: "null", value: null});
  assert.equal(v.identity.key, '["p","v"]');
  assert.equal(v.combination.key, "[]");
  assert.equal(v.stock().quantidade, 3);
});
test("barcode is independent, exact and optional, with no inherited fallback", () => {
  assert.deepEqual(resolve({barcode: "001"}, {}).barcode, {source: "variant", state: "omitted"});
  assert.equal(variant({barcode: "001"}).barcode.value, "001");
  assert.equal(variant({barcode: null}).barcode.state, "null");
  for (const bad of [1, "", " ", undefined]) assert.throws(() => variant({barcode: bad}), TypeError);
});
test("barcode candidate search never selects an ambiguous result or conflates identities", () => {
  const simple = new b.ItemIdentityDto({productId: "p", variantId: null});
  const v = new b.ItemIdentityDto({productId: "p", variantId: "v"});
  const candidates = [{identity: simple, barcode: "001"}, {identity: v, barcode: "001"}];
  const ambiguous = c.barcodeMatches("001", candidates);
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.matches.length, 2);
  assert.equal(has(ambiguous, "selected"), false);
  assert.equal(c.barcodeMatches("001", candidates.slice(0, 1)).status, "uniqueInCandidates");
  assert.equal(c.barcodeMatches("1", candidates).status, "notFound");
  assert.equal(c.barcodeMatches("001", [{identity: simple}, {identity: v, barcode: null}]).status, "notFound");
  assert.throws(() => ambiguous.matches.pop(), TypeError);
  assert.throws(() => c.barcodeMatches("001", [candidates[0], candidates[0]]), TypeError);
  assert.throws(() => c.barcodeMatches("001", [{identity: {productId: "p", variantId: null}}]), TypeError);
});
test("malformed modes, undefined, unknown fields and non-DTO resolver inputs fail closed", () => {
  for (const raw of [null, [], new Date(), {price: 10}, {[Symbol("hidden")]: 1}]) {
    assert.throws(() => parent(raw), TypeError);
    assert.throws(() => variant(raw), TypeError);
  }
  for (const value of [undefined, 10, {}, {mode: "inherit", value: 1}, {mode: "remove"}, {mode: "override"}]) {
    assert.throws(() => variant({priceCents: value}), TypeError);
  }
  assert.throws(() => c.resolveCommercial({}, variant({})), TypeError);
});
