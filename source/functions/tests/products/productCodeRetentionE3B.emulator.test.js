"use strict";
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const admin = require("firebase-admin");
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(localhost|127\.0\.0\.1):\d+$/);
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
const {createProduct} = require("../../products/createProduct");
const {updateProduct} = require("../../products/updateProduct");
const {updateProductV2} = require("../../products/productMutationV2");
const {archiveProduct} = require("../../products/archiveProduct");
const {codeRef} = require("../../products/productCodeReservation");
const c2 = require("../../products/productVariantsC1");
after(() => db.terminate());
const body = cod => ({name: "Synthetic", price: 10, quantidade: 1, lotes: [], minimumStock: 0, imageUrl: "", cod});
const req = (f, data) => ({auth: {uid: f.uid}, data});
const time = s => ({seconds: String(s.updateTime.seconds), nanoseconds: s.updateTime.nanoseconds});
async function fixture() {
  const uid = randomUUID(), store = db.collection("stores").doc(randomUUID());
  await store.set({subscriptionType: "pro", subscriptionStatus: "active"});
  await db.collection("users").doc(uid).set({storeId: store.id, role: "admin"});
  const f = {uid, store, scope: {projectId: db.projectId, storeId: store.id, uid}};
  const created = await create(f, "CAM001");
  return {...f, ref: store.collection("products").doc(created.productId)};
}
const create = (f, cod) => createProduct.run(req(f, {requestId: randomUUID(), product: body(cod), categoryIds: []}));
const v1 = (f, cod) => updateProduct.run(req(f, {requestId: randomUUID(), productId: f.ref.id, product: body(cod)}));
async function command(f, changes) {
  return {schemaVersion: 2, requestId: randomUUID(), scope: f.scope, productId: f.ref.id,
    expectedUpdateTime: time(await f.ref.get()), changes};
}
const send = (f, data) => updateProductV2.run(req(f, data));
const v2 = async (f, cod) => send(f, await command(f, cod ? {set: {cod}} : {remove: ["cod"]}));
const duplicate = fn => assert.rejects(fn, e => e.code === "already-exists" && e.details.reason === "duplicate-product-cod");
async function state(f) {
  const result = {};
  for (const name of ["products", "productCodes", "auditLogs"]) {
    result[name] = (await f.store.collection(name).get()).docs.map(s => ({id: s.id, data: s.data(), time: time(s)}));
  }
  return result;
}

test("V2 -> V1 -> V2 retains all codes, rejects both-owner reuse and exposes only current COD", async () => {
  const f = await fixture(), original = await codeRef(f.store, "CAM001").get();
  await v2(f, "CAM002"); await v1(f, "CAM003"); await v2(f, "CAM004");
  for (const cod of ["CAM001", "CAM002", "CAM003"]) {
    const before = await f.ref.get();
    await duplicate(() => v1(f, cod)); await duplicate(() => v2(f, cod));
    await duplicate(() => create(f, cod));
    assert.ok((await f.ref.get()).updateTime.isEqual(before.updateTime));
    assert.equal((await f.store.collection("products").where("cod", "==", cod).get()).size, 0);
    assert.equal((await codeRef(f.store, cod).get()).data().productId, f.ref.id);
  }
  assert.equal((await f.store.collection("products").where("cod", "==", "CAM004").get()).docs[0].id, f.ref.id);
  assert.ok((await codeRef(f.store, "CAM001").get()).updateTime.isEqual(original.updateTime));
  await v2(f, ""); await duplicate(() => v2(f, "CAM004")); await duplicate(() => v1(f, "CAM004"));
  assert.equal((await f.store.collection("productCodes").get()).size, 4);
  const other = await fixture(); await v2(other, "CAM004"); // Store scope, including historical codes.
});

test("legacy reservations remain byte/version identical across removal and archive, with no reactivation", async () => {
  const f = await fixture(), ref = codeRef(f.store, "CAM001");
  await ref.set({cod: "CAM001", productId: f.ref.id});
  const before = await ref.get();
  await v2(f, "CAM001"); // Unchanged legacy current COD is allowed.
  await v1(f, "");
  await archiveProduct.run(req(f, {storeId: f.store.id, productId: f.ref.id}));
  await duplicate(() => create(f, "CAM001"));
  const after = await ref.get();
  assert.deepEqual(after.data(), before.data()); assert.ok(after.updateTime.isEqual(before.updateTime));
});

