"use strict";
const {seedAdmission} = require("./fixtures/storeWriterAdmissionFixture.cjs");
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
  const uid = randomUUID(), store = db.collection("stores").doc(randomUUID());
  const product = store.collection("products").doc("p");
  await seedAdmission(db, store.id, "legacy");
  await db.collection("users").doc(uid).set({role: "admin", storeId: store.id});
  await store.set({ownerId: uid, subscriptionStatus: "active", subscriptionType: "business", perfilFiscal: {configurado: true}});
  await product.set({...fixtures.product, ...overrides});
  return {uid, store, product, data: {...structuredClone(fixtures.command), storeId: store.id, localSaleId: randomUUID()}};
}
const send = (f, data = f.data, auth = {uid: f.uid}) => syncOfflineSale.run({auth, data});
const saved = async f => (await f.store.collection("sales").doc(f.data.localSaleId).get()).data();
const count = async (f, name) => (await f.store.collection(name).get()).size;
async function state(f) {
  const p = await f.product.get();
  return {data: p.data(), time: p.updateTime, sale: await saved(f), audits: await count(f, "auditLogs")};
}
async function noEffect(f, data = f.data, code = "failed-precondition") {
  const before = await state(f);
  await assert.rejects(() => send(f, data), e => e.code === code);
  assert.deepEqual(await state(f), before);
}

