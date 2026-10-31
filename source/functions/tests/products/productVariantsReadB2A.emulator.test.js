"use strict";
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const admin = require("firebase-admin");
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(localhost|127\.0\.0\.1):\d+$/);
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
const c12 = require("../../products/productVariantsC1");
const c3 = require("../../products/productVariantsC3");
const api = require("../../products/productVariantsReadB2A");
const {codeRef} = require("../../products/productCodeReservation");
after(() => db.terminate());
const time = c12.firestoreValue;
const req = (f, data) => ({auth: {uid: f.uid}, data});
const query = (f, operation, command, database = db) => api.queryVariantReceiptB2A(database, req(f, {operation, command}));
const read = (f, database = db) => api.readVariantStateB2A(database, req(f,
  {scope: f.scope, productId: f.parent.id, variantId: f.variant.id}));
const receipt = (f, cmd) => f.store.collection("auditLogs").doc("f10-c1-" + c12.localMutationSupport.hash([f.uid, cmd.requestId]));
async function fixture(cod = true) {
  const store = db.collection("stores").doc(randomUUID()), uid = randomUUID();
  const user = db.collection("users").doc(uid);
  await store.set({}); await user.set({role: "admin", storeId: store.id});
  const scope = {projectId: db.projectId, uid, storeId: store.id};
  const parent = store.collection("products").doc(randomUUID()), variant = parent.collection("variants").doc(randomUUID());
  const f = {store, uid, user, scope, parent, variant};
  f.p = {schemaVersion: 1, scope, requestId: randomUUID(), productId: parent.id,
    product: {productKind: "variantParent", name: "Synthetic", ...(cod ? {cod: " p "} : {}),
      attributeDefinitions: [{attributeId: "color", label: "Color", values: [{valueId: "red", label: "Red"}]}]}};
  await c12[cod ? "createProductC2" : "createProductC1"](db, req(f, f.p));
  f.v = {schemaVersion: 1, scope, requestId: randomUUID(), productId: parent.id, variantId: variant.id,
    expectedProductUpdateTime: time((await parent.get()).updateTime),
    variant: {attributes: [{attributeId: "color", valueId: "red"}], ...(cod ? {cod: " v "} : {})}};
  await c12[cod ? "createVariantC2" : "createVariantC1"](db, req(f, f.v));
  return f;
}
async function stockCommand(f, archive = false) {
  return {schemaVersion: 1, requestId: randomUUID(), scope: f.scope, productId: f.parent.id, variantId: f.variant.id,
    expectedProductUpdateTime: time((await f.parent.get()).updateTime),
    expectedVariantUpdateTime: time((await f.variant.get()).updateTime), reason: " synthetic ",
    ...(archive ? {} : {stockChange: {kind: "setManualQuantity", quantity: 7}})};
}
test("C1 historical creation receipts and exact original baselines remain compatible", async () => {
  const f = await fixture(false);
  for (const [op, cmd] of [["createProductC1", f.p], ["createVariantC1", f.v]]) {
    const result = await query(f, op, cmd);
    assert.equal(result.status, "confirmed"); assert.equal(result.receipt.data.result.status, "created");
    assert.equal(Object.hasOwn(result.receipt.data.result, "requestId"), false);
  }
});
test("C2 alias uses C1 persisted operation, raw COD and input omission semantics", async () => {
  const f = await fixture();
  for (const [op, cmd, saved] of [["createProductC2", f.p, "createProductC1"], ["createVariantC2", f.v, "createVariantC1"]]) {
    const result = await query(f, op, cmd); assert.equal(result.status, "confirmed");
    assert.equal(result.persistedOperation, saved);
  }
  assert.equal((await query(f, "createVariantC2", {...f.v, variant: {...f.v.variant, cod: "V"}})).status, "identity-conflict");
  assert.equal((await query(f, "createVariantC2", {...f.v, variant: {attributes: f.v.variant.attributes}})).status, "identity-conflict");
});
test("C3 adjustment and archive receipts are confirmed independently of later entity state", async () => {
  const f = await fixture(), s = await stockCommand(f);
  await c3.adjustVariantStockC3(db, req(f, s));
  const a = await stockCommand(f, true); await c3.archiveVariantC3(db, req(f, a));
  await f.parent.update({isArchived: true, name: "Later state"});
  for (const [op, cmd] of [["adjustVariantStockC3", s], ["archiveVariantC3", a], ["createVariantC2", f.v]]) {
    assert.equal((await query(f, op, cmd)).status, "confirmed");
  }
  const state = await read(f); assert.equal(state.status, "available");
  assert.equal(state.variant.data.quantidade, 7); assert.equal(state.variant.data.isArchived, true);
  assert.equal(state.parent.isSellable, false);
});
test("archive no-op receipt and stock no-op preserve their changed flag", async () => {
  const f = await fixture(); let s = await stockCommand(f); s.stockChange.quantity = 0;
  await c3.adjustVariantStockC3(db, req(f, s));
  assert.equal((await query(f, "adjustVariantStockC3", s)).receipt.data.result.changed, false);
  let a = await stockCommand(f, true); await c3.archiveVariantC3(db, req(f, a));
  a = await stockCommand(f, true); await c3.archiveVariantC3(db, req(f, a));
  assert.equal((await query(f, "archiveVariantC3", a)).receipt.data.result.changed, false);
});
test("state reads preserve exact tokens, unknown maps and native SDK values", async () => {
  const f = await fixture(); const expiry = new admin.firestore.Timestamp(2000000000, 123456789);
  await f.parent.update({future: {nil: null, reference: f.variant, bytes: Buffer.from([1, 2])}});
  await f.variant.update({quantidade: 3, lotes: [{quantidade: 3, validade: expiry, future: {geo: new admin.firestore.GeoPoint(1, 2)}}]});
  const result = await read(f); assert.equal(result.status, "available");
  assert.deepEqual(result.parent.updateTime, time((await f.parent.get()).updateTime));
  assert.deepEqual(result.variant.updateTime, time((await f.variant.get()).updateTime));
  assert.deepEqual(result.variant.data.lotes[0].validade, time((await f.variant.get()).data().lotes[0].validade));
  assert.equal(result.variant.data.lotes[0].validade.nanoseconds, 123456000);
  assert.deepEqual(time(expiry), {seconds: "2000000000", nanoseconds: 123456789});
  assert.equal(result.parent.data.future.reference.firestoreReference, f.variant.path);
  assert.equal(result.parent.data.future.bytes.firestoreBytesBase64, "AQI=");
  assert.deepEqual(result.variant.data.lotes[0].future.geo, {latitude: 1, longitude: 2});
});
test("native lot adjustment audit retains metadata and can be verified", async () => {
  const f = await fixture(); await f.variant.update({quantidade: 2, lotes: [{quantidade: 2,
    validade: new admin.firestore.Timestamp(2000000000, 123456789), unknown: {value: "retain"}}]});
  const cmd = await stockCommand(f); cmd.stockChange = {kind: "editLots", operations: [{op: "update", index: 0, set: {quantidade: 4}}]};
  await c3.adjustVariantStockC3(db, req(f, cmd));
  assert.equal((await query(f, "adjustVariantStockC3", cmd)).status, "confirmed");
});
test("legacy COD ownership is read without migration", async () => {
  const f = await fixture(); const ref = codeRef(f.store, "P");
  await ref.set({cod: "P", productId: f.parent.id}); const before = await ref.get();
  assert.equal((await read(f)).status, "available");
  assert.ok((await ref.get()).updateTime.isEqual(before.updateTime));
});
test("absence, failed writer and missing entities remain unknown", async () => {
  const f = await fixture(), cmd = await stockCommand(f);
  assert.deepEqual(await query(f, "adjustVariantStockC3", cmd), {status: "unknown", reason: "receipt-absent"});
  cmd.expectedVariantUpdateTime.nanoseconds = (cmd.expectedVariantUpdateTime.nanoseconds + 1000) % 1000000000;
  await assert.rejects(() => c3.adjustVariantStockC3(db, req(f, cmd)), {code: "aborted"});
  assert.equal((await query(f, "adjustVariantStockC3", cmd)).status, "unknown");
  assert.equal((await api.readVariantStateB2A(db, req(f, {scope: f.scope, productId: f.parent.id, variantId: "absent"}))).status, "unknown");
});
test("different operation, baseline, command and entity cannot prove success", async () => {
  const f = await fixture(), s = await stockCommand(f); await c3.adjustVariantStockC3(db, req(f, s));
  const a = {...s}; delete a.stockChange;
  for (const [op, cmd] of [["archiveVariantC3", a], ["adjustVariantStockC3", {...s, reason: "different"}],
    ["adjustVariantStockC3", {...s, variantId: "other"}],
    ["adjustVariantStockC3", {...s, expectedVariantUpdateTime: {seconds: "1", nanoseconds: 0}}]]) {
    const result = await query(f, op, cmd); assert.equal(result.status, "identity-conflict");
    assert.equal(Object.hasOwn(result, "receipt"), false);
  }
});
test("store, project and uid scopes cannot be supplied as authority", async () => {
  const f = await fixture(), other = await fixture();
  for (const scope of [{...f.scope, storeId: other.scope.storeId}, {...f.scope, uid: other.uid}, {...f.scope, projectId: "demo-other"}]) {
    assert.equal((await query(f, "createVariantC2", {...f.v, scope})).status, "access-denied");
    assert.equal((await api.readVariantStateB2A(db, req(f, {scope, productId: f.parent.id, variantId: f.variant.id}))).status, "access-denied");
  }
  const valid = {...f.v, scope: other.scope}; assert.equal((await query(other, "createVariantC2", valid)).status, "unknown");
});
test("authorization and revocation checked on every confirmed replay and state read", async () => {
  const f = await fixture(); assert.equal((await query(f, "createVariantC2", f.v)).status, "confirmed");
  await f.user.update({accessStatus: "revoked"});
  assert.equal((await read(f)).status, "access-denied");
  assert.equal((await query(f, "createVariantC2", f.v)).status, "access-denied");
  await f.user.update({accessStatus: "active", role: "unknown"});
  assert.equal((await query(f, "createVariantC2", f.v)).status, "access-denied");
  assert.equal((await api.readVariantStateB2A(db, {data: {scope: f.scope, productId: f.parent.id, variantId: f.variant.id}})).status, "access-denied");
});
test("archive receipt requires current admin permission", async () => {
  const f = await fixture(), a = await stockCommand(f, true); await c3.archiveVariantC3(db, req(f, a));
  await f.user.update({role: "operador"});
  assert.equal((await query(f, "archiveVariantC3", a)).status, "access-denied");
  assert.equal((await read(f)).status, "available");
});
test("corrupt receipt envelope, command, result and timestamps fail closed", async () => {
  const f = await fixture(), ref = receipt(f, f.v), original = (await ref.get()).data();
  const variants = [{...original, schemaVersion: 2}, {...original, operation: "createVariantC2"},
    {...original, createdAt: "now"}, {...original, result: {...original.result, replayed: true}},
    {...original, result: {...original.result, variantId: "wrong"}},
    {...original, command: {...original.command, unexpected: true}}];
  for (const raw of variants) {
    await ref.set(raw); assert.equal((await query(f, "createVariantC2", f.v)).status, "inconsistent-state");
  }
});
test("corrupt C3 audit cannot be accepted as success", async () => {
  const f = await fixture(), s = await stockCommand(f); await c3.adjustVariantStockC3(db, req(f, s));
  const ref = receipt(f, s), raw = (await ref.get()).data();
  for (const change of [{audit: {...raw.audit, reason: "wrong"}},
    {audit: {...raw.audit, after: {...raw.audit.after, quantidade: 99}}}, {result: {...raw.result, changed: false}}]) {
    await ref.set({...raw, ...change}); assert.equal((await query(f, "adjustVariantStockC3", s)).status, "inconsistent-state");
  }
});
test("malformed stock, attributes, archive and COD reservations are inconsistent", async () => {
  for (const update of [{quantidade: -1}, {quantidade: 1, lotes: [{quantidade: 2, validade: admin.firestore.Timestamp.now()}]},
    {attributes: []}, {isArchived: null}, {cod: " v "}, {productId: "wrong"}]) {
    const f = await fixture(); await f.variant.update(update); assert.equal((await read(f)).status, "inconsistent-state");
  }
  const f = await fixture(); await codeRef(f.store, "V").update({variantId: "wrong"});
  assert.equal((await read(f)).status, "inconsistent-state");
});
test("combination reservation corruption is not silently repaired", async () => {
  const f = await fixture(); const refs = await f.parent.collection("variantCombinations").get();
  await refs.docs[0].ref.update({variantId: "wrong"});
  assert.equal((await read(f)).status, "inconsistent-state");
  assert.equal((await refs.docs[0].ref.get()).data().variantId, "wrong");
});
test("concurrent operation and receipt lookup yield only unknown or confirmed", async () => {
  const f = await fixture(), s = await stockCommand(f);
  const results = await Promise.all([c3.adjustVariantStockC3(db, req(f, s)), ...Array.from({length: 4}, () => query(f, "adjustVariantStockC3", s))]);
  for (const r of results.slice(1)) assert.ok(["unknown", "confirmed"].includes(r.status));
  assert.equal((await query(f, "adjustVariantStockC3", s)).status, "confirmed");
});
test("concurrent revocation never grants access after committed revocation", async () => {
  const f = await fixture(); const results = await Promise.all([
    f.user.update({accessStatus: "revoked"}), query(f, "createVariantC2", f.v), read(f)]);
  assert.ok(["confirmed", "access-denied"].includes(results[1].status));
  assert.ok(["available", "access-denied"].includes(results[2].status));
  assert.equal((await query(f, "createVariantC2", f.v)).status, "access-denied");
});
test("read timeouts and failures remain unknown and perform no writes", async () => {
  const f = await fixture();
  for (const code of [4, "deadline-exceeded", "unavailable", 10]) {
    const fake = {projectId: db.projectId, _settings: db._settings, runTransaction: async () => { throw Object.assign(new Error("synthetic"), {code}); }};
    assert.equal((await read(f, fake)).status, "unknown");
    assert.equal((await query(f, "createVariantC2", f.v, fake)).status, "unknown");
  }
  const before = await Promise.all([f.parent.get(), f.variant.get(), receipt(f, f.v).get()]);
  const readonly = {projectId: db.projectId, _settings: db._settings, collection: db.collection.bind(db),
    runTransaction: (fn) => db.runTransaction((tx) => fn({get: tx.get.bind(tx)}))};
  assert.equal((await read(f, readonly)).status, "available");
  assert.equal((await query(f, "createVariantC2", f.v, readonly)).status, "confirmed");
  const after = await Promise.all([f.parent.get(), f.variant.get(), receipt(f, f.v).get()]);
  before.forEach((s, i) => { assert.ok(s.updateTime.isEqual(after[i].updateTime)); assert.deepEqual(s.data(), after[i].data()); });
});
test("input is snapshotted before awaiting, and invalid commands fail before I/O", async () => {
  const f = await fixture(), cmd = structuredClone(f.v), pending = query(f, "createVariantC2", cmd);
  cmd.variant.cod = "changed"; cmd.scope.uid = "other";
  assert.equal((await pending).status, "confirmed");
  await assert.rejects(() => query(f, "createVariantC2", {...f.v, variant: {...f.v.variant, cod: null}}), {code: "invalid-argument"});
  await assert.rejects(() => query(f, "unknown", f.v), {code: "invalid-argument"});
  await assert.rejects(() => read(f, {...db, projectId: "production"}), {code: "failed-precondition"});
});
test("parent-only read exposes definitions and exact baseline without vendable inventory", async () => {
  const f = await fixture(); await f.parent.update({quantidade: 123, future: "retain"});
  const result = await api.readVariantStateB2A(db, req(f, {scope: f.scope, productId: f.parent.id}));
  assert.equal(result.status, "available"); assert.equal(result.parent.isSellable, false);
  assert.equal(result.parent.data.quantidade, 123); assert.equal(result.parent.data.future, "retain");
  assert.equal(Object.hasOwn(result, "variant"), false); assert.equal(result.identity.variantId, null);
  assert.deepEqual(result.parent.updateTime, time((await f.parent.get()).updateTime));
});
test("empty and whitespace COD remain distinct frozen commands", async () => {
  const f = await fixture(false); const cmd = {...f.p, requestId: randomUUID(), productId: randomUUID(),
    product: {productKind: "simple", name: "Synthetic", cod: "   "}};
  await c12.createProductC2(db, req(f, cmd));
  assert.equal((await query(f, "createProductC2", cmd)).status, "confirmed");
  for (const product of [{productKind: "simple", name: "Synthetic"}, {...cmd.product, cod: ""}]) {
    assert.equal((await query(f, "createProductC2", {...cmd, product})).status, "identity-conflict");
  }
});
test("receipt command uid, project and store are bound to the authorized intention", async () => {
  const f = await fixture(), ref = receipt(f, f.v), original = (await ref.get()).data();
  for (const scope of [{...f.scope, uid: "other"}, {...f.scope, storeId: "other"}, {...f.scope, projectId: "demo-other"}]) {
    await ref.set({...original, command: {...original.command, scope}});
    assert.equal((await query(f, "createVariantC2", f.v)).status, "identity-conflict");
  }
});
test("receipt proof is independent of missing entity, while state remains unknown", async () => {
  const f = await fixture();
  // Simulate missing snapshot without deleting even synthetic documents.
  const fake = {projectId: db.projectId, _settings: db._settings, collection: db.collection.bind(db),
    runTransaction: (fn) => db.runTransaction((tx) => fn({get: (ref) => ref.path === f.variant.path ?
      Promise.resolve({exists: false}) : tx.get(ref)}))};
  assert.equal((await read(f, fake)).status, "unknown");
  assert.equal((await query(f, "createVariantC2", f.v, fake)).status, "confirmed");
});
test("failed receipt read after authorization remains unknown", async () => {
  const f = await fixture(); const fake = {projectId: db.projectId, _settings: db._settings, collection: db.collection.bind(db),
    runTransaction: (fn) => db.runTransaction((tx) => fn({get: (ref) => ref.path.includes("/auditLogs/") ?
      Promise.reject(Object.assign(new Error("synthetic timeout"), {code: 4})) : tx.get(ref)}))};
  assert.equal((await query(f, "createVariantC2", f.v, fake)).status, "unknown");
});
test("parallel state reads and stock adjustment preserve an atomic snapshot", async () => {
  const f = await fixture(), s = await stockCommand(f), before = await f.variant.get();
  const results = await Promise.all([c3.adjustVariantStockC3(db, req(f, s)), ...Array.from({length: 4}, () => read(f))]);
  const after = await f.variant.get();
  for (const r of results.slice(1)) {
    assert.equal(r.status, "available");
    if (r.variant.data.quantidade === 0) assert.deepEqual(r.variant.updateTime, time(before.updateTime));
    else { assert.equal(r.variant.data.quantidade, 7); assert.deepEqual(r.variant.updateTime, time(after.updateTime)); }
  }
});
