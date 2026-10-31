"use strict";
const {seedAdmission} = require("../sales/fixtures/storeWriterAdmissionFixture.cjs");
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const admin = require("firebase-admin");
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(localhost|127\.0\.0\.1):\d+$/);
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
const api = require("../../products/productVariantsC1");
after(() => db.terminate());
const definitions = [{attributeId: "color", label: "Cor", values: [
  {valueId: "red", label: "Vermelho"}, {valueId: "blue", label: "Azul"}]}];
async function fixture() {
  const uid = randomUUID();
  const store = db.collection("stores").doc(randomUUID());
  const user = db.collection("users").doc(uid);
  await store.set({}); await user.set({storeId: store.id, role: "admin"});
  await seedAdmission(db, store.id);
  const scope = {projectId: db.projectId, uid, storeId: store.id};
  return {uid, store, user, scope, productId: randomUUID()};
}
const request = (f, data) => ({auth: {uid: f.uid}, data});
function parentCommand(f, simple = false) {
  return {schemaVersion: 1, requestId: randomUUID(), scope: f.scope, productId: f.productId,
    product: simple ? {productKind: "simple", name: "Sintético"} :
      {productKind: "variantParent", name: "Sintético", attributeDefinitions: definitions}};
}
const read = (f, variantId) => api.readProductC1(db, request(f, {scope: f.scope,
  productId: f.productId, ...(variantId ? {variantId} : {})}));
