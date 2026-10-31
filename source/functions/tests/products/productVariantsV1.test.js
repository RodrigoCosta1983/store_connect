"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const c = require("../../contracts/productVariantsV1");
const f9 = require("../../products/productCodeReservation");
const v2 = require("../../sales/saleV2Contract");
const defs = () => [
  {attributeId: "size", label: "Tamanho", values: [{valueId: "m", label: "M"}]},
  {attributeId: "color", label: "Cor", values: [{valueId: "blue", label: "Azul"}]},
];
const pairs = () => [{attributeId: "size", valueId: "m"}, {attributeId: "color", valueId: "blue"}];
const parent = (definitions = defs()) => c.productDto("p", {
  productKind: "variantParent", variantSchemaVersion: 1, attributeDefinitions: definitions,
});
const variant = (p = parent(), extra = {}) => new c.VariantDto("stable-v", {
  variantSchemaVersion: 1, productId: "p", attributes: pairs(), ...extra,
}, p);

test("legacy simple snapshot has no persisted defaults and preserves unknown data", () => {
  const raw = {name: "Legado", price: 0, custom: {nested: [1, null]}, barcode: null};
  const dto = c.productDto("p", raw);
  assert.ok(dto instanceof c.SimpleProductDto);
  assert.equal(dto.isLegacy, true);
  assert.equal(dto.isSellable, true);
  assert.deepEqual(dto.data, raw);
  assert.equal(Object.hasOwn(dto.data, "productKind"), false);
  assert.deepEqual(dto.field("quantidade"), {state: "omitted"});
  assert.deepEqual(dto.field("barcode"), {state: "null", value: null});
  assert.deepEqual(dto.field("price"), {state: "value", value: 0});
  assert.deepEqual(dto.field("missingCustom"), {state: "omitted"});
  raw.custom.nested.push(2);
  assert.deepEqual(dto.data.custom.nested, [1, null]);
  assert.throws(() => dto.data.custom.nested.push(3), TypeError);
  assert.throws(() => { dto.productId = "changed"; }, TypeError);
});

test("parent is structurally non-sellable even with stock and price", () => {
  const dto = c.productDto("p", {productKind: "variantParent", variantSchemaVersion: 1,
    attributeDefinitions: [], quantidade: 100, price: 10});
  assert.equal(dto.isSellable, false);
  assert.equal(dto.field("quantidade").value, 100);
});

test("new discriminators are strict and unknown fields never default", () => {
  for (const raw of [{productKind: "simple"}, {variantSchemaVersion: 1},
    {productKind: null, variantSchemaVersion: 1}, {productKind: "other", variantSchemaVersion: 1},
    {productKind: "simple", variantSchemaVersion: 2},
    {productKind: "simple", variantSchemaVersion: 1, typo: 10}]) {
    assert.throws(() => c.productDto("p", raw), TypeError);
  }
  const simple = c.productDto("p", {productKind: "simple", variantSchemaVersion: 1});
  assert.equal(simple.isLegacy, false);
  assert.deepEqual(simple.field("price"), {state: "omitted"});
});

test("renaming labels or commercial fields cannot derive or change variant ID", () => {
  const renamed = defs(); renamed[0].label = "Medida"; renamed[0].values[0].label = "Médio";
  const first = variant(); const second = variant(parent(renamed), {name: "Novo", cod: "NEW", barcode: "123"});
  assert.equal(first.variantId, "stable-v");
  assert.equal(first.identity.key, second.identity.key);
  assert.equal(first.combination.key, second.combination.key);
  assert.throws(() => { first.variantId = "new"; }, TypeError);
});

test("canonical attributes ignore input and definition order without mutating either", () => {
  const raw = pairs(); const d = c.definitions(defs());
  const a = c.canonicalCombination(raw, d);
  const b = c.canonicalCombination(raw.slice().reverse(), d.slice().reverse());
  assert.equal(a.key, b.key);
  assert.deepEqual(a.pairs.map((p) => p.attributeId), ["color", "size"]);
  assert.equal(raw[0].attributeId, "size");
  assert.throws(() => a.pairs.reverse(), TypeError);
  assert.throws(() => { a.pairs[0].valueId = "new"; }, TypeError);
});

