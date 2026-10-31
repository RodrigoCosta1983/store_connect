"use strict";
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID, createHash} = require("node:crypto");
const admin = require("firebase-admin");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
const {adjustProductStockV1, updateProductV2} = require("../../products/productMutationV2");
const {getProductMutationResult} = require("../../products/productMutationResult");
const {validateAdjustProductStock} = require("../../products/productMutationContract");
after(() => db.terminate());
const time = s => ({seconds: String(s.updateTime.seconds), nanoseconds: s.updateTime.nanoseconds});
async function fixture(overrides = {}) {
  const uid = randomUUID(), store = db.collection("stores").doc(randomUUID());
  const user = db.collection("users").doc(uid), product = store.collection("products").doc("p");
  await store.set({}); await user.set({storeId: store.id, role: "admin"});
  await product.set({name: "Simple", quantidade: 5, lotes: [], price: 10, ...overrides});
  return {uid, store, user, product, profile: product.collection("commercialProfiles").doc("current")};
}
async function command(f, scoped = true, stockChange = {kind: "setManualQuantity", quantity: 8}) {
  return {schemaVersion: 1, requestId: randomUUID(), productId: f.product.id,
    expectedUpdateTime: time(await f.product.get()), reason: "Contagem", stockChange,
    ...(scoped ? {scope: {projectId: process.env.GCLOUD_PROJECT, uid: f.uid, storeId: f.store.id}} : {})};
}
const send = (f, data) => adjustProductStockV1.run({auth: {uid: f.uid}, data});
const query = (f, data) => getProductMutationResult.run({auth: {uid: f.uid}, data: {
  operation: "adjustProductStockV1", command: data, expectedStoreId: f.store.id}});
async function state(f) {
  const collections = await f.store.listCollections();
  const result = {};
  for (const collection of collections) {
    result[collection.id] = (await collection.get()).docs.map(s => ({id: s.id, data: s.data(), time: time(s)}));
  }
  const profile = await f.profile.get();
  return {...result, profile: profile.exists ? {data: profile.data(), time: time(profile)} : null};
}
const noTerminal = e => e.code === "failed-precondition" && !e.details?.persistedRejection && typeof e.details?.reason === "string";

for (const scoped of [true, false]) {
  for (const [label, overrides, profile] of [
    ["explicit parent", {productKind: "variantParent", variantSchemaVersion: 1, attributeDefinitions: []}],
    ["parent lacking kind", {variantSchemaVersion: 1, attributeDefinitions: []}],
    ["parent lacking version", {productKind: "variantParent", attributeDefinitions: []}],
    ["parent lacking both discriminators", {attributeDefinitions: []}],
    ["variant", {variantSchemaVersion: 1, productId: "parent", attributes: {color: "blue"}}],
    ["variant lacking discriminator", {productId: "parent", attributes: {color: "blue"}}],
    ["variant attributes only", {attributes: null}],
    ["partial simple", {productKind: "simple"}],
    ["mixed simple", {productKind: "simple", variantSchemaVersion: 1, attributes: {}}],
    ["variant identity on product", {variantId: null}],
    ["parent marker null", {attributeDefinitions: null}],
    ["SDK marker", {attributeDefinitions: new admin.firestore.GeoPoint(1, 2)}],
    ["nonfinite marker", {variantSchemaVersion: NaN}],
    ["invalid active state", {isArchived: "false"}],
    ["new money", {priceCents: 10}],
    ["empty profile", {}, {}],
    ["profile with data", {}, {schemaVersion: 1}],
    ["SDK profile", {}, {point: new admin.firestore.GeoPoint(1, 2)}],
    ["archived parent", {productKind: "variantParent", variantSchemaVersion: 1, isArchived: true}],
  ]) test("C5 stock domain block " + label + (scoped ? " scoped" : " unscoped"), async () => {
    const f = await fixture(overrides);
    if (profile !== undefined) await f.profile.set(profile);
    const data = await command(f, scoped), before = await state(f);
    const frozen = structuredClone(data);
    await assert.rejects(() => send(f, data), noTerminal);
    assert.deepEqual(data, frozen);
    assert.deepEqual(await state(f), before);
    const result = await query(f, data);
    assert.equal(result.status, "not-recorded"); assert.equal(result.definitive, false);
    assert.deepEqual(await state(f), before);
  });
}

