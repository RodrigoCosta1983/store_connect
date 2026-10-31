"use strict";

const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const admin = require("firebase-admin");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
const projectId = process.env.GCLOUD_PROJECT || "demo-f9-cod-atomic";
assert.ok(projectId.startsWith("demo-"), "Tests require a local demo project");
if (!admin.apps.length) admin.initializeApp({projectId});
const {createProduct} = require("../../products/createProduct");
const {updateProduct} = require("../../products/updateProduct");
const {archiveProduct} = require("../../products/archiveProduct");
const {restoreProduct} = require("../../products/restoreProduct");
const {codeRef, reservationOwner} = require("../../products/productCodeReservation");
const db = admin.firestore();
let passed = 0;
let failed = 0;
let racePairs = 0;

async function fixture(role = "admin", accessStatus = "active") {
  const suffix = randomUUID();
  const uid = `u-${suffix}`;
  const storeRef = db.collection("stores").doc(`s-${suffix}`);
  await storeRef.set({name: "Test", subscriptionType: "pro", subscriptionStatus: "inactive"});
  const userRef = db.collection("users").doc(uid);
  await userRef.set({storeId: storeRef.id, role, accessStatus});
  return {uid, storeRef, userRef};
}
function product(cod = "", extra = {}) {
  return {name: "Produto", cod, price: 10, quantidade: 1, lotes: [], minimumStock: 0, imageUrl: "", ...extra};
}
function create(f, cod = "", requestId = randomUUID()) {
  return createProduct.run({auth: {uid: f.uid}, data: {requestId, product: product(cod), categoryIds: []}});
}
function update(f, productId, cod, requestId = randomUUID(), extra = {}) {
  return updateProduct.run({auth: {uid: f.uid}, data: {productId, requestId, product: product(cod, extra)}});
}
async function reject(action, code, reason) {
  await assert.rejects(action, (error) => {
    assert.equal(error.code, code);
    if (reason) assert.equal(error.details?.reason, reason);
    return true;
  });
}
async function invariant(f) {
  const products = await f.storeRef.collection("products").get();
  const codes = await f.storeRef.collection("productCodes").get();
  const byCode = new Map();
  for (const doc of products.docs) {
    const cod = doc.data().cod;
    if (!cod) continue;
    assert.equal(cod, cod.trim().toUpperCase());
    assert.ok(!byCode.has(cod), `Duplicate COD: ${cod}`);
    byCode.set(cod, doc.id);
    const reservation = await codeRef(f.storeRef, cod).get();
    assert.deepEqual(reservation.data(), {cod, ownerType: "product", productId: doc.id, variantId: null});
  }
  for (const doc of codes.docs) {
    const owner = reservationOwner(doc.data());
    assert.equal(owner.ownerType, "product");
    assert.ok(products.docs.some((product) => product.id === owner.productId), "Reservation owner exists");
    if (byCode.has(doc.data().cod)) assert.equal(byCode.get(doc.data().cod), owner.productId);
  }
}
async function race(f, first, second, cod) {
  const results = await Promise.allSettled([first(), second()]);
  const winners = results.filter((result) => result.status === "fulfilled");
  const losers = results.filter((result) => result.status === "rejected");
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].reason.code, "already-exists");
  assert.equal(losers[0].reason.details?.reason, "duplicate-product-cod");
  assert.deepEqual((await codeRef(f.storeRef, cod).get()).data(), {
    cod, ownerType: "product", productId: winners[0].value.productId, variantId: null,
  });
  await invariant(f);
  racePairs++;
}
async function test(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}`, error); }
}

(async () => {
  await test("owner contract recognizes legacy, product and future variant owners", async () => {
    assert.deepEqual(reservationOwner({productId: "p"}),
      {ownerType: "product", productId: "p", variantId: null});
    assert.deepEqual(reservationOwner({ownerType: "variant", productId: "p", variantId: "v"}),
      {ownerType: "variant", productId: "p", variantId: "v"});
    for (const data of [
      {}, {productId: " "}, {productId: "p/v"},
      {productId: "p", variantId: "v"},
      {ownerType: null, productId: "p", variantId: null},
      {ownerType: "other", productId: "p", variantId: null},
      {ownerType: "product", productId: "p"},
      {ownerType: "product", productId: "p", variantId: "v"},
      {ownerType: "variant", productId: "p", variantId: null},
      {ownerType: "variant", productId: "p", variantId: " "},
    ]) assert.throws(() => reservationOwner(data), (e) => e.code === "failed-precondition");
  });
  await test("E3-B: legacy reservation stays unchanged on edit, archive, restore and change", async () => {
    const f = await fixture(); const item = await create(f, "LEGACY");
    const ref = codeRef(f.storeRef, "LEGACY");
    const legacy = {cod: "LEGACY", productId: item.productId};
    await ref.set(legacy);
    const before = await ref.get();
    await update(f, item.productId, " legacy ");
    const request = {auth: {uid: f.uid}, data: {storeId: f.storeRef.id, productId: item.productId}};
    await archiveProduct.run(request);
    await reject(() => create(f, "LEGACY"), "already-exists", "duplicate-product-cod");
    await restoreProduct.run(request);
    assert.deepEqual((await ref.get()).data(), legacy);
    assert.ok((await ref.get()).updateTime.isEqual(before.updateTime));
    await update(f, item.productId, "NEW");
    assert.deepEqual((await ref.get()).data(), legacy);
    assert.ok((await ref.get()).updateTime.isEqual(before.updateTime));
    await reject(() => create(f, "LEGACY"), "already-exists", "duplicate-product-cod");
    await reject(() => update(f, item.productId, "LEGACY"), "already-exists", "duplicate-product-cod");
    await invariant(f);
  });
  await test("inconsistent owners abort create and update without partial writes", async () => {
    for (const owner of [
      {ownerType: "product", variantId: "v"},
      {ownerType: "variant", variantId: null},
      {ownerType: "unknown", variantId: null},
      {variantId: "v"},
    ]) {
      const f = await fixture(); const item = await create(f, "OLD");
      const productRef = f.storeRef.collection("products").doc(item.productId);
      const before = (await productRef.get()).data();
      const broken = {cod: "NEW", productId: item.productId, ...owner};
      await codeRef(f.storeRef, "NEW").set(broken);
      await reject(() => create(f, "NEW"), "failed-precondition");
      await reject(() => update(f, item.productId, "NEW"), "failed-precondition");
      assert.deepEqual((await productRef.get()).data(), before);
      assert.equal((await f.storeRef.collection("products").get()).size, 1);
      assert.equal((await f.storeRef.collection("auditLogs").get()).size, 1);
      assert.deepEqual((await codeRef(f.storeRef, "NEW").get()).data(), broken);
      await codeRef(f.storeRef, "OLD").set({...broken, cod: "OLD"});
      await reject(() => update(f, item.productId, "FREE"), "failed-precondition");
      assert.equal((await codeRef(f.storeRef, "FREE").get()).exists, false);
      assert.deepEqual((await productRef.get()).data(), before);
    }
  });
  await test("variant reservation blocks same parent product and is never released by product flows", async () => {
    const f = await fixture(); const item = await create(f, "OLD");
    const variant = {cod: "VARIANT", ownerType: "variant", productId: item.productId, variantId: "v"};
    const ref = codeRef(f.storeRef, "VARIANT");
    await ref.set(variant); // Future-owner fixture only; no variant API.
    await reject(() => create(f, "VARIANT"), "already-exists", "duplicate-product-cod");
    await reject(() => update(f, item.productId, "VARIANT"), "already-exists", "duplicate-product-cod");
    await codeRef(f.storeRef, "OLD").set({...variant, cod: "OLD"});
    await reject(() => update(f, item.productId, "FREE"), "failed-precondition");
    assert.equal((await codeRef(f.storeRef, "FREE").get()).exists, false);
    assert.deepEqual((await ref.get()).data(), variant);
    assert.equal((await f.storeRef.collection("products").doc(item.productId).get()).data().cod, "OLD");
  });
  await test("create COD atomically reserves hash and normalizes unrestricted characters", async () => {
    const f = await fixture();
    const result = await create(f, " ca / 01 . pt ");
    const cod = "CA / 01 . PT";
    assert.deepEqual((await codeRef(f.storeRef, cod).get()).data(),
      {cod, ownerType: "product", productId: result.productId, variantId: null});
    assert.match(codeRef(f.storeRef, cod).id, /^[a-f0-9]{64}$/);
    await invariant(f);
  });
  await test("same store duplicate rejected with no partial product or receipt writes", async () => {
    const f = await fixture();
    await create(f, "CA-0001");
    const before = (await f.storeRef.collection("auditLogs").get()).size;
    await reject(() => create(f, " ca-0001 "), "already-exists", "duplicate-product-cod");
    assert.equal((await f.storeRef.collection("products").get()).size, 1);
    assert.equal((await f.storeRef.collection("auditLogs").get()).size, before);
    await invariant(f);
  });
  await test("cross-store creates and updates allow the same COD", async () => {
    const a = await fixture(); const b = await fixture();
    await create(a, "LC-0001");
    const item = await create(b);
    await update(b, item.productId, "lc-0001");
    await invariant(a); await invariant(b);
  });
  await test("empty COD creates no reservation", async () => {
    const f = await fixture(); await create(f); await create(f, "   ");
    assert.equal((await f.storeRef.collection("productCodes").get()).size, 0);
    await invariant(f);
  });
  await test("self edit preserves reservation", async () => {
    const f = await fixture(); const item = await create(f, "LC-0001");
    const before = (await codeRef(f.storeRef, "LC-0001").get()).updateTime;
    await update(f, item.productId, " lc-0001 ", randomUUID(), {name: "Renamed"});
    assert.ok((await codeRef(f.storeRef, "LC-0001").get()).updateTime.isEqual(before));
    assert.equal((await f.storeRef.collection("products").doc(item.productId).get()).data().name, "Renamed");
    await invariant(f);
  });
  await test("E3-B: COD change retains old reservation and blocks reuse/reactivation", async () => {
    const f = await fixture(); const item = await create(f, "CA-0001");
    await update(f, item.productId, "CA-0002");
    assert.equal((await codeRef(f.storeRef, "CA-0001").get()).data().productId, item.productId);
    await reject(() => create(f, "CA-0001"), "already-exists", "duplicate-product-cod");
    await reject(() => update(f, item.productId, "CA-0001"), "already-exists", "duplicate-product-cod");
    await invariant(f);
  });
  await test("occupied COD update leaves old reservation and product intact", async () => {
    const f = await fixture(); const a = await create(f, "A"); await create(f, "B");
    const ref = f.storeRef.collection("products").doc(a.productId);
    const before = (await ref.get()).data();
    await reject(() => update(f, a.productId, "b", randomUUID(), {price: 99}), "already-exists", "duplicate-product-cod");
    assert.deepEqual((await ref.get()).data(), before); await invariant(f);
  });
  await test("E3-B: COD removal deletes field and retains old reservation", async () => {
    const f = await fixture(); const item = await create(f, "CA-0001");
    await update(f, item.productId, "   ");
    assert.equal(Object.hasOwn((await f.storeRef.collection("products").doc(item.productId).get()).data(), "cod"), false);
    assert.equal((await codeRef(f.storeRef, "CA-0001").get()).data().productId, item.productId);
    await reject(() => create(f, "CA-0001"), "already-exists", "duplicate-product-cod");
    await reject(() => update(f, item.productId, "CA-0001"), "already-exists", "duplicate-product-cod");
    await invariant(f);
  });
  await test("legacy product without COD receives a reservation on update", async () => {
    const f = await fixture(); const ref = f.storeRef.collection("products").doc("legacy");
    const data = product(); delete data.cod; await ref.set(data);
    await update(f, ref.id, "LEGACY"); await invariant(f);
  });
  await test("legacy without COD can still be edited without any reservation", async () => {
    const f = await fixture(); const ref = f.storeRef.collection("products").doc("legacy");
    const data = product(); delete data.cod; await ref.set(data);
    await update(f, ref.id, ""); await invariant(f);
  });
  await test("omitted COD preserves current COD", async () => {
    const f = await fixture(); const item = await create(f, "KEEP");
    const data = product(); delete data.cod;
    await updateProduct.run({auth: {uid: f.uid}, data: {productId: item.productId, requestId: randomUUID(), product: data}});
    await invariant(f);
    assert.equal((await f.storeRef.collection("products").doc(item.productId).get()).data().cod, "KEEP");
  });
  await test("old missing reservation blocks self edit without silent migration", async () => {
    const f = await fixture(); await f.storeRef.collection("products").doc("fixture").set(product("OLD"));
    await reject(() => update(f, "fixture", "OLD"), "failed-precondition");
    assert.equal((await codeRef(f.storeRef, "OLD").get()).exists, false);
  });
  await test("foreign old reservation is never released", async () => {
    const f = await fixture(); const item = await create(f, "OLD");
    await codeRef(f.storeRef, "OLD").set({cod: "OLD", productId: "someone-else"});
    await reject(() => update(f, item.productId, "NEW"), "failed-precondition");
    assert.equal((await codeRef(f.storeRef, "NEW").get()).exists, false);
    assert.equal((await codeRef(f.storeRef, "OLD").get()).data().productId, "someone-else");
  });
  await test("create retry replay remains safe after COD changes", async () => {
    const f = await fixture(); const requestId = randomUUID();
    const item = await create(f, "BEFORE", requestId);
    await update(f, item.productId, "AFTER");
    const replay = await create(f, "BEFORE", requestId);
    assert.equal(replay.productId, item.productId); assert.equal(replay.replayed, true);
    assert.equal((await codeRef(f.storeRef, "BEFORE").get()).exists, true); await invariant(f);
  });
  await test("update retry replay cannot revert a later COD change", async () => {
    const f = await fixture(); const item = await create(f); const requestId = randomUUID();
    await update(f, item.productId, "FIRST", requestId);
    await update(f, item.productId, "SECOND");
    assert.equal((await update(f, item.productId, "FIRST", requestId)).replayed, true);
    assert.equal((await f.storeRef.collection("products").doc(item.productId).get()).data().cod, "SECOND");
    await reject(() => update(f, item.productId, "OTHER", requestId), "already-exists", "request-id-reused");
    await invariant(f);
  });
  await test("all five operational roles retain update permission", async () => {
    for (const role of ["admin", "gerente", "operador", "caixa", "vendedor"]) {
      const f = await fixture(role); const item = await create(f);
      await update(f, item.productId, "ROLE"); await invariant(f);
    }
  });
  await test("concurrent identical updates replay exactly once", async () => {
    const f = await fixture(); const item = await create(f); const requestId = randomUUID();
    const results = await Promise.all([
      update(f, item.productId, "RETRY", requestId), update(f, item.productId, "RETRY", requestId),
    ]);
    assert.equal(results.filter((result) => result.replayed).length, 1);
    assert.equal((await f.storeRef.collection("auditLogs").get()).size, 2);
    await invariant(f);
  });
  await test("E3-B: concurrent V1 updates retain every historical reservation", async () => {
    const f = await fixture(); const item = await create(f, "ORIGINAL");
    await Promise.all([update(f, item.productId, "FIRST"), update(f, item.productId, "SECOND")]);
    await invariant(f);
    assert.equal((await codeRef(f.storeRef, "ORIGINAL").get()).exists, true);
    assert.equal((await f.storeRef.collection("productCodes").get()).size, 3);
  });
  await test("authorization, profile and store are checked inside transaction including replay", async () => {
    const f = await fixture(); const item = await create(f); const requestId = randomUUID();
    await update(f, item.productId, "OWN", requestId);
    await f.userRef.update({accessStatus: " revoked "});
    await reject(() => update(f, item.productId, "OWN", requestId), "permission-denied");
    await f.userRef.update({accessStatus: "active", role: "unknown"});
    await reject(() => update(f, item.productId, "OWN"), "permission-denied");
    const other = await fixture();
    await reject(() => update(other, item.productId, "THEFT"), "not-found");
    await reject(() => updateProduct.run({data: {}}), "unauthenticated");
    await f.userRef.delete(); await reject(() => update(f, item.productId, "OWN"), "permission-denied");
  });
  await test("taxonomic and archive fields cannot be smuggled through update", async () => {
    const f = await fixture(); const item = await create(f);
    for (const extra of [{categoryIds: []}, {isArchived: false}, {storeId: "other"}, {cod: 12}]) {
      await reject(() => update(f, item.productId, "CODE", randomUUID(), extra), "invalid-argument");
    }
    await invariant(f);
  });
  await test("update retains timestamps, stock lots and former fiscal access policy", async () => {
    const f = await fixture(); const item = await create(f);
    await update(f, item.productId, "FISCAL", randomUUID(), {
      quantidade: 2, lotes: [{quantidade: 2, validadeMs: Date.UTC(2030, 0, 1)}], fiscal: {ncm: "12345678"},
    });
    const data = (await f.storeRef.collection("products").doc(item.productId).get()).data();
    assert.ok(data.lotes[0].validade instanceof admin.firestore.Timestamp);
    assert.ok(data.fiscal.updatedAt instanceof admin.firestore.Timestamp); await invariant(f);
  });
  await test("archive and restore preserve the COD reservation and do not free a retained product", async () => {
    const f = await fixture(); const cod = "CA-0001-P-PT";
    const item = await create(f, cod);
    const request = {auth: {uid: f.uid}, data: {storeId: f.storeRef.id, productId: item.productId}};
    const productRef = f.storeRef.collection("products").doc(item.productId);
    const reservationRef = codeRef(f.storeRef, cod);
    const original = await reservationRef.get();
    const archived = await archiveProduct.run(request);
    assert.equal(archived.success, true);
    assert.equal(archived.alreadyArchived, false);
    assert.equal((await archiveProduct.run(request)).alreadyArchived, true);
    assert.equal((await productRef.get()).data().isArchived, true);
    assert.equal((await productRef.get()).data().cod, cod);
    assert.deepEqual((await reservationRef.get()).data(),
      {cod, ownerType: "product", productId: item.productId, variantId: null});
    assert.ok((await reservationRef.get()).updateTime.isEqual(original.updateTime));
    await invariant(f);
    await reject(() => create(f, " ca-0001-p-pt "), "already-exists", "duplicate-product-cod");
    const restored = await restoreProduct.run(request);
    assert.equal(restored.success, true);
    assert.equal(restored.alreadyActive, false);
    assert.equal((await restoreProduct.run(request)).alreadyActive, true);
    assert.equal((await productRef.get()).data().isArchived, false);
    assert.equal((await productRef.get()).data().cod, cod);
    assert.deepEqual((await reservationRef.get()).data(), original.data());
    assert.ok((await reservationRef.get()).updateTime.isEqual(original.updateTime));
    assert.equal((await f.storeRef.collection("productCodes").get()).size, 1);
    await invariant(f);
  });
  await test("archived COD also blocks another product update without partial writes", async () => {
    const f = await fixture(); const cod = "CA-0001-P-PT";
    const a = await create(f, cod); const b = await create(f, "OTHER");
    await archiveProduct.run({auth: {uid: f.uid}, data: {storeId: f.storeRef.id, productId: a.productId}});
    const bRef = f.storeRef.collection("products").doc(b.productId);
    const before = (await bRef.get()).data();
    await reject(() => update(f, b.productId, " ca-0001-p-pt ", randomUUID(), {price: 99}),
      "already-exists", "duplicate-product-cod");
    assert.deepEqual((await bRef.get()).data(), before);
    assert.equal((await codeRef(f.storeRef, cod).get()).data().productId, a.productId);
    await invariant(f);
  });
  await test("archived reservation is isolated by store for both create and update", async () => {
    const a = await fixture(); const b = await fixture(); const cod = "CA-0001-P-PT";
    const original = await create(a, cod);
    await archiveProduct.run({auth: {uid: a.uid}, data: {storeId: a.storeRef.id, productId: original.productId}});
    const other = await create(b, " ca-0001-p-pt ");
    const originalReservation = await codeRef(a.storeRef, cod).get();
    const otherReservation = await codeRef(b.storeRef, cod).get();
    assert.equal((await b.storeRef.collection("products").doc(other.productId).get()).data().cod, cod);
    await update(b, other.productId, "FREE");
    assert.ok((await codeRef(a.storeRef, cod).get()).updateTime.isEqual(originalReservation.updateTime));
    assert.ok((await codeRef(b.storeRef, cod).get()).updateTime.isEqual(otherReservation.updateTime));
    const state = async (f) => {
      const result = {};
      for (const collection of ["products", "productCodes", "auditLogs"]) {
        result[collection] = (await f.storeRef.collection(collection).get()).docs.map((doc) =>
          ({id: doc.id, data: doc.data(), updateTime: doc.updateTime}));
      }
      return result;
    };
    const beforeA = await state(a); const beforeB = await state(b);
    await reject(() => update(b, other.productId, "ca-0001-p-pt"), "already-exists", "duplicate-product-cod");
    assert.deepEqual(await state(a), beforeA);
    assert.deepEqual(await state(b), beforeB);
    assert.equal((await b.storeRef.collection("products").doc(other.productId).get()).data().cod, "FREE");
    assert.equal((await codeRef(b.storeRef, "FREE").get()).data().productId, other.productId);
    assert.equal((await codeRef(a.storeRef, cod).get()).data().productId, original.productId);
    assert.equal((await codeRef(b.storeRef, cod).get()).data().productId, other.productId);
    await invariant(a); await invariant(b);
  });
  await test("legacy product without COD archives and restores without reservation", async () => {
    const f = await fixture(); const ref = f.storeRef.collection("products").doc("legacy-archive");
    const data = product(); delete data.cod; await ref.set(data);
    const request = {auth: {uid: f.uid}, data: {storeId: f.storeRef.id, productId: ref.id}};
    assert.equal((await archiveProduct.run(request)).success, true);
    assert.equal((await ref.get()).data().isArchived, true);
    await invariant(f);
    assert.equal((await restoreProduct.run(request)).success, true);
    assert.equal((await ref.get()).data().isArchived, false);
    assert.equal(Object.hasOwn((await ref.get()).data(), "cod"), false);
    assert.equal((await f.storeRef.collection("productCodes").get()).size, 0);
    await invariant(f);
  });
  await test("restore rejects missing reservation without state or reservation writes", async () => {
    const f = await fixture(); const cod = "CA-0001-P-PT"; const item = await create(f, cod);
    const request = {auth: {uid: f.uid}, data: {storeId: f.storeRef.id, productId: item.productId}};
    await archiveProduct.run(request);
    // Deliberately inconsistent emulator fixture; never a normal archive path.
    await codeRef(f.storeRef, cod).delete();
    await reject(() => restoreProduct.run(request), "failed-precondition");
    const restored = (await f.storeRef.collection("products").doc(item.productId).get()).data();
    assert.equal(restored.isArchived, true);
    assert.equal(restored.cod, cod);
    assert.equal((await codeRef(f.storeRef, cod).get()).exists, false);
    assert.equal((await f.storeRef.collection("productCodes").get()).size, 0);
  });
  await test("archived COD cannot be removed, changed or assigned; unchanged commercial edit is safe", async () => {
    for (const cod of ["KEEP", ""]) {
      const f = await fixture(); const item = await create(f, cod);
      const request = {auth: {uid: f.uid}, data: {storeId: f.storeRef.id, productId: item.productId}};
      await archiveProduct.run(request);
      const ref = f.storeRef.collection("products").doc(item.productId);
      const before = (await ref.get()).data();
      for (const next of ["NEW", ...(cod ? [""] : [])]) {
        await reject(() => update(f, item.productId, next), "failed-precondition", "archived-product-cod-immutable");
        assert.deepEqual((await ref.get()).data(), before);
      }
      await update(f, item.productId, cod, randomUUID(), {name: "Commercial edit"});
      await restoreProduct.run(request); await invariant(f);
    }
  });
  await test("unreserved legacy COD blocks concurrent claims, including archived normalized values", async () => {
    for (const isArchived of [false, true]) {
      const f = await fixture();
      await f.storeRef.collection("products").doc("legacy").set(product(" legacy ", {isArchived}));
      const item = await create(f, "OTHER");
      const results = await Promise.allSettled([create(f, "LEGACY"), update(f, item.productId, "LEGACY")]);
      for (const result of results) {
        assert.equal(result.status, "rejected"); assert.equal(result.reason.code, "already-exists");
      }
      assert.equal((await codeRef(f.storeRef, "LEGACY").get()).exists, false);
      assert.equal((await f.storeRef.collection("products").get()).size, 2);
    }
  });
  await test("archive/update race serializes COD identity and subsequent restore", async () => {
    for (let i = 0; i < 5; i++) {
      const f = await fixture(); const item = await create(f, "OLD");
      const request = {auth: {uid: f.uid}, data: {storeId: f.storeRef.id, productId: item.productId}};
      const results = await Promise.allSettled([archiveProduct.run(request), update(f, item.productId, "NEW")]);
      assert.equal(results[0].status, "fulfilled");
      if (results[1].status === "rejected") assert.equal(results[1].reason.code, "failed-precondition");
      await invariant(f); await restoreProduct.run(request); await invariant(f);
    }
  });
  await test("restore rejects variant or foreign owner and duplicate legacy product without partial writes", async () => {
    for (const scenario of ["variant", "foreign", "duplicate"]) {
      const f = await fixture(); const item = await create(f, "KEEP");
      const request = {auth: {uid: f.uid}, data: {storeId: f.storeRef.id, productId: item.productId}};
      await archiveProduct.run(request);
      if (scenario === "duplicate") await f.storeRef.collection("products").doc("legacy").set(product("KEEP"));
      else await codeRef(f.storeRef, "KEEP").set({cod: "KEEP", ownerType: scenario === "variant" ? "variant" : "product",
        productId: scenario === "variant" ? item.productId : "foreign", variantId: scenario === "variant" ? "v" : null});
      const before = (await f.storeRef.collection("auditLogs").get()).size;
      await assert.rejects(() => restoreProduct.run(request));
      assert.equal((await f.storeRef.collection("products").doc(item.productId).get()).data().isArchived, true);
      assert.equal((await f.storeRef.collection("auditLogs").get()).size, before);
    }
  });
  await test("create/create race: five iterations have exactly one winner", async () => {
    for (let i = 0; i < 5; i++) {
      const f = await fixture();
      await race(f, () => create(f, "CA-0001-P-PT"), () => create(f, " ca-0001-p-pt "), "CA-0001-P-PT");
    }
  });
  await test("update/update race: five iterations have exactly one winner", async () => {
    for (let i = 0; i < 5; i++) {
      const f = await fixture(); const a = await create(f, "A"); const b = await create(f, "B");
      await race(f, () => update(f, a.productId, "CA-0001-P-PT"),
        () => update(f, b.productId, "ca-0001-p-pt"), "CA-0001-P-PT");
    }
  });
  await test("create/update race: five iterations have exactly one winner", async () => {
    for (let i = 0; i < 5; i++) {
      const f = await fixture(); const item = await create(f, "OLD");
      await race(f, () => create(f, "CA-0001-P-PT"),
        () => update(f, item.productId, "ca-0001-p-pt"), "CA-0001-P-PT");
    }
  });
  console.log(`Tests: ${passed} passed; ${failed} failed; ${racePairs} race pairs`);
  if (failed) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
