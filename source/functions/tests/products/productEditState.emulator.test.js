"use strict";
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const admin = require("firebase-admin");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
if (!admin.apps.length) admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
const {getProductEditState, project} = require("../../products/productEditState");
const {getProductMutationResult} = require("../../products/productMutationResult");
const {updateProductV2, adjustProductStockV1} = require("../../products/productMutationV2");
after(() => db.terminate());
async function fixture() {
  const uid = randomUUID();
  const store = db.collection("stores").doc(randomUUID());
  const user = db.collection("users").doc(uid);
  const product = store.collection("products").doc(randomUUID());
  await store.set({});
  await user.set({storeId: store.id, role: "admin"});
  await product.set({name: "Original", price: 5, quantidade: 4, lotes: [], minimumStock: 0, imageUrl: ""});
  return {uid, store, user, product};
}
const edit = (f) => getProductEditState.run({auth: {uid: f.uid}, data: {productId: f.product.id}});
async function command(f) {
  return {schemaVersion: 2, requestId: randomUUID(), productId: f.product.id,
    expectedUpdateTime: (await edit(f)).expectedUpdateTime, changes: {set: {name: "Changed"}}};
}
const recover = (f, data, operation = "updateProductV2") => getProductMutationResult.run({auth: {uid: f.uid},
  data: {operation, command: data, expectedStoreId: f.store.id}});
