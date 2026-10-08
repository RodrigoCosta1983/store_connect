"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const admin = require("firebase-admin");
const {Transaction} = require("@google-cloud/firestore");
const {createCatalog, updateCatalog} = require("../../catalog/createCatalog");
const {validateDynamicSectionsInput} = require("../../catalog/catalogDynamicSections");

async function run() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  admin.initializeApp({projectId: "store-connect-app"});
  const db = admin.firestore();
  const uid = `cat-h1-${Date.now()}`;
  const store = db.collection("stores").doc(uid);
  const user = db.collection("users").doc(uid);
  const catalog = store.collection("catalogs").doc("edit");
  const originalKey = process.env.CATALOG_TOKEN_ENCRYPTION_KEY;
  process.env.CATALOG_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  const reads = [];
  const operations = [];
  const transactionMethods = {};
  for (const method of ["get", "set", "create", "update", "delete"]) {
    transactionMethods[method] = Transaction.prototype[method];
    Transaction.prototype[method] = function(...args) {
      operations.push({transaction: this, method});
      return transactionMethods[method].apply(this, args);
    };
  }
  const dbGetAll = db.getAll;
  const transactionGetAll = Transaction.prototype.getAll;
  const record = (refs, kind) => refs.forEach((ref) => {
    if (ref.path && ref.path.startsWith(`${store.path}/categories/`)) {
      reads.push({id: ref.id, kind});
    }
  });
  db.getAll = function(...refs) {
    record(refs, "db");
    return dbGetAll.apply(this, refs);
  };
  Transaction.prototype.getAll = function(...refs) {
    operations.push({transaction: this, method: "getAll"});
    record(refs, "transaction");
    return transactionGetAll.apply(this, refs);
  };
  const config = (ids, extra = {}) => ({
    suggestions: {enabled: true, categoryIds: ids}, ...extra,
  });
  const create = (sections) => createCatalog.run({auth: {uid}, data: {
    title: "CAT-H1", productIds: ["product"], expiresInDays: 7,
    ...(sections === undefined ? {} : {dynamicSections: sections}),
  }});
  const update = (sections) => updateCatalog.run({auth: {uid}, data: {
    catalogId: catalog.id, title: "CAT-H1 edited", productIds: ["product"],
    ...(sections === undefined ? {} : {dynamicSections: sections}),
  }});
  const invalid = async (action) => {
    await assert.rejects(action, (error) => {
      assert.equal(error.code, "invalid-argument");
      assert.equal(error.details.reason, "invalid-dynamic-section-categories");
      return true;
    });
  };
  let passed = 0;
  const test = async (name, action) => {
    reads.length = 0;
    operations.length = 0;
    await action();
    passed += 1;
    console.log(`PASS ${name}`);
  };
  try {
    await user.set({role: "operador", accessStatus: "active", storeId: uid});
    await store.set({subscriptionStatus: "active"});
    await store.collection("products").doc("product").set({quantidade: 2});
    for (const [id, data] of Object.entries({
      root: {}, root2: {parentCategoryId: null},
      child: {parentCategoryId: "root"}, deep: {parentCategoryId: "child"},
      self: {parentCategoryId: "self"}, orphan: {parentCategoryId: "missing"},
      malformed: {parentCategoryId: 42},
    })) await store.collection("categories").doc(id).set(data);
    await catalog.set({title: "Before", productCount: 1});
    await catalog.collection("items").doc("old").set({productId: "product", position: 0});

    await test("create omitted", async () => {
      const result = await create();
      assert.equal(reads.length, 0);
      assert.deepEqual((await store.collection("catalogs").doc(result.catalogId).get()).data().dynamicSections,
          validateDynamicSectionsInput({}));
    });
    await test("create all-disabled", async () => {
      await create({}); assert.equal(reads.length, 0);
    });
    await test("create all-disabled preserves IDs without category reads", async () => {
      const value = {suggestions: {enabled: false, categoryIds: ["missing", "deep"]}};
      const result = await create(value);
      assert.equal(reads.length, 0);
      assert.deepEqual((await store.collection("catalogs").doc(result.catalogId).get()).data().dynamicSections,
          validateDynamicSectionsInput(value));
    });
    await test("create enabled without IDs requires zero reads", async () => {
      await assert.rejects(() => create(config([])), (error) => {
        assert.equal(error.code, "invalid-argument");
        assert.equal(error.details.reason, "active-section-without-category");
        return true;
      });
      assert.equal(reads.length, 0);
    });
    await test("create valid root and child, deduplicated parent", async () => {
      await create(config(["child", "root"]));
      assert.deepEqual(reads.map((r) => r.id).sort(), ["child", "root"]);
    });
    await test("create nonexistent without writes, including slug", async () => {
      await store.update({publicSlug: admin.firestore.FieldValue.delete()});
      const before = (await store.collection("catalogs").get()).size;
      await invalid(() => create(config(["missing"])));
      assert.equal((await store.collection("catalogs").get()).size, before);
      assert.equal((await store.get()).data().publicSlug, undefined);
    });
    for (const id of ["deep", "self", "orphan", "malformed"]) {
      await test(`create invalid hierarchy ${id}`, () => invalid(() => create(config([id]))));
    }
    await test("create shared IDs across sections", async () => {
      await create(config(["child"], {offers: {enabled: true, categoryIds: ["child"]}}));
      assert.deepEqual(reads.map((r) => r.id).sort(), ["child", "root"]);
    });
    await test("create enabled validates disabled persisted IDs", () => invalid(() => create(config(["root"], {
      offers: {enabled: false, categoryIds: ["missing"]},
    }))));

    const stale = validateDynamicSectionsInput(config(["missing", "root"]));
    await catalog.update({dynamicSections: stale});
    await test("update omitted preserves stale", async () => {
      await update(); assert.equal(reads.length, 0);
      assert.deepEqual((await catalog.get()).data().dynamicSections, stale);
    });
    await test("update normalized equal preserves stale and ordering", async () => {
      await update(config(["root", "missing"])); assert.equal(reads.length, 0);
      assert.deepEqual((await catalog.get()).data().dynamicSections, stale);
    });
    await test("update changed valid uses transaction and deduplicates", async () => {
      const value = config(["child"], {offers: {enabled: true, categoryIds: ["child", "root2"]}});
      await update(value);
      assert.deepEqual(reads.map((r) => r.id).sort(), ["child", "root", "root2"]);
      assert.ok(reads.every((r) => r.kind === "transaction"));
      const transactions = new Set(operations.map((operation) => operation.transaction));
      for (const transaction of transactions) {
        const ordered = operations.filter((operation) => operation.transaction === transaction);
        const firstWrite = ordered.findIndex(({method}) =>
          ["set", "create", "update", "delete"].includes(method));
        assert.ok(firstWrite >= 0, "transaction must contain a write");
        assert.ok(ordered.slice(0, firstWrite).some(({method}) => method === "getAll"));
        assert.ok(ordered.every(({method}, index) =>
          !["get", "getAll"].includes(method) || index < firstWrite),
        "all transaction reads must precede the first write");
      }
      assert.deepEqual((await catalog.get()).data().dynamicSections, validateDynamicSectionsInput(value));
    });
    const snapshot = async () => ({
      parent: (await catalog.get()).data(),
      items: (await catalog.collection("items").get()).docs.map((d) => ({id: d.id, ...d.data()})),
    });
    await test("update nonexistent rejects without writes", async () => {
      const before = await snapshot();
      await invalid(() => update(config(["missing"])));
      assert.deepEqual(await snapshot(), before);
    });
    await test("update invalid hierarchy rejects without writes", async () => {
      const before = await snapshot();
      await invalid(() => update(config(["deep"])));
      assert.deepEqual(await snapshot(), before);
    });
    await test("update validates unchanged IDs in changed configuration", async () => {
      await catalog.update({dynamicSections: stale});
      await invalid(() => update(config(["missing", "root"], {
        offers: {enabled: true, categoryIds: ["root2"]},
      })));
      assert.deepEqual(reads.map((r) => r.id).sort(), ["missing", "root", "root2"]);
    });
    await test("update to all-disabled requires zero reads", async () => {
      await update({}); assert.equal(reads.length, 0);
    });
    await test("update changed validates IDs persisted in disabled sections", async () => {
      const value = {suggestions: {enabled: false, categoryIds: ["child"]}};
      await update(value);
      assert.deepEqual(reads.map((r) => r.id).sort(), ["child", "root"]);
      assert.ok(reads.every((r) => r.kind === "transaction"));
      assert.deepEqual((await catalog.get()).data().dynamicSections, validateDynamicSectionsInput(value));
      reads.length = 0;
      await invalid(() => update({suggestions: {enabled: false, categoryIds: ["missing"]}}));
      assert.deepEqual(reads.map((r) => r.id), ["missing"]);
      assert.ok(reads.every((r) => r.kind === "transaction"));
    });
    await test("create authorization precedes category reads", async () => {
      await user.update({accessStatus: "revoked"});
      await assert.rejects(() => create(config(["root"])), {code: "permission-denied"});
      assert.equal(reads.length, 0);
    });
    console.log(`CAT-H1: ${passed}/${passed}`);
  } finally {
    db.getAll = dbGetAll;
    Transaction.prototype.getAll = transactionGetAll;
    for (const [method, original] of Object.entries(transactionMethods)) {
      Transaction.prototype[method] = original;
    }
    if (originalKey === undefined) delete process.env.CATALOG_TOKEN_ENCRYPTION_KEY;
    else process.env.CATALOG_TOKEN_ENCRYPTION_KEY = originalKey;
    const tokens = await db.collection("catalogPublicTokens").where("storeId", "==", uid).get();
    for (const token of tokens.docs) await token.ref.delete();
    const slugs = await db.collection("storePublicSlugs").where("storeId", "==", uid).get();
    for (const slug of slugs.docs) await slug.ref.delete();
    await db.recursiveDelete(store);
    await user.delete();
    await admin.app().delete();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