test("manual simple preserves original command hash and receipt format", async () => {
  const f = await fixture(); const data = await command(f); const frozen = structuredClone(data);
  const before = (await f.product.get()).data();
  assert.deepEqual(await send(f, data), {success: true, productId: "p", requestId: data.requestId, replayed: false, changed: true});
  assert.deepEqual((await f.product.get()).data(), {...before, quantidade: 8});
  const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ?
    Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  const receipt = (await f.store.collection("auditLogs").get()).docs[0].data();
  assert.equal(receipt.requestHash, createHash("sha256").update(JSON.stringify(canonical(validateAdjustProductStock(frozen)))).digest("hex"));
  assert.equal(receipt.action, "adjustProductStockV1"); assert.equal(receipt.schemaVersion, 1);
  assert.deepEqual(data, frozen);
});

for (const price of [NaN, Infinity, -Infinity]) test("four stock modes ignore invalid sale price " + String(price), async () => {
  const metadata = {point: new admin.firestore.GeoPoint(1, 2), ref: db.doc("synthetic/reference"), bytes: Buffer.from([1]), number: NaN};
  const f = await fixture({price, costPrice: NaN, fiscal: metadata, legacy: metadata});
  await send(f, await command(f));
  assert.equal((await f.product.get()).data().quantidade, 8);
  await send(f, await command(f, true, {kind: "convertToLots", lots: [{quantidade: 3, validadeMs: 1900000000000}, {quantidade: 4, validadeMs: 1900000001000}]}));
  const precise = new admin.firestore.Timestamp(1900000000, 123456000);
  const lots = (await f.product.get()).data().lotes;
  await f.product.update({lotes: [{...lots[0], validade: precise, metadata}, lots[1]]});
  const before = (await f.product.get()).data();
  await send(f, await command(f, true, {kind: "editLots", operations: [{op: "update", index: 0, set: {quantidade: 2}}]}));
  assert.deepEqual((await f.product.get()).data(), {...before, quantidade: 6, lotes: [{...before.lotes[0], quantidade: 2}, before.lotes[1]]});
  await send(f, await command(f, true, {kind: "convertToManual", quantity: 9, acknowledgement: true}));
  const final = (await f.product.get()).data();
  assert.equal(final.quantidade, 9); assert.deepEqual(final.lotes, []);
  assert.deepEqual(final.fiscal, metadata); assert.deepEqual(final.legacy, metadata);
  assert.ok(Object.is(final.price, price)); assert.ok(Number.isNaN(final.costPrice));
  assert.equal((await f.store.collection("auditLogs").get()).size, 4);
});

test("raw variantId including nonenumerable undefined never disappears", async () => {
  const f = await fixture(); const before = await state(f);
  for (const variantId of [null, undefined, "v"]) {
    for (const enumerable of [true, false]) {
      const data = await command(f);
      Object.defineProperty(data, "variantId", {value: variantId, enumerable});
      await assert.rejects(() => send(f, data), e => e.code === "invalid-argument");
      assert.ok(Object.hasOwn(data, "variantId")); assert.equal(data.variantId, variantId);
    }
  }
  assert.deepEqual(await state(f), before);
});

test("confirmed replay precedes later type/profile and stale CAS", async () => {
  const f = await fixture(); const data = await command(f); const original = await send(f, data);
  await f.product.update({productKind: "variantParent", variantSchemaVersion: 1, attributeDefinitions: []});
  await f.profile.set({}); const before = await state(f);
  assert.deepEqual(await send(f, data), {...original, replayed: true});
  assert.equal((await query(f, data)).status, "confirmed");
  assert.deepEqual(await state(f), before);
});

