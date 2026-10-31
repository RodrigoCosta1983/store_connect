"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {projectCommercialRead: read} = require("../../contracts/productCommercialPersistenceC5");
const {resolveCommercial, barcodeMatches} = require("../../contracts/productCommercialC5");
const {productDto, ItemIdentityDto} = require("../../contracts/productVariantsV1");
const time = {seconds: "1792100000", nanoseconds: 123456789};
const absent = {exists: false};
const snap = data => ({exists: true, data, updateTime: {...time}});
const context = (kind = "simple") => ({projectId: "demo-c5-b", storeId: "s", productId: "p",
  variantId: kind === "variant" ? "v" : null, kind});
const entity = kind => kind === "variant" ? {productId: "p", variantSchemaVersion: 1, attributes: []} :
  {productKind: kind, variantSchemaVersion: 1, ...(kind === "variantParent" ? {attributeDefinitions: []} : {})};
const profile = (configuration, c = context()) => snap({schemaVersion: 1, identity: {...c}, configuration});
const current = (configuration, kind = "simple", extra = {}) => read(context(kind), snap({...entity(kind), ...extra}), profile(configuration, context(kind)));

test("legacy simple remains opaque without discriminator, defaults, conversion or field loss", () => {
  const data = {price: 19.99, costPrice: null, imageUrl: "", fiscal: {unknownLegacy: "x"},
    barcode: "0001", minimumStock: 4, quantidade: 7, custom: {nested: [null, {seconds: "1", nanoseconds: 999999999}]}};
  const result = read(context(), snap(data), absent);
  assert.equal(result.status, "legacyObservation");
  assert.deepEqual(result.snapshots.entity.data, data);
  assert.deepEqual(result.legacy.price, {state: "value", value: 19.99});
  assert.deepEqual(result.legacy.costPrice, {state: "null", value: null});
  assert.equal(result.legacy.fiscal.value.unknownLegacy, "x");
  assert.equal(Object.hasOwn(result, "configuration"), false);
  assert.equal(productDto("p", result.snapshots.entity.data).isLegacy, true);
});
test("C1/C2 entity shapes without commercial document stay observations, never default inheritance", () => {
  for (const kind of ["simple", "variantParent", "variant"]) {
    const data = {...entity(kind), cod: "COD", quantidade: 0, lotes: [], isArchived: false};
    const result = read(context(kind), snap(data), absent);
    assert.equal(result.status, "legacyObservation");
    assert.deepEqual(result.legacy.price, {state: "omitted"});
    assert.deepEqual(result.snapshots.entity.data, data);
  }
});
test("legacy null, empty, invalid money and absent fields are preserved without implicit migration", () => {
  for (const price of [null, -5, 1.005, "1.00", 0]) {
    const r = read(context(), snap({price}), absent);
    assert.equal(r.status, "legacyObservation");
    assert.deepEqual(r.legacy.price, price === null ? {state: "null", value: null} : {state: "value", value: price});
  }
  assert.deepEqual(read(context(), snap({}), absent).legacy.price, {state: "omitted"});
});
test("new cents only exist inside the versioned separate document configuration", () => {
  const r = current({priceCents: 1999, costCents: 0, minimumStock: 2, imageUrl: "ref", barcode: "001", fiscal: {ncm: "0101"}});
  assert.equal(r.status, "commercialV1");
  assert.equal(r.configuration.priceCents.value, 1999);
  assert.equal(r.configuration.costCents.value, 0);
  assert.equal(Object.hasOwn(r.snapshots.entity.data, "priceCents"), false);
  assert.equal(Object.hasOwn(r.snapshots.entity.data, "commercial"), false);
});
test("equal, divergent and null legacy money coexisting with new schema are all blocked", () => {
  for (const key of ["price", "costPrice"]) {
    for (const value of [19.99, 5, null, 0]) {
      const r = current({priceCents: 1999}, "simple", {[key]: value});
      assert.equal(r.reason, "mixed-monetary-representations");
      assert.equal(r.status, "blocked");
      assert.equal(Object.hasOwn(r, "configuration"), false);
      assert.equal(r.snapshots.entity.data[key], value);
    }
  }
});
test("absence, null, explicit inheritance and own zero are different in persisted proposal", () => {
  const p = current({priceCents: 500}, "variantParent");
  for (const [raw, source, value] of [[{}, "parent", 500], [{priceCents: {mode: "inherit"}}, "parent", 500],
    [{priceCents: {mode: "override", value: 0}}, "variant", 0], [{priceCents: null}, "unresolved", null]]) {
    const v = current(raw, "variant");
    assert.equal(v.status, "commercialV1");
    const r = resolveCommercial(p.configuration, v.configuration);
    assert.equal(r.priceCents.source, source);
    assert.equal(r.priceCents.value, value);
    assert.deepEqual(v.snapshots.commercial.data.configuration, raw);
  }
  assert.equal(current({priceCents: null}).configuration.priceCents.state, "null");
});
test("image removal has an explicit marker, never null/delete or empty text fallback", () => {
  const p = current({imageUrl: "base"}, "variantParent").configuration;
  const v = current({imageUrl: {mode: "remove"}}, "variant").configuration;
  assert.deepEqual(resolveCommercial(p, v).imageUrl, {source: "variant", state: "removed"});
  assert.equal(resolveCommercial(p, current({imageUrl: null}, "variant").configuration).imageUrl.source, "unresolved");
  assert.equal(current({imageUrl: ""}).status, "blocked");
});
test("individual barcode and minimum never borrow the parent configuration", () => {
  const p = current({barcode: "base", minimumStock: 999}, "variantParent").configuration;
  const v = current({}, "variant").configuration;
  assert.deepEqual(resolveCommercial(p, v).barcode, {source: "variant", state: "omitted"});
  assert.deepEqual(resolveCommercial(p, v).minimumStock, {source: "variant", state: "omitted"});
  const own = current({barcode: "0001", minimumStock: 0}, "variant").configuration;
  assert.equal(own.barcode.value, "0001");
  assert.equal(own.minimumStock.value, 0);
  assert.equal(current({minimumStock: null}, "variant").configuration.minimumStock.state, "null");
  assert.equal(current({minimumStock: -1}, "variant").status, "blocked");
});
test("barcode ambiguity is preserved after local projection", () => {
  const a = current({barcode: "0001"});
  const b = current({barcode: "0001"}, "variant");
  const candidates = [a, b].map(r => ({identity: new ItemIdentityDto({productId: r.context.productId, variantId: r.context.variantId}), barcode: r.configuration.barcode.value}));
  const result = barcodeMatches("0001", candidates);
  assert.equal(result.status, "ambiguous");
  assert.equal(Object.hasOwn(result, "selected"), false);
});
test("cost and fiscal exceptions remain explicit declarations with rationale and full-map replacement", () => {
  const p = current({costCents: 50, fiscal: {ncm: "01", origem: "0"}}, "variantParent").configuration;
  const v = current({costCents: {mode: "override", value: 0, reason: "Fornecedor distinto"},
    fiscal: {mode: "override", value: {ncm: null}, reason: "Revisão sintética"}}, "variant").configuration;
  const r = resolveCommercial(p, v);
  assert.equal(r.costCents.value, 0);
  assert.deepEqual(r.fiscal.value, {ncm: null});
  assert.equal(r.fiscal.reason, "Revisão sintética");
  assert.equal(current({fiscal: {mode: "override", value: {}}}, "variant").status, "blocked");
  assert.equal(current({fiscal: {inventedTax: "x"}}).status, "blocked");
});
test("invalid cents never fall back to a legacy field or default", () => {
  for (const value of [-1, -0, 0.5, "100", Number.MAX_SAFE_INTEGER + 1]) {
    const r = current({priceCents: value});
    assert.equal(r.reason, "invalid-commercial-document");
    assert.equal(Object.hasOwn(r, "configuration"), false);
  }
  assert.equal(current({priceCents: Number.MAX_SAFE_INTEGER}).status, "commercialV1");
});
test("unknown profile fields/version block interpretation but preserve complete evidence", () => {
  for (const data of [
    {schemaVersion: 2, future: {price: 1}},
    {schemaVersion: 1, identity: context(), configuration: {}, future: {nested: [1, null]}},
    {schemaVersion: 1, identity: context(), configuration: {future: "keep"}},
  ]) {
    const r = read(context(), snap({custom: "keep"}), snap(data));
    assert.equal(r.status, "blocked");
    assert.deepEqual(r.snapshots.commercial.data, data);
    assert.equal(r.snapshots.entity.data.custom, "keep");
    assert.equal(Object.hasOwn(r, "legacy"), false);
  }
});
test("identity mismatch in project/store/product/variant/kind blocks projection", () => {
  for (const [key, value] of [["projectId", "demo-other"], ["storeId", "other"], ["productId", "other"], ["variantId", "other"], ["kind", "simple"]]) {
    const ctx = context("variant"), p = profile({}, {...ctx, [key]: value});
    const r = read(ctx, snap(entity("variant")), p);
    assert.equal(r.status, "blocked");
  }
  assert.equal(read(context("variant"), snap({...entity("variant"), productId: "other"}), profile({}, context("variant"))).reason, "entity-identity-mismatch");
  assert.equal(read(context(), snap({productKind: "simple"}), absent).reason, "entity-identity-mismatch");
});
test("orphan commercial document and malformed/missing snapshots never become valid data", () => {
  assert.equal(read(context(), absent, profile({priceCents: 1})).reason, "entity-absent");
  for (const s of [null, {}, {exists: false, data: {}}, {exists: true, data: {}}, {exists: true, data: null, updateTime: time}]) {
    assert.throws(() => read(context(), snap({}), s), TypeError);
  }
  assert.throws(() => read(context(), snap({}), snap(null)), TypeError);
});
test("exact timestamps and unknown entity/lot metadata survive without rewriting baselines", () => {
  const raw = {quantidade: 4, lotes: [{quantidade: 4, validade: {seconds: "1", nanoseconds: 999999999}, extra: "keep"}],
    updatedAt: {seconds: "0", nanoseconds: 1}};
  const r = read(context(), snap(raw), absent);
  assert.deepEqual(r.snapshots.entity.updateTime, time);
  assert.deepEqual(r.snapshots.entity.data, raw);
  assert.equal(Object.hasOwn(r, "expectedUpdateTime"), false);
  assert.equal(Object.hasOwn(r, "receipt"), false);
  for (const t of [{seconds: "01", nanoseconds: 0}, {seconds: "0", nanoseconds: -0}, {seconds: "0", nanoseconds: 1e9}, {seconds: "253402300800", nanoseconds: 0}]) {
    assert.throws(() => read(context(), {...snap({}), updateTime: t}, absent), TypeError);
  }
});
test("snapshot evidence and configuration are copied/frozen without mutating caller data", () => {
  const e = snap({...entity("simple"), custom: {list: [1]}}), p = profile({fiscal: {ncm: "01"}});
  const r = read(context(), e, p);
  e.data.custom.list.push(2); p.data.configuration.fiscal.ncm = "02";
  assert.deepEqual(r.snapshots.entity.data.custom.list, [1]);
  assert.equal(r.configuration.fiscal.value.ncm, "01");
  assert.throws(() => { r.snapshots.commercial.data.configuration.fiscal.ncm = "bad"; }, TypeError);
  assert.equal(Object.isFrozen(e.data.custom.list), false);
});
test("commercial configuration rejects operational leaves; raw entity stock remains separate", () => {
  for (const configuration of [{quantidade: 10}, {lotes: []}, {receipt: {}}, {stockChange: {}}, {cod: "X"}]) {
    assert.equal(current(configuration).reason, "invalid-commercial-document");
  }
  const r = current({priceCents: 100}, "simple", {quantidade: 8, lotes: [], extra: "opaque"});
  assert.equal(r.status, "commercialV1");
  assert.equal(r.snapshots.entity.data.quantidade, 8);
  assert.equal(Object.hasOwn(r.configuration, "quantidade"), false);
});
test("non-JSON snapshots, accessors, cycles, holes and SDK-like objects fail without coercion", () => {
  const cycle = {}; cycle.self = cycle;
  let evaluated = false;
  const accessor = {get price() { evaluated = true; return 1; }};
  for (const data of [{value: undefined}, {value: Infinity}, {date: new Date()}, cycle, {list: new Array(1)}, accessor]) {
    assert.throws(() => read(context(), snap(data), absent), TypeError);
  }
  assert.equal(evaluated, false);
});
