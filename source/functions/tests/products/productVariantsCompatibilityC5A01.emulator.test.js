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
after(() => db.terminate());
const request = (f, data) => ({auth: {uid: f.uid}, data});
const defs = [{attributeId: "color", label: "Color", values: [{valueId: "blue", label: "Blue"}]}];
async function fixture() {
  const store = db.collection("stores").doc(randomUUID()), uid = randomUUID(), user = db.collection("users").doc(uid);
  const product = store.collection("products").doc("p");
  await store.set({}); await user.set({role: "admin", storeId: store.id});
  return {store, uid, user, product, scope: {projectId: db.projectId, uid, storeId: store.id}};
}
function command(f, kind = "simple", cod = false) {
  return {schemaVersion: 1, scope: f.scope, requestId: randomUUID(), productId: f.product.id,
    product: {productKind: kind, name: "Synthetic", ...(cod ? {cod: " OWN "} : {}),
      ...(kind === "variantParent" ? {attributeDefinitions: defs} : {})}};
}
async function state(f) {
  const queries = await Promise.all([f.store.collection("products").get(), f.store.collection("productCodes").get(),
    f.store.collection("auditLogs").get(), f.product.collection("variants").get(), f.product.collection("variantCombinations").get()]);
  return queries.map(q => q.docs.map(s => ({path: s.ref.path, data: c12.firestoreValue(s.data()), time: c12.firestoreValue(s.updateTime)})));
}
for (const operation of ["createProductC1", "createProductC2"]) {
  for (const kind of ["simple", "variantParent"]) {
    for (const collection of ["variants", "variantCombinations"]) {
      test(`${operation}/${kind} refuses absent root with ${collection}, even archived or malformed`, async () => {
        const f = await fixture(), cmd = command(f, kind, operation.endsWith("C2"));
        const ref = f.product.collection(collection).doc("orphan");
        await ref.set(collection === "variants" ? {variantSchemaVersion: 1, productId: "p", attributes: [],
          isArchived: true, quantidade: 4, lotes: [], historical: "keep"} : {malformed: true});
        assert.equal((await f.product.get()).exists, false);
        const before = await state(f);
        await assert.rejects(() => c12[operation](db, request(f, cmd)), e =>
          e.code === "failed-precondition" && e.details?.reason === "orphan-variant-structure");
        assert.deepEqual(await state(f), before); assert.equal((await f.product.get()).exists, false);
      });
    }
  }
}
test("ordinary C1/C2 simple and parent creation retain command/receipt/defaults/COD semantics", async () => {
  for (const operation of ["createProductC1", "createProductC2"]) {
    for (const kind of ["simple", "variantParent"]) {
      const f = await fixture(), cmd = command(f, kind, operation.endsWith("C2"));
      const expected = c12.localMutationSupport.command("createProductC1", cmd, operation.endsWith("C2"));
      const result = await c12[operation](db, request(f, cmd));
      assert.deepEqual(result, {schemaVersion: 1, productId: "p", variantId: null, status: "created", replayed: false});
      const saved = (await f.product.get()).data();
      assert.equal(saved.productKind, kind); assert.equal(saved.quantidade, 0); assert.deepEqual(saved.lotes, []);
      const receipts = await f.store.collection("auditLogs").get(); assert.equal(receipts.size, 1);
      assert.deepEqual(receipts.docs[0].data().command, expected);
      assert.equal(receipts.docs[0].data().operation, "createProductC1");
      assert.equal(saved.cod, operation.endsWith("C2") ? "OWN" : undefined);
    }
  }
});
test("existing legacy/simple/parent/variant roots cannot be implicitly converted in either direction", async () => {
  for (const stored of [{name: "Legacy", quantidade: 5}, {productKind: "simple", variantSchemaVersion: 1},
    {productKind: "variantParent", variantSchemaVersion: 1, attributeDefinitions: defs},
    {variantSchemaVersion: 1, productId: "parent", attributes: []}]) {
    const f = await fixture(); await f.product.set(stored); const before = await state(f);
    for (const kind of ["simple", "variantParent"]) {
      await assert.rejects(() => c12.createProductC2(db, request(f, command(f, kind, true))), e =>
        e.code === "already-exists" && e.details?.reason === "product-id-conflict");
    }
    assert.deepEqual(await state(f), before);
  }
});
test("historical replay and conflicting identity are resolved before mutable subtree checks", async () => {
  const f = await fixture(), cmd = command(f, "simple", true);
  await c12.createProductC2(db, request(f, cmd));
  await f.product.collection("variants").doc("inconsistent-later-state").set({historical: true});
  const before = await state(f);
  const result = await c12.createProductC2(db, request(f, cmd)); assert.equal(result.replayed, true);
  await assert.rejects(() => c12.createProductC2(db, request(f, {...cmd, product: {...cmd.product, name: "Different"}})),
    e => e.code === "already-exists" && e.details?.reason === "request-identity-conflict");
  assert.deepEqual(await state(f), before);
});
test("revocation precedes orphan reads; failed verification cannot create entity, receipt or COD", async () => {
  const f = await fixture(), cmd = command(f, "simple", true);
  await f.product.collection("variants").doc("orphan").set({});
  await f.user.update({accessStatus: "revoked"});
  await assert.rejects(() => c12.createProductC2(db, request(f, cmd)), {code: "permission-denied"});
  const g = await fixture(), next = command(g, "simple", true), before = await state(g);
  const unavailable = {projectId: db.projectId, _settings: db._settings, collection: db.collection.bind(db),
    runTransaction: fn => db.runTransaction(tx => fn({get: ref => typeof ref.limit === "function" ?
      Promise.reject(new Error("Synthetic subtree read failure")) : tx.get(ref)}))};
  await assert.rejects(() => c12.createProductC2(unavailable, request(g, next)), /Synthetic subtree read failure/);
  assert.deepEqual(await state(g), before);
});
