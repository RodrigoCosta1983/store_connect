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
const core = c12.localMutationSupport, time = c12.firestoreValue;
after(() => db.terminate());
const request = (f, data) => ({auth: {uid: f.uid}, data});
const input = (f, extra = {}) => ({scope: f.scope, productId: f.parent.id, pageSize: 2, ...extra});
const list = (f, extra = {}, database = db) => api.listProductVariantsB02(database, request(f, input(f, extra)));
async function fixture(ids = []) {
  const store = db.collection("stores").doc(randomUUID()), uid = randomUUID();
  const user = db.collection("users").doc(uid), parent = store.collection("products").doc(randomUUID());
  await store.set({}); await user.set({role: "admin", storeId: store.id});
  const scope = {projectId: db.projectId, uid, storeId: store.id};
  const f = {store, user, uid, parent, scope};
  await c12.createProductC2(db, request(f, {schemaVersion: 1, scope, requestId: randomUUID(), productId: parent.id,
    product: {productKind: "variantParent", name: "Synthetic", cod: " P ", attributeDefinitions: [
      {attributeId: "color", label: "Color", values: [...new Set([...ids, "later"])].map(id => ({valueId: id, label: id}))}]} }));
  for (const id of ids) await add(f, id);
  return f;
}
async function add(f, id) {
  await c12.createVariantC2(db, request(f, {schemaVersion: 1, scope: f.scope, requestId: randomUUID(),
    productId: f.parent.id, variantId: id, expectedProductUpdateTime: time((await f.parent.get()).updateTime),
    variant: {name: id, cod: ` V-${id} `, attributes: [{attributeId: "color", valueId: id}]}}));
}
async function change(f, id, archive = false) {
  const variant = f.parent.collection("variants").doc(id);
  const command = {schemaVersion: 1, scope: f.scope, requestId: randomUUID(), productId: f.parent.id, variantId: id,
    expectedProductUpdateTime: time((await f.parent.get()).updateTime),
    expectedVariantUpdateTime: time((await variant.get()).updateTime), reason: "Synthetic",
    ...(archive ? {} : {stockChange: {kind: "setManualQuantity", quantity: 7}})};
  return c3[archive ? "archiveVariantC3" : "adjustVariantStockC3"](db, request(f, command));
}
function noPage(result, status, reason) {
  assert.deepEqual(result, {status, reason});
  assert.equal(Object.hasOwn(result, "variants"), false);
  assert.equal(Object.hasOwn(result, "pagination"), false);
}
async function allSnapshots(f) {
  const queries = await Promise.all([f.store.collection("products").get(), f.store.collection("productCodes").get(),
    f.store.collection("auditLogs").get(), f.parent.collection("variants").get(), f.parent.collection("variantCombinations").get()]);
  return [await f.user.get(), await f.store.get(), ...queries.flatMap(q => q.docs)]
    .map(s => ({path: s.ref.path, data: time(s.data()), updateTime: time(s.updateTime)}));
}

