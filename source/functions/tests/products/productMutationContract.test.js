"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const {validateUpdateProductV2: update, validateAdjustProductStock: stock} =
  require("../../products/productMutationContract");
const time = {seconds: "1791970000", nanoseconds: 123456000};
const input = (changes = {set: {name: " Item "}}) =>
  ({schemaVersion: 2, requestId: "r", productId: "p", expectedUpdateTime: time, changes});
const adjustment = (stockChange = {kind: "setManualQuantity", quantity: 0}) =>
  ({schemaVersion: 1, requestId: "r", productId: "p", expectedUpdateTime: time, reason: " Contagem ", stockChange});

test("partial patch normalizes values without synthesizing omitted fields or mutating input", () => {
  const payload = input({set: {name: " Item ", cod: " cod "}});
  const result = update(payload);
  assert.deepEqual(result.changes, {set: {name: "Item", cod: "COD"}, remove: []});
  assert.equal(payload.changes.set.name, " Item ");
  assert.deepEqual(result.expectedUpdateTime, time);
});
test("rejects stock, internal fiscal, derived fields and arbitrary paths in ordinary edits", () => {
  for (const key of ["quantidade", "lotes", "fiscal", "fiscal.ncm", "name_lowercase",
    "isArchived", "storeId", "createdAt", "__proto__"]) {
    assert.throws(() => update(input({set: {[key]: null}})), TypeError);
  }
});
test("explicit fiscal patch preserves null intent and only permits known editable leaves", () => {
  const result = update(input({fiscal: {set: {cest: null}, remove: ["ncm"]}}));
  assert.deepEqual(result.changes.fiscal, {set: {cest: null}, remove: ["ncm"]});
  for (const key of ["updatedAt", "internalTax", "credentials", "ncm.value", "__proto__"]) {
    assert.throws(() => update(input({fiscal: {set: {[key]: "x"}}})), TypeError);
    assert.throws(() => update(input({fiscal: {remove: [key]}})), TypeError);
  }
});
test("null, omitted, zero, empty and remove remain different by field", () => {
  for (const key of ["name", "price", "minimumStock", "cod", "barcode", "costPrice", "imageUrl"]) {
    assert.throws(() => update(input({set: {[key]: null}})), TypeError);
  }
  assert.deepEqual(update(input({set: {price: 0, costPrice: 0, minimumStock: 0, imageUrl: ""}})).changes.set,
    {price: 0, costPrice: 0, minimumStock: 0, imageUrl: ""});
  for (const key of ["cod", "barcode", "name"]) assert.throws(() => update(input({set: {[key]: " "}})), TypeError);
  assert.deepEqual(update(input({remove: ["costPrice", "cod"]})).changes.remove, ["cod", "costPrice"]);
  assert.throws(() => update(input({remove: ["name"]})), TypeError);
  assert.throws(() => update(input({fiscal: null})), TypeError);
});
test("rejects empty commands, conflicting set/remove and duplicate removals", () => {
  for (const changes of [{}, {set: {}}, {fiscal: {}}, {set: {cod: "A"}, remove: ["cod"]},
    {remove: ["cod", "cod"]}, {fiscal: {set: {ncm: "x"}, remove: ["ncm"]}}]) {
    assert.throws(() => update(input(changes)), TypeError);
  }
  assert.deepEqual(update(input({set: {name: "N"}, fiscal: {}})).changes.fiscal, {set: {}, remove: []});
});
test("version is mandatory and cannot lose precision or accept impossible timestamps", () => {
  for (const expectedUpdateTime of [null, {}, {seconds: 12, nanoseconds: 0},
    {seconds: "01", nanoseconds: 0}, {seconds: "-0", nanoseconds: 0},
    {seconds: "1", nanoseconds: 1}, {seconds: "1", nanoseconds: 1e9},
    {seconds: "253402300800", nanoseconds: 0}, {seconds: "-62135596801", nanoseconds: 0}]) {
    assert.throws(() => update({...input(), expectedUpdateTime}), TypeError);
  }
  assert.deepEqual(update(input()).expectedUpdateTime, time);
});
test("strict envelope, identifiers and request length; V1 cannot be silently reinterpreted", () => {
  for (const payload of [null, [], {...input(), schemaVersion: 1}, {...input(), storeId: "other"},
    {...input(), requestId: ""}, {...input(), requestId: "r".repeat(129)},
    {...input(), productId: ".."}, {...input(), productId: "a/b"}]) {
    assert.throws(() => update(payload), TypeError);
  }
});
test("category selection is explicit, ordered, bounded and separate from legacy projection", () => {
  assert.deepEqual(update(input({categories: {ids: []}})).changes.categories, {ids: []});
  for (const ids of [null, ["a", "a"], [".."], Array.from({length: 11}, (_, i) => String(i))]) {
    assert.throws(() => update(input({categories: {ids}})));
  }
  assert.throws(() => update(input({categories: {ids: [], categoryName: "forged"}})), TypeError);
});
test("stock adjustment requires explicit reason and disallows cadastral/fiscal/COD fields", () => {
  assert.equal(stock(adjustment()).reason, "Contagem");
  for (const reason of [null, "", " "]) assert.throws(() => stock({...adjustment(), reason}), TypeError);
  for (const key of ["cod", "fiscal", "changes", "storeId"]) {
    assert.throws(() => stock({...adjustment(), [key]: "x"}), TypeError);
  }
  for (const quantity of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, null, NaN, Infinity]) {
    assert.throws(() => stock(adjustment({kind: "setManualQuantity", quantity})), TypeError);
  }
});
test("lot patch indexes are explicit; zero is permitted only for an existing lot", () => {
  const operations = [{op: "update", index: 1, set: {quantidade: 0}},
    {op: "add", quantidade: 2, validadeMs: Date.UTC(2030, 0)}];
  assert.deepEqual(stock(adjustment({kind: "editLots", operations})).stockChange.operations, operations);
  for (const operations of [[], [{op: "update", index: 0, set: {metadata: "x"}}],
    [{op: "remove", index: 0}, {op: "remove", index: 0}],
    [{op: "add", quantidade: 0, validadeMs: 0}], [{op: "remove", index: -1}],
    [{op: "update", index: 0, set: {validadeMs: 253402300800000}}]]) {
    assert.throws(() => stock(adjustment({kind: "editLots", operations})), TypeError);
  }
});
test("stock modes and destructive conversion require explicit acknowledgement", () => {
  assert.equal(stock(adjustment({kind: "convertToManual", quantity: 0, acknowledgement: true})).stockChange.quantity, 0);
  for (const change of [{kind: "convertToManual", quantity: 0},
    {kind: "convertToManual", quantity: 0, acknowledgement: false},
    {kind: "convertToLots", lots: []}, {kind: "unknown"},
    {kind: "setManualQuantity", quantity: 0, lotes: []}]) {
    assert.throws(() => stock(adjustment(change)), TypeError);
  }
});
