"use strict";
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID, createHash} = require("node:crypto");
const admin = require("firebase-admin");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
const {updateProductV2} = require("../../products/productMutationV2");
const {getProductMutationResult} = require("../../products/productMutationResult");
const {codeRef} = require("../../products/productCodeReservation");
const {validateUpdateProductV2} = require("../../products/productMutationContract");
after(() => db.terminate());
const time = s => ({seconds: String(s.updateTime.seconds), nanoseconds: s.updateTime.nanoseconds});
async function fixture(overrides = {}) {
  const uid = randomUUID(), store = db.collection("stores").doc(randomUUID());
  const user = db.collection("users").doc(uid), product = store.collection("products").doc("p");
  await store.set({}); await user.set({storeId: store.id, role: "admin"});
  await product.set({name: "Simple", quantidade: 5, lotes: [], price: 10, ...overrides});
  return {uid, store, user, product, profile: product.collection("commercialProfiles").doc("current")};
}
async function command(f, changes = {set: {name: "Changed"}}, scoped = true) {
  return {schemaVersion: 2, requestId: randomUUID(), productId: f.product.id,
    expectedUpdateTime: time(await f.product.get()), changes,
    ...(scoped ? {scope: {projectId: process.env.GCLOUD_PROJECT, uid: f.uid, storeId: f.store.id}} : {})};
}
const send = (f, data) => updateProductV2.run({auth: {uid: f.uid}, data});
const query = (f, data) => getProductMutationResult.run({auth: {uid: f.uid}, data: {
  operation: "updateProductV2", command: data, expectedStoreId: f.store.id}});
async function state(f) {
  const result = {};
  for (const c of await f.store.listCollections()) {
    result[c.id] = (await c.get()).docs.map(s => ({id: s.id, data: s.data(), time: time(s)}));
  }
  const p = await f.profile.get();
  return {...result, profile: p.exists ? {data: p.data(), time: time(p)} : null};
}
const nonterminal = e => e.code === "failed-precondition" && !e.details?.persistedRejection;

for (const scoped of [true, false]) {
  for (const [label, overrides, profile] of [
    ["parent", {productKind: "variantParent", variantSchemaVersion: 1, attributeDefinitions: []}],
    ["parent with definitions only", {attributeDefinitions: []}],
    ["parent missing kind", {variantSchemaVersion: 1, attributeDefinitions: []}],
    ["parent missing version", {productKind: "variantParent", attributeDefinitions: []}],
    ["variant", {variantSchemaVersion: 1, productId: "parent", attributes: {color: "blue"}}],
    ["variant missing discriminator", {productId: "parent", attributes: {}}],
    ["partial kind", {productKind: "simple"}],
    ["mixed simple", {productKind: "simple", variantSchemaVersion: 1, attributes: {}}],
    ["variant identity", {variantId: null}],
    ["malformed marker", {attributeDefinitions: null}],
    ["SDK marker", {attributes: new admin.firestore.GeoPoint(1, 2)}],
    ["nonfinite marker", {variantSchemaVersion: NaN}],
    ["second monetary authority", {priceCents: 10}],
    ["empty profile", {}, {}],
    ["profile", {}, {schemaVersion: 1}],
    ["SDK profile", {}, {ref: db.doc("synthetic/reference")}],
    ["parent with invalid price", {attributeDefinitions: [], price: NaN}],
    ["profile with invalid price", {price: Infinity}, {}],
  ]) test("cadastral domain block " + label + (scoped ? " scoped" : " unscoped"), async () => {
    const f = await fixture(overrides); if (profile !== undefined) await f.profile.set(profile);
    const data = await command(f, undefined, scoped), frozen = structuredClone(data), before = await state(f);
    await assert.rejects(() => send(f, data), nonterminal);
    assert.deepEqual(data, frozen); assert.deepEqual(await state(f), before);
    assert.equal((await query(f, data)).status, "not-recorded");
    assert.equal((await query(f, data)).definitive, false); assert.deepEqual(await state(f), before);
  });
}

test("simple edit preserves frozen command/hash and all operational data", async () => {
  const meta = {point: new admin.firestore.GeoPoint(1, 2), ref: db.doc("synthetic/reference"), bytes: Buffer.from([1]),
    at: new admin.firestore.Timestamp(1900000000, 123456000), n: NaN};
  const f = await fixture({legacy: meta, fiscal: {internal: meta}, lotes: [{quantidade: 5, validade: meta.at, meta}]});
  const before = (await f.product.get()).data(), data = await command(f), frozen = structuredClone(data);
  assert.equal((await send(f, data)).success, true);
  assert.deepEqual((await f.product.get()).data(), {...before, name: "Changed", name_lowercase: "changed"});
  const receipt = (await f.store.collection("auditLogs").get()).docs[0].data();
  const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ?
    Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  assert.equal(receipt.requestHash, createHash("sha256").update(JSON.stringify(canonical(validateUpdateProductV2(frozen)))).digest("hex"));
  assert.deepEqual(data, frozen); assert.equal((await f.store.collection("sales").get()).size, 0);
});

for (const [label, price] of [["NaN", NaN], ["Infinity", Infinity], ["-Infinity", -Infinity], ["string", "bad"],
  ["SDK", new admin.firestore.GeoPoint(1, 2)]]) test("legitimate invalid-price correction " + label, async () => {
  const f = await fixture({price, minimumStock: "bad", fiscal: null, quantidade: "legacy-invalid"});
  const before = (await f.product.get()).data();
  await send(f, await command(f, {set: {price: 2, minimumStock: 0}}));
  assert.deepEqual((await f.product.get()).data(), {...before, price: 2, minimumStock: 0});
  // No unrelated monetary validation: legacy price may also remain invalid.
  const g = await fixture({price, fiscal: null});
  await send(g, await command(g));
  assert.deepEqual((await g.product.get()).data().price, price);
});

