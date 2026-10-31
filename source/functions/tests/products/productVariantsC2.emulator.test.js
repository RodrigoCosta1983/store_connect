"use strict";
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID, createHash} = require("node:crypto");
const admin = require("firebase-admin");
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(localhost|127\.0\.0\.1):\d+$/);
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
const api = require("../../products/productVariantsC1");
const {codeRef} = require("../../products/productCodeReservation");
const {createProduct} = require("../../products/createProduct");
after(() => db.terminate());
const definitions = [{attributeId: "color", label: "Cor", values: [
  {valueId: "red", label: "Vermelho"}, {valueId: "blue", label: "Azul"}]}];
async function fixture() {
  const uid = randomUUID(); const store = db.collection("stores").doc(randomUUID());
  const user = db.collection("users").doc(uid);
  await store.set({}); await user.set({storeId: store.id, role: "admin"});
  return {uid, user, store, scope: {projectId: db.projectId, uid, storeId: store.id}};
}
const req = (f, data) => ({auth: {uid: f.uid}, data});
function product(f, kind = "simple", cod) {
  return {schemaVersion: 1, requestId: randomUUID(), scope: f.scope, productId: randomUUID(),
    product: {productKind: kind, name: "Synthetic", ...(cod === undefined ? {} : {cod}),
      ...(kind === "variantParent" ? {attributeDefinitions: definitions} : {})}};
}
async function variant(f, cod, parentId) {
  if (!parentId) {
    const p = product(f, "variantParent");
    await api.createProductC2(db, req(f, p)); parentId = p.productId;
  }
  const parent = await api.readProductC1(db, req(f, {scope: f.scope, productId: parentId}));
  return {schemaVersion: 1, requestId: randomUUID(), scope: f.scope, productId: parentId,
    variantId: randomUUID(), expectedProductUpdateTime: parent.expectedUpdateTime,
    variant: {attributes: [{attributeId: "color", valueId: "red"}], ...(cod === undefined ? {} : {cod})}};
}
const execute = (f, c) => (c.variant ? api.createVariantC2 : api.createProductC2)(db, req(f, c));
const reject = (fn, code) => assert.rejects(fn, (e) => e.code === code);
const target = (f, c) => c.variant ? f.store.collection("products").doc(c.productId).collection("variants").doc(c.variantId) :
  f.store.collection("products").doc(c.productId);
async function intent(f, kind, cod) { return kind === "variant" ? variant(f, cod) : product(f, kind, cod); }