test("same authoritative snapshot returns the exact token, changes get a different token", async () => {
  const f = await fixture();
  const first = await edit(f); const second = await edit(f);
  assert.deepEqual(first, second);
  const snapshot = await f.product.get();
  assert.deepEqual(first.expectedUpdateTime, {seconds: String(snapshot.updateTime.seconds), nanoseconds: snapshot.updateTime.nanoseconds});
  await f.product.update({name: "Concurrent"});
  assert.notDeepEqual((await edit(f)).expectedUpdateTime, first.expectedUpdateTime);
});
test("projection preserves absence/null and lot indices/precision without internal fields", async () => {
  const f = await fixture();
  await f.product.update({barcode: null, fiscal: {ncm: null, cfop: "5102", secret: "never-return", updatedAt: admin.firestore.Timestamp.now()},
    lotes: [{quantidade: 0, validade: new admin.firestore.Timestamp(1893456000, 123456000), secret: "never-return"},
      {quantidade: 4, validade: null}], internal: "never-return", createdAt: admin.firestore.Timestamp.now()});
  const dto = await edit(f);
  assert.equal(Object.hasOwn(dto.product, "costPrice"), false);
  assert.equal(dto.product.barcode, null);
  assert.deepEqual(dto.product.fiscal, {ncm: null, cfop: "5102"});
  assert.deepEqual(dto.product.lotes, [{index: 0, quantidade: 0, validade: {seconds: "1893456000", nanoseconds: 123456000}},
    {index: 1, quantidade: 4, validade: null}]);
  assert.equal(JSON.stringify(dto).includes("never-return"), false);
});
test("legacy malformed fields are unavailable rather than synthesized", async () => {
  const f = await fixture();
  await f.product.update({fiscal: "invalid", lotes: ["invalid", {quantidade: "invalid", validade: "invalid"}]});
  const dto = await edit(f);
  assert.equal(Object.hasOwn(dto.product, "fiscal"), false);
  assert.deepEqual(dto.product.lotes, [{index: 0}, {index: 1}]);
  assert.deepEqual(dto.unavailable, ["fiscal", "lotes.0", "lotes.1.quantidade", "lotes.1.validade"]);
});
test("missing/null snapshot token cannot fall back to updatedAt", () => {
  for (const updateTime of [null, undefined]) {
    assert.throws(() => project({id: "p", data: () => ({updatedAt: admin.firestore.Timestamp.now()}), updateTime}),
      (e) => e.code === "internal");
  }
});
test("missing/null command token rejects both mutations and result lookup", async () => {
  const f = await fixture();
  for (const value of [null, undefined]) {
    const data = await command(f);
    if (value === undefined) delete data.expectedUpdateTime; else data.expectedUpdateTime = value;
    await assert.rejects(() => updateProductV2.run({auth: {uid: f.uid}, data}), (e) => e.code === "invalid-argument");
    await assert.rejects(() => recover(f, data), (e) => e.code === "invalid-argument");
    await assert.rejects(() => adjustProductStockV1.run({auth: {uid: f.uid}, data: {schemaVersion: 1,
      requestId: randomUUID(), productId: f.product.id, expectedUpdateTime: value, reason: "count",
      stockChange: {kind: "setManualQuantity", quantity: 3}}}), (e) => e.code === "invalid-argument");
  }
});
test("authorization, revocation and derived store restrict both read endpoints", async () => {
  const f = await fixture(); const data = await command(f);
  await assert.rejects(() => getProductEditState.run({data: {productId: f.product.id}}), (e) => e.code === "unauthenticated");
  await assert.rejects(() => getProductMutationResult.run({data: {}}), (e) => e.code === "unauthenticated");
  for (const role of ["admin", "gerente", "operador", "caixa", "vendedor"]) {
    await f.user.update({role}); assert.equal((await edit(f)).productId, f.product.id);
  }
  for (const patch of [{accessStatus: "revoked"}, {accessStatus: "active", role: "unknown"}]) {
    await f.user.update(patch);
    await assert.rejects(() => edit(f), (e) => e.code === "permission-denied");
    await assert.rejects(() => recover(f, data), (e) => e.code === "permission-denied");
  }
  const other = await fixture();
  await f.user.update({role: "admin", storeId: other.store.id});
  await assert.rejects(() => edit(f), (e) => e.code === "not-found");
  await assert.rejects(() => recover(f, data), (e) => e.code === "permission-denied");
});
test("unknown request is not-recorded, never definitive rejection", async () => {
  const f = await fixture();
  assert.equal((await recover(f, await command(f))).status, "not-recorded");
  assert.equal((await recover(f, await command(f))).definitive, false);
});
test("confirmed result is recoverable after later edits; mismatch yields identity-conflict", async () => {
  const f = await fixture(); const data = await command(f);
  await updateProductV2.run({auth: {uid: f.uid}, data});
  await f.product.update({price: 7});
  const result = await recover(f, data);
  assert.equal(result.status, "confirmed"); assert.equal(result.result.requestId, data.requestId);
  assert.equal(JSON.stringify(result).includes("requestHash"), false);
  assert.equal((await recover(f, {...data, changes: {set: {name: "Other"}}})).status, "identity-conflict");
  const otherUid = randomUUID(); await db.collection("users").doc(otherUid).set({storeId: f.store.id, role: "admin"});
  assert.equal((await recover({...f, uid: otherUid}, data)).status, "not-recorded");
  await f.user.update({accessStatus: "revoked"});
  await assert.rejects(() => recover(f, data), (e) => e.code === "permission-denied");
});
test("stock receipts have their own operation namespace", async () => {
  const f = await fixture(); const initial = await command(f);
  const data = {schemaVersion: 1, requestId: initial.requestId, productId: f.product.id,
    expectedUpdateTime: initial.expectedUpdateTime, reason: "count", stockChange: {kind: "setManualQuantity", quantity: 3}};
  await adjustProductStockV1.run({auth: {uid: f.uid}, data});
  assert.equal((await recover(f, data, "adjustProductStockV1")).status, "confirmed");
  assert.equal((await recover(f, initial)).status, "not-recorded");
});
test("ledger scope is enforced transactionally, including after a profile moves stores", async () => {
  const f = await fixture(); const data = await command(f);
  data.scope = {uid: f.uid, storeId: f.store.id, projectId: process.env.GCLOUD_PROJECT};
  for (const patch of [{uid: randomUUID()}, {storeId: randomUUID()}, {projectId: "demo-other"}]) {
    await assert.rejects(() => updateProductV2.run({auth: {uid: f.uid}, data: {...data, scope: {...data.scope, ...patch}}}),
      (e) => e.code === "permission-denied" && e.details.reason === "mutation-scope-mismatch");
  }
  await updateProductV2.run({auth: {uid: f.uid}, data});
  assert.equal((await recover(f, data)).status, "confirmed");
  const other = await fixture();
  await f.user.update({storeId: other.store.id});
  await assert.rejects(() => updateProductV2.run({auth: {uid: f.uid}, data}),
    (e) => e.code === "permission-denied" && e.details.reason === "mutation-scope-mismatch");
});
test("scoped mutation persists rejection atomically; result/retry preserve it without product writes", async () => {
  const f = await fixture(); const data = await command(f);
  data.scope = {uid: f.uid, storeId: f.store.id, projectId: process.env.GCLOUD_PROJECT};
  await f.product.update({price: 7});
  const before = await f.product.get();
  await Promise.all([1, 2].map(() => assert.rejects(() => updateProductV2.run({auth: {uid: f.uid}, data}),
    (e) => e.code === "aborted" && e.details.persistedRejection === true)));
  assert.ok((await f.product.get()).updateTime.isEqual(before.updateTime));
  assert.equal((await f.store.collection("auditLogs").get()).size, 1);
  const result = await recover(f, data);
  assert.equal(result.status, "rejected"); assert.equal(result.definitive, true);
  assert.deepEqual(result.error, {code: "aborted", reason: "product-version-conflict"});
  assert.equal(JSON.stringify(result).includes("requestHash"), false);
  assert.equal((await recover(f, {...data, changes: {set: {price: 9}}})).status, "identity-conflict");
  await assert.rejects(() => updateProductV2.run({auth: {uid: f.uid}, data: {...data, changes: {set: {price: 9}}}}),
    (e) => e.code === "already-exists" && e.details.reason === "request-id-reused");
  assert.equal((await f.store.collection("auditLogs").get()).size, 1);
  await f.product.update({name: "Later"});
  await assert.rejects(() => updateProductV2.run({auth: {uid: f.uid}, data}),
    (e) => e.code === "aborted" && e.details.persistedRejection === true);
  assert.equal((await f.product.get()).data().name, "Later");
  await f.user.update({accessStatus: "revoked"});
  await assert.rejects(() => recover(f, data), (e) => e.code === "permission-denied");
  await assert.rejects(() => updateProductV2.run({auth: {uid: f.uid}, data}), (e) => e.code === "permission-denied");
});
test("scoped stock rejection is durable and never changes archived product/stock", async () => {
  const f = await fixture();
  await f.product.update({isArchived: true});
  const data = {schemaVersion: 1, requestId: randomUUID(), productId: f.product.id,
    expectedUpdateTime: (await edit(f)).expectedUpdateTime, reason: "count",
    stockChange: {kind: "setManualQuantity", quantity: 99},
    scope: {uid: f.uid, storeId: f.store.id, projectId: process.env.GCLOUD_PROJECT}};
  const before = await f.product.get();
  await assert.rejects(() => adjustProductStockV1.run({auth: {uid: f.uid}, data}),
    (e) => e.code === "failed-precondition" && e.details.persistedRejection === true);
  assert.ok((await f.product.get()).updateTime.isEqual(before.updateTime));
  assert.equal((await recover(f, data, "adjustProductStockV1")).status, "rejected");
  await f.product.update({isArchived: false});
  await assert.rejects(() => adjustProductStockV1.run({auth: {uid: f.uid}, data}),
    (e) => e.code === "failed-precondition" && e.details.reason === "archived-product-stock-immutable");
  assert.equal((await f.product.get()).data().quantidade, 4);
});
test("legacy unscoped rejections and authorization errors do not gain receipts", async () => {
  const f = await fixture(); const data = await command(f);
  await f.product.update({price: 8});
  await assert.rejects(() => updateProductV2.run({auth: {uid: f.uid}, data}), (e) => e.code === "aborted");
  assert.equal((await recover(f, data)).status, "not-recorded");
  const scoped = {...data, scope: {uid: f.uid, storeId: f.store.id, projectId: process.env.GCLOUD_PROJECT}};
  await f.user.update({accessStatus: "revoked"});
  await assert.rejects(() => updateProductV2.run({auth: {uid: f.uid}, data: scoped}), (e) => e.code === "permission-denied");
  assert.equal((await f.store.collection("auditLogs").get()).size, 0);
});
test("transient read failure is never persisted as terminal rejection", async () => {
  const f = await fixture(); const data = await command(f);
  data.scope = {uid: f.uid, storeId: f.store.id, projectId: process.env.GCLOUD_PROJECT};
  const original = db.runTransaction;
  try {
    db.runTransaction = function(callback, ...args) {
      return original.call(this, async (transaction) => {
        const get = transaction.get.bind(transaction);
        transaction.get = (ref, ...rest) => {
          if (ref.path === f.product.path) throw new (require("firebase-functions/v2/https").HttpsError)("unavailable", "Synthetic transient failure");
          return get(ref, ...rest);
        };
        return callback(transaction);
      }, ...args);
    };
    await assert.rejects(() => updateProductV2.run({auth: {uid: f.uid}, data}), (e) => e.code === "unavailable");
  } finally { db.runTransaction = original; }
  assert.equal((await recover(f, data)).status, "not-recorded");
  assert.equal((await f.store.collection("auditLogs").get()).size, 0);
});
