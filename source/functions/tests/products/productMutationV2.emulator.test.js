"use strict";
const {seedAdmission} = require("../sales/fixtures/storeWriterAdmissionFixture.cjs");

const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const admin = require("firebase-admin");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
if (!admin.apps.length) admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
const {updateProductV2, adjustProductStockV1} = require("../../products/productMutationV2");
const {createProduct} = require("../../products/createProduct");
const {updateProduct} = require("../../products/updateProduct");
const {archiveProduct} = require("../../products/archiveProduct");
const {syncOfflineSale} = require("../../sales/syncOfflineSale");
const {codeRef} = require("../../products/productCodeReservation");
after(() => db.terminate());
const commercial = (cod = "") =>
  ({name: "Original", price: 10, quantidade: 5, lotes: [], minimumStock: 1, imageUrl: "", ...(cod ? {cod} : {})});
const version = (snapshot) => ({seconds: String(snapshot.updateTime.seconds), nanoseconds: snapshot.updateTime.nanoseconds});
async function fixture(cod = "KEEP") {
  const uid = randomUUID();
  const store = db.collection("stores").doc(randomUUID());
  const user = db.collection("users").doc(uid);
  await store.set({subscriptionType: "pro", subscriptionStatus: "active"});
  await seedAdmission(db, store.id);
  await user.set({storeId: store.id, role: "admin"});
  const created = await createProduct.run({auth: {uid}, data: {
    requestId: randomUUID(), product: commercial(cod), categoryIds: []}});
  return {uid, store, user, ref: store.collection("products").doc(created.productId)};
}
async function command(f, changes = {set: {name: "Changed"}}) {
  return {schemaVersion: 2, requestId: randomUUID(), productId: f.ref.id,
    expectedUpdateTime: version(await f.ref.get()), changes};
}
async function adjustment(f, stockChange = {kind: "setManualQuantity", quantity: 4}) {
  return {schemaVersion: 1, requestId: randomUUID(), productId: f.ref.id,
    expectedUpdateTime: version(await f.ref.get()), reason: "Contagem", stockChange};
}
const send = (f, data) => updateProductV2.run({auth: {uid: f.uid}, data});
const adjust = (f, data) => adjustProductStockV1.run({auth: {uid: f.uid}, data});
async function reject(action, code, reason) {
  await assert.rejects(action, (e) => {
    assert.equal(e.code, code);
    if (reason) assert.equal(e.details?.reason, reason);
    return true;
  });
}
async function state(f) {
  const [products, codes, audits, sales, cash] = await Promise.all([
    f.store.collection("products").get(), f.store.collection("productCodes").get(),
    f.store.collection("auditLogs").get(), f.store.collection("sales").get(), f.store.collection("cash_flow").get()]);
  const docs = (snapshot) => snapshot.docs.map((d) => ({id: d.id, data: d.data(), version: version(d)}));
  return {products: docs(products), codes: docs(codes), audits: docs(audits), sales: docs(sales), cash: docs(cash)};
}
const lot = (n, metadata = {}) => ({quantidade: n,
  validade: new admin.firestore.Timestamp(1893456000, 123456000), ...metadata});
async function seedLots(f) {
  await f.ref.update({quantidade: 5, lotes: [lot(2, {legacyId: "a", extra: {keep: true}}),
    lot(3, {legacyId: "b", supplier: "legacy"})]});
}

