"use strict";
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
require("../../products/productVariantsC1").localMutationSupport.environment(db);
const {updateProduct} = require("../../products/updateProduct");
const {adjustProductStockV1} = require("../../products/productMutationV2");
const {codeRef} = require("../../products/productCodeReservation");
const time = value => ({seconds: String(value.seconds), nanoseconds: value.nanoseconds});
after(() => db.terminate());
const modes = [{name: "updateProduct"}, {name: "stock-scoped", stock: true, scoped: true},
  {name: "stock-unscoped", stock: true}];
async function fixture(extra = {}) {
  const uid = randomUUID(), store = db.collection("stores").doc(randomUUID()), user = db.collection("users").doc(uid);
  const product = store.collection("products").doc("p");
  await store.set({}); await user.set({role: "admin", storeId: store.id});
  await product.set({name: "Synthetic", price: 10, quantidade: 4, lotes: [], cod: "OLD", ...extra});
  await codeRef(store, "OLD").set({cod: "OLD", ownerType: "product", productId: "p", variantId: null});
  return {uid, user, store, product};
}
async function command(f, mode) {
  return mode.stock ? {schemaVersion: 1, requestId: randomUUID(), productId: "p",
    expectedUpdateTime: time((await f.product.get()).updateTime), reason: "Synthetic count",
    stockChange: {kind: "setManualQuantity", quantity: 9},
    ...(mode.scoped ? {scope: {projectId: db.projectId, uid: f.uid, storeId: f.store.id}} : {})} :
    {requestId: randomUUID(), productId: "p", product: {name: "Changed", price: 12, quantidade: 9,
      lotes: [], minimumStock: 0, imageUrl: "", cod: "NEW"}};
}
const send = (f, mode, data) => (mode.stock ? adjustProductStockV1 : updateProduct).run({auth: {uid: f.uid}, data});
const refused = e => e.code === "failed-precondition" && e.details?.reason === "variant-structure-not-supported" &&
  !e.details?.persistedRejection;
async function state(f) {
  const collections = ["products", "productCodes", "auditLogs"].map(c => f.store.collection(c));
  collections.push(f.product.collection("variants"), f.product.collection("variantCombinations"));
  const queries = await Promise.all(collections.map(c => c.get()));
  return queries.map(q => q.docs.map(s => ({path: s.ref.path, data: s.data(), updateTime: time(s.updateTime)})));
}
// Only test instrumentation of the real SDK transaction; no application bypass.
async function withTransaction(hook, work, beforeAttempt = async () => {}) {
  const original = db.runTransaction;
  let attempt = 0;
  db.runTransaction = (fn, options) => original.call(db, async tx => {
    const current = ++attempt;
    await beforeAttempt(current);
    return fn(new Proxy(tx, {get(target, key) {
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? (...args) => hook(key, args, () => value.apply(target, args), current) : value;
    }}));
  }, options);
  try { return await work(); } finally { db.runTransaction = original; }
}
const collectionOf = ref => ref?._queryOptions?.collectionId;
const childData = archived => ({variantSchemaVersion: 1, productId: "p", attributes: [{attributeId: "color", valueId: "blue"}],
  quantidade: 2, lotes: [], isArchived: archived, cod: "VARIANT", history: {keep: true}});

