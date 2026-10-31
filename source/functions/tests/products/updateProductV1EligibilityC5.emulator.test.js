"use strict";
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID, createHash} = require("node:crypto");
const admin = require("firebase-admin");
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(localhost|127\.0\.0\.1):\d+$/);
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
const {updateProduct} = require("../../products/updateProduct");
const {validateUpdateProductInput} = require("../../products/updateProductContract");
const {codeRef} = require("../../products/productCodeReservation");
after(() => db.terminate());
const body = () => ({name: "Changed", price: 12, quantidade: 5, lotes: [], minimumStock: 0, imageUrl: ""});
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ?
  Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hash = v => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const time = s => ({seconds: String(s.updateTime.seconds), nanoseconds: s.updateTime.nanoseconds});
async function fixture(overrides = {}, profile) {
  const uid = randomUUID(), store = db.collection("stores").doc(randomUUID());
  const user = db.collection("users").doc(uid), ref = store.collection("products").doc("p");
  await store.set({}); await user.set({role: "admin", storeId: store.id});
  await ref.set({name: "Simple", price: 10, quantidade: 5, lotes: [], cod: "OLD", ...overrides});
  await codeRef(store, "OLD").set({cod: "OLD", ownerType: "product", productId: "p", variantId: null});
  const commercial = ref.collection("commercialProfiles").doc("current");
  if (profile !== undefined) await commercial.set(profile);
  return {uid, store, user, ref, commercial};
}
const command = (product = body()) => ({requestId: randomUUID(), productId: "p", product});
const send = (f, data) => updateProduct.run({auth: {uid: f.uid}, data});
async function state(f) {
  const result = {};
  for (const c of [f.store, f.user, f.commercial]) {
    const s = await c.get(); result[c.path] = s.exists ? {data: s.data(), time: time(s)} : null;
  }
  for (const c of ["products", "productCodes", "auditLogs"]) {
    result[c] = (await f.store.collection(c).get()).docs.map(s => ({id: s.id, data: s.data(), time: time(s)}));
  }
  return result;
}
const blocked = e => e.code === "failed-precondition" && typeof e.details?.reason === "string" && !e.details?.persistedRejection;
for (const [label, data, profile] of [
  ["explicit parent", {productKind: "variantParent", variantSchemaVersion: 1, attributeDefinitions: []}],
  ["definitions only", {attributeDefinitions: []}],
  ["parent missing kind", {variantSchemaVersion: 1, attributeDefinitions: []}],
  ["parent missing version", {productKind: "variantParent", attributeDefinitions: []}],
  ["top-level variant", {variantSchemaVersion: 1, productId: "parent", attributes: {color: "blue"}}],
  ["variant without version", {productId: "parent", attributes: {}}],
  ["partial simple", {productKind: "simple"}],
  ["version only", {variantSchemaVersion: 1}],
  ["mixed identity", {productKind: "simple", variantSchemaVersion: 1, variantId: "v"}],
  ["null variant", {variantId: null}],
  ["null definitions", {attributeDefinitions: null}],
  ["SDK marker", {attributes: new admin.firestore.GeoPoint(1, 2)}],
  ["NaN marker", {variantSchemaVersion: NaN}],
  ["reference marker", {productKind: db.doc("synthetic/reference")}],
  ["priceCents", {priceCents: 0}], ["costCents null", {costCents: null}],
  ["commercial map", {commercial: {}}], ["commercialProfiles array", {commercialProfiles: []}],
  ["empty profile", {}, {}], ["profile present", {}, {schemaVersion: 1}],
  ["SDK profile", {}, {value: new admin.firestore.GeoPoint(1, 2)}],
  ["NaN profile", {}, {value: NaN}],
]) test("V1 domain block: " + label, async () => {
  const f = await fixture(data, profile), cmd = command({...body(), cod: "NEW"});
  const before = await state(f), frozen = structuredClone(cmd);
  await assert.rejects(() => send(f, cmd), blocked);
  assert.deepEqual(await state(f), before); assert.deepEqual(cmd, frozen);
});

