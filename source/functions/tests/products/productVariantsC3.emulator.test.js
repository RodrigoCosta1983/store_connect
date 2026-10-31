"use strict";
const {seedAdmission} = require("../sales/fixtures/storeWriterAdmissionFixture.cjs");
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const admin = require("firebase-admin");
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(localhost|127\.0\.0\.1):\d+$/);
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
const c12 = require("../../products/productVariantsC1");
const api = require("../../products/productVariantsC3");
const {adjustProductStockV1} = require("../../products/productMutationV2");
const {codeRef} = require("../../products/productCodeReservation");
after(() => db.terminate());
const timestamp = (v) => ({seconds: String(v.seconds), nanoseconds: v.nanoseconds});
const request = (f, data) => ({auth: {uid: f.uid}, data});
const stock = (f, c) => api.adjustVariantStockC3(db, request(f, c));
const archive = (f, c) => api.archiveVariantC3(db, request(f, c));
test("F10 C3 stock receipt survives closure without another stock mutation", async () => {
  const f = await fixture(), c = await command(f);
  await stock(f, c);
  await seedAdmission(db, f.store.id, "draining", 2);
  assert.equal((await stock(f, c)).replayed, true);
  await assert.rejects(stock(f, await command(f, {kind: "setManualQuantity", quantity: 99})),
    error => error.details?.reason === "writer-admission-denied");
  assert.equal((await f.leaves[0].get()).data().quantidade, 5);
});
const rejection = (fn, code, reason) => assert.rejects(fn, (e) => {
  assert.equal(e.code, code); if (reason) assert.equal(e.details?.reason, reason); return true;
});
async function fixture(identity = {}) {
  const store = db.collection("stores").doc(randomUUID()); const uid = randomUUID();
  const user = db.collection("users").doc(uid); await store.set({});
  await user.set({role: "admin", storeId: store.id});
  await seedAdmission(db, store.id);
  const scope = {projectId: db.projectId, storeId: store.id, uid};
  const parent = store.collection("products").doc(identity.productId || randomUUID());
  const f = {store, uid, user, scope, parent, leaves: [], creates: []};
  const p = {schemaVersion: 1, scope, requestId: randomUUID(), productId: parent.id,
    product: {productKind: "variantParent", name: "Synthetic", cod: "PARENT", attributeDefinitions: [
      {attributeId: "color", label: "Color", values: [{valueId: "red", label: "Red"}, {valueId: "blue", label: "Blue"}]}]}};
  await c12.createProductC2(db, request(f, p)); f.creates.push(p);
  for (const color of ["red", "blue"]) {
    const leaf = parent.collection("variants").doc(identity.variantIds ? identity.variantIds[f.leaves.length] : randomUUID());
    const c = {schemaVersion: 1, scope, requestId: randomUUID(), productId: parent.id,
      variantId: leaf.id, expectedProductUpdateTime: timestamp((await parent.get()).updateTime),
      variant: {cod: color.toUpperCase(), attributes: [{attributeId: "color", valueId: color}]}};
    await c12.createVariantC2(db, request(f, c)); f.leaves.push(leaf); f.creates.push(c);
  }
  return f;
}
async function command(f, change = {kind: "setManualQuantity", quantity: 5}, index = 0) {
  const p = await f.parent.get(); const v = await f.leaves[index].get();
  return {schemaVersion: 1, requestId: randomUUID(), scope: f.scope, productId: f.parent.id,
    variantId: f.leaves[index].id, expectedProductUpdateTime: timestamp(p.updateTime),
    expectedVariantUpdateTime: timestamp(v.updateTime), reason: " Synthetic adjustment ",
    ...(change === null ? {} : {stockChange: change})};
}
async function state(f) {
  return {parent: (await f.parent.get()).data(), variants: await Promise.all(f.leaves.map(async (ref) => (await ref.get()).data())),
    codes: (await f.store.collection("productCodes").get()).docs.map((s) => [s.id, s.data()]),
    combinations: (await f.parent.collection("variantCombinations").get()).docs.map((s) => [s.id, s.data()]),
    receipts: (await f.store.collection("auditLogs").get()).docs.map((s) => [s.id, s.data()])};
}
const inventory = (raw) => ({quantidade: raw.quantidade, ...(Object.hasOwn(raw, "lotes") ? {lotes: raw.lotes} : {})});

