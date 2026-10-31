"use strict";
// CURRENT S03 behavior, including defects. Not a proposed V2 validator.
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
const admin = require("firebase-admin");
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
const {syncOfflineSale} = require("../../sales/syncOfflineSale");
const fixtures = require("./fixtures/currentSale");
after(() => db.terminate());
async function fixture(overrides = {}) {
  const uid = randomUUID();
  const store = db.collection("stores").doc(randomUUID());
  const product = store.collection("products").doc("p");
  await store.set({ownerId: uid, subscriptionStatus: "active", subscriptionType: "pro"});
  await product.set({...fixtures.product, ...overrides});
  return {uid, store, product, data: {...structuredClone(fixtures.command), storeId: store.id, localSaleId: randomUUID()}};
}
const send = (f, data = f.data, uid = f.uid) => syncOfflineSale.run({auth: {uid}, data});
const sale = async (f) => (await f.store.collection("sales").doc(f.data.localSaleId).get()).data();
const count = async (f, name) => (await f.store.collection(name).get()).size;
test("S03 current manual document preserves historical price and device date, no cost/parcel/cash", async () => {
  const f = await fixture(); const result = await send(f); const saved = await sale(f);
  assert.equal(result.success, true); assert.equal(result.alreadyProcessed, false);
  assert.deepEqual(Object.keys(saved).sort(), ["totalAmount","products","createdAt","storeId","notes","paymentMethod","isPaid","customerId","customerName","localSaleId","syncOrigin","syncedBy","syncedAt","containsArchivedProductsAtSync","archivedProductsAtSync"].sort());
  assert.deepEqual(saved.products, fixtures.command.products);
  assert.equal(saved.createdAt.toMillis(), Date.parse(fixtures.command.createdAt));
  assert.equal(saved.syncOrigin, "offline"); assert.equal(saved.isPaid, true);
  assert.ok(saved.syncedAt instanceof admin.firestore.Timestamp);
  assert.equal((await f.product.get()).data().quantidade, 4);
  assert.deepEqual((await f.product.get()).data().legacy, {keep: true});
  assert.equal(await count(f, "cash_flow"), 0); assert.equal(await count(f, "auditLogs"), 0);
});
test("S03 current lost response replay never rewrites later payment/fiscal/history", async () => {
  const f = await fixture();
  await assert.rejects(async () => { await send(f); throw new Error("simulated lost transport response"); });
  await f.store.collection("sales").doc(f.data.localSaleId).update({isPaid: false, fiscal: {nfce: {status: "autorizado"}}, unknown: "keep"});
  await f.product.update({quantidade: 3, price: 500});
  const before = await sale(f);
  assert.equal((await send(f)).alreadyProcessed, true);
  assert.deepEqual(await sale(f), before);
  assert.equal((await f.product.get()).data().quantidade, 3);
});
test("S03 CURRENT DEFECT reused ID with divergent valid payload is accepted as replay", async () => {
  const f = await fixture(); await send(f);
  const changed = {...f.data, totalAmount: 40, products: [{productId: "p", name: "Diferente", quantity: 2, price: 20}]};
  assert.equal((await send(f, changed)).alreadyProcessed, true);
  assert.equal((await sale(f)).totalAmount, 10);
  assert.equal((await f.product.get()).data().quantidade, 4);
});
test("S03 current owner-only rejects operational admin and subscription blocks existing replay", async () => {
  const f = await fixture(); const employee = randomUUID();
  await db.collection("users").doc(employee).set({storeId: f.store.id, role: "admin"});
  await assert.rejects(() => send(f, f.data, employee), (e) => e.code === "permission-denied");
  await send(f); await f.store.update({subscriptionStatus: "inactive"});
  await assert.rejects(() => send(f), (e) => e.code === "failed-precondition");
  assert.equal(await count(f, "sales"), 1);
});
test("S03 CURRENT DEFECT deferred payload is forced paid and installments ignored", async () => {
  const f = await fixture();
  await send(f, {...f.data, paymentMethod: "A prazo", isPaid: false, installmentCount: 2, installments: [{amount: 5},{amount: 5}]});
  const saved = await sale(f);
  assert.equal(saved.paymentMethod, "A prazo"); assert.equal(saved.isPaid, true);
  assert.equal(Object.hasOwn(saved, "installments"), false);
});
test("S03 current FIFO removes consumed lot and preserves surviving metadata and nanos", async () => {
  const later = {quantidade: 3, validade: new admin.firestore.Timestamp(1956614400, 123456789), metadata: {keep: true}};
  const earlier = {quantidade: 2, validade: new admin.firestore.Timestamp(1925078400, 987654321), id: "earlier"};
  const f = await fixture({lotes: [later, earlier]});
  // Compare with the actual persisted fixture: Firestore stores microsecond
  // precision, so sub-microsecond input digits are not a writer mutation.
  const persistedLater = (await f.product.get()).data().lotes[0];
  await send(f, {...f.data, totalAmount: 30, products: [{...f.data.products[0], quantity: 3}]});
  const p = (await f.product.get()).data();
  assert.equal(p.quantidade, 2); assert.deepEqual(p.lotes, [{...persistedLater, quantidade: 2}]);
});
test("S03 current insufficient stock rolls back sale and every product write", async () => {
  const f = await fixture({quantidade: 0});
  await assert.rejects(() => send(f), (e) => e.code === "failed-precondition");
  assert.equal(await count(f, "sales"), 0); assert.equal((await f.product.get()).data().quantidade, 0);
});
test("S03 current two concurrent identical commands debit exactly once", async () => {
  const f = await fixture(); const results = await Promise.all([send(f), send(f)]);
  assert.equal(results.filter((r) => r.alreadyProcessed).length, 1);
  assert.equal(await count(f, "sales"), 1); assert.equal((await f.product.get()).data().quantidade, 4);
});
test("S03 current archived backlog allows earlier device date and preserves one audit on replay", async () => {
  const f = await fixture({isArchived: true, archivedAt: admin.firestore.Timestamp.fromDate(new Date("2026-10-02T03:00:00.000Z"))});
  await send(f); await send(f);
  assert.equal((await sale(f)).containsArchivedProductsAtSync, true); assert.equal(await count(f, "auditLogs"), 1);
  const g = await fixture({isArchived: true, archivedAt: admin.firestore.Timestamp.fromDate(new Date("2026-09-30T03:00:00.000Z"))});
  await assert.rejects(() => send(g), (e) => e.code === "failed-precondition");
  assert.equal(await count(g, "sales"), 0);
});
test("S03 CURRENT DEFECT existing sale without localSaleId is accepted without content match", async () => {
  const f = await fixture();
  await f.store.collection("sales").doc(f.data.localSaleId).set({totalAmount: 999, isPaid: false, legacy: true});
  assert.equal((await send(f)).alreadyProcessed, true);
  assert.deepEqual(await sale(f), {totalAmount: 999, isPaid: false, legacy: true});
  assert.equal((await f.product.get()).data().quantidade, 5);
});
test("S03 current floating-point cent tolerance rejects 1.01 vs rounded 1.005; exact normalized total accepts coercion", async () => {
  const f = await fixture();
  const products = [{productId: "p", name: "Historical", quantity: "1", price: "1.005"}];
  await assert.rejects(() => send(f, {...f.data, totalAmount: "1.01", products}), (e) => e.code === "failed-precondition");
  assert.equal(await count(f, "sales"), 0);
  await send(f, {...f.data, totalAmount: "1.00", products});
  const saved = await sale(f);
  assert.equal(saved.products[0].price, 1); assert.equal(saved.totalAmount, 1);
});
test("S03 D03 duplicate lot lines reject new effect without debit", async () => {
  const f = await fixture({lotes: [{quantidade: 5, validade: new admin.firestore.Timestamp(1956614400, 0)}]});
  const before = await f.product.get();
  await assert.rejects(() => send(f, {...f.data, totalAmount: 20, products: [f.data.products[0], f.data.products[0]]}), e => e.code === "invalid-argument");
  assert.equal(await sale(f), undefined);
  assert.deepEqual((await f.product.get()).updateTime, before.updateTime);
  assert.deepEqual((await f.product.get()).data(), before.data());
});