test("partial ordinary edit leaves fiscal/internal data, stock, lots, reservations and history untouched", async () => {
  const f = await fixture(); await seedLots(f);
  await f.ref.update({fiscal: {ncm: "123", updatedAt: admin.firestore.Timestamp.now(),
    internalTax: {keep: true}}, legacy: {keep: true}, costPrice: 2});
  const before = (await f.ref.get()).data();
  const reservation = await codeRef(f.store, "KEEP").get();
  const result = await send(f, await command(f));
  const after = (await f.ref.get()).data();
  assert.equal(result.changed, true);
  assert.deepEqual(after, {...before, name: "Changed", name_lowercase: "changed"});
  assert.ok((await codeRef(f.store, "KEEP").get()).updateTime.isEqual(reservation.updateTime));
});
test("explicit fiscal leaves patch preserves siblings/internal data; null and removal have different meanings", async () => {
  const f = await fixture();
  await f.ref.update({fiscal: {ncm: "old", cest: "keep", cfop: "remove", internalTax: {keep: true}}});
  await send(f, await command(f, {fiscal: {set: {ncm: "new", cest: null}, remove: ["cfop"]}}));
  const fiscal = (await f.ref.get()).data().fiscal;
  assert.equal(fiscal.ncm, "new"); assert.equal(fiscal.cest, null);
  assert.equal(Object.hasOwn(fiscal, "cfop"), false);
  assert.deepEqual(fiscal.internalTax, {keep: true});
  assert.ok(fiscal.updatedAt instanceof admin.firestore.Timestamp);
});
test("protected fiscal fields/paths and stock in ordinary patch reject before any write", async () => {
  const f = await fixture(); const before = await state(f);
  for (const changes of [{set: {fiscal: {ncm: "x"}}}, {set: {quantidade: 0}},
    {set: {lotes: []}}, {fiscal: {set: {updatedAt: null}}},
    {fiscal: {remove: ["internalTax"]}}, {set: {"fiscal.ncm": "x"}}]) {
    const data = await command(f, changes);
    await reject(() => send(f, data), "invalid-argument");
    assert.deepEqual(await state(f), before);
  }
});

