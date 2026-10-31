"use strict";
const {seedAdmission} = require("../sales/fixtures/storeWriterAdmissionFixture.cjs");

const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const admin = require("firebase-admin");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
const projectId = process.env.GCLOUD_PROJECT || "demo-f9-update-integrity";
assert.ok(projectId.startsWith("demo-"));
if (!admin.apps.length) admin.initializeApp({projectId});
const db = admin.firestore();
const {createProduct} = require("../../products/createProduct");
const {updateProduct} = require("../../products/updateProduct");
const {codeRef} = require("../../products/productCodeReservation");
after(() => db.terminate());
const commercial = () => ({name: "Product", price: 10, quantidade: 5, lotes: [], minimumStock: 1, imageUrl: ""});
async function fixture() {
  const uid = randomUUID(); const store = db.collection("stores").doc(randomUUID());
  await store.set({subscriptionType: "pro", subscriptionStatus: "active"});
  await seedAdmission(db, store.id, "legacy");
  await db.collection("users").doc(uid).set({storeId: store.id, role: "admin"});
  const {productId} = await createProduct.run({auth: {uid}, data: {requestId: randomUUID(),
    product: {...commercial(), cod: "KEEP"}, categoryIds: []}});
  const ref = store.collection("products").doc(productId);
  return {store, ref, uid, productId};
}
const update = (f, product, requestId = randomUUID()) => updateProduct.run({auth: {uid: f.uid},
  data: {productId: f.productId, requestId, product}});
async function state(f) {
  return {product: (await f.ref.get()).data(), code: (await codeRef(f.store, "KEEP").get()).data(),
    logs: (await f.store.collection("auditLogs").get()).size};
}
test("missing or null required fields reject before product, COD and receipt writes", async () => {
  const f = await fixture(); const before = await state(f);
  for (const field of ["name", "price", "quantidade", "lotes", "minimumStock", "imageUrl"]) {
    for (const absent of [false, true]) {
      const data = {...commercial(), cod: ""};
      if (absent) delete data[field]; else data[field] = null;
      await assert.rejects(() => update(f, data), (e) => e.code === "invalid-argument");
      assert.deepEqual(await state(f), before);
    }
  }
});
test("omitted optional fields preserve legacy data, fiscal map and COD reservation", async () => {
  const f = await fixture();
  await f.ref.update({barcode: "LEGACY", costPrice: 2,
    fiscal: {ncm: "12345678", legacyTax: "preserve"}, legacyData: {keep: true}});
  const reservation = await codeRef(f.store, "KEEP").get();
  await update(f, {...commercial(), name: "Renamed"});
  const data = (await f.ref.get()).data();
  assert.equal(data.barcode, "LEGACY"); assert.equal(data.costPrice, 2);
  assert.deepEqual(data.fiscal, {ncm: "12345678", legacyTax: "preserve"});
  assert.deepEqual(data.legacyData, {keep: true}); assert.equal(data.cod, "KEEP");
  assert.ok((await codeRef(f.store, "KEEP").get()).updateTime.isEqual(reservation.updateTime));
});
test("null optional values and mismatched lots reject without releasing COD", async () => {
  const f = await fixture(); const before = await state(f);
  for (const field of ["cod", "barcode", "costPrice", "fiscal"]) {
    await assert.rejects(() => update(f, {...commercial(), [field]: null}), (e) => e.code === "invalid-argument");
    assert.deepEqual(await state(f), before);
  }
  await assert.rejects(() => update(f, {...commercial(), lotes: [{quantidade: 2, validadeMs: Date.UTC(2030, 0)}]}),
    (e) => e.code === "invalid-argument");
  assert.deepEqual(await state(f), before);
});
test("explicit zero stock with empty lots is a valid intentional update and replay cannot repeat it", async () => {
  const f = await fixture(); const requestId = randomUUID();
  const data = {...commercial(), quantidade: 0};
  await update(f, data, requestId);
  assert.equal((await f.ref.get()).data().quantidade, 0);
  await f.ref.update({quantidade: 3}); // A later inventory operation.
  assert.equal((await update(f, data, requestId)).replayed, true);
  assert.equal((await f.ref.get()).data().quantidade, 3);
  assert.equal((await codeRef(f.store, "KEEP").get()).data().productId, f.productId);
});
test("legacy document rejects incomplete edit without injecting defaults or clearing fields", async () => {
  const f = await fixture(); const legacy = {name: "Legacy", price: 2, quantidade: 7, historical: true};
  await f.ref.set(legacy); // Deliberately no COD or lotes in this Emulator fixture.
  const before = await state(f);
  await assert.rejects(() => update(f, {name: "Changed", price: 3}), (e) => e.code === "invalid-argument");
  assert.deepEqual(await state(f), before);
});
