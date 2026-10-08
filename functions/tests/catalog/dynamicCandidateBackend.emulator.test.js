"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080",
    "Este teste exige o Firestore Emulator local.");
const admin = require("firebase-admin");
const {createCatalog, getCatalogForEdit, updateCatalog, getPublicCatalog,
  submitPublicCatalogSelection} = require("../../catalog/createCatalog");

async function run() {
  const previousKey = process.env.CATALOG_TOKEN_ENCRYPTION_KEY;
  process.env.CATALOG_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  admin.initializeApp({projectId: "store-connect-app"});
  const db = admin.firestore();
  const uid = `dynamic-candidate-${Date.now()}`;
  const user = db.collection("users").doc(uid);
  const store = db.collection("stores").doc(uid);
  const sections = {
    suggestions: {enabled: true, categoryIds: ["suggest"]},
    offers: {enabled: true, categoryIds: ["offer"]},
    completeOrder: {enabled: true, categoryIds: ["complete"]},
  };
  const auth = {uid};
  try {
    await user.set({role: "operador", accessStatus: "active", storeId: uid});
    await store.set({ownerId: uid, subscriptionStatus: "active"});
    for (const [id, parent] of [["root", null], ["suggest", "root"],
      ["offer", "root"], ["complete", "root"]]) {
      await store.collection("categories").doc(id).set({name: id, parentCategoryId: parent});
    }
    for (const [id, categoryIds] of [["main-1", []], ["main-2", []],
      ["shared", ["suggest", "offer"]], ["suggest-2", ["suggest"]],
      ["offer-2", ["offer"]], ["complete-1", ["complete"]], ["complete-2", ["complete"]]]) {
      await store.collection("products").doc(id).set({name: id, categoryIds,
        price: 10, quantidade: 20, isArchived: false});
    }
    const input = {title: "Candidato Functions", productIds: ["main-1", "main-2"],
      expiresInDays: 7, dynamicSections: sections};
    await assert.rejects(() => createCatalog.run({auth, data: {...input,
      dynamicSections: {suggestions: {enabled: true, categoryIds: ["missing"]}}}}),
    (error) => error.code === "invalid-argument" &&
      error.details.reason === "invalid-dynamic-section-categories");
    assert.equal((await store.collection("catalogs").get()).size, 0);
    const created = await createCatalog.run({auth, data: input});
    const publicInput = {publicSlug: created.publicSlug, publicToken: created.publicToken};
    const read = () => getPublicCatalog.run({data: publicInput});
    const before = await read();
    assert.deepEqual(before.products.map((p) => p.productId), ["main-1", "main-2"]);
    assert.deepEqual(before.dynamicSections.map((s) => s.id), ["suggestions", "offers", "completeOrder"]);
    for (const section of before.dynamicSections) assert.equal(section.products.length, 2);
    for (const section of before.dynamicSections.slice(0, 2)) {
      assert.ok(section.products.some((p) => p.productId === "shared"));
    }
    const edit = await getCatalogForEdit.run({auth, data: {catalogId: created.catalogId}});
    assert.deepEqual(edit.catalog.dynamicSections, sections);
    await updateCatalog.run({auth, data: {catalogId: created.catalogId,
      title: "Editado sem alterar seções", productIds: input.productIds}});
    assert.deepEqual((await read()).dynamicSections, before.dynamicSections);
    await assert.rejects(() => updateCatalog.run({auth, data: {catalogId: created.catalogId,
      title: "Inválido", productIds: input.productIds,
      dynamicSections: {suggestions: {enabled: true, categoryIds: ["missing"]}}}}),
    (error) => error.code === "invalid-argument" &&
      error.details.reason === "invalid-dynamic-section-categories");
    assert.deepEqual((await read()).dynamicSections, before.dynamicSections);
    const submitted = await submitPublicCatalogSelection.run({data: {...publicInput,
      requestVersion: 2, customerName: "Cliente Emulator", customerPhone: "11999990000",
      items: [{productId: "main-1", quantity: 1}, {productId: "shared", quantity: 2},
        {productId: "complete-1", quantity: 1}]}});
    assert.equal(submitted.success, true);
    assert.equal(submitted.validatedItemCount, 3);
    assert.equal(submitted.totalUnits, 4);
    assert.equal(submitted.totalAmount, 40);
    const requests = await store.collection("catalogRequests").get();
    assert.equal(requests.size, 1);
    assert.equal((await requests.docs[0].ref.collection("items").get()).size, 3);
    for (const id of ["main-1", "shared", "complete-1"]) {
      assert.equal((await store.collection("products").doc(id).get()).data().quantidade, 20);
    }
    assert.equal((await store.collection("sales").get()).size, 0);
    console.log("PASS E2E candidato: principais=2; suggestions=2; offers=2; completeOrder=2; duplicado entre seções; CAT-H1 create/update; submit misto V2; estoque preservado.");
  } finally {
    if (previousKey === undefined) delete process.env.CATALOG_TOKEN_ENCRYPTION_KEY;
    else process.env.CATALOG_TOKEN_ENCRYPTION_KEY = previousKey;
    for (const collection of ["catalogPublicTokens", "storePublicSlugs"]) {
      const docs = await db.collection(collection).where("storeId", "==", uid).get();
      for (const doc of docs.docs) await doc.ref.delete();
    }
    await db.recursiveDelete(store);
    await user.delete();
    await admin.app().delete();
  }
}

run().catch((error) => {console.error(error); process.exitCode = 1;});