test("duplicate combinations and duplicate selected attributes reject", () => {
  const a = variant().combination;
  assert.throws(() => c.uniqueCombinations([a, variant().combination]), TypeError);
  assert.throws(() => c.canonicalCombination([pairs()[0], pairs()[0]], c.definitions(defs())), TypeError);
  c.uniqueCombinations([a]);
});

test("duplicate definitions, duplicate values and unknown fields reject", () => {
  assert.throws(() => c.definitions([defs()[0], defs()[0]]), TypeError);
  assert.throws(() => new c.AttributeDefinitionDto({...defs()[0], values: [defs()[0].values[0], defs()[0].values[0]]}), TypeError);
  assert.throws(() => new c.AttributeValueDto({valueId: "m", label: "M", typo: true}), TypeError);
  assert.throws(() => new c.AttributeDefinitionDto({...defs()[0], label: " "}), TypeError);
});

test("nonexistent attributes and values, mismatched parents and malformed pairs reject", () => {
  for (const attributes of [[{attributeId: "missing", valueId: "m"}],
    [{attributeId: "size", valueId: "missing"}], [{attributeId: "size", valueId: "m", extra: true}]]) {
    assert.throws(() => variant(parent(), {attributes}), TypeError);
  }
  assert.throws(() => variant(parent(), {productId: "other"}), TypeError);
  assert.throws(() => variant(parent(), {variantSchemaVersion: 2}), TypeError);
});

test("commercial presence has no inheritance, COD requirement or null normalization", () => {
  const p = c.productDto("p", {productKind: "variantParent", variantSchemaVersion: 1,
    attributeDefinitions: defs(), price: 15, imageUrl: "parent", fiscal: {ncm: "123"}});
  const v = variant(p, {price: null, barcode: "", costPrice: 0});
  assert.deepEqual(v.field("price"), {state: "null", value: null});
  assert.deepEqual(v.field("imageUrl"), {state: "omitted"});
  assert.deepEqual(v.field("cod"), {state: "omitted"});
  assert.deepEqual(v.field("fiscal"), {state: "omitted"});
  assert.equal(v.field("barcode").value, "");
  assert.equal(v.field("costPrice").value, 0);
  // These slots are observations, not commercial validation/permission to write.
  assert.throws(() => variant(p, {price: undefined}), TypeError);
});

test("partial and empty combinations are structural only, no Cartesian generation", () => {
  assert.equal(c.canonicalCombination([], c.definitions(defs())).key, "[]");
  assert.equal(c.canonicalCombination([pairs()[0]], c.definitions(defs())).pairs.length, 1);
});

test("item identity uses an unambiguous explicit tuple, not COD or delimiters", () => {
  const simple = new c.ItemIdentityDto({productId: "p", variantId: null});
  const v = new c.ItemIdentityDto({productId: "p", variantId: "v"});
  assert.notEqual(simple.key, v.key);
  assert.notEqual(new c.ItemIdentityDto({productId: "a:b", variantId: "c"}).key,
    new c.ItemIdentityDto({productId: "a", variantId: "b:c"}).key);
  assert.throws(() => new c.ItemIdentityDto({productId: "p"}), TypeError);
  assert.throws(() => new c.ItemIdentityDto({productId: "p", variantId: null, cod: "x"}), TypeError);
});

test("new stable IDs reject invalid representations without commercial length caps", () => {
  for (const productId of ["", "a/b", ".", "..", " x", "__reserved__", "\ud800", "\u0000"]) {
    assert.throws(() => new c.ItemIdentityDto({productId, variantId: null}), TypeError);
  }
  assert.equal(new c.ItemIdentityDto({productId: "x".repeat(1500), variantId: "😀"}).variantId, "😀");
});

test("COD legacy interpretation agrees with F9 and leaves reservation untouched", () => {
  for (const raw of [{productId: "p", cod: "ABC"},
    {productId: "p", ownerType: "product", variantId: null},
    {productId: "p", ownerType: "variant", variantId: "v"},
    {productId: "__legacy__", cod: "OLD"}]) {
    const before = JSON.stringify(raw);
    assert.deepEqual({...new c.CodeOwnerDto(raw)}, f9.reservationOwner(raw));
    assert.equal(JSON.stringify(raw), before);
  }
  for (const raw of [{productId: "p", variantId: "v"}, {productId: "p", ownerType: null},
    {productId: "p", ownerType: "product"}, {productId: "p", ownerType: "variant", variantId: null}]) {
    assert.throws(() => new c.CodeOwnerDto(raw));
    assert.throws(() => f9.reservationOwner(raw));
  }
});