test("simple edit preserves V1 command/hash/receipt and unrelated SDK metadata", async () => {
  const metadata = {point: new admin.firestore.GeoPoint(1, 2), ref: db.doc("synthetic/reference"),
    bytes: Buffer.from([1, 2]), at: new admin.firestore.Timestamp(1900000000, 123456789), n: NaN};
  const f = await fixture({legacy: metadata, fiscal: {internal: metadata}});
  const before = (await f.ref.get()).data(), cmd = command(), frozen = structuredClone(cmd);
  assert.deepEqual(await send(f, cmd), {success: true, productId: "p", replayed: false});
  assert.deepEqual(cmd, frozen);
  assert.deepEqual((await f.ref.get()).data(), {...before, ...body(), name_lowercase: "changed"});
  const normalized = validateUpdateProductInput(cmd);
  const expectedHash = hash(canonical({productId: normalized.productId, product: normalized.product, codSupplied: normalized.codSupplied}));
  const receipt = await f.store.collection("auditLogs").doc(hash(["updateProduct", f.store.id, f.uid, cmd.requestId])).get();
  assert.equal(receipt.data().requestHash, expectedHash); assert.equal(receipt.data().action, "product_updated");
});
for (const price of [NaN, Infinity, -Infinity, "invalid", new admin.firestore.GeoPoint(1, 2)]) {
  test("V1 can correct historical invalid price " + String(price), async () => {
    const f = await fixture({price, quantidade: "invalid", minimumStock: -1, fiscal: null});
    await send(f, command());
    const data = (await f.ref.get()).data();
    assert.equal(data.price, 12); assert.equal(data.quantidade, 5); assert.equal(data.minimumStock, 0);
    assert.equal(data.fiscal, null);
  });
}
test("explicit simple and archived simple retain cadastral compatibility", async () => {
  for (const markers of [{productKind: "simple", variantSchemaVersion: 1}, {isArchived: true}]) {
    const f = await fixture(markers); await send(f, command());
    for (const [k, v] of Object.entries(markers)) assert.deepEqual((await f.ref.get()).data()[k], v);
  }
});
test("confirmed replay precedes changed domain/profile/reservations and cannot rewrite state", async () => {
  const f = await fixture(), cmd = command(); await send(f, cmd);
  await f.ref.update({productKind: "variantParent", variantSchemaVersion: 1, attributeDefinitions: [], quantidade: 2});
  await f.commercial.set({sdk: new admin.firestore.GeoPoint(1, 2)});
  await codeRef(f.store, "OLD").delete();
  const before = await state(f);
  assert.equal((await send(f, cmd)).replayed, true); assert.deepEqual(await state(f), before);
  await assert.rejects(() => send(f, {...cmd, product: {...body(), price: 13}}), e => e.code === "already-exists" && e.details.reason === "request-id-reused");
  assert.deepEqual(await state(f), before);
});
test("V1 rejected calls have no receipt: same intent reevaluates after domain correction", async () => {
  const f = await fixture({attributeDefinitions: []}), cmd = command();
  const before = await state(f); await assert.rejects(() => send(f, cmd), blocked);
  assert.deepEqual(await state(f), before);
  await f.ref.update({attributeDefinitions: admin.firestore.FieldValue.delete()});
  await send(f, cmd); assert.equal((await f.store.collection("auditLogs").get()).size, 1);
});
test("historical COD rejection is unpersisted, then current domain/profile is revalidated", async () => {
  const f = await fixture({isArchived: true}), cmd = command({...body(), cod: "NEW"});
  const before = await state(f);
  await assert.rejects(() => send(f, cmd), e => e.code === "failed-precondition" && e.details.reason === "archived-product-cod-immutable");
  assert.deepEqual(await state(f), before);
  await f.ref.update({isArchived: false, attributeDefinitions: []}); await f.commercial.set({});
  const later = await state(f); await assert.rejects(() => send(f, cmd), blocked);
  assert.deepEqual(await state(f), later);
});
test("raw variant identity cannot disappear before normalization, including nonenumerable own fields", async () => {
  const f = await fixture(), before = await state(f);
  for (const nested of [false, true]) for (const enumerable of [false, true]) for (const value of [null, undefined, "v"]) {
    const cmd = command(); Object.defineProperty(nested ? cmd.product : cmd, "variantId", {value, enumerable});
    await assert.rejects(() => send(f, cmd), e => e.code === "invalid-argument");
  }
  assert.deepEqual(await state(f), before);
});
test("auth, roles, revocation and store scope apply before replay", async () => {
  const f = await fixture(), cmd = command(); await send(f, cmd);
  await assert.rejects(() => updateProduct.run({data: cmd}), e => e.code === "unauthenticated");
  for (const profile of [{role: "unknown", storeId: f.store.id}, {role: "admin", storeId: f.store.id, accessStatus: " REVOKED "},
    {role: "admin", storeId: " invalid "}]) {
    await f.user.set(profile); const before = await state(f);
    await assert.rejects(() => send(f, cmd), e => e.code === "permission-denied");
    assert.deepEqual(await state(f), before);
  }
  const other = db.collection("stores").doc(randomUUID()); await other.set({});
  await f.user.set({role: "admin", storeId: other.id}); const before = await state(f);
  await assert.rejects(() => send(f, cmd), e => e.code === "not-found");
  assert.deepEqual(await state(f), before); assert.equal((await other.collection("auditLogs").get()).size, 0);
  for (const role of ["admin", "gerente", "operador", "caixa", "vendedor"]) {
    await f.user.set({role, storeId: f.store.id}); assert.equal((await send(f, command())).success, true);
  }
});
test("concurrent same command deduplicates; different commands retain historical no-CAS behavior", async () => {
  const f = await fixture(), cmd = command();
  const results = await Promise.all([send(f, cmd), send(f, cmd)]);
  assert.equal(results.filter(r => r.replayed).length, 1);
  assert.equal((await f.store.collection("auditLogs").get()).size, 1);
  const a = command({...body(), quantidade: 8}), b = command({...body(), quantidade: 9});
  const edits = await Promise.all([send(f, a), send(f, b)]);
  assert.ok(edits.every(r => !r.replayed));
  assert.ok([8, 9].includes((await f.ref.get()).data().quantidade));
  assert.equal((await f.store.collection("auditLogs").get()).size, 3);
  // Old editor payload still overwrites a later stock operation: no implicit CAS.
  await f.ref.update({quantidade: 1}); await send(f, command({...body(), quantidade: 8}));
  assert.equal((await f.ref.get()).data().quantidade, 8);
});
test("V1 change/removal retains COD versions and same-owner historical reactivation fails", async () => {
  const f = await fixture(), original = await codeRef(f.store, "OLD").get();
  await send(f, command({...body(), cod: "NEW"}));
  assert.ok((await codeRef(f.store, "OLD").get()).updateTime.isEqual(original.updateTime));
  const next = await codeRef(f.store, "NEW").get();
  await send(f, command({...body(), cod: ""}));
  assert.ok((await codeRef(f.store, "NEW").get()).updateTime.isEqual(next.updateTime));
  for (const cod of ["OLD", "NEW"]) {
    const before = await state(f);
    await assert.rejects(() => send(f, command({...body(), cod})), e => e.code === "already-exists" && e.details.reason === "duplicate-product-cod");
    assert.deepEqual(await state(f), before);
  }
});