test("empty fiscal block is no-op and malformed legacy fiscal can be preserved by ordinary edits", async () => {
  const f = await fixture();
  await f.ref.update({fiscal: null});
  const data = await command(f, {set: {price: 0}, fiscal: {}});
  await send(f, data);
  assert.equal((await f.ref.get()).data().fiscal, null);
  const before = await state(f);
  const fiscalData = await command(f, {fiscal: {set: {ncm: "x"}}});
  await reject(() => send(f, fiscalData), "failed-precondition", "invalid-current-fiscal");
  assert.deepEqual(await state(f), before);
  for (const invalidFiscal of [admin.firestore.Timestamp.now(), f.ref, ["legacy"], "legacy"]) {
    await f.ref.update({fiscal: invalidFiscal});
    const invalidBefore = await state(f);
    const patch = await command(f, {fiscal: {set: {ncm: "x"}}});
    await reject(() => send(f, patch), "failed-precondition", "invalid-current-fiscal");
    assert.deepEqual(await state(f), invalidBefore);
  }
});
test("optional fields are omitted, zeroed or removed explicitly without stock defaults on a legacy product", async () => {
  const f = await fixture("");
  await f.ref.set({name: "Legacy", historical: true, fiscal: {internalTax: "keep"},
    barcode: "old", costPrice: 7, quantidade: 9}); // No lotes, isArchived or minimumStock.
  await send(f, await command(f, {set: {price: 0}, remove: ["barcode", "costPrice"]}));
  assert.deepEqual((await f.ref.get()).data(), {name: "Legacy", historical: true,
    fiscal: {internalTax: "keep"}, quantidade: 9, price: 0});
});
test("unchanged patch confirms an idempotent no-op without changing product or fiscal timestamps", async () => {
  const f = await fixture();
  const data = await command(f, {set: {name: "Original"}, fiscal: {}});
  const before = await f.ref.get();
  const result = await send(f, data);
  assert.equal(result.changed, false);
  assert.ok((await f.ref.get()).updateTime.isEqual(before.updateTime));
  assert.equal((await send(f, data)).replayed, true);
});
test("categories and commercial fields commit together; duplicate COD rejects everything", async () => {
  const f = await fixture();
  await f.store.collection("categories").doc("root").set({name: "Root"});
  await f.store.collection("categories").doc("child").set({name: "Child", parentCategoryId: "root"});
  await createProduct.run({auth: {uid: f.uid}, data: {requestId: randomUUID(),
    product: commercial("TAKEN"), categoryIds: []}});
  const before = await state(f);
  const rejected = await command(f, {set: {name: "Not saved", cod: "TAKEN"}, categories: {ids: ["child"]}});
  await reject(() => send(f, rejected), "already-exists", "duplicate-product-cod");
  assert.deepEqual(await state(f), before);
  await send(f, await command(f, {set: {name: "Saved", cod: "NEW"}, categories: {ids: ["child"]}}));
  const data = (await f.ref.get()).data();
  assert.equal(data.name, "Saved"); assert.equal(data.cod, "NEW");
  assert.deepEqual(data.categoryIds, ["child"]); assert.equal(data.categoryName, "Child");
  assert.equal((await codeRef(f.store, "KEEP").get()).data().productId, f.ref.id);
  assert.equal((await codeRef(f.store, "NEW").get()).data().productId, f.ref.id);
});
test("invalid categories/hierarchy fail without commercial writes", async () => {
  const f = await fixture(); const before = await state(f);
  const missing = await command(f, {set: {name: "No"}, categories: {ids: ["missing"]}});
  await reject(() => send(f, missing), "failed-precondition", "category-unavailable");
  assert.deepEqual(await state(f), before);
  await f.store.collection("categories").doc("bad").set({name: "Bad", parentCategoryId: "bad"});
  const bad = await command(f, {categories: {ids: ["bad"]}});
  await reject(() => send(f, bad), "failed-precondition", "invalid-category-hierarchy");
  assert.deepEqual(await state(f), before);
});
test("replay after lost response and later stock/COD changes does not repeat or revert anything", async () => {
  const f = await fixture();
  const data = await command(f, {set: {name: "Committed", cod: "NEW"}});
  await send(f, data); // Simulated response discarded after successful server commit.
  await f.ref.update({name: "Later", quantidade: 4});
  const later = await state(f);
  const result = await send(f, data);
  assert.equal(result.replayed, true);
  assert.deepEqual(await state(f), later);
  await reject(() => send(f, {...data, changes: {set: {name: "Different"}}}),
    "already-exists", "request-id-reused");
  const updatedBaseline = {...data, expectedUpdateTime: version(await f.ref.get())};
  await reject(() => send(f, updatedBaseline), "already-exists", "request-id-reused");
  assert.deepEqual(await state(f), later);
});
test("same logical normalized payload replays regardless of object key order", async () => {
  const f = await fixture();
  const data = await command(f, {set: {name: " New ", cod: " new "}});
  await send(f, data);
  assert.equal((await send(f, {...data, changes: {set: {cod: "NEW", name: "New"}}})).replayed, true);
});
test("injected failure before commit leaves product, categories, reservations and receipt unchanged", async () => {
  const f = await fixture();
  await f.store.collection("categories").doc("c").set({name: "Category"});
  const data = await command(f, {set: {cod: "NEW", name: "Not saved"}, categories: {ids: ["c"]}});
  const before = await state(f);
  const prototype = Object.getPrototypeOf(db);
  const original = prototype.runTransaction;
  prototype.runTransaction = function(callback, ...args) {
    return original.call(this, (transaction) => {
      const originalCreate = transaction.create;
      transaction.create = function(ref, ...values) {
        if (ref.parent.id === "auditLogs") throw new Error("injected-before-commit");
        return originalCreate.call(this, ref, ...values);
      };
      return callback(transaction);
    }, ...args);
  };
  try { await assert.rejects(() => send(f, data), /injected-before-commit/); }
  finally { prototype.runTransaction = original; }
  assert.deepEqual(await state(f), before);
  await send(f, data);
  assert.equal((await f.ref.get()).data().cod, "NEW");
});
test("sale before edit makes the original document version stale, even without revision fields", async () => {
  const f = await fixture(); const data = await command(f);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(f.ref);
    transaction.update(f.ref, {quantidade: snapshot.data().quantidade - 1});
    transaction.create(f.store.collection("sales").doc("sale"), {historicalCost: 2, quantity: 1});
  });
  const before = await state(f);
  await reject(() => send(f, data), "aborted", "product-version-conflict");
  assert.deepEqual(await state(f), before);
  await send(f, await command(f));
  assert.equal((await f.ref.get()).data().quantidade, 4);
  assert.equal((await f.store.collection("sales").doc("sale").get()).data().historicalCost, 2);
});
test("real concurrent sale/edit serializes safely; edit never restores old stock", async () => {
  const f = await fixture(); const data = await command(f, {set: {price: 12}});
  const results = await Promise.allSettled([
    send(f, data),
    db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(f.ref);
      transaction.update(f.ref, {quantidade: snapshot.data().quantidade - 1});
      transaction.create(f.store.collection("sales").doc("concurrent"), {quantity: 1, unitCostAtSale: 2});
    }),
  ]);
  assert.equal(results[1].status, "fulfilled");
  if (results[0].status === "rejected") assert.equal(results[0].reason.details?.reason, "product-version-conflict");
  const saved = (await f.ref.get()).data();
  assert.equal(saved.quantidade, 4);
  assert.equal(saved.price, results[0].status === "fulfilled" ? 12 : 10);
});
test("two stock adjustments sharing a baseline have one winner; replay never repeats an adjustment", async () => {
  const f = await fixture();
  const a = await adjustment(f);
  const b = {...a, requestId: randomUUID(), stockChange: {kind: "setManualQuantity", quantity: 3}};
  const results = await Promise.allSettled([adjust(f, a), adjust(f, b)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.details.reason, "product-version-conflict");
  const winner = results[0].status === "fulfilled" ? a : b;
  await f.ref.update({quantidade: 1});
  const before = await state(f);
  assert.equal((await adjust(f, winner)).replayed, true);
  assert.deepEqual(await state(f), before);
});
test("concurrent identical requests produce one receipt and one mutation", async () => {
  const f = await fixture(); const data = await command(f);
  const count = (await f.store.collection("auditLogs").get()).size;
  const results = await Promise.all([send(f, data), send(f, data)]);
  assert.equal(results.filter((r) => r.replayed).length, 1);
  assert.equal((await f.store.collection("auditLogs").get()).size, count + 1);
});
test("stock adjustment is authorized, audited and independent of fiscal/COD/sales/cash", async () => {
  const f = await fixture(); await f.ref.update({fiscal: {internalTax: "keep"}});
  const before = await state(f);
  const data = await adjustment(f);
  await adjust(f, data);
  const after = await state(f);
  assert.equal((await f.ref.get()).data().quantidade, 4);
  assert.deepEqual(after.codes, before.codes); assert.deepEqual(after.sales, before.sales);
  assert.deepEqual(after.cash, before.cash);
  assert.deepEqual((await f.ref.get()).data().fiscal, {internalTax: "keep"});
  const audit = after.audits.find((d) => d.data.action === "adjustProductStockV1").data;
  assert.equal(audit.reason, "Contagem"); assert.equal(audit.before.quantidade, 5);
  assert.equal(audit.after.quantidade, 4); assert.equal(audit.performedBy.uid, f.uid);
  await f.user.update({accessStatus: "revoked"});
  await reject(() => adjust(f, data), "permission-denied");
});
test("lot edits preserve order, depleted lots, nanosecond timestamps and unknown metadata", async () => {
  const f = await fixture(); await seedLots(f);
  const original = (await f.ref.get()).data().lotes;
  await adjust(f, await adjustment(f, {kind: "editLots", operations: [
    {op: "update", index: 0, set: {quantidade: 0}},
  ]}));
  const current = (await f.ref.get()).data();
  assert.equal(current.quantidade, 3);
  assert.deepEqual(current.lotes, [{...original[0], quantidade: 0}, original[1]]);
  const before = await state(f);
  const removeAll = await adjustment(f, {kind: "editLots", operations: [
    {op: "remove", index: 0}, {op: "remove", index: 1},
  ]});
  await reject(() => adjust(f, removeAll), "failed-precondition", "stock-mode-conflict");
  assert.deepEqual(await state(f), before);
});
test("lot operations target original indexes, and stale indexes cannot edit a reordered list", async () => {
  const f = await fixture(); await seedLots(f);
  const stale = await adjustment(f, {kind: "editLots", operations: [{op: "update", index: 1, set: {quantidade: 1}}]});
  const data = await adjustment(f, {kind: "editLots", operations: [
    {op: "remove", index: 0}, {op: "update", index: 1, set: {quantidade: 2}},
    {op: "add", quantidade: 1, validadeMs: Date.UTC(2031, 0)},
  ]});
  await adjust(f, data);
  assert.deepEqual((await f.ref.get()).data().lotes[0], lot(2, {legacyId: "b", supplier: "legacy"}));
  const before = await state(f);
  await reject(() => adjust(f, stale), "aborted", "product-version-conflict");
  assert.deepEqual(await state(f), before);
});
test("stock conversions require explicit intent; legacy manual product gains no default lot field", async () => {
  const f = await fixture("");
  await f.ref.set({name: "Legacy", quantidade: 5});
  await adjust(f, await adjustment(f, {kind: "setManualQuantity", quantity: 0}));
  assert.deepEqual((await f.ref.get()).data(), {name: "Legacy", quantidade: 0});
  await adjust(f, await adjustment(f, {kind: "convertToLots",
    lots: [{quantidade: 2, validadeMs: Date.UTC(2030, 0)}]}));
  assert.equal((await f.ref.get()).data().quantidade, 2);
  await adjust(f, await adjustment(f, {kind: "convertToManual", quantity: 3, acknowledgement: true}));
  assert.equal((await f.ref.get()).data().quantidade, 3);
  assert.deepEqual((await f.ref.get()).data().lotes, []);
});
test("invalid legacy stock blocks adjustment but ordinary cadastral patch preserves it", async () => {
  const f = await fixture("");
  await f.ref.set({name: "Bad stock", quantidade: 2.5, lotes: [{legacy: true}]});
  const before = await state(f); const data = await adjustment(f);
  await reject(() => adjust(f, data), "failed-precondition", "invalid-current-stock");
  assert.deepEqual(await state(f), before);
  await send(f, await command(f));
  assert.equal((await f.ref.get()).data().quantidade, 2.5);
  assert.deepEqual((await f.ref.get()).data().lotes, [{legacy: true}]);
});
test("archived COD and stock are immutable; valid commercial/category maintenance remains possible", async () => {
  const f = await fixture();
  await archiveProduct.run({auth: {uid: f.uid}, data: {storeId: f.store.id, productId: f.ref.id, reason: "test"}});
  const before = await state(f);
  const cod = await command(f, {remove: ["cod"]});
  await reject(() => send(f, cod), "failed-precondition", "archived-product-cod-immutable");
  const inventory = await adjustment(f);
  await reject(() => adjust(f, inventory), "failed-precondition", "archived-product-stock-immutable");
  assert.deepEqual(await state(f), before);
  await send(f, await command(f, {set: {name: "Archived"}, categories: {ids: []}}));
  assert.equal((await f.ref.get()).data().isArchived, true);
});
test("legacy reservations remain byte-identical; missing and variant reservations cannot be repaired or claimed", async () => {
  const f = await fixture();
  const reservation = codeRef(f.store, "KEEP");
  await reservation.set({cod: "KEEP", productId: f.ref.id});
  const legacy = await reservation.get();
  await send(f, await command(f));
  assert.ok((await reservation.get()).updateTime.isEqual(legacy.updateTime));
  await reservation.delete();
  const before = await state(f); const missing = await command(f);
  await reject(() => send(f, missing), "failed-precondition");
  assert.deepEqual(await state(f), before);
  await reservation.set({cod: "KEEP", productId: f.ref.id, ownerType: "variant", variantId: "v"});
  const variantBefore = await state(f); const variant = await command(f);
  await reject(() => send(f, variant), "already-exists");
  assert.deepEqual(await state(f), variantBefore);
});
test("unreserved legacy product and concurrent create block duplicate COD claims without partial writes", async () => {
  const f = await fixture("");
  await f.store.collection("products").doc("legacy").set({cod: " legacy ", isArchived: true});
  const data = await command(f, {set: {cod: "LEGACY"}});
  const before = await state(f);
  await reject(() => send(f, data), "already-exists", "duplicate-product-cod");
  assert.deepEqual(await state(f), before);
  const race = await command(f, {set: {cod: "RACE"}});
  const results = await Promise.allSettled([
    send(f, race),
    createProduct.run({auth: {uid: f.uid}, data: {requestId: randomUUID(), product: commercial("RACE"), categoryIds: []}}),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const products = (await f.store.collection("products").get()).docs.filter((d) => d.data().cod === "RACE");
  assert.equal(products.length, 1);
  assert.equal((await codeRef(f.store, "RACE").get()).data().productId, products[0].id);
});
test("authentication, role, store isolation and revocation apply to mutations and replays", async () => {
  const f = await fixture(); const data = await command(f);
  await reject(() => updateProductV2.run({data}), "unauthenticated");
  await f.user.update({role: "viewer"});
  await reject(() => send(f, data), "permission-denied");
  await f.user.update({role: "operador"});
  await send(f, data);
  await f.user.update({accessStatus: "revoked"});
  await reject(() => send(f, data), "permission-denied");
  const other = await fixture();
  const before = await state(f);
  await reject(() => send(other, data), "not-found");
  assert.deepEqual(await state(f), before);
});
test("V1 replay survives cut and its receipt/hash namespace is independent of V2", async () => {
  const f = await fixture();
  const requestId = randomUUID(); const product = {...commercial("KEEP"), name: "V1"};
  const v1 = {requestId, productId: f.ref.id, product};
  await seedAdmission(db, f.store.id, "legacy");
  await updateProduct.run({auth: {uid: f.uid}, data: v1});
  await seedAdmission(db, f.store.id, "authoritative", 3);
  const v2 = {...await command(f), requestId};
  await send(f, v2);
  assert.equal((await updateProduct.run({auth: {uid: f.uid}, data: v1})).replayed, true);
  assert.equal((await f.ref.get()).data().name, "Changed");
  const v1Next = {...v1, requestId: randomUUID(), product: {...product, name: "Still V1"}};
  await reject(() => updateProduct.run({auth: {uid: f.uid}, data: v1Next}), "failed-precondition", "writer-admission-denied");
  assert.equal((await f.ref.get()).data().name, "Changed");
});

test("microsecond version difference within the same millisecond cannot pass concurrency check", async () => {
  const f = await fixture(); const data = await command(f);
  const ns = data.expectedUpdateTime.nanoseconds;
  data.expectedUpdateTime = {...data.expectedUpdateTime, nanoseconds: ns % 1000000 === 999000 ? ns - 1000 : ns + 1000};
  const before = await state(f);
  await reject(() => send(f, data), "aborted", "product-version-conflict");
  assert.deepEqual(await state(f), before);
});
test("two different V2 products concurrently claiming one COD have exactly one reservation owner", async () => {
  const f = await fixture("");
  const second = await createProduct.run({auth: {uid: f.uid}, data: {
    requestId: randomUUID(), product: commercial(), categoryIds: []}});
  const g = {...f, ref: f.store.collection("products").doc(second.productId)};
  const [a, b] = await Promise.all([command(f, {set: {cod: "SHARED"}}), command(g, {set: {cod: "SHARED"}})]);
  const results = await Promise.allSettled([send(f, a), send(g, b)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.details.reason, "duplicate-product-cod");
  const reservation = (await codeRef(f.store, "SHARED").get()).data();
  const docs = (await f.store.collection("products").get()).docs.filter((d) => d.data().cod === "SHARED");
  assert.equal(docs.length, 1); assert.equal(docs[0].id, reservation.productId);
});
test("sale and stock adjustment race cannot overwrite a completed sale with a stale count", async () => {
  const f = await fixture(); const data = await adjustment(f, {kind: "setManualQuantity", quantity: 8});
  const outcomes = await Promise.allSettled([
    adjust(f, data),
    db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(f.ref);
      transaction.update(f.ref, {quantidade: snapshot.data().quantidade - 1});
      transaction.create(f.store.collection("sales").doc("race"), {quantity: 1});
    }),
  ]);
  assert.equal(outcomes[1].status, "fulfilled");
  if (outcomes[0].status === "rejected") assert.equal(outcomes[0].reason.details.reason, "product-version-conflict");
  assert.equal((await f.ref.get()).data().quantidade, outcomes[0].status === "fulfilled" ? 7 : 4);
});
test("lot index overflow and unsafe sum fail before product or audit changes", async () => {
  const f = await fixture(); await seedLots(f);
  const before = await state(f);
  const badIndex = await adjustment(f, {kind: "editLots", operations: [{op: "remove", index: 9}]});
  await reject(() => adjust(f, badIndex), "failed-precondition", "invalid-lot-index");
  const overflow = await adjustment(f, {kind: "editLots", operations: [
    {op: "update", index: 0, set: {quantidade: Number.MAX_SAFE_INTEGER}},
  ]});
  await reject(() => adjust(f, overflow), "failed-precondition", "invalid-stock-total");
  assert.deepEqual(await state(f), before);
});
test("changing the stock payload after a confirmed request rejects reuse and cannot duplicate adjustment", async () => {
  const f = await fixture(); const data = await adjustment(f);
  await adjust(f, data);
  const before = await state(f);
  await reject(() => adjust(f, {...data, stockChange: {kind: "setManualQuantity", quantity: 0}}),
    "already-exists", "request-id-reused");
  assert.deepEqual(await state(f), before);
});

test("actual syncOfflineSale FIFO invalidates old edit baseline, preserves lot metadata and replays once", async () => {
  const f = await fixture(); await seedLots(f);
  await f.store.update({ownerId: f.uid});
  const edit = await command(f);
  const sale = {storeId: f.store.id, localSaleId: randomUUID(), paymentMethod: "Dinheiro",
    totalAmount: 10, products: [{productId: f.ref.id, name: "Original", quantity: 1, price: 10}]};
  await seedAdmission(db, f.store.id, "legacy");
  await syncOfflineSale.run({auth: {uid: f.uid}, data: sale});
  await seedAdmission(db, f.store.id, "authoritative", 3);
  const before = await state(f);
  assert.equal((await f.ref.get()).data().quantidade, 4);
  assert.deepEqual((await f.ref.get()).data().lotes[0], lot(1, {legacyId: "a", extra: {keep: true}}));
  await reject(() => send(f, edit), "aborted", "product-version-conflict");
  await syncOfflineSale.run({auth: {uid: f.uid}, data: sale});
  assert.deepEqual(await state(f), before);
  await send(f, await command(f, {set: {price: 20}}));
  const persistedSale = (await f.store.collection("sales").doc(sale.localSaleId).get()).data();
  assert.equal(persistedSale.products[0].price, 10);
});
test("legacy offline writer cannot race with an authoritative stock adjustment", async () => {
  const f = await fixture();
  await f.store.update({ownerId: f.uid});
  const data = await adjustment(f, {kind: "setManualQuantity", quantity: 8});
  const sale = {storeId: f.store.id, localSaleId: randomUUID(), paymentMethod: "Dinheiro",
    totalAmount: 10, products: [{productId: f.ref.id, name: "Original", quantity: 1, price: 10}]};
  const results = await Promise.allSettled([
    adjust(f, data), syncOfflineSale.run({auth: {uid: f.uid}, data: sale}),
  ]);
  assert.equal(results[1].status, "rejected");
  assert.equal(results[1].reason.details.reason, "writer-admission-denied");
  assert.equal(results[0].status, "fulfilled");
  assert.equal((await f.ref.get()).data().quantidade, 8);
  assert.equal((await f.store.collection("sales").get()).size, 0);
  const before = await state(f);
  await reject(() => syncOfflineSale.run({auth: {uid: f.uid}, data: sale}), "failed-precondition", "writer-admission-denied");
  assert.deepEqual(await state(f), before);
});