test("confirmed and rejected scoped receipts replay before later COD/reservation revalidation", async () => {
  const f = await fixture();
  const confirmed = await command(f, {set: {cod: "CAM002"}}); await send(f, confirmed);
  const rejected = await command(f, {set: {cod: "CAM001"}});
  await assert.rejects(() => send(f, rejected), e => e.details?.persistedRejection && e.details.reason === "duplicate-product-cod");
  await v1(f, "CAM003");
  // Synthetic corruption after persisted outcomes must not reinterpret replay.
  await codeRef(f.store, "CAM003").set({cod: "BROKEN", productId: "foreign"});
  const before = await state(f);
  assert.equal((await send(f, confirmed)).replayed, true);
  await assert.rejects(() => send(f, rejected), e => e.details?.persistedRejection && e.details.reason === "duplicate-product-cod");
  assert.deepEqual(await state(f), before);
});

test("concurrent V2 changes share exact CAS: one commit, no losing reservation; stale retry stays rejected", async () => {
  const f = await fixture();
  const a = await command(f, {set: {cod: "CAM002"}}), b = {...a, requestId: randomUUID(), changes: {set: {cod: "CAM003"}}};
  const results = await Promise.allSettled([send(f, a), send(f, b)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const loser = results[0].status === "rejected" ? a : b;
  const error = results.find(r => r.status === "rejected").reason;
  assert.equal(error.code, "aborted"); assert.equal(error.details.reason, "product-version-conflict");
  assert.equal((await codeRef(f.store, loser.changes.set.cod).get()).exists, false);
  assert.equal((await f.store.collection("productCodes").get()).size, 2);
  const before = await state(f);
  await assert.rejects(() => send(f, loser), e => e.details?.persistedRejection && e.code === "aborted");
  assert.deepEqual(await state(f), before);
});

test("missing, inconsistent and foreign current reservations fail closed in both writers without repair", async () => {
  for (const broken of [null, {cod: "WRONG"}, {cod: "CAM001", productId: "foreign"}, {cod: "CAM001", ownerType: "other"}]) {
    const f = await fixture(), index = codeRef(f.store, "CAM001");
    if (broken) await index.set({productId: f.ref.id, ...broken}); else await index.delete();
    const before = await state(f);
    for (const cod of ["CAM001", "CAM002", ""]) {
      const code = cod === "CAM001" && broken?.productId === "foreign" ? "already-exists" : "failed-precondition";
      await assert.rejects(() => v1(f, cod), e => e.code === code);
      const c = await command(f, cod ? {set: {cod}} : {remove: ["cod"]}); delete c.scope;
      await assert.rejects(() => send(f, c), e => e.code === code);
    }
    assert.deepEqual(await state(f), before);
  }
});

test("orphan and matching-owner reservations cannot be adopted by creation or assignment", async () => {
  const f = await fixture();
  for (const productId of ["missing-owner", f.ref.id]) {
    const cod = productId === f.ref.id ? "SAME" : "ORPHAN";
    await codeRef(f.store, cod).set({cod, productId});
    await duplicate(() => create(f, cod)); await duplicate(() => v1(f, cod)); await duplicate(() => v2(f, cod));
  }
});

test("real C2 variant and product creation cannot reuse historical F9 COD", async () => {
  const f = await fixture(); await v2(f, "CAM002"); await v1(f, "");
  const parentId = randomUUID();
  await c2.createProductC2(db, req(f, {schemaVersion: 1, requestId: randomUUID(), scope: f.scope, productId: parentId,
    product: {productKind: "variantParent", name: "Parent", attributeDefinitions: [
      {attributeId: "color", label: "Cor", values: [{valueId: "red", label: "Vermelho"}]}]}}));
  const parent = await c2.readProductC1(db, req(f, {scope: f.scope, productId: parentId}));
  for (const cod of ["CAM001", "CAM002"]) {
    const before = await state(f), variantId = randomUUID();
    await duplicate(() => c2.createVariantC2(db, req(f, {schemaVersion: 1, requestId: randomUUID(), scope: f.scope,
      productId: parentId, variantId, expectedProductUpdateTime: parent.expectedUpdateTime,
      variant: {cod, attributes: [{attributeId: "color", valueId: "red"}]}})));
    await duplicate(() => c2.createProductC2(db, req(f, {schemaVersion: 1, requestId: randomUUID(), scope: f.scope,
      productId: randomUUID(), product: {productKind: "simple", name: "Other", cod}})));
    assert.deepEqual(await state(f), before);
    assert.equal((await f.store.collection("products").doc(parentId).collection("variants").doc(variantId).get()).exists, false);
  }
});