for (const a of ["simple", "variantParent", "variant"]) {
  for (const b of ["simple", "variantParent", "variant"]) {
    test(`concurrent ${a} x ${b}: one code owner, no losing item/receipt`, async () => {
      const f = await fixture(); const ca = await intent(f, a, " x "); const cb = await intent(f, b, "X");
      const before = (await f.store.collection("auditLogs").get()).size;
      const results = await Promise.allSettled([execute(f, ca), execute(f, cb)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(results.find((r) => r.status === "rejected").reason.code, "already-exists");
      const winner = results[0].status === "fulfilled" ? ca : cb;
      const loser = winner === ca ? cb : ca;
      assert.equal((await target(f, loser).get()).exists, false);
      assert.deepEqual((await codeRef(f.store, "X").get()).data(), {cod: "X",
        ownerType: winner.variant ? "variant" : "product", productId: winner.productId, variantId: winner.variantId || null});
      assert.equal((await f.store.collection("auditLogs").get()).size, before + 1);
    });
  }
}
test("archived owners retain codes against every owner kind", async () => {
  for (const kind of ["simple", "variantParent", "variant"]) {
    const f = await fixture(); const c = await intent(f, kind, "ARCHIVE"); await execute(f, c);
    const reservation = await codeRef(f.store, "ARCHIVE").get();
    await target(f, c).update({isArchived: true});
    for (const other of ["simple", "variantParent", "variant"]) {
      const next = await intent(f, other, " archive ");
      await reject(() => execute(f, next), "already-exists");
    }
    assert.ok((await codeRef(f.store, "ARCHIVE").get()).updateTime.isEqual(reservation.updateTime));
  }
});
test("absent, empty and whitespace persist F9 semantics but distinct receipt commands", async () => {
  const f = await fixture();
  for (const kind of ["simple", "variantParent", "variant"]) {
    for (const cod of [undefined, "", "   "]) {
      const c = await intent(f, kind, cod); await execute(f, c);
      assert.equal(Object.hasOwn((await target(f, c).get()).data(), "cod"), false);
      const ref = f.store.collection("auditLogs").doc("f10-c1-" + createHash("sha256").update(JSON.stringify([f.uid, c.requestId])).digest("hex"));
      const saved = (await ref.get()).data().command;
      const body = saved.variant || saved.product;
      assert.equal(Object.hasOwn(body, "cod"), cod !== undefined);
      if (cod !== undefined) assert.equal(body.cod, cod);
      assert.equal((await execute(f, c)).replayed, true);
      const changed = structuredClone(c); (changed.variant || changed.product).cod = cod === "" ? "   " : "";
      await reject(() => execute(f, changed), "already-exists");
    }
  }
  assert.equal((await f.store.collection("productCodes").get()).size, 0);
});
test("normalization limits, null/type rejection and no silent coercion", async () => {
  const f = await fixture();
  for (const kind of ["simple", "variantParent", "variant"]) {
    for (const cod of [null, 7, false, {}, [], "a".repeat(41), "ß".repeat(21)]) {
      const c = await intent(f, kind, cod);
      await reject(() => execute(f, c), "invalid-argument");
      assert.equal((await target(f, c).get()).exists, false);
    }
  }
  for (const cod of [" aBc ", " a".slice(1).repeat(40), "ß".repeat(20)]) {
    const c = product(f, "simple", cod); await execute(f, c);
    assert.equal((await target(f, c).get()).data().cod, cod.trim().toUpperCase());
  }
});
test("legacy reservations and unreserved archived products block without rewriting", async () => {
  const f = await fixture(); const p = f.store.collection("products").doc("legacy");
  await p.set({cod: "LEGACY", isArchived: true});
  await codeRef(f.store, "LEGACY").set({cod: "LEGACY", productId: p.id});
  const before = await codeRef(f.store, "LEGACY").get();
  for (const kind of ["simple", "variantParent", "variant"]) {
    await reject(async () => execute(f, await intent(f, kind, "legacy")), "already-exists");
  }
  assert.ok((await codeRef(f.store, "LEGACY").get()).updateTime.isEqual(before.updateTime));
  await p.set({cod: " no-index ", isArchived: true});
  await reject(() => execute(f, product(f, "simple", "NO-INDEX")), "already-exists");
});
test("malformed/orphan reservations and unindexed variants fail closed", async () => {
  const f = await fixture();
  for (const raw of [{cod: "X", productId: "orphan"}, {cod: "Y", productId: "p"},
    {cod: "X", ownerType: "variant", productId: "p", variantId: null}]) {
    await codeRef(f.store, "X").set(raw);
    await reject(() => execute(f, product(f, "simple", "X")), raw.cod === "X" && !raw.ownerType ? "already-exists" : "failed-precondition");
  }
  const c = await variant(f, "UNINDEXED");
  await target(f, c).set({cod: "UNINDEXED", isArchived: true});
  await reject(() => execute(f, product(f, "simple", "NEW")), "failed-precondition");
});
test("F9 creation and F10 compete in both directions and concurrently", async () => {
  const f = await fixture();
  const f9 = (cod) => createProduct.run({auth: {uid: f.uid}, data: {requestId: randomUUID(), categoryIds: [],
    product: {name: "Synthetic", cod, price: 1, quantidade: 0, lotes: [], minimumStock: 0, imageUrl: ""}}});
  await f9("OLD");
  for (const kind of ["simple", "variantParent", "variant"]) {
    await reject(async () => execute(f, await intent(f, kind, "OLD")), "already-exists");
    const c = await intent(f, kind, kind); await execute(f, c);
    await reject(() => f9(kind), "already-exists");
    const race = await intent(f, kind, "race-" + kind);
    const results = await Promise.allSettled([f9("race-" + kind), execute(f, race)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.find((r) => r.status === "rejected").reason.code, "already-exists");
  }
});
test("C1 persisted commands replay through C2 unchanged even after archive", async () => {
  const f = await fixture(); const p = product(f, "variantParent");
  await api.createProductC1(db, req(f, p)); const v = await variant(f, undefined, p.productId);
  await api.createVariantC1(db, req(f, v));
  const receipts = await f.store.collection("auditLogs").get();
  await target(f, p).update({isArchived: true});
  assert.equal((await execute(f, p)).replayed, true); assert.equal((await execute(f, v)).replayed, true);
  for (const receipt of receipts.docs) assert.ok((await receipt.ref.get()).updateTime.isEqual(receipt.updateTime));
  const changed = {...p, product: {...p.product, cod: "NEW"}};
  await reject(() => execute(f, changed), "already-exists");
  assert.equal((await codeRef(f.store, "NEW").get()).exists, false);
});
test("COD replay concurrency, authorization/revocation, scope and store isolation", async () => {
  const f = await fixture(); const c = product(f, "simple", "X");
  const results = await Promise.all([execute(f, c), execute(f, c)]);
  assert.equal(results.filter((r) => r.replayed).length, 1);
  await reject(() => api.createProductC2(db, {data: c}), "unauthenticated");
  await f.user.update({accessStatus: "revoked"});
  await reject(() => execute(f, c), "permission-denied");
  await f.user.update({accessStatus: "active"});
  for (const key of ["projectId", "storeId", "uid"]) {
    await reject(() => execute(f, {...c, scope: {...c.scope, [key]: "other"}}), "permission-denied");
  }
  const g = await fixture(); await execute(g, {...c, scope: g.scope});
  assert.equal((await codeRef(g.store, "X").get()).exists, true);
});
test("rollback includes code/entity/combination/receipt/parent baseline; retry succeeds", async () => {
  const f = await fixture(); const c = await variant(f, "ROLLBACK");
  const parent = f.store.collection("products").doc(c.productId); const before = await parent.get();
  const original = db.runTransaction.bind(db);
  db.runTransaction = (callback) => original(async (tx) => { await callback(tx); throw new Error("synthetic-rollback"); });
  try { await assert.rejects(() => execute(f, c), /synthetic-rollback/); }
  finally { db.runTransaction = original; }
  assert.equal((await target(f, c).get()).exists, false);
  assert.equal((await codeRef(f.store, "ROLLBACK").get()).exists, false);
  assert.equal((await parent.collection("variantCombinations").get()).size, 0);
  assert.equal((await f.store.collection("auditLogs").get()).size, 1);
  assert.ok((await parent.get()).updateTime.isEqual(before.updateTime));
  await execute(f, c);
});
test("COD cannot bypass C1 IDs, baseline, parent, combinations or zero-stock gates", async () => {
  const f = await fixture(); const c = await variant(f, "GUARDED");
  const parent = f.store.collection("products").doc(c.productId);
  for (const patch of [{variantId: "bad/id"}, {variant: {...c.variant, quantidade: 1}},
    {variant: {...c.variant, lotes: [{}]}}, {variant: {...c.variant, attributes: [{attributeId: "bad", valueId: "red"}]}}]) {
    await reject(() => execute(f, {...c, ...patch}), "invalid-argument");
  }
  await reject(() => execute(f, {...c, variant: {...c.variant, attributes: []}}), "failed-precondition");
  await parent.update({name: "Changed"});
  await reject(() => execute(f, c), "failed-precondition");
  const fresh = await variant(f, "GUARDED", c.productId); await execute(f, fresh);
  const duplicate = await variant(f, "OTHER", c.productId);
  await reject(() => execute(f, duplicate), "already-exists");
  assert.equal((await codeRef(f.store, "OTHER").get()).exists, false);
  const blue = {...await variant(f, "ARCHIVED", c.productId),
    variant: {cod: "ARCHIVED", attributes: [{attributeId: "color", valueId: "blue"}]}};
  await parent.update({isArchived: true});
  await reject(() => execute(f, blue), "failed-precondition");
  assert.equal((await codeRef(f.store, "ARCHIVED").get()).exists, false);
});
test("C2 environment guard refuses remote/non-demo before writing COD", async () => {
  const f = await fixture(); const c = product(f, "simple", "REMOTE");
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  try {
    process.env.FIRESTORE_EMULATOR_HOST = "example.com:8080";
    await reject(() => execute(f, c), "failed-precondition");
  } finally { process.env.FIRESTORE_EMULATOR_HOST = host; }
  await reject(() => api.createProductC2({projectId: "prod"}, req(f, c)), "failed-precondition");
  assert.equal((await codeRef(f.store, "REMOTE").get()).exists, false);
});
test("concurrent different commands sharing requestId commit one immutable intention", async () => {
  const f = await fixture(); const a = product(f, "simple", "A");
  const b = {...product(f, "simple", "B"), requestId: a.requestId};
  const results = await Promise.allSettled([execute(f, a), execute(f, b)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.details.reason, "request-identity-conflict");
  assert.equal((await f.store.collection("productCodes").get()).size, 1);
  assert.equal((await f.store.collection("products").get()).size, 1);
  assert.equal((await f.store.collection("auditLogs").get()).size, 1);
});
test("concurrent revocation serializes with commit and denies subsequent replay", async () => {
  const f = await fixture(); const c = product(f, "simple", "REVOKED");
  const original = db.runTransaction.bind(db); let revocation;
  db.runTransaction = (callback) => original(async (tx) => {
    const result = await callback(tx);
    // Do not await a competing write while holding a pessimistic profile lock.
    if (!revocation) revocation = f.user.update({accessStatus: "revoked"});
    return result;
  });
  let result;
  try {
    result = await execute(f, c).then(() => "created", (e) => {
      assert.equal(e.code, "permission-denied"); return "denied";
    });
    await revocation;
  }
  finally { db.runTransaction = original; }
  const count = result === "created" ? 1 : 0;
  assert.equal((await target(f, c).get()).exists, count === 1);
  assert.equal((await f.store.collection("productCodes").get()).size, count);
  assert.equal((await f.store.collection("auditLogs").get()).size, count);
  await reject(() => execute(f, c), "permission-denied");
});