for (const mode of modes) {
  for (const [label, collection, data] of [
    ["active variant", "variants", childData(false)],
    ["archived variant", "variants", childData(true)],
    ["malformed variant", "variants", {}],
    ["orphan combination", "variantCombinations", {malformed: true}],
  ]) {
    test(`${mode.name} refuses ${label} under unmarked root with no side effects`, async () => {
      const f = await fixture(); await f.product.collection(collection).doc("v").set(data);
      const before = await state(f), dataCommand = await command(f, mode);
      await assert.rejects(() => send(f, mode, dataCommand), refused);
      assert.deepEqual(await state(f), before);
    });
  }
  test(`${mode.name} keeps legitimate legacy and versioned simple payloads and COD behavior`, async () => {
    for (const extra of [{}, {productKind: "simple", variantSchemaVersion: 1, isArchived: false}]) {
      const f = await fixture(extra), data = await command(f, mode), calls = [];
      const result = await withTransaction((method, args, proceed) => {
        if (method === "get" && collectionOf(args[0])) calls.push(collectionOf(args[0]));
        return proceed();
      }, () => send(f, mode, data));
      assert.equal(result.success, true); assert.equal(result.replayed, false);
      assert.ok(calls.includes("variants")); assert.ok(calls.includes("variantCombinations"));
      const saved = (await f.product.get()).data(); assert.equal(saved.quantidade, 9);
      assert.equal(saved.cod, mode.stock ? "OLD" : "NEW");
      assert.equal((await f.store.collection("auditLogs").get()).size, 1);
    }
  });
  test(`${mode.name} confirmed replay and request conflict precede descendant queries`, async () => {
    const f = await fixture(), data = await command(f, mode); await send(f, mode, data);
    await f.product.collection("variants").doc("v").set(childData(true));
    await f.product.collection("variantCombinations").doc("orphan").set({});
    const before = await state(f); let queries = 0;
    await withTransaction((method, args, proceed) => {
      if (method === "get" && collectionOf(args[0])) queries++;
      return proceed();
    }, async () => {
      assert.equal((await send(f, mode, data)).replayed, true);
      const different = mode.stock ? {...data, reason: "Different"} : {...data, product: {...data.product, cod: "OTHER"}};
      await assert.rejects(() => send(f, mode, different), e => e.code === "already-exists");
    });
    assert.equal(queries, 0); assert.deepEqual(await state(f), before);
  });
  test(`${mode.name} failed or inconclusive subtree reads are nonterminal and atomic`, async () => {
    const f = await fixture(), data = await command(f, mode), before = await state(f);
    for (const collection of ["variants", "variantCombinations"]) {
      for (const response of [undefined, null, {}, {empty: true, size: 1, docs: [{}]},
        {empty: true, size: 0, docs: null}, "throw", "https-error"]) {
        let reached = false;
        await withTransaction((method, args, proceed) => {
          if (method === "get" && collectionOf(args[0]) === collection) {
            reached = true;
            if (response === "throw") return Promise.reject(new Error("Synthetic I/O failure"));
            if (response === "https-error") return Promise.reject(new HttpsError("failed-precondition", "Synthetic read error"));
            return Promise.resolve(response);
          }
          return proceed();
        }, () => assert.rejects(() => send(f, mode, data), e => e.code === "unavailable" &&
          e.details?.reason === "variant-structure-read-unavailable" && !e.details?.persistedRejection));
        assert.equal(reached, true); assert.deepEqual(await state(f), before);
      }
    }
    assert.equal((await send(f, mode, data)).success, true); // Same request after read recovery, no sealed rejection.
  });
  test(`${mode.name} authorization and store identity are checked before subtree reads`, async () => {
    const f = await fixture(), other = await fixture(), data = await command(f, mode);
    await other.product.collection("variants").doc("v").set(childData(false));
    // A foreign store with the same product ID must not block this store's simple root.
    assert.equal((await send(f, mode, data)).success, true);
    for (const patch of [{role: "viewer"}, {role: "admin", accessStatus: "revoked"}]) {
      await f.user.update(patch); const before = await state(f); let reads = 0;
      await withTransaction((method, args, proceed) => {
        if (method === "get" && collectionOf(args[0])) reads++;
        return proceed();
      }, () => assert.rejects(() => send(f, mode, data), e => e.code === "permission-denied"));
      assert.equal(reads, 0); assert.deepEqual(await state(f), before);
    }
    await f.user.update({role: "admin", accessStatus: "active"});
    if (mode.scoped) {
      for (const field of ["projectId", "uid", "storeId"]) {
        await assert.rejects(() => send(f, mode, {...data, scope: {...data.scope, [field]: "other"}}), {code: "permission-denied"});
      }
      await f.user.update({storeId: other.store.id});
      await assert.rejects(() => send(f, mode, data), {code: "permission-denied"});
    }
  });
  test(`${mode.name} sees concurrent child insertion after root read but before structure query`, async () => {
    const f = await fixture(), data = await command(f, mode); let inserted = false;
    const before = (await f.product.get()).data();
    await withTransaction((method, args, proceed) => {
      if (method === "get" && collectionOf(args[0]) === "variants" && !inserted) {
        inserted = true;
        return f.product.collection("variants").doc("concurrent").set(childData(false)).then(proceed);
      }
      return proceed();
    }, () => assert.rejects(() => send(f, mode, data), refused));
    assert.equal(inserted, true); assert.deepEqual((await f.product.get()).data(), before);
    assert.equal((await f.store.collection("auditLogs").get()).size, 0);
  });
  test(`${mode.name} insertion racing an empty query serializes; later mutation always refuses`, async () => {
    const f = await fixture(), data = await command(f, mode); let insertion;
    await withTransaction((method, args, proceed) => {
      if (method === "get" && collectionOf(args[0]) === "variants") {
        return proceed().then(snapshot => {
          if (!insertion) insertion = f.product.collection("variants").doc("racing").set(childData(false));
          return snapshot;
        });
      }
      return proceed();
    }, async () => {
      try { assert.equal((await send(f, mode, data)).success, true); }
      catch (error) { assert.ok(refused(error), String(error)); }
    });
    assert.ok(insertion); await insertion;
    const before = await state(f), next = await command(f, mode);
    await assert.rejects(() => send(f, mode, next), refused);
    assert.deepEqual(await state(f), before);
  });
  test(`${mode.name} transaction retry rechecks descendants and rolls back staged COD/stock`, async () => {
    const f = await fixture(), data = await command(f, mode), before = (await f.product.get()).data();
    const oldCode = await codeRef(f.store, "OLD").get();
    let insertion, attempts = 0;
    await withTransaction((method, args, proceed, attempt) => {
      attempts = Math.max(attempts, attempt);
      if (method === "update" && attempt === 1) {
        insertion = f.product.collection("variantCombinations").doc("racing").set({malformed: true});
        throw Object.assign(new Error("Synthetic ABORTED after prepare"), {code: 10});
      }
      return proceed();
    }, () => assert.rejects(() => send(f, mode, data), refused), async attempt => {
      if (attempt > 1) await insertion;
    });
    assert.ok(attempts > 1); await insertion;
    assert.deepEqual((await f.product.get()).data(), before);
    assert.equal((await f.store.collection("auditLogs").get()).size, 0);
    assert.equal((await codeRef(f.store, "NEW").get()).exists, false);
    const preservedCode = await codeRef(f.store, "OLD").get();
    assert.deepEqual(preservedCode.data(), oldCode.data());
    assert.ok(preservedCode.updateTime.isEqual(oldCode.updateTime));
  });
}
test("scoped stock stale baseline and its historical rejected replay retain their terminal contract", async () => {
  const mode = modes[1], f = await fixture(), data = await command(f, mode);
  await f.product.update({name: "Later"});
  await assert.rejects(() => send(f, mode, data), e => e.code === "aborted" && e.details?.persistedRejection === true);
  await f.product.collection("variants").doc("later").set(childData(false));
  const before = await state(f);
  await assert.rejects(() => send(f, mode, data), e => e.code === "aborted" && e.details?.persistedRejection === true);
  assert.deepEqual(await state(f), before);
});