test("archived rejection stays terminal scoped, legacy unscoped stays without receipt", async () => {
  for (const scoped of [true, false]) {
    const f = await fixture({isArchived: true}); const data = await command(f, scoped);
    const before = await f.product.get();
    await assert.rejects(() => send(f, data), e => e.details.reason === "archived-product-stock-immutable" &&
      Boolean(e.details.persistedRejection) === scoped);
    assert.ok((await f.product.get()).updateTime.isEqual(before.updateTime));
    assert.equal((await f.store.collection("auditLogs").get()).size, scoped ? 1 : 0);
    if (scoped) {
      await f.product.update({isArchived: false, attributeDefinitions: []}); await f.profile.set({});
      const saved = await state(f);
      await assert.rejects(() => send(f, data), e => e.details.reason === "archived-product-stock-immutable" && e.details.persistedRejection);
      assert.equal((await query(f, data)).status, "rejected"); assert.deepEqual(await state(f), saved);
    }
  }
});

test("same request concurrency applies once; distinct requests retain CAS terminal conflict", async () => {
  const f = await fixture(); const data = await command(f);
  const results = await Promise.all([send(f, data), send(f, data)]);
  assert.equal(results.filter(r => r.replayed).length, 1);
  assert.equal((await f.store.collection("auditLogs").get()).size, 1);
  const a = await command(f), b = {...a, requestId: randomUUID(), stockChange: {kind: "setManualQuantity", quantity: 6}};
  a.stockChange = {kind: "setManualQuantity", quantity: 7};
  const race = await Promise.allSettled([send(f, a), send(f, b)]);
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
  const loser = race.find(r => r.status === "rejected").reason;
  assert.equal(loser.code, "aborted"); assert.equal(loser.details.reason, "product-version-conflict");
  assert.equal(loser.details.persistedRejection, true);
});

test("stock roles, scope, membership and revocation remain authoritative even for replay", async () => {
  const f = await fixture(); const data = await command(f);
  await assert.rejects(() => adjustProductStockV1.run({data}), e => e.code === "unauthenticated");
  for (const role of ["admin", "gerente", "operador", "caixa", "vendedor"]) {
    await f.user.update({role}); await send(f, await command(f));
  }
  for (const patch of [{role: "viewer"}, {role: "admin", accessStatus: "revoked"}]) {
    await f.user.update(patch);
    await assert.rejects(() => send(f, data), e => e.code === "permission-denied");
  }
  await f.user.update({role: "admin", accessStatus: "active"});
  const valid = await command(f); await send(f, valid); const before = await state(f);
  for (const field of ["uid", "storeId", "projectId"]) {
    await assert.rejects(() => send(f, {...valid, scope: {...valid.scope, [field]: "other"}}), e => e.code === "permission-denied");
  }
  const other = await fixture(); await f.user.update({storeId: other.store.id});
  await assert.rejects(() => send(f, valid), e => e.code === "permission-denied");
  assert.deepEqual(await state(f), before);
});

test("E2-B cadastral guard blocks parent independently; simple scoped CAS remains terminal", async () => {
  const f = await fixture({productKind: "variantParent", variantSchemaVersion: 1, attributeDefinitions: []});
  await f.profile.set({});
  const baseline = await command(f);
  const {reason, stockChange, ...envelope} = baseline;
  const data = {...envelope, schemaVersion: 2, changes: {set: {name: "Changed"}}};
  const before = await state(f);
  await assert.rejects(() => updateProductV2.run({auth: {uid: f.uid}, data}), noTerminal);
  assert.deepEqual(await state(f), before);
  const simple = await fixture(); const simpleBaseline = await command(simple);
  const {reason: unusedReason, stockChange: unusedStock, ...simpleEnvelope} = simpleBaseline;
  const simpleData = {...simpleEnvelope, schemaVersion: 2, changes: {set: {name: "Changed"}}};
  assert.equal((await updateProductV2.run({auth: {uid: simple.uid}, data: simpleData})).success, true);
  const stale = {...simpleData, requestId: randomUUID()};
  await assert.rejects(() => updateProductV2.run({auth: {uid: simple.uid}, data: stale}),
    e => e.code === "aborted" && e.details.persistedRejection === true);
});