test("independent sibling adjustments leave parent, codes, combinations and old receipts untouched", async () => {
  const f = await fixture(); const before = await state(f); const parentToken = (await f.parent.get()).updateTime;
  const a = await command(f); const b = await command(f, {kind: "setManualQuantity", quantity: 9}, 1);
  await Promise.all([stock(f, a), stock(f, b)]);
  const after = await state(f);
  assert.deepEqual(after.variants.map((v) => v.quantidade), [5, 9]);
  assert.deepEqual(after.parent, before.parent); assert.equal(after.parent.quantidade, 0);
  assert.ok((await f.parent.get()).updateTime.isEqual(parentToken));
  assert.deepEqual(after.codes, before.codes); assert.deepEqual(after.combinations, before.combinations);
  for (const entry of before.receipts) assert.deepEqual(after.receipts.find((r) => r[0] === entry[0]), entry);
  assert.equal((await c12.readProductC1(db, request(f, {scope: f.scope, productId: f.parent.id}))).entity.isSellable, false);
});
test("same variant baseline under concurrent distinct adjustments has one winner", async () => {
  const f = await fixture(); const a = await command(f); const b = {...a, requestId: randomUUID(),
    stockChange: {kind: "setManualQuantity", quantity: 8}};
  const outcomes = await Promise.allSettled([stock(f, a), stock(f, b)]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(outcomes.find((r) => r.status === "rejected").reason.code, "aborted");
  assert.equal((await f.store.collection("auditLogs").get()).size, 4);
});
test("concurrent replay is one effect and survives later stock/archive/parent changes", async () => {
  const f = await fixture(); const c = await command(f);
  const results = await Promise.all([stock(f, c), stock(f, c)]);
  assert.equal(results.filter((r) => r.replayed).length, 1);
  await stock(f, await command(f, {kind: "setManualQuantity", quantity: 7}));
  const a = await command(f, null); await archive(f, a); await f.parent.update({isArchived: true});
  const before = await state(f);
  assert.equal((await stock(f, c)).replayed, true); assert.equal((await archive(f, a)).replayed, true);
  assert.deepEqual(await state(f), before);
});
test("stale parent/variant tokens and microsecond changes reject without receipt", async () => {
  const f = await fixture(); const c = await command(f);
  const ns = c.expectedVariantUpdateTime.nanoseconds;
  const bad = {...c, expectedVariantUpdateTime: {...c.expectedVariantUpdateTime,
    nanoseconds: ns % 1000000 === 999000 ? ns - 1000 : ns + 1000}};
  const before = await state(f); await rejection(() => stock(f, bad), "aborted");
  assert.deepEqual(await state(f), before);
  await f.parent.update({name: "Changed"}); await rejection(() => stock(f, c), "aborted");
  const staleArchive = await command(f, null);
  await stock(f, await command(f)); await rejection(() => archive(f, staleArchive), "aborted");
});
test("F9 parity: conversions, positional lot edits, zero lots, nanoseconds and unknown metadata", async () => {
  const f = await fixture(); const reference = f.store.collection("products").doc("f9-reference");
  await reference.set({quantidade: 0, lotes: [], isArchived: false});
  const changes = [
    {kind: "setManualQuantity", quantity: 6},
    {kind: "convertToLots", lots: [{quantidade: 2, validadeMs: 1893456000000}, {quantidade: 4, validadeMs: 1893542400000}]},
    {kind: "editLots", operations: [{op: "update", index: 0, set: {quantidade: 0}},
      {op: "add", quantidade: 3, validadeMs: 1893628800000}]},
    {kind: "editLots", operations: [{op: "remove", index: 0}, {op: "update", index: 1, set: {quantidade: 1}}]},
    {kind: "convertToManual", quantity: 9, acknowledgement: true},
  ];
  for (let i = 0; i < changes.length; i++) {
    if (i === 2) {
      const lots = (await reference.get()).data().lotes;
      lots[1] = {...lots[1], validade: new admin.firestore.Timestamp(1893542400, 123456000),
        lotId: "stable-existing", unknown: {cost: null, custom: "retained"}};
      await reference.update({lotes: lots}); await f.leaves[0].update({lotes: lots});
    }
    await adjustProductStockV1.run(request(f, {schemaVersion: 1, requestId: randomUUID(), productId: reference.id,
      expectedUpdateTime: timestamp((await reference.get()).updateTime), reason: "Synthetic adjustment", stockChange: changes[i]}));
    await stock(f, await command(f, changes[i]));
    assert.deepEqual(inventory((await f.leaves[0].get()).data()), inventory((await reference.get()).data()));
  }
});
test("invalid quantities/intent/lot edits/modes/overflow never commit partial inventory", async () => {
  const f = await fixture();
  for (const change of [{kind: "setManualQuantity", quantity: -1}, {kind: "setManualQuantity", quantity: 1.5},
    {kind: "setManualQuantity", quantity: "2"}, {kind: "setManualQuantity", quantity: Number.MAX_SAFE_INTEGER + 1},
    {kind: "consumeFIFO", quantity: 1}, {kind: "convertToManual", quantity: 1},
    {kind: "convertToLots", lots: []}, {kind: "convertToLots", lots: [{quantidade: 0, validadeMs: 1}]},
    {kind: "convertToLots", lots: [{quantidade: 1, validadeMs: 253402300800000}]}]) {
    const c = await command(f, change); const before = await state(f);
    await rejection(() => stock(f, c), "invalid-argument"); assert.deepEqual(await state(f), before);
  }
  await stock(f, await command(f, {kind: "convertToLots", lots: [
    {quantidade: 2, validadeMs: 1893456000000}, {quantidade: 3, validadeMs: 1893542400000}]}));
  for (const change of [{kind: "setManualQuantity", quantity: 1},
    {kind: "editLots", operations: [{op: "remove", index: 2}]},
    {kind: "editLots", operations: [{op: "remove", index: 0}, {op: "remove", index: 1}]},
    {kind: "editLots", operations: [{op: "update", index: 0, set: {quantidade: Number.MAX_SAFE_INTEGER}}]}]) {
    const before = await state(f); await rejection(() => command(f, change).then((c) => stock(f, c)), "failed-precondition");
    assert.deepEqual(await state(f), before);
  }
  const duplicate = await command(f, {kind: "editLots", operations: [{op: "remove", index: 0}, {op: "remove", index: 0}]});
  await rejection(() => stock(f, duplicate), "invalid-argument");
});
test("malformed current inventory blocks stock and archive without silent repair", async () => {
  const f = await fixture();
  for (const patch of [{quantidade: -1, lotes: []}, {quantidade: 1.5, lotes: []},
    {quantidade: 1, lotes: null}, {quantidade: 1, lotes: [{quantidade: 1, validade: 1}]},
    {quantidade: 2, lotes: [{quantidade: 1, validade: admin.firestore.Timestamp.fromMillis(1)}]}]) {
    await f.leaves[0].update(patch); const before = await state(f);
    await rejection(() => command(f).then((c) => stock(f, c)), "failed-precondition");
    await rejection(() => command(f, null).then((c) => archive(f, c)), "failed-precondition");
    assert.deepEqual(await state(f), before);
  }
});
test("archive preserves lots, COD, historical documents, attributes and sibling eligibility", async () => {
  const f = await fixture();
  await stock(f, await command(f, {kind: "convertToLots", lots: [{quantidade: 4, validadeMs: 1893456000000}]}));
  const history = f.leaves[0].collection("history").doc("existing"); await history.set({legacy: {retained: true}});
  const before = (await f.leaves[0].get()).data(); const codes = await codeRef(f.store, "RED").get();
  const a = await command(f, null); assert.equal((await archive(f, a)).changed, true);
  const after = (await f.leaves[0].get()).data();
  assert.deepEqual({...after, isArchived: before.isArchived, updatedAt: before.updatedAt}, before);
  assert.deepEqual((await history.get()).data(), {legacy: {retained: true}});
  assert.ok((await codeRef(f.store, "RED").get()).updateTime.isEqual(codes.updateTime));
  const noOp = await command(f, null); const token = (await f.leaves[0].get()).updateTime;
  assert.equal((await archive(f, noOp)).changed, false);
  assert.ok((await f.leaves[0].get()).updateTime.isEqual(token));
  await rejection(() => command(f).then((c) => stock(f, c)), "failed-precondition");
  await stock(f, await command(f, {kind: "setManualQuantity", quantity: 2}, 1));
  await f.parent.update({isArchived: true});
  await rejection(() => command(f, {kind: "setManualQuantity", quantity: 3}, 1).then((c) => stock(f, c)), "failed-precondition");
  await rejection(() => command(f, null, 1).then((c) => archive(f, c)), "failed-precondition");
});
test("archive/stock race serializes; losing stale intent cannot restore eligibility or inventory", async () => {
  const f = await fixture(); const s = await command(f); const a = await command(f, null);
  const results = await Promise.allSettled([stock(f, s), archive(f, a)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.code, "aborted");
  if (results[1].status === "rejected") await archive(f, await command(f, null));
  await rejection(() => command(f).then((c) => stock(f, c)), "failed-precondition");
});
test("one shared receipt barrier across C1/C2 create, adjustment and archive in both directions", async () => {
  const f = await fixture();
  const c = {...await command(f), requestId: f.creates[1].requestId};
  await rejection(() => stock(f, c), "already-exists", "request-identity-conflict");
  await rejection(async () => archive(f, {...await command(f, null), requestId: f.creates[0].requestId}), "already-exists");
  const s = await command(f); await stock(f, s); const before = await state(f);
  await rejection(() => stock(f, {...s, reason: "Different"}), "already-exists");
  await rejection(async () => archive(f, {...await command(f, null), requestId: s.requestId}), "already-exists");
  const p = {...f.creates[0], requestId: s.requestId, productId: randomUUID()};
  await rejection(() => c12.createProductC1(db, request(f, p)), "invalid-argument"); // Original C1 rejects COD.
  delete p.product.cod; await rejection(() => c12.createProductC1(db, request(f, p)), "already-exists");
  await rejection(() => c12.createProductC2(db, request(f, {...p, product: {...p.product, cod: "NEW"}})), "already-exists");
  assert.deepEqual(await state(f), before);
  const a = await command(f, null); await archive(f, a);
  await rejection(async () => stock(f, {...await command(f), requestId: a.requestId}), "already-exists");
});
test("concurrent creation/adjustment with same requestId cannot use separate namespaces", async () => {
  const f = await fixture(); const s = await command(f);
  const p = {...f.creates[0], requestId: s.requestId, productId: randomUUID()};
  delete p.product.cod;
  const results = await Promise.allSettled([stock(f, s), c12.createProductC2(db, request(f, p))]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.details.reason, "request-identity-conflict");
});
test("authorization, admin-only archive, role/revocation/membership and scope include replays", async () => {
  const f = await fixture(); const s = await command(f); const a = await command(f, null);
  await rejection(() => api.adjustVariantStockC3(db, {data: s}), "unauthenticated");
  await rejection(() => api.archiveVariantC3(db, {data: a}), "unauthenticated");
  for (const key of ["projectId", "storeId", "uid"]) {
    await rejection(() => stock(f, {...s, scope: {...s.scope, [key]: "other"}}), "permission-denied");
  }
  await f.user.update({role: "vendedor"});
  await rejection(() => archive(f, a), "permission-denied"); await stock(f, s);
  await f.user.update({role: "admin"}); const fresh = await command(f, null); await archive(f, fresh);
  await f.user.update({role: "gerente"}); await rejection(() => archive(f, fresh), "permission-denied");
  await f.user.update({role: "admin", accessStatus: "revoked"});
  await rejection(() => stock(f, s), "permission-denied"); await rejection(() => archive(f, fresh), "permission-denied");
  await f.user.update({accessStatus: "active", storeId: "other"});
  await rejection(() => stock(f, s), "permission-denied");
});
test("scope isolates equal product/variant/request IDs across stores", async () => {
  const f = await fixture();
  const g = await fixture({productId: f.parent.id, variantIds: f.leaves.map((v) => v.id)});
  const s = await command(f); await stock(f, s);
  const gc = {...await command(g, {kind: "setManualQuantity", quantity: 9}), requestId: s.requestId};
  await stock(g, gc);
  await rejection(() => stock(g, {...gc, productId: randomUUID(), requestId: randomUUID()}), "not-found");
  assert.equal((await f.leaves[0].get()).data().quantidade, 5);
  assert.equal((await g.leaves[0].get()).data().quantidade, 9);
});
test("failure after staging stock or archive rolls back document/token/receipt and permits retry", async () => {
  for (const operation of ["stock", "archive"]) {
    const f = await fixture(); const c = await command(f, operation === "stock" ? {kind: "setManualQuantity", quantity: 6} : null);
    const before = await state(f); const token = (await f.leaves[0].get()).updateTime;
    const original = db.runTransaction.bind(db);
    db.runTransaction = (callback) => original(async (tx) => { await callback(tx); throw new Error("synthetic-before-commit"); });
    try { await assert.rejects(() => (operation === "stock" ? stock : archive)(f, c), /synthetic-before-commit/); }
    finally { db.runTransaction = original; }
    assert.deepEqual(await state(f), before); assert.ok((await f.leaves[0].get()).updateTime.isEqual(token));
    await (operation === "stock" ? stock : archive)(f, c);
  }
});
test("COD/combination corruption is not repaired by stock or archive", async () => {
  const f = await fixture(); const code = codeRef(f.store, "RED"); const saved = (await code.get()).data();
  await code.delete(); const before = await state(f);
  await rejection(() => command(f).then((c) => stock(f, c)), "failed-precondition");
  await rejection(() => command(f, null).then((c) => archive(f, c)), "failed-precondition");
  assert.deepEqual(await state(f), before); await code.set(saved);
  const combination = (await f.parent.collection("variantCombinations").get()).docs.find((d) => d.data().variantId === f.leaves[0].id);
  await combination.ref.update({variantId: "other"});
  await rejection(() => command(f).then((c) => stock(f, c)), "failed-precondition");
});
test("strict intents reject cadastral/stock smuggling, arbitrary paths, wrong identity and remote SDK", async () => {
  const f = await fixture(); const s = await command(f); const a = await command(f, null);
  for (const patch of [{changes: {set: {quantidade: 10}}}, {quantidade: 10}, {lotes: []}, {cod: "NEW"},
    {variantId: null}, {variantId: "bad/id"}, {reason: " "}, {schemaVersion: 2}]) {
    await rejection(() => stock(f, {...s, ...patch}), "invalid-argument");
  }
  await rejection(() => archive(f, {...a, stockChange: s.stockChange}), "invalid-argument");
  await rejection(() => c12.createVariantC2(db, request(f, {...f.creates[1], requestId: randomUUID(),
    variant: {...f.creates[1].variant, quantidade: 7}})), "invalid-argument");
  const parent = {...s, variantId: f.parent.id}; await rejection(() => stock(f, parent), "not-found");
  const original = process.env.FIRESTORE_EMULATOR_HOST;
  try {
    process.env.FIRESTORE_EMULATOR_HOST = "remote.example:8080";
    await rejection(() => stock(f, s), "failed-precondition"); await rejection(() => archive(f, a), "failed-precondition");
  } finally { process.env.FIRESTORE_EMULATOR_HOST = original; }
  await rejection(() => api.adjustVariantStockC3({projectId: "production"}, request(f, s)), "failed-precondition");
});
test("unknown document and lot metadata survive adjustment/archive; C1/C2 receipts still replay", async () => {
  const f = await fixture(); const extra = {future: {value: null, ref: f.parent, bytes: Buffer.from([1, 2])}};
  await f.parent.update({unknownMetadata: extra});
  await f.leaves[0].update({unknownMetadata: extra});
  await stock(f, await command(f, {kind: "convertToLots", lots: [{quantidade: 2, validadeMs: 1893456000000}]}));
  const lots = (await f.leaves[0].get()).data().lotes;
  lots[0].unknown = extra; lots[0].validade = new admin.firestore.Timestamp(1893456000, 123456000);
  await f.leaves[0].update({lotes: lots});
  await stock(f, await command(f, {kind: "editLots", operations: [{op: "update", index: 0, set: {quantidade: 3}}]}));
  await archive(f, await command(f, null));
  const raw = (await f.leaves[0].get()).data();
  assert.deepEqual(raw.unknownMetadata, extra); assert.deepEqual(raw.lotes[0].unknown, extra);
  assert.equal(raw.lotes[0].validade.nanoseconds, 123456000);
  assert.deepEqual((await f.parent.get()).data().unknownMetadata, extra);
  assert.equal((await c12.createProductC2(db, request(f, f.creates[0]))).replayed, true);
  assert.equal((await c12.createVariantC2(db, request(f, f.creates[1]))).replayed, true);
});
test("no-op manual adjustment records intention without advancing baseline; caller payload is frozen before await", async () => {
  const f = await fixture(); const c = await command(f, {kind: "setManualQuantity", quantity: 0});
  const token = (await f.leaves[0].get()).updateTime;
  assert.equal((await stock(f, c)).changed, false);
  assert.ok((await f.leaves[0].get()).updateTime.isEqual(token));
  const next = await command(f); const pending = stock(f, next);
  next.stockChange.quantity = 99; next.reason = "mutated";
  await pending; assert.equal((await f.leaves[0].get()).data().quantidade, 5);
});