test("A L S simple confirms once, preserves command snapshots and creates no financial/fiscal/receipt documents", async () => {
  for (const structural of [{}, {productKind: "simple", variantSchemaVersion: 1}]) {
    const f = await fixture(structural), before = structuredClone(f.data);
    const result = await send(f);
    assert.deepEqual(Object.keys(result).sort(), ["success", "localSaleId", "serverSaleId", "alreadyProcessed", "shouldRequestNfce", "archivedProductsAccepted"].sort());
    assert.equal(result.alreadyProcessed, false); assert.equal(result.shouldRequestNfce, true);
    assert.equal((await send(f)).alreadyProcessed, true);
    assert.equal((await f.product.get()).data().quantidade, 4);
    const s = await saved(f);
    assert.deepEqual(s.products, before.products); assert.equal(s.totalAmount, before.totalAmount);
    for (const k of ["notes", "paymentMethod", "customerId", "customerName"]) assert.equal(s[k], before[k]);
    assert.equal(s.createdAt.toMillis(), Date.parse(before.createdAt)); assert.equal(s.isPaid, true);
    assert.equal(Object.hasOwn(s, "fiscal"), false); assert.equal(Object.hasOwn(s, "receipt"), false);
    assert.deepEqual(f.data, before);
    const collections = (await f.store.listCollections()).map(c => c.id).sort();
    assert.deepEqual(collections, ["products", "sales"]);
  }
});
test("B C D J replay precedes structural/raw/duplicate gates, preserves divergent and old sale without localSaleId", async () => {
  const f = await fixture(); await send(f);
  await f.product.update({productKind: "variantParent", variantSchemaVersion: 1});
  await f.product.collection("commercialProfiles").doc("current").set({});
  await f.store.collection("sales").doc(f.data.localSaleId).update({isPaid: false, fiscal: {keep: true}});
  const before = await state(f);
  const line = {...f.data.products[0], variantId: null, quantity: 2, price: 25};
  assert.equal((await send(f, {...f.data, products: [line, {...line, productId: " p "}], totalAmount: 100})).alreadyProcessed, true);
  assert.deepEqual(await state(f), before);
  await f.store.collection("sales").doc(f.data.localSaleId).set({products: [line, line], legacy: true});
  const old = await state(f);
  assert.equal((await send(f)).alreadyProcessed, true); assert.deepEqual(await state(f), old);
  await noEffect(f, {...f.data, products: []}, "invalid-argument");
});
test("E F G parents partial variants mixed markers and monetary authorities reject without effects", async () => {
  const cases = [{productKind: "variantParent", variantSchemaVersion: 1, attributeDefinitions: []},
    {attributeDefinitions: []}, {productKind: "simple"}, {variantSchemaVersion: 1},
    {productId: "p", variantSchemaVersion: 1, attributes: {}},
    {productKind: "simple", variantSchemaVersion: 1, attributes: {}},
    ...["productId", "variantId", "attributes", "attributeDefinitions", "priceCents", "costCents", "commercial", "commercialProfiles"]
      .flatMap(k => [null, {}, NaN, new admin.firestore.Timestamp(1, 1)].map(v => ({[k]: v})))];
  for (const data of cases) await noEffect(await fixture(data));
  for (const data of [{}, {schemaVersion: 1}, {timestamp: new admin.firestore.Timestamp(1, 1)}]) {
    const f = await fixture(); await f.product.collection("commercialProfiles").doc("current").set(data);
    await noEffect(f);
  }
});
test("H I explicit raw variant and duplicate trimmed manual/FIFO lines reject before stock", async () => {
  for (const variantId of [null, undefined, "v"]) {
    const f = await fixture();
    await noEffect(f, {...f.data, products: [{...f.data.products[0], variantId}]}, "invalid-argument");
  }
  for (const lotes of [[], [{quantidade: 5, validade: new admin.firestore.Timestamp(1956614400, 0)}]]) {
    const f = await fixture({lotes});
    const line = {...f.data.products[0], quantity: 3};
    await noEffect(f, {...f.data, products: [line, {...line, productId: " p "}], totalAmount: 60}, "invalid-argument");
  }
});
test("K archive before/equal/after intention and invalid date retain exact historical policy", async () => {
  const intention = Date.parse(fixtures.command.createdAt);
  for (const delta of [-1, 0, 1]) {
    const f = await fixture({isArchived: true, archivedAt: admin.firestore.Timestamp.fromMillis(intention + delta)});
    if (delta < 0) await noEffect(f);
    else {
      const result = await send(f); assert.equal(result.archivedProductsAccepted, 1);
      assert.equal(await count(f, "auditLogs"), 1);
      assert.equal((await send(f)).archivedProductsAccepted, 0); assert.equal(await count(f, "auditLogs"), 1);
    }
  }
  for (const archivedAt of [null, "invalid"]) await noEffect(await fixture({isArchived: true, archivedAt}));
});
test("M N later insufficient stock prepares no writes or archive audit; injected precommit failure rolls back", async () => {
  const f = await fixture({isArchived: true, archivedAt: admin.firestore.Timestamp.fromMillis(Date.parse(fixtureDate()))});
  const q = f.store.collection("products").doc("q"); await q.set({...fixtures.product, quantidade: 0});
  const before = await state(f), qBefore = await q.get();
  await noEffect(f, {...f.data, products: [...f.data.products, {...f.data.products[0], productId: "q"}], totalAmount: 20});
  assert.deepEqual((await q.get()).updateTime, qBefore.updateTime);
  const original = db.runTransaction;
  let staged = 0;
  db.runTransaction = function(callback, ...rest) {
    return original.call(this, tx => {
      const update = tx.update.bind(tx); tx.update = (...args) => { staged++; return update(...args); };
      tx.create = () => { throw new Error("synthetic precommit failure"); };
      return callback(tx);
    }, ...rest);
  };
  try { await noEffect(f, f.data, "internal"); } finally { db.runTransaction = original; }
  assert.equal(staged, 1); assert.deepEqual(await state(f), before);
});
function fixtureDate() { return "2026-10-02T03:00:00.000Z"; }
test("O P concurrency same identity commits once; distinct identities cannot oversell manual or FIFO", async () => {
  const f = await fixture();
  const results = await Promise.all([send(f), send(f)]);
  assert.equal(results.filter(r => r.alreadyProcessed).length, 1);
  assert.equal((await f.product.get()).data().quantidade, 4);
  for (const lotes of [[], [{quantidade: 1, validade: new admin.firestore.Timestamp(1956614400, 0)}]]) {
    const g = await fixture({quantidade: 1, lotes});
    const results = await Promise.allSettled([send(g), send(g, {...g.data, localSaleId: randomUUID()})]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.find(r => r.status === "rejected").reason.code, "failed-precondition");
    assert.equal((await g.product.get()).data().quantidade, 0); assert.equal(await count(g, "sales"), 1);
  }
});
test("R auth store owner subscription still precede replay; current ID conflict remains", async () => {
  const f = await fixture();
  await assert.rejects(() => send(f, f.data, null), e => e.code === "unauthenticated");
  await assert.rejects(() => send(f, {...f.data, storeId: randomUUID()}), e => e.code === "not-found");
  await send(f);
  await assert.rejects(() => send(f, f.data, {uid: randomUUID()}), e => e.code === "permission-denied");
  for (const status of ["trial", "overdue", " ACTIVE "]) {
    await f.store.update({subscriptionStatus: status}); assert.equal((await send(f)).alreadyProcessed, true);
  }
  await f.store.update({subscriptionStatus: "inactive"}); await noEffect(f);
  await f.store.update({subscriptionStatus: "active", ownerId: "other"});
  await noEffect(f, f.data, "permission-denied");
  await f.store.update({ownerId: f.uid});
  await f.store.collection("sales").doc(f.data.localSaleId).update({localSaleId: "other"});
  await noEffect(f, f.data, "already-exists");
});
