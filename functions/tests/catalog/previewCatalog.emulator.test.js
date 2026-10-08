"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const admin = require("firebase-admin");
const {DocumentReference, WriteBatch, Transaction} = require("@google-cloud/firestore");
const {previewCatalog, getPublicCatalog} = require("../../catalog/createCatalog");

async function run() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  admin.initializeApp({projectId: "store-connect-app"});
  const db = admin.firestore();
  const uid = `preview-${Date.now()}`;
  const store = db.collection("stores").doc(uid);
  const user = db.collection("users").doc(uid);
  const sections = Object.fromEntries(["suggestions", "offers", "completeOrder"]
      .map((id) => [id, {enabled: true, categoryIds: [id]}]));
  const draft = {title: "Draft", productIds: ["main"], expiresInDays: 7,
    dynamicSections: sections};
  await user.set({storeId: uid, role: "operador", accessStatus: "active"});
  await store.set({name: "Preview store", subscriptionStatus: "active", publicSlug: uid});
  for (const role of ["admin", "gerente", "invalid", "revoked"]) {
    await db.collection("users").doc(`${uid}-${role}`).set({storeId: uid,
      role: role === "revoked" ? "admin" : role,
      accessStatus: role === "revoked" ? "revoked" : "active"});
  }
  const inactiveStore = db.collection("stores").doc(`${uid}-inactive`);
  await inactiveStore.set({subscriptionStatus: "expired"});
  await db.collection("users").doc(`${uid}-inactive`).set({
    role: "admin", storeId: inactiveStore.id,
  });
  await store.collection("products").doc("main").set({
    name: "Principal", price: 15.99, quantidade: 5, categoryIds: ["suggestions"],
  });
  for (const id of Object.keys(sections)) {
    await store.collection("categories").doc(id).set({parentCategoryId: null});
    await store.collection("products").doc(id).set({
      name: id, price: 7.25, quantidade: 3, categoryIds: [id],
    });
  }
  await store.collection("categories").doc("deep").set({parentCategoryId: "child"});
  await store.collection("categories").doc("child").set({parentCategoryId: "suggestions"});
  await store.collection("products").doc("archived").set({quantidade: 2, isArchived: true});
  await store.collection("products").doc("empty").set({quantidade: 0});
  await store.collection("products").doc("hidden").set({
    quantidade: 0, categoryIds: ["offers"],
  });
  const token = `PreviewFixture_${uid}_ABCDEFGHIJKLMNOPQRSTUVWXYZ`;
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const catalog = store.collection("catalogs").doc("existing");
  await catalog.set({title: draft.title, status: "active", publicTokenHash: hash,
    updatedAt: admin.firestore.Timestamp.now(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 86400000),
    dynamicSections: sections});
  await catalog.collection("items").doc("main").set({productId: "main", position: 0});
  await db.collection("catalogPublicTokens").doc(hash).set({storeId: uid, catalogId: catalog.id});
  const before = (await catalog.get()).data();
  const storeBefore = (await store.get()).data();
  const restore = [];
  let writes = 0;
  const guard = (target, name) => {
    const original = target[name];
    target[name] = function() { writes++; throw new Error(`Forbidden write: ${name}`); };
    restore.push(() => { target[name] = original; });
  };
  for (const target of [DocumentReference.prototype, WriteBatch.prototype, Transaction.prototype]) {
    for (const method of ["set", "create", "update", "delete"]) guard(target, method);
  }
  for (const method of ["batch", "runTransaction", "bulkWriter"]) guard(db, method);
  // Firestore transport itself needs entropy; only reject catalog allocation.
  const randomBytes = crypto.randomBytes;
  crypto.randomBytes = function(...args) {
    if (/generatePublicToken|ensurePublicStoreSlug/.test(new Error().stack)) {
      throw new Error("Preview attempted to allocate a public identity");
    }
    return randomBytes.apply(this, args);
  };
  restore.push(() => { crypto.randomBytes = randomBytes; });
  let passed = 0;
  const preview = (data = draft, actor = uid) => previewCatalog.run({auth: {uid: actor}, data});
  const rejects = (action, code, reason) => assert.rejects(action, (error) => {
    assert.equal(error.code, code);
    if (reason) assert.equal(error.details.reason, reason);
    return true;
  });
  const test = async (name, action) => {
    await action();
    assert.equal(writes, 0, "Preview must never attempt writes or generate tokens");
    passed++;
    console.log(`PASS ${name}`);
  };
  try {
    await test("unauthenticated / zero writes", () => rejects(
        () => previewCatalog.run({data: draft}), "unauthenticated"));
    await test("missing user / zero writes", () => rejects(
        () => preview(draft, "missing-preview-user"), "permission-denied"));
    for (const role of ["invalid", "revoked"]) await test(`${role} denied`, () => rejects(
        () => preview(draft, `${uid}-${role}`), "permission-denied"));
    await test("inactive subscription", () => rejects(
        () => preview(draft, `${uid}-inactive`), "failed-precondition"));
    for (const role of ["admin", "gerente"]) await test(`${role} authorized`, async () => {
      assert.equal((await preview(draft, `${uid}-${role}`)).success, true);
    });
    await test("missing product", () => rejects(
        () => preview({...draft, productIds: ["missing"]}), "not-found"));
    for (const id of ["archived", "empty"]) await test(`${id} product rejected`, () => rejects(
        () => preview({...draft, productIds: [id]}), "failed-precondition"));
    await test("invalid sections normalization", () => rejects(
        () => preview({...draft, dynamicSections: {unknown: {}}}), "invalid-argument"));
    for (const id of ["missing", "deep"]) await test(`CAT-H1 ${id}`, () => rejects(
        () => preview({...draft, dynamicSections: {offers: {enabled: true, categoryIds: [id]}}}),
        "invalid-argument", "invalid-dynamic-section-categories"));
    await test("valid draft / main products / three sections / zero writes", async () => {
      const result = await preview();
      assert.equal(result.success, true);
      assert.deepEqual(result.products.map((p) => p.productId), ["main"]);
      assert.equal(result.products[0].price, 15.99);
      assert.deepEqual(result.dynamicSections.map((s) => s.id), Object.keys(sections));
      for (const section of result.dynamicSections) {
        assert.deepEqual(section.products.map((p) => p.productId), [section.id]);
      }
      for (const key of ["catalogId", "publicToken", "publicSlug", "expiresAt", "updatedAt"])
        assert.equal(result[key], undefined);
      assert.equal(result.catalog.expiresAt, undefined);
    });
    await test("existing public resolver parity / exact prices and order", async () => {
      const result = await preview();
      const publicResult = await getPublicCatalog.run({data: {publicSlug: uid, publicToken: token}});
      assert.deepEqual(result.products, publicResult.products);
      assert.deepEqual(result.dynamicSections, publicResult.dynamicSections);
    });
    await test("disabled sections / default normalization", async () => {
      assert.deepEqual((await preview({...draft, dynamicSections: {}})).dynamicSections, []);
    });
    await test("invalid title and validity / zero writes", async () => {
      await rejects(() => preview({...draft, title: ""}), "invalid-argument");
      await rejects(() => preview({...draft, expiresInDays: 0}), "invalid-argument");
    });
    await test("existing catalog, items, dates and store unchanged", async () => {
      assert.deepEqual((await catalog.get()).data(), before);
      assert.deepEqual((await store.get()).data(), storeBefore);
      assert.equal((await store.collection("catalogs").get()).size, 1);
      assert.equal((await catalog.collection("items").get()).size, 1);
    });
    console.log(`Preview backend: ${passed}/${passed}`);
  } finally {
    restore.reverse().forEach((action) => action());
    await db.recursiveDelete(store);
    await inactiveStore.delete();
    await user.delete();
    for (const role of ["admin", "gerente", "invalid", "revoked", "inactive"])
      await db.collection("users").doc(`${uid}-${role}`).delete();
    await db.collection("catalogPublicTokens").doc(hash).delete();
    await admin.app().delete();
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
