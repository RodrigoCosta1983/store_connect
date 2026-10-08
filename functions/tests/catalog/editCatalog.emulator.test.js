"use strict";

const assert = require("node:assert/strict");
const admin = require("firebase-admin");
const {Timestamp} = require("firebase-admin/firestore");
const {getCatalogForEdit, updateCatalog} = require("../../catalog/createCatalog");

async function run() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080",
      "This test requires the local Firestore Emulator.");
  admin.initializeApp({projectId: "store-connect-app"});
  const db = admin.firestore();
  const uid = `edit-c2-${Date.now()}`;
  const user = db.collection("users").doc(uid);
  const store = db.collection("stores").doc(uid);
  const catalog = store.collection("catalogs").doc("catalog");
  const tokenIndex = db.collection("catalogPublicTokens").doc(uid);
  const expiresAt = new Timestamp(1900000000, 123456789);
  const identity = {
    catalogId: catalog.id,
    publicSlug: "test-slug",
    publicToken: "synthetic-test-token",
    publicTokenHash: "synthetic-test-hash",
    publicTokenEncrypted: {ciphertext: "synthetic-test-ciphertext"},
    createdAt: Timestamp.fromMillis(1000),
    createdByUid: uid,
  };
  const update = (data = {}) => updateCatalog.run({auth: {uid}, data: {
    catalogId: catalog.id, title: "Edited", productIds: ["a"], ...data,
  }});
  const read = (catalogId = catalog.id) => getCatalogForEdit.run({
    auth: {uid}, data: {catalogId},
  });
  const reject = (action, code) => assert.rejects(action, {code});
  const snapshot = async () => ({
    parent: (await catalog.get()).data(),
    items: (await catalog.collection("items").orderBy("position").get())
        .docs.map((doc) => ({id: doc.id, ...doc.data()})),
  });
  try {
    await user.set({role: "operador", accessStatus: "active", storeId: uid});
    await store.set({subscriptionStatus: "active", publicSlug: "test-slug"});
    await tokenIndex.set({storeId: uid, catalogId: catalog.id});
    await catalog.set({...identity, expiresAt, title: "Before", status: "active",
      productCount: 1});
    await catalog.collection("items").doc("old").set({productId: "a", position: 0});
    for (const id of ["a", "b", "c"]) {
      // No name/price/image/category is required; numeric strings are valid.
      await store.collection("products").doc(id).set({quantidade: "2.5"});
    }
    const before = await snapshot();
    await reject(() => update({productIds: ["a/sub/doc"]}), "invalid-argument");
    await reject(() => update({catalogId: "catalog/items/item"}), "invalid-argument");
    await reject(() => read("catalog/items/item"), "invalid-argument");
    await reject(() => update({productIds: Array(201).fill("a")}), "invalid-argument");
    await reject(() => update({productIds: ["missing"]}), "not-found");
    await store.collection("products").doc("bad").set({quantidade: 2, isArchived: true});
    await reject(() => update({productIds: ["bad"]}), "failed-precondition");
    for (const quantidade of [0, -1, null, "", "invalid", NaN, Infinity]) {
      await store.collection("products").doc("bad").set({quantidade});
      await reject(() => update({productIds: ["bad"]}), "failed-precondition");
    }
    await store.collection("products").doc("bad").set({});
    await reject(() => update({productIds: ["bad"]}), "failed-precondition");
    for (const expiresAtIso of [null, "", 123, "invalid",
      new Date(Date.now() - 1000).toISOString(),
      new Date(Date.now() + 31 * 86400000).toISOString()]) {
      await reject(() => update({expiresAtIso}), "invalid-argument");
    }
    assert.deepEqual(await snapshot(), before, "Invalid edits must not write");

    for (const subscriptionStatus of ["inactive", "expired", "canceled", ""]) {
      await store.update({subscriptionStatus});
      await reject(() => update(), "failed-precondition");
      assert.equal((await read()).success, true, "Internal reading remains allowed");
    }
    for (const subscriptionStatus of ["active", "trial", "overdue", " ACTIVE "]) {
      await store.update({subscriptionStatus});
      await update({productIds: [" b ", "a", "b", "c"]});
    }
    const result = await read();
    assert.deepEqual(Object.keys(result).sort(), ["catalog", "success"]);
    assert.deepEqual(Object.keys(result.catalog).sort(), [
      "catalogId",
      "dynamicSections",
      "expiresAt",
      "productCount",
      "productIds",
      "status",
      "title",
    ]);
    assert.deepEqual(result.catalog.productIds, ["b", "a", "c"]);
    assert.deepEqual(result.catalog.dynamicSections, {
      suggestions: {
        enabled: false,
        categoryIds: [],
      },
      offers: {
        enabled: false,
        categoryIds: [],
      },
      completeOrder: {
        enabled: false,
        categoryIds: [],
      },
    });
    assert((await catalog.get()).data().expiresAt.isEqual(before.parent.expiresAt));
    for (const [key, value] of Object.entries(identity)) {
      assert.deepEqual((await catalog.get()).data()[key], value);
    }
    assert.deepEqual((await tokenIndex.get()).data(), {storeId: uid, catalogId: catalog.id});
    assert.equal((await store.get()).data().publicSlug, "test-slug");

    const explicitExpiry = new Date(Date.now() + 86400000).toISOString();
    await update({expiresAtIso: explicitExpiry});
    assert.equal((await read()).catalog.expiresAt, explicitExpiry);

    // Real overlapping SDK transactions, repeated with disjoint item sets.
    for (let round = 0; round < 4; round += 1) {
      const edits = [{title: "A", productIds: ["a"]},
        {title: "BC", productIds: ["b", "c"]}];
      const [first, second, concurrentRead] = await Promise.all([
        update(edits[0]), update(edits[1]), read(),
      ]);
      assert(first.success && second.success);
      const observed = concurrentRead.catalog;
      const expectedRead = observed.title === "BC" ? ["b", "c"] : ["a"];
      assert.deepEqual(observed.productIds, expectedRead);
      assert.equal(observed.productCount, expectedRead.length);
      const final = await snapshot();
      const winner = edits.find((edit) => edit.title === final.parent.title);
      assert(winner);
      assert.deepEqual(final.items.map((item) => item.productId), winner.productIds);
      assert.deepEqual(final.items.map((item) => item.position),
          winner.productIds.map((_, index) => index));
      assert.equal(final.parent.productCount, final.items.length);
    }

    const ids = Array.from({length: 200}, (_, index) => `p${index}`);
    const seed = db.batch();
    ids.forEach((id) => seed.set(store.collection("products").doc(id), {quantidade: 1}));
    await seed.commit();
    await update({productIds: ids});
    await update({productIds: [...ids].reverse()}); // Exactly 401 writes.
    const full = await snapshot();
    assert.equal(full.items.length, 200);
    assert.deepEqual(full.items.map((item) => item.productId), [...ids].reverse());
    assert.deepEqual(full.items.map((item) => item.position), ids.map((_, i) => i));
    await catalog.collection("items").doc("excess").set({productId: "a", position: 200});
    const inconsistent = await snapshot();
    await reject(() => update({productIds: ids}), "failed-precondition");
    assert.deepEqual(await snapshot(), inconsistent);
    for (const [key, value] of Object.entries(identity)) {
      assert.deepEqual(inconsistent.parent[key], value);
    }
    assert.deepEqual((await tokenIndex.get()).data(), {storeId: uid, catalogId: catalog.id});
    console.log("PASS C2: validation, expiry, identity, concurrency, consistent reads, 401-write boundary");
  } finally {
    await db.recursiveDelete(store);
    await user.delete();
    await tokenIndex.delete();
    await admin.app().delete();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