test("archived simple supports allowed correction; COD/fiscal terminal errors stay historical", async () => {
  const f = await fixture({isArchived: true, price: NaN});
  await send(f, await command(f, {set: {price: 2}}));
  const data = await command(f, {set: {cod: "NEW"}}), before = await f.product.get();
  await assert.rejects(() => send(f, data), e => e.details.reason === "archived-product-cod-immutable" && e.details.persistedRejection);
  assert.ok((await f.product.get()).updateTime.isEqual(before.updateTime));
});

test("structural and monetary marker patch attempts fail before effects", async () => {
  const f = await fixture(), before = await state(f);
  for (const key of ["productKind", "variantSchemaVersion", "attributeDefinitions", "attributes", "productId", "variantId",
    "priceCents", "costCents", "commercial", "commercialProfiles"]) {
    for (const changes of [{set: {[key]: null}}, {remove: [key]}, {fiscal: {set: {[key]: "x"}}}, {set: {[key + ".x"]: "y"}}]) {
      const data = await command(f, changes);
      await assert.rejects(() => send(f, data), e => e.code === "invalid-argument");
    }
  }
  for (const variantId of [null, undefined, "v"]) {
    const data = await command(f); Object.defineProperty(data, "variantId", {value: variantId});
    await assert.rejects(() => send(f, data), e => e.code === "invalid-argument");
    assert.ok(Object.hasOwn(data, "variantId"));
  }
  assert.deepEqual(await state(f), before);
});

test("confirmed and terminal rejected replays precede later parent/profile and CAS", async () => {
  for (const rejected of [false, true]) {
    const f = await fixture({fiscal: null});
    const data = await command(f, rejected ? {fiscal: {set: {ncm: "123"}}} : undefined);
    if (rejected) await assert.rejects(() => send(f, data), e => e.details.reason === "invalid-current-fiscal" && e.details.persistedRejection);
    else await send(f, data);
    await f.product.update({productKind: "variantParent", variantSchemaVersion: 1, price: NaN}); await f.profile.set({});
    const before = await state(f);
    if (rejected) await assert.rejects(() => send(f, data), e => e.details.reason === "invalid-current-fiscal" && e.details.persistedRejection);
    else assert.equal((await send(f, data)).replayed, true);
    assert.equal((await query(f, data)).status, rejected ? "rejected" : "confirmed");
    assert.deepEqual(await state(f), before);
  }
});

test("CAS remains prior to domain; concurrent edits retain one winner and terminal conflict", async () => {
  const f = await fixture(); const stale = await command(f);
  await f.product.update({attributeDefinitions: []});
  await assert.rejects(() => send(f, stale), e => e.code === "aborted" && e.details.reason === "product-version-conflict" && e.details.persistedRejection);
  const g = await fixture(); const a = await command(g), b = {...a, requestId: randomUUID(), changes: {set: {name: "Other"}}};
  const race = await Promise.allSettled([send(g, a), send(g, b)]);
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(race.find(r => r.status === "rejected").reason.details.reason, "product-version-conflict");
});

test("roles, authorization, membership and revocation guard current state and replay", async () => {
  const f = await fixture(); let valid;
  const unauthenticated = await command(f);
  await assert.rejects(() => updateProductV2.run({data: unauthenticated}), e => e.code === "unauthenticated");
  for (const role of ["admin", "gerente", "operador", "caixa", "vendedor"]) {
    await f.user.update({role}); valid = await command(f, {set: {name: role}}); await send(f, valid);
  }
  const before = await state(f);
  for (const patch of [{role: "viewer"}, {role: "admin", accessStatus: "revoked"}]) {
    await f.user.update(patch); await assert.rejects(() => send(f, valid), e => e.code === "permission-denied");
  }
  await f.user.update({role: "admin", accessStatus: "active"});
  for (const key of ["uid", "storeId", "projectId"]) {
    await assert.rejects(() => send(f, {...valid, scope: {...valid.scope, [key]: "other"}}), e => e.code === "permission-denied");
  }
  const other = await fixture(); await f.user.update({storeId: other.store.id});
  await assert.rejects(() => send(f, valid), e => e.code === "permission-denied");
  assert.deepEqual(await state(f), before);
});

// E2-B originally characterized release; E3-B supersedes only that expectation.
test("E3-B: change/removal retains legacy reservation with cadastral barrier preserved", async () => {
  for (const remove of [false, true]) {
    const f = await fixture({cod: "OLD"});
    await codeRef(f.store, "OLD").set({cod: "OLD", productId: "p"});
    await send(f, await command(f, remove ? {remove: ["cod"]} : {set: {cod: "NEW"}}));
    assert.deepEqual((await codeRef(f.store, "OLD").get()).data(), {cod: "OLD", productId: "p"});
    if (!remove) assert.equal((await codeRef(f.store, "NEW").get()).data().productId, "p");
    assert.equal((await f.product.get()).data().quantidade, 5);
  }
});

test("missing historical COD reservation still rejects without silent repair", async () => {
  const f = await fixture({cod: "MISSING"}), data = await command(f), before = await f.product.get();
  await assert.rejects(() => send(f, data), e => e.code === "failed-precondition" && e.details.persistedRejection);
  assert.ok((await f.product.get()).updateTime.isEqual(before.updateTime));
  assert.equal((await codeRef(f.store, "MISSING").get()).exists, false);
});