test("existing authorized parent with no variants is proven empty at this transaction", async () => {
  const f = await fixture(), result = await list(f);
  assert.equal(result.status, "available"); assert.deepEqual(result.variants, []);
  assert.equal(result.pagination.totalCount, 0); assert.equal(result.pagination.offset, 0);
  assert.equal(result.pagination.empty, true); assert.equal(result.pagination.complete, true);
  assert.equal(result.pagination.nextCursor, null); assert.equal(result.parent.isSellable, false);
  assert.deepEqual(result.parent.updateTime, time((await f.parent.get()).updateTime));
});
test("complete deterministic traversal, exact boundary, repeat and changed object key order", async () => {
  const f = await fixture(["z", "a", "m", "b", "d"]), pages = [], rows = [];
  let cursor;
  do {
    const page = await list(f, cursor ? {cursor} : {});
    assert.equal(page.status, "available");
    assert.equal(page.pagination.offset, rows.length); assert.equal(page.pagination.totalCount, 5);
    assert.equal(page.pagination.empty, false);
    if (pages.length) assert.equal(page.pagination.fingerprint, pages[0].pagination.fingerprint);
    pages.push(page); rows.push(...page.variants); cursor = page.pagination.nextCursor;
    assert.equal(page.pagination.complete, cursor === null);
  } while (cursor);
  assert.deepEqual(rows.map(r => r.identity.variantId), ["a", "b", "d", "m", "z"]);
  assert.deepEqual(pages.map(p => p.variants.length), [2, 2, 1]);
  assert.deepEqual(pages.map(p => p.pagination.complete), [false, false, true]);
  assert.equal(core.hash(core.canonical([1, f.scope, f.parent.id, pages[0].parent.updateTime,
    rows.map(v => [v.identity.variantId, v.updateTime])])), pages[0].pagination.fingerprint);
  assert.deepEqual(await list(f, {cursor: pages[0].pagination.nextCursor}), pages[1]);
  const reordered = {storeId: f.scope.storeId, projectId: f.scope.projectId, uid: f.uid};
  assert.deepEqual((await list(f, {scope: reordered, cursor: pages[0].pagination.nextCursor})).variants, pages[1].variants);
  const single = await list(f, {pageSize: 5}); assert.equal(single.pagination.complete, true);
  assert.equal(single.pagination.nextCursor, null); assert.equal(single.variants.length, 5);
});
test("includes archived variants and parent; retains COD, lot metadata and exact baselines", async () => {
  const f = await fixture(["a", "b"]); await change(f, "a", true);
  const v = f.parent.collection("variants").doc("b");
  await v.update({quantidade: 3, lotes: [{quantidade: 3, validade: new admin.firestore.Timestamp(2000000000, 123456789),
    unknown: {bytes: Buffer.from([1, 2]), reference: f.parent}}], future: null});
  await f.parent.update({isArchived: true, quantidade: 123, future: "kept"});
  const result = await list(f); assert.equal(result.status, "available");
  assert.equal(result.variants[0].data.isArchived, true); assert.equal(result.variants[0].data.cod, "V-A");
  const second = result.variants[1], saved = await v.get();
  assert.deepEqual(second.updateTime, time(saved.updateTime)); assert.equal(second.data.quantidade, 3);
  assert.equal(second.data.future, null); assert.deepEqual(second.data.attributes, saved.data().attributes);
  assert.deepEqual(second.data.lotes[0].validade, time(saved.data().lotes[0].validade));
  assert.equal(second.data.lotes[0].unknown.bytes.firestoreBytesBase64, "AQI=");
  assert.equal(second.data.lotes[0].unknown.reference.firestoreReference, f.parent.path);
  assert.equal(result.parent.data.quantidade, 123); assert.equal(result.parent.data.future, "kept");
  assert.equal(result.parent.isSellable, false);
});
test("invalid page/cursor inputs fail before transaction and are never empty", async () => {
  const f = await fixture(["a", "b", "d"]), first = await list(f), cursor = first.pagination.nextCursor;
  let calls = 0;
  const database = {projectId: db.projectId, _settings: db._settings, runTransaction: () => { calls++; throw new Error("No I/O"); }};
  for (const extra of [{pageSize: 0}, {pageSize: 51}, {pageSize: 1.5}, {pageSize: "2"}, {pageSize: null},
    {cursor: null}, {cursor: "cursor"}, {cursor: {}}, {cursor: {...cursor, version: 2}},
    {cursor: {...cursor, offset: 1}}, {cursor: {...cursor, offset: 200}},
    {cursor: {...cursor, fingerprint: "invalid"}}, {cursor: {...cursor, afterId: "../escape"}},
    {cursor: {...cursor, extra: true}}, {pageSize: 1, cursor}, {role: "admin"}, {uid: f.uid}, {scope: {...f.scope, role: "admin"}}]) {
    await assert.rejects(() => list(f, extra, database), {code: "invalid-argument"});
  }
  assert.equal(calls, 0);
});
test("cursor identity and position conflicts disclose no page, unsigned cursor is no credential", async () => {
  const f = await fixture(["a", "b", "d"]), first = await list(f), cursor = first.pagination.nextCursor;
  for (const altered of [{...cursor, productId: "other"},
    ...["projectId", "uid", "storeId"].map(k => ({...cursor, scope: {...cursor.scope, [k]: "other"}}))]) {
    noPage(await list(f, {cursor: altered}), "identity-conflict", "cursor-identity-conflict");
  }
  noPage(await list(f, {cursor: {...cursor, afterId: "z"}}), "identity-conflict", "cursor-position-conflict");
  noPage(await list(f, {cursor: {...cursor, fingerprint: "0".repeat(64)}}), "unknown", "listing-changed");
});
test("authentication, current role, revocation and store membership are rechecked on every page", async () => {
  const f = await fixture(["a", "b", "d"]), cursor = (await list(f)).pagination.nextCursor;
  const data = input(f, {cursor});
  for (const auth of [undefined, {}, {uid: "missing-user"}]) {
    noPage(await api.listProductVariantsB02(db, {auth, data}), "access-denied", "authorization-failed");
  }
  for (const patch of [{role: "unknown"}, {role: "admin", accessStatus: "revoked"},
    {accessStatus: "active", storeId: "another-store"}]) {
    await f.user.update(patch);
    noPage(await list(f, {cursor}), "access-denied", "authorization-failed");
  }
  await f.user.update({role: "admin", storeId: f.store.id, accessStatus: "active"});
  assert.equal((await list(f, {cursor})).pagination.complete, true);
  for (const role of ["admin", "gerente", "operador", "caixa", "vendedor"]) {
    await f.user.update({role}); assert.equal((await list(f)).status, "available");
  }
});
test("client project/uid/store claims and another product cannot redirect a cursor", async () => {
  const f = await fixture(["a", "b", "d"]), other = await fixture(["a"]);
  for (const scope of [{...f.scope, uid: other.uid}, {...f.scope, storeId: other.store.id}, {...f.scope, projectId: "demo-other"}]) {
    noPage(await list(f, {scope}), "access-denied", "authorization-failed");
  }
  const cursor = (await list(f)).pagination.nextCursor;
  noPage(await list(other, {cursor}), "identity-conflict", "cursor-identity-conflict");
  noPage(await list(f, {productId: other.parent.id}), "unknown", "entity-absent");
});
for (const mutation of ["stock", "archive", "insert", "parent"]) {
  test(`${mutation} between pages invalidates the traversal, including unchanged parent for C3`, async () => {
    const f = await fixture(["a", "b", "d"]), first = await list(f), parentBefore = await f.parent.get();
    if (mutation === "insert") await add(f, "later");
    else if (mutation === "parent") await f.parent.update({name: "Later"});
    else await change(f, "d", mutation === "archive");
    if (["stock", "archive"].includes(mutation)) assert.ok((await f.parent.get()).updateTime.isEqual(parentBefore.updateTime));
    noPage(await list(f, {cursor: first.pagination.nextCursor}), "unknown", "listing-changed");
    assert.equal((await list(f)).status, "available");
  });
}
test("parallel C3 adjustment and list return only consistent transactional snapshots", async () => {
  const f = await fixture(["a", "b", "d"]), ref = f.parent.collection("variants").doc("d"), before = await ref.get();
  const results = await Promise.all([change(f, "d"), ...Array.from({length: 3}, () => list(f, {pageSize: 3}))]);
  const after = await ref.get();
  for (const result of results.slice(1)) {
    assert.equal(result.status, "available"); assert.equal(result.pagination.complete, true);
    const v = result.variants[2]; assert.ok([0, 7].includes(v.data.quantidade));
    assert.deepEqual(v.updateTime, time(v.data.quantidade === 0 ? before.updateTime : after.updateTime));
    assert.equal(result.pagination.fingerprint, core.hash(core.canonical([1, f.scope, f.parent.id, result.parent.updateTime,
      result.variants.map(row => [row.identity.variantId, row.updateTime])])));
  }
});
test("concurrent revocation is serializable and committed revocation denies all later pages", async () => {
  const f = await fixture(["a"]);
  const results = await Promise.all([f.user.update({accessStatus: "revoked"}), list(f)]);
  assert.ok(["available", "access-denied"].includes(results[1].status));
  noPage(await list(f), "access-denied", "authorization-failed");
});
test("missing parent/store, simple or legacy product are never a proven empty variant parent", async () => {
  const f = await fixture(); noPage(await list(f, {productId: "absent"}), "unknown", "entity-absent");
  const storeId = randomUUID(), uid = randomUUID(); await db.collection("users").doc(uid).set({role: "admin", storeId});
  const missing = await api.listProductVariantsB02(db, {auth: {uid}, data: {scope: {...f.scope, uid, storeId}, productId: "p"}});
  noPage(missing, "unknown", "read-unavailable");
  for (const data of [{name: "Legacy"}, {productKind: "simple", variantSchemaVersion: 1, isArchived: false}]) {
    const ref = f.store.collection("products").doc(randomUUID()); await ref.set(data);
    noPage(await list(f, {productId: ref.id}), "inconsistent-state", "invalid-stored-state");
    assert.deepEqual((await ref.get()).data(), data);
  }
});
test("off-page corrupt link, inventory, attributes, archive, COD or index reject the whole page", async () => {
  for (const patch of [{productId: "other"}, {quantidade: -1}, {attributes: []}, {isArchived: null}, {cod: " v "}]) {
    const f = await fixture(["a", "b", "d"]); await f.parent.collection("variants").doc("d").update(patch);
    noPage(await list(f), "inconsistent-state", "invalid-stored-state");
  }
  const f = await fixture(["a", "b", "d"]); await codeRef(f.store, "V-D").update({variantId: "wrong"});
  noPage(await list(f), "inconsistent-state", "invalid-stored-state");
  const g = await fixture(["a", "b", "d"]), combo = g.parent.collection("variantCombinations")
    .doc(core.hash(JSON.stringify([["color", "d"]])));
  await combo.update({variantId: "wrong"});
  noPage(await list(g), "inconsistent-state", "invalid-stored-state");
});
test("collection larger than the existing 200-row local bound never reports truncated completion", async () => {
  const f = await fixture(), batch = db.batch();
  for (let i = 0; i < 201; i++) batch.set(f.parent.collection("variants").doc(`v-${i}`), {syntheticCorruption: true});
  await batch.commit(); noPage(await list(f), "inconsistent-state", "invalid-stored-state");
});
test("query/transaction failures stay unknown, no partial data or false empty", async () => {
  const f = await fixture();
  for (const code of [4, "unavailable", "deadline-exceeded", 10]) {
    const fake = {projectId: db.projectId, _settings: db._settings, runTransaction: async () => { throw Object.assign(new Error("test"), {code}); }};
    noPage(await list(f, {}, fake), "unknown", "read-unavailable");
  }
  const fake = {projectId: db.projectId, _settings: db._settings, collection: db.collection.bind(db),
    runTransaction: fn => db.runTransaction(tx => fn({get: ref => typeof ref.limit === "function" ?
      Promise.reject(new Error("Query failed")) : tx.get(ref)}))};
  noPage(await list(f, {}, fake), "unknown", "read-unavailable");
});
test("read-only transaction surface preserves all documents, receipts, reservations and baselines", async () => {
  const f = await fixture(["a", "b", "d"]), before = await allSnapshots(f);
  const readonly = {projectId: db.projectId, _settings: db._settings, collection: db.collection.bind(db),
    runTransaction: fn => db.runTransaction(tx => fn({get: tx.get.bind(tx)}))};
  const first = await list(f, {}, readonly); assert.equal(first.status, "available");
  assert.equal((await list(f, {cursor: first.pagination.nextCursor}, readonly)).pagination.complete, true);
  assert.deepEqual(await allSnapshots(f), before);
});
test("input snapshot and demo/effective SDK guards are checked before all I/O", async () => {
  const f = await fixture(["a"]), data = input(f), pending = api.listProductVariantsB02(db, request(f, data));
  data.scope = {projectId: "other", uid: "other", storeId: "other"}; data.productId = "other";
  const result = await pending; assert.equal(result.status, "available"); assert.equal(result.identity.productId, f.parent.id);
  for (const database of [{projectId: "production", _settings: db._settings},
    {projectId: db.projectId, _settings: {...db._settings, ssl: true}},
    {projectId: db.projectId, _settings: {...db._settings, servicePath: "remote.example"}}]) {
    await assert.rejects(() => list(f, {}, database), {code: "failed-precondition"});
  }
});