const lot = (quantity = 2) => ({quantidade: quantity,
  validade: {seconds: "1791970000", nanoseconds: 123456789}, lotId: "lot-independent", metadata: {source: "legacy"}});

test("stock has optional lots, exact time and metadata, without inventing lot identity", () => {
  const manual = new c.StockDto({quantidade: 2});
  assert.deepEqual(manual.lotsField, {state: "omitted"});
  assert.equal(Object.hasOwn(manual, "lots"), false);
  const empty = new c.StockDto({quantidade: 2, lotes: []});
  assert.deepEqual(empty.lotsField, {state: "value", value: []});
  const raw = lot(); const stocked = new c.StockDto({quantidade: 2, lotes: [raw]});
  raw.metadata.source = "changed";
  assert.equal(stocked.lots[0].data.metadata.source, "legacy");
  assert.equal(stocked.lots[0].data.validade.nanoseconds, 123456789);
  const noId = lot(); delete noId.lotId;
  assert.equal(Object.hasOwn(new c.LotDto(noId).data, "lotId"), false);
  assert.throws(() => stocked.lots.push(new c.LotDto(lot())), TypeError);
});

test("malformed stock is rejected by stock parser, never silently repaired by product reads", () => {
  for (const raw of [{quantidade: -1}, {quantidade: -0}, {quantidade: 1.5},
    {quantidade: 2, lotes: null}, {quantidade: 3, lotes: [lot()]},
    {quantidade: 2, lotes: [{...lot(), validade: {seconds: "01", nanoseconds: 0}}]},
    {quantidade: Number.MAX_SAFE_INTEGER, lotes: [lot(Number.MAX_SAFE_INTEGER), lot(1)]}]) {
    assert.throws(() => new c.StockDto(raw), TypeError);
    const legacy = c.productDto("p", raw);
    assert.deepEqual(legacy.data, raw);
  }
});

test("non-DTO objects, cycles and undefined cannot be silently serialized", () => {
  assert.throws(() => c.productDto("p", {createdAt: new Date()}), TypeError);
  assert.throws(() => c.productDto("p", {unknown: undefined}), TypeError);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => c.productDto("p", cyclic), TypeError);
});

test("V2 normalized bytes and hash remain identical and reject variantId", () => {
  const input = {schemaVersion: 2, requestId: "sale", saleId: "sale",
    scope: {projectId: "demo-test", uid: "u", storeId: "s"}, origin: "online", saleKind: "instant",
    items: [{productId: "p", quantity: 1, expectedUnitPriceCents: 29}],
    expectedTotalCents: 29, paymentMethod: "PIX"};
  const expected = '{"schemaVersion":2,"requestId":"sale","saleId":"sale","scope":{"projectId":"demo-test","uid":"u","storeId":"s"},"origin":"online","saleKind":"instant","items":[{"productId":"p","quantity":1,"expectedUnitPriceCents":29}],"expectedTotalCents":29,"paymentMethod":"PIX","notes":null,"customerId":null}';
  assert.equal(JSON.stringify(v2.normalize(input)), expected);
  assert.equal(v2.hash(v2.normalize(input)), createHash("sha256").update(expected).digest("hex"));
  assert.throws(() => v2.normalize({...input, items: [{...input.items[0], variantId: "v"}]}));
});

test("stock is parsed per sellable entity, never borrowed from parent or sibling", () => {
  const p = parent();
  const first = variant(p, {quantidade: 2});
  const second = new c.VariantDto("other-v", {variantSchemaVersion: 1,
    productId: "p", attributes: [pairs()[0]], quantidade: 7}, p);
  assert.equal(first.stock().quantidade, 2);
  assert.equal(second.stock().quantidade, 7);
  assert.equal(c.productDto("simple", {quantidade: 3}).stock().quantidade, 3);
  assert.equal(typeof p.stock, "undefined");
  assert.throws(() => variant(p).stock(), TypeError);
});