async function parent(f) { await api.createProductC1(db, request(f, parentCommand(f))); }
async function variantCommand(f, color = "red") {
  return {schemaVersion: 1, requestId: randomUUID(), scope: f.scope, productId: f.productId,
    variantId: randomUUID(), expectedProductUpdateTime: (await read(f)).expectedUpdateTime,
    variant: {attributes: [{attributeId: "color", valueId: color}]}};
}
const rejected = (fn, code) => assert.rejects(fn, (e) => e.code === code);
test("F10 C1 replay survives closure; new variant/product creation is denied", async () => {
  const f = await fixture(), c = parentCommand(f);
  await api.createProductC1(db, request(f, c));
  await seedAdmission(db, f.store.id, "draining", 2);
  assert.equal((await api.createProductC1(db, request(f, c))).replayed, true);
  await rejected(() => api.createProductC1(db, request(f,
    {...c, requestId: randomUUID(), productId: randomUUID()})), "failed-precondition");
  assert.equal((await f.store.collection("products").get()).size, 1);
});
test("create/read versioned parent, variant and simple; independent zero stock", async () => {
  const f = await fixture(); await parent(f);
  const command = await variantCommand(f);
  const result = await api.createVariantC1(db, request(f, command));
  const state = await read(f, result.variantId);
  assert.equal(state.parent.entity.isSellable, false);
  assert.equal(state.variant.entity.productId, f.productId);
  assert.equal(state.variant.entity.variantId, command.variantId);
  assert.equal(state.variant.entity.stock().quantidade, 0);
  assert.deepEqual(state.variant.entity.data.lotes, []);
  assert.equal(Object.hasOwn(state.variant.entity.data, "cod"), false);
  assert.equal(Object.hasOwn(state.variant.entity.data, "price"), false);
  assert.match(state.variant.metadata.createdAt.seconds, /^\d+$/);
  assert.equal((await f.store.collection("sales").get()).size, 0);
  assert.equal((await f.store.collection("productCodes").get()).size, 0);
  const simple = await fixture();
  await api.createProductC1(db, request(simple, parentCommand(simple, true)));
  assert.equal((await read(simple)).entity.isLegacy, false);
});
test("legacy adapter preserves absence/null, exact timestamps and SDK values without rewriting", async () => {
  const f = await fixture(); const ref = f.store.collection("products").doc(f.productId);
  const raw = {name: "Legado", price: null, quantidade: 3, extra: {timestamp: new admin.firestore.Timestamp(123, 456000),
    ref: f.store, bytes: Buffer.from([1, 2]), point: new admin.firestore.GeoPoint(1, 2)},
    lotes: [{quantidade: 3, validade: new admin.firestore.Timestamp(1893456000, 123456000), custom: "retained"}]};
  await ref.set(raw); const before = await ref.get();
  const state = await read(f);
  assert.equal(state.entity.isLegacy, true);
  assert.deepEqual(state.entity.field("price"), {state: "null", value: null});
  assert.deepEqual(state.entity.field("cod"), {state: "omitted"});
  assert.deepEqual(state.entity.data.extra.timestamp, {seconds: "123", nanoseconds: 456000});
  assert.equal(state.entity.data.extra.ref.firestoreReference, f.store.path);
  assert.equal(state.entity.stock().lots[0].data.validade.nanoseconds, 123456000);
  assert.deepEqual((await ref.get()).updateTime, before.updateTime);
});
test("same request replay survives changed current parent; identity conflicts never write", async () => {
  const f = await fixture(); const p = parentCommand(f);
  const [a, b] = await Promise.all([api.createProductC1(db, request(f, p)), api.createProductC1(db, request(f, p))]);
  assert.equal([a, b].filter((r) => r.replayed).length, 1);
  const c = await variantCommand(f); await api.createVariantC1(db, request(f, c));
  await f.store.collection("products").doc(f.productId).update({isArchived: true});
  assert.equal((await api.createVariantC1(db, request(f, c))).replayed, true);
  await rejected(() => api.createVariantC1(db, request(f, {...c, variantId: randomUUID()})), "already-exists");
  await rejected(() => api.createProductC1(db, request(f, {...p, productId: randomUUID()})), "already-exists");
  const cross = {...c, requestId: p.requestId};
  await rejected(() => api.createVariantC1(db, request(f, cross)), "already-exists");
  assert.equal((await f.store.collection("auditLogs").get()).size, 2);
});
test("concurrent duplicate combinations create exactly one leaf/reservation/receipt", async () => {
  const f = await fixture(); await parent(f);
  const a = await variantCommand(f); const b = {...a, requestId: randomUUID(), variantId: randomUUID()};
  const results = await Promise.allSettled([api.createVariantC1(db, request(f, a)), api.createVariantC1(db, request(f, b))]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const ref = f.store.collection("products").doc(f.productId);
  assert.equal((await ref.collection("variants").get()).size, 1);
  assert.equal((await ref.collection("variantCombinations").get()).size, 1);
  assert.equal((await f.store.collection("auditLogs").get()).size, 2);
});
test("archived combinations, missing index and orphan reservation block duplication", async () => {
  const f = await fixture(); await parent(f);
  const c = await variantCommand(f); await api.createVariantC1(db, request(f, c));
  const ref = f.store.collection("products").doc(f.productId);
  await ref.collection("variants").doc(c.variantId).update({isArchived: true});
  await rejected(() => variantCommand(f).then((v) => api.createVariantC1(db, request(f, v))), "already-exists");
  const reservations = await ref.collection("variantCombinations").get();
  await reservations.docs[0].ref.delete(); // Synthetic corruption, emulator only.
  await rejected(() => variantCommand(f).then((v) => api.createVariantC1(db, request(f, v))), "already-exists");
  await ref.collection("variants").doc(c.variantId).delete();
  await reservations.docs[0].ref.set({variantId: "orphan"});
  await rejected(() => variantCommand(f).then((v) => api.createVariantC1(db, request(f, v))), "already-exists");
});
test("attributes reject duplicates, unknown values, empty/partial combinations; stable IDs after label rename", async () => {
  const f = await fixture(); await parent(f); const c = await variantCommand(f);
  for (const attributes of [[{attributeId: "other", valueId: "red"}],
    [{attributeId: "color", valueId: "missing"}], [...c.variant.attributes, ...c.variant.attributes]]) {
    await rejected(() => api.createVariantC1(db, request(f, {...c, variant: {attributes}})), "invalid-argument");
  }
  await rejected(() => api.createVariantC1(db, request(f, {...c, variant: {attributes: []}})), "failed-precondition");
  await api.createVariantC1(db, request(f, c));
  const before = (await read(f, c.variantId)).variant.entity;
  const renamed = structuredClone(definitions); renamed[0].label = "Color"; renamed[0].values[0].label = "Red";
  await f.store.collection("products").doc(f.productId).update({attributeDefinitions: renamed});
  const after = (await read(f, c.variantId)).variant.entity;
  assert.equal(after.variantId, before.variantId); assert.equal(after.combination.key, before.combination.key);
});
test("authorization and scope checked on reads, writes and replays", async () => {
  const f = await fixture(); const c = parentCommand(f); await api.createProductC1(db, request(f, c));
  await rejected(() => api.createProductC1(db, {data: c}), "unauthenticated");
  await rejected(() => api.readProductC1(db, {data: {scope: f.scope, productId: f.productId}}), "unauthenticated");
  for (const patch of [{role: "unknown"}, {role: "admin", accessStatus: "revoked"}]) {
    await f.user.update(patch);
    await rejected(() => api.createProductC1(db, request(f, c)), "permission-denied");
    await rejected(() => read(f), "permission-denied");
  }
  await f.user.update({role: "admin", accessStatus: "active"});
  for (const key of ["uid", "storeId", "projectId"]) {
    const scope = {...f.scope, [key]: "demo-other"};
    await rejected(() => api.createProductC1(db, request(f, {...c, scope})), "permission-denied");
  }
  const other = await fixture();
  await rejected(() => api.readProductC1(db, request(other, {scope: other.scope, productId: f.productId})), "not-found");
  await f.user.update({storeId: other.store.id});
  await rejected(() => api.createProductC1(db, request(f, c)), "permission-denied");
});
test("same IDs and combinations in different stores remain isolated", async () => {
  const a = await fixture(); const b = await fixture(); b.productId = a.productId;
  await parent(a); await parent(b);
  const ca = await variantCommand(a); const cb = {...await variantCommand(b), variantId: ca.variantId, requestId: ca.requestId};
  await api.createVariantC1(db, request(a, ca)); await api.createVariantC1(db, request(b, cb));
  assert.equal((await read(a, ca.variantId)).variant.entity.variantId, cb.variantId);
  assert.equal((await read(b, cb.variantId)).variant.entity.productId, a.productId);
});
test("explicit COD/stock rejection, strict fields and no side effects", async () => {
  const f = await fixture();
  for (const patch of [{cod: "X"}, {cod: null}, {COD: "X"}, {quantidade: 1}, {quantidade: null},
    {lotes: [{}]}, {lotes: null}, {stock: 0}, {price: 10}, {categoryIds: []}, {productId: "forged"}]) {
    const c = parentCommand(f);
    await rejected(() => api.createProductC1(db, request(f, {...c, product: {...c.product, ...patch}})), "invalid-argument");
  }
  assert.equal((await f.store.collection("products").get()).size, 0);
  assert.equal((await f.store.collection("auditLogs").get()).size, 0);
  await parent(f);
  for (const patch of [{cod: "X"}, {quantidade: 1}, {lotes: [{}]}, {stockChange: {}}]) {
    const c = await variantCommand(f);
    await rejected(() => api.createVariantC1(db, request(f, {...c, variant: {...c.variant, ...patch}})), "invalid-argument");
  }
});
test("stale baseline, simple/archived parent and existing IDs cannot create variants", async () => {
  const f = await fixture(); await parent(f); const c = await variantCommand(f);
  const ref = f.store.collection("products").doc(f.productId);
  await ref.update({name: "Concurrent"});
  await rejected(() => api.createVariantC1(db, request(f, c)), "failed-precondition");
  const valid = await variantCommand(f); await api.createVariantC1(db, request(f, valid));
  const collision = {...await variantCommand(f, "blue"), variantId: valid.variantId};
  await rejected(() => api.createVariantC1(db, request(f, collision)), "already-exists");
  await ref.update({isArchived: true});
  await rejected(() => variantCommand(f, "blue").then((v) => api.createVariantC1(db, request(f, v))), "failed-precondition");
  const simple = await fixture(); await api.createProductC1(db, request(simple, parentCommand(simple, true)));
  await rejected(() => variantCommand(simple).then((v) => api.createVariantC1(db, request(simple, v))), "failed-precondition");
});
test("transaction failure after staging writes rolls back entity/index/receipt/parent token", async () => {
  const f = await fixture(); await parent(f); const c = await variantCommand(f);
  const original = db.runTransaction.bind(db);
  const originalToken = (await read(f)).expectedUpdateTime;
  db.runTransaction = (callback) => original(async (tx) => {
    await callback(tx); throw new Error("synthetic-before-commit");
  });
  try { await assert.rejects(() => api.createVariantC1(db, request(f, c)), /synthetic-before-commit/); }
  finally { db.runTransaction = original; }
  const ref = f.store.collection("products").doc(f.productId);
  assert.equal((await ref.collection("variants").get()).size, 0);
  assert.equal((await ref.collection("variantCombinations").get()).size, 0);
  assert.equal((await f.store.collection("auditLogs").get()).size, 1);
  assert.deepEqual((await read(f)).expectedUpdateTime, originalToken);
  assert.equal((await api.createVariantC1(db, request(f, c))).status, "created");
});
test("environment guard refuses non-demo, non-loopback and mismatched configured SDK host", async () => {
  const original = process.env.FIRESTORE_EMULATOR_HOST;
  const f = await fixture(); const c = parentCommand(f);
  try {
    for (const host of ["example.com:8080", "127.0.0.1:0", "127.0.0.1:65536", "localhost:9999", ""]) {
      process.env.FIRESTORE_EMULATOR_HOST = host;
      await rejected(() => api.createProductC1(db, request(f, c)), "failed-precondition");
    }
  } finally { process.env.FIRESTORE_EMULATOR_HOST = original; }
  await rejected(() => api.createProductC1({projectId: "production"}, request(f, c)), "failed-precondition");
});
test("multi-attribute ordering is canonical, missing selections blocked and invalid definitions rejected", async () => {
  const f = await fixture();
  const c = parentCommand(f);
  c.product.attributeDefinitions = [...definitions, {attributeId: "size", label: "Tamanho",
    values: [{valueId: "m", label: "M"}]}];
  const invalid = structuredClone(c); invalid.product.attributeDefinitions.push(definitions[0]);
  await rejected(() => api.createProductC1(db, request(f, invalid)), "invalid-argument");
  await api.createProductC1(db, request(f, c));
  const v = await variantCommand(f);
  await rejected(() => api.createVariantC1(db, request(f, v)), "failed-precondition");
  v.variant.attributes = [{attributeId: "size", valueId: "m"}, ...v.variant.attributes];
  await api.createVariantC1(db, request(f, v));
  const reverse = {...await variantCommand(f), variant: {attributes: v.variant.attributes.slice().reverse()}};
  await rejected(() => api.createVariantC1(db, request(f, reverse)), "already-exists");
  assert.deepEqual((await read(f, v.variantId)).variant.entity.data.attributes.map((p) => p.attributeId), ["color", "size"]);
});
test("concurrent same variant command is replayed once; distinct combinations require fresh parent baseline", async () => {
  const f = await fixture(); await parent(f); const c = await variantCommand(f);
  const results = await Promise.all([api.createVariantC1(db, request(f, c)), api.createVariantC1(db, request(f, c))]);
  assert.equal(results.filter((r) => r.replayed).length, 1);
  const stale = {...c, variantId: randomUUID(), requestId: randomUUID(),
    variant: {attributes: [{attributeId: "color", valueId: "blue"}]}};
  await rejected(() => api.createVariantC1(db, request(f, stale)), "failed-precondition");
  stale.expectedProductUpdateTime = (await read(f)).expectedUpdateTime;
  await api.createVariantC1(db, request(f, stale));
  assert.equal((await f.store.collection("products").doc(f.productId).collection("variants").get()).size, 2);
});
