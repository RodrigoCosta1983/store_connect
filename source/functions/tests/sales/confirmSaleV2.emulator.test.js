"use strict";
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const {seedAdmission} = require("./fixtures/storeWriterAdmissionFixture.cjs");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
const admin = require("firebase-admin");
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
const {confirmSaleV2, getSaleMutationResultV1} = require("../../sales/confirmSaleV2");
const {adjustProductStockV1} = require("../../products/productMutationV2");
after(() => db.terminate());
async function fixture(overrides = {}) {
  const uid = randomUUID();
  const store = db.collection("stores").doc(randomUUID());
  const user = db.collection("users").doc(uid);
  const product = store.collection("products").doc("p");
  await store.set({ownerId: uid, subscriptionStatus: "active"});
  await seedAdmission(db, store.id);
  await user.set({storeId: store.id, role: "admin"});
  await product.set({name: "Produto", price: 0.29, quantidade: 5, lotes: [], legacy: {keep: true}, ...overrides});
  const saleId = randomUUID();
  const data = {schemaVersion: 2, requestId: saleId, saleId,
    scope: {projectId: process.env.GCLOUD_PROJECT, uid, storeId: store.id},
    origin: "online", saleKind: "instant", paymentMethod: "Dinheiro",
    items: [{productId: "p", quantity: 1, expectedUnitPriceCents: 29}], expectedTotalCents: 29};
  return {uid, store, user, product, data};
}
const send = (f, data = f.data, uid = f.uid) => confirmSaleV2.run({auth: {uid}, data});
const query = (f, data = f.data, uid = f.uid) => getSaleMutationResultV1.run({auth: {uid}, data});
const saleRef = (f) => f.store.collection("sales").doc(f.data.saleId);
const count = async (f, collection) => (await f.store.collection(collection).get()).size;
const quantity = async (f) => (await f.product.get()).data().quantidade;
const units = (f, n) => ({...f.data, items: [{...f.data.items[0], quantity: n}], expectedTotalCents: 29 * n});
const another = (data) => { const saleId = randomUUID(); return {...data, requestId: saleId, saleId}; };
test("valid manual sale historical shape; no cash, costs, installments or fiscal effects", async () => {
  const f = await fixture(); const before = (await f.product.get()).data();
  assert.equal((await send(f)).status, "confirmed");
  const saved = (await saleRef(f).get()).data();
  assert.deepEqual(Object.keys(saved).sort(), ["totalAmount", "products", "createdAt", "storeId", "notes", "paymentMethod", "isPaid", "customerId", "customerName", "localSaleId", "syncOrigin"].sort());
  assert.deepEqual(saved.products, [{productId: "p", name: "Produto", quantity: 1, price: 0.29}]);
  assert.equal(saved.totalAmount, 0.29); assert.equal(saved.isPaid, true); assert.equal(saved.syncOrigin, "online");
  assert.ok(saved.createdAt instanceof admin.firestore.Timestamp);
  assert.deepEqual((await f.product.get()).data(), {...before, quantidade: 4});
  assert.equal(await count(f, "cash_flow"), 0); assert.equal(await count(f, "auditLogs"), 1);
  const receipt = (await f.store.collection("auditLogs").get()).docs[0].data();
  assert.equal(receipt.actorUid, f.uid); assert.equal(receipt.saleId, f.data.saleId); assert.match(receipt.requestHash, /^[0-9a-f]{64}$/);
});
test("FIFO by full timestamp and stable original index preserves maps/dates", async () => {
  const t = new admin.firestore.Timestamp(1900000000, 123456000);
  const f = await fixture({quantidade: 7, lotes: [
    {quantidade: 2, validade: new admin.firestore.Timestamp(t.seconds, 123457000), id: "later", metadata: {keep: true}},
    {quantidade: 2, validade: t, id: "first", arbitrary: ["keep"]},
    {quantidade: 3, validade: t, id: "second", legacy: {date: t}},
  ]});
  const original = (await f.product.get()).data().lotes;
  assert.equal((await send(f, units(f, 3))).status, "confirmed");
  assert.deepEqual((await f.product.get()).data().lotes, [{...original[2], quantidade: 2}, original[0]]);
  assert.equal(await quantity(f), 4);
});
test("same identity concurrent requests apply once; lost response and later financial/fiscal edits survive replay", async () => {
  const f = await fixture();
  const results = await Promise.all([send(f), send(f)]);
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  await assert.rejects(async () => { await send(f); throw new Error("lost response"); });
  await saleRef(f).update({paidAmount: 0.1, totalPaidAmount: 0.1, isPaid: false, fiscal: {nfce: {status: "autorizado"}}, custom: true});
  await f.product.update({price: 999, isArchived: true});
  await f.store.update({subscriptionStatus: "inactive"});
  const before = await saleRef(f).get();
  assert.equal((await query(f)).status, "confirmed"); assert.equal((await send(f)).replayed, true);
  const after = await saleRef(f).get(); assert.ok(after.updateTime.isEqual(before.updateTime)); assert.deepEqual(after.data(), before.data());
  assert.equal(await quantity(f), 4); assert.equal(await count(f, "auditLogs"), 1);
});
test("same identity divergent command conflicts; two identities for identical legitimate sales both confirm", async () => {
  const f = await fixture(); await send(f);
  assert.equal((await send(f, units(f, 2))).status, "identity-conflict");
  assert.equal((await query(f, {...f.data, notes: "different"})).status, "identity-conflict");
  assert.equal((await send(f, another(f.data))).status, "confirmed");
  assert.equal(await quantity(f), 3); assert.equal(await count(f, "sales"), 2);
});
test("two different concurrent sales cannot oversell", async () => {
  const f = await fixture({quantidade: 1});
  const results = await Promise.all([send(f), send(f, another(f.data))]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["confirmed", "rejected"]);
  assert.equal(await quantity(f), 0); assert.equal(await count(f, "sales"), 1); assert.equal(await count(f, "auditLogs"), 2);
});
test("concurrency with B05 uses current stock or rejects stale adjustment", async () => {
  const f = await fixture(); const baseline = await f.product.get();
  const data = {schemaVersion: 1, requestId: randomUUID(), productId: "p",
    expectedUpdateTime: {seconds: String(baseline.updateTime.seconds), nanoseconds: baseline.updateTime.nanoseconds},
    reason: "Contagem", stockChange: {kind: "setManualQuantity", quantity: 8}};
  const [sold, adjusted] = await Promise.allSettled([send(f), adjustProductStockV1.run({auth: {uid: f.uid}, data})]);
  assert.equal(sold.status, "fulfilled"); assert.equal(sold.value.status, "confirmed");
  if (adjusted.status === "fulfilled") assert.equal(await quantity(f), 7);
  else { assert.equal(adjusted.reason.details.reason, "product-version-conflict"); assert.equal(await quantity(f), 4); }
  await assert.rejects(() => adjustProductStockV1.run({auth: {uid: f.uid}, data: {...data, requestId: randomUUID()}}), (e) => e.details.reason === "product-version-conflict");
});
for (const [label, overrides, reason] of [
  ["insufficient", {quantidade: 0}, "insufficient-stock"], ["price changed", {price: 0.30}, "price-conflict"],
  ["fractional cents", {price: 1.005}, "invalid-current-price"], ["archived", {isArchived: true}, "product-archived"],
  ["NaN price", {price: NaN}, "invalid-current-price"],
  ["Infinity price", {price: Infinity}, "invalid-current-price"],
  ["-Infinity price", {price: -Infinity}, "invalid-current-price"],
  ["bad quantity", {quantidade: -1}, "invalid-current-stock"], ["bad lots", {lotes: null}, "invalid-current-stock"],
  ["inconsistent lots", {lotes: [{quantidade: 1, validade: admin.firestore.Timestamp.now()}]}, "inconsistent-current-stock"],
  ["missing lot date", {lotes: [{quantidade: 5}]}, "invalid-current-stock"],
]) test("terminal rejection: " + label, async () => {
  const f = await fixture(overrides); const before = await f.product.get();
  assert.deepEqual(await send(f), {status: "rejected", saleId: f.data.saleId, reason, replayed: false});
  assert.ok((await f.product.get()).updateTime.isEqual(before.updateTime)); assert.equal(await count(f, "sales"), 0);
  const receipt = (await f.store.collection("auditLogs").get()).docs[0];
  assert.equal(await count(f, "auditLogs"), 1);
  assert.equal(receipt.data().result.reason, reason);
  await f.product.set({name: "Fixed", price: 0.29, quantidade: 50, lotes: []});
  assert.equal((await send(f)).reason, reason); assert.equal((await query(f)).status, "rejected"); assert.equal(await quantity(f), 50);
  assert.ok((await receipt.ref.get()).updateTime.isEqual(receipt.updateTime));
});
test("failure in second product leaves first stock untouched; no partial FIFO", async () => {
  const f = await fixture({lotes: [{quantidade: 5, validade: admin.firestore.Timestamp.now()}]});
  const before = await f.product.get();
  const data = {...f.data, items: [...f.data.items, {productId: "z-missing", quantity: 1, expectedUnitPriceCents: 29}], expectedTotalCents: 58};
  assert.equal((await send(f, data)).reason, "product-unavailable");
  assert.ok((await f.product.get()).updateTime.isEqual(before.updateTime)); assert.equal(await count(f, "sales"), 0);
});
test("all recognized operational roles; revoked/missing/unknown profile and wrong scope deny", async () => {
  const f = await fixture({quantidade: 20});
  for (const role of ["admin", "gerente", "operador", "caixa", "vendedor"]) {
    await f.user.update({role}); assert.equal((await send(f, another(f.data))).status, "confirmed");
  }
  for (const role of ["owner", "superadmin", "cliente", ""]) {
    await f.user.update({role}); await assert.rejects(() => send(f), (e) => e.code === "permission-denied");
  }
  await f.user.update({role: "admin", accessStatus: "revoked"});
  await assert.rejects(() => send(f), (e) => e.code === "permission-denied");
  await assert.rejects(() => query(f), (e) => e.code === "permission-denied");
  await f.user.update({accessStatus: "active"});
  for (const field of ["uid", "storeId", "projectId"]) {
    const data = {...f.data, scope: {...f.data.scope, [field]: "other"}};
    await assert.rejects(() => send(f, data), (e) => e.code === "permission-denied");
    await assert.rejects(() => query(f, data), (e) => e.code === "permission-denied");
  }
  await assert.rejects(() => confirmSaleV2.run({data: f.data}), (e) => e.code === "unauthenticated");
  await f.user.delete(); await assert.rejects(() => send(f), (e) => e.code === "permission-denied");
});
test("store isolation, membership change, actor collision and private result lookup", async () => {
  const f = await fixture(); await send(f);
  const other = await fixture();
  await assert.rejects(() => query(f, f.data, other.uid), (e) => e.code === "permission-denied");
  await other.user.update({storeId: f.store.id});
  const command = {...f.data, scope: {...f.data.scope, uid: other.uid}};
  assert.equal((await send(f, command, other.uid)).status, "identity-conflict");
  await assert.rejects(() => query(f, command, other.uid), (e) => e.code === "permission-denied");
  await f.user.update({storeId: other.store.id});
  await assert.rejects(() => query(f), (e) => e.code === "permission-denied");
  assert.equal(await quantity(f), 4);
});
test("invalid money/quantity/duplicate/extra fields fail without receipt or sale", async () => {
  const f = await fixture();
  for (const data of [units(f, 0), units(f, -1), units(f, 1.5), units(f, Number.MAX_SAFE_INTEGER),
    {...f.data, items: [...f.data.items, ...f.data.items], expectedTotalCents: 58},
    {...f.data, expectedTotalCents: "29"}, {...f.data, fiscal: {}}, {...f.data, items: [{...f.data.items[0], quantity: "1"}]}]) {
    await assert.rejects(() => send(f, data), (e) => e.code === "invalid-argument");
  }
  assert.equal(await count(f, "auditLogs"), 0); assert.equal(await quantity(f), 5);
});
test("failure immediately before commit yields not-recorded, same frozen identity can retry", async () => {
  const f = await fixture(); const original = db.runTransaction;
  // Inject into the actual Admin transaction, after ALL writes were queued.
  db.runTransaction = function(callback, ...args) {
    return original.call(this, async (tx) => {
      await callback(tx);
      // A lookup while the first attempt is still in flight is not final.
      const intercepted = db.runTransaction;
      db.runTransaction = original;
      try {
        const inFlight = await query(f);
        assert.equal(inFlight.status, "not-recorded");
        assert.equal(inFlight.definitive, false);
      } finally { db.runTransaction = intercepted; }
      throw new Error("injected precommit failure");
    }, ...args);
  };
  try { await assert.rejects(() => send(f), /injected precommit failure/); }
  finally { db.runTransaction = original; }
  assert.equal((await query(f)).status, "not-recorded"); assert.equal((await query(f)).definitive, false);
  assert.equal(await quantity(f), 5); assert.equal(await count(f, "sales"), 0); assert.equal(await count(f, "auditLogs"), 0);
  assert.equal((await send(f)).status, "confirmed"); assert.equal(await quantity(f), 4);
});
test("legacy existing sale cannot fabricate V2 receipt or lower stock", async () => {
  const f = await fixture(); await saleRef(f).set({legacy: true});
  assert.equal((await send(f)).status, "identity-conflict"); assert.equal((await query(f)).status, "identity-conflict");
  assert.equal(await count(f, "auditLogs"), 0); assert.equal(await quantity(f), 5);
});
test("optional instant customer snapshot derives from same store; receipt replay ignores later customer changes", async () => {
  const f = await fixture(); await f.store.collection("customers").doc("c").set({name: "Original"});
  const data = {...f.data, customerId: "c", notes: "note"};
  assert.equal((await send(f, data)).status, "confirmed");
  await f.store.collection("customers").doc("c").delete();
  assert.equal((await send(f, data)).replayed, true);
  assert.equal((await saleRef(f).get()).data().customerName, "Original");
});
test("new-sale subscription eligibility preserves online statuses and default; replay/query remain available", async () => {
  const f = await fixture({quantidade: 20});
  for (const subscriptionStatus of ["active", "trial", "overdue", null]) {
    await f.store.update({subscriptionStatus}); assert.equal((await send(f, another(f.data))).status, "confirmed");
  }
  await f.store.update({subscriptionStatus: "inactive"});
  await assert.rejects(() => send(f), (e) => e.details.reason === "subscription-ineligible");
  assert.equal((await query(f)).status, "not-recorded"); assert.equal(await quantity(f), 16);
});
test("local gate refuses non-demo project and non-loopback host before any effect", async () => {
  const f = await fixture();
  const project = process.env.GCLOUD_PROJECT; const host = process.env.FIRESTORE_EMULATOR_HOST;
  try {
    process.env.GCLOUD_PROJECT = "real-project";
    await assert.rejects(() => send(f), (e) => e.details.reason === "local-emulator-only");
    process.env.GCLOUD_PROJECT = project; process.env.FIRESTORE_EMULATOR_HOST = "remote.example:8080";
    await assert.rejects(() => query(f), (e) => e.details.reason === "local-emulator-only");
  } finally { process.env.GCLOUD_PROJECT = project; process.env.FIRESTORE_EMULATOR_HOST = host; }
  assert.equal(await quantity(f), 5); assert.equal(await count(f, "auditLogs"), 0);
});
test("safe integer total that loses cents in legacy monetary units is rejected atomically", async () => {
  const f = await fixture({price: 30023997515803.29, quantidade: 3});
  const data = {...units(f, 3), items: [{productId: "p", quantity: 3, expectedUnitPriceCents: 3002399751580329}],
    expectedTotalCents: 9007199254740987};
  assert.equal((await send(f, data)).reason, "incompatible-legacy-total");
  assert.equal(await quantity(f), 3); assert.equal(await count(f, "sales"), 0);
});

for (const [label, overrides, profile] of [
  ["explicit parent", {productKind: "variantParent", variantSchemaVersion: 1, attributeDefinitions: []}],
  ["parent without discriminators", {attributeDefinitions: [{id: "color"}]}],
  ["empty parent marker", {attributeDefinitions: null}],
  ["partial kind", {productKind: "simple"}],
  ["partial version", {variantSchemaVersion: 1}],
  ["mixed simple", {productKind: "simple", variantSchemaVersion: 1, attributes: {}}],
  ["variant", {variantSchemaVersion: 1, productId: "parent", attributes: {color: "blue"}}],
  ["new top-level money", {priceCents: 29}],
  ["invalid cost", {costPrice: -1}],
  ["empty profile", {}, {}],
  ["profile with data", {}, {schemaVersion: 1}],
  ["profile plus archived", {isArchived: true}, {}],
  ["profile plus invalid price", {price: "bad"}, {}],
]) test("C5 nonterminal domain block: " + label, async () => {
  const f = await fixture(overrides);
  if (profile !== undefined) await f.product.collection("commercialProfiles").doc("current").set(profile);
  const before = await f.product.get();
  await assert.rejects(() => send(f), e => e.code === "failed-precondition" && typeof e.details.reason === "string");
  assert.ok((await f.product.get()).updateTime.isEqual(before.updateTime));
  assert.deepEqual((await f.product.get()).data(), before.data());
  assert.equal(await count(f, "sales"), 0); assert.equal(await count(f, "auditLogs"), 0);
  assert.equal((await query(f)).status, "not-recorded");
  // A domain error did not seal the frozen identity as terminal rejected.
  await f.product.set({name: "Fixed", price: 0.29, quantidade: 5, lotes: []});
  if (profile !== undefined) await f.product.collection("commercialProfiles").doc("current").delete();
  assert.equal((await send(f)).status, "confirmed");
});

test("C5 raw variantId presence including undefined is rejected without rewriting input", async () => {
  const f = await fixture();
  for (const variantId of [null, undefined, "v", "", false, 0]) {
    const data = {...f.data, items: [{...f.data.items[0], variantId}]};
    await assert.rejects(() => send(f, data), e => e.code === "invalid-argument");
    assert.ok(Object.hasOwn(data.items[0], "variantId"));
    assert.equal(data.items[0].variantId, variantId);
  }
  assert.equal(await quantity(f), 5); assert.equal(await count(f, "sales"), 0); assert.equal(await count(f, "auditLogs"), 0);
});

test("C5 known confirmed and terminal rejected receipts precede current profile/type", async () => {
  for (const overrides of [{}, {quantidade: 0}]) {
    const f = await fixture(overrides); const original = await send(f);
    await f.product.update({productKind: "variantParent", variantSchemaVersion: 1, price: 888, attributeDefinitions: []});
    await f.product.collection("commercialProfiles").doc("current").set({});
    const product = await f.product.get(); const receipt = (await f.store.collection("auditLogs").get()).docs[0];
    assert.deepEqual(await send(f), {...original, replayed: true});
    assert.deepEqual(await query(f), {...original, replayed: true});
    assert.ok((await f.product.get()).updateTime.isEqual(product.updateTime));
    assert.ok((await receipt.ref.get()).updateTime.isEqual(receipt.updateTime));
  }
});

test("C5 second product domain block leaves prepared FIFO and all records untouched", async () => {
  const f = await fixture({lotes: [{quantidade: 5, validade: admin.firestore.Timestamp.now()}]});
  const second = f.store.collection("products").doc("z");
  await second.set({name: "Parent", price: 0.29, quantidade: 5, attributeDefinitions: []});
  const before = await f.product.get(); const other = await second.get();
  const data = {...f.data, items: [...f.data.items, {productId: "z", quantity: 1, expectedUnitPriceCents: 29}], expectedTotalCents: 58};
  await assert.rejects(() => send(f, data), e => e.code === "failed-precondition");
  assert.ok((await f.product.get()).updateTime.isEqual(before.updateTime));
  assert.ok((await second.get()).updateTime.isEqual(other.updateTime));
  assert.equal(await count(f, "sales"), 0); assert.equal(await count(f, "auditLogs"), 0);
});

for (const price of [NaN, Infinity, -Infinity]) {
  for (const [label, overrides, profile] of [
    ["parent", {productKind: "variantParent", variantSchemaVersion: 1, attributeDefinitions: []}],
    ["parent marker", {attributeDefinitions: []}],
    ["variant", {variantSchemaVersion: 1, productId: "parent", attributes: {}}],
    ["partial kind", {productKind: "simple"}],
    ["profile", {}, {}],
  ]) test("R2 nonfinite domain priority: " + label + " " + String(price), async () => {
    const f = await fixture({...overrides, price});
    if (profile) await f.product.collection("commercialProfiles").doc("current").set(profile);
    const before = await f.product.get();
    await assert.rejects(() => send(f), e => e.code === "failed-precondition" &&
      ["parent-not-supported", "invalid-kind-or-identity", "commercial-profile-not-supported"].includes(e.details.reason));
    assert.ok((await f.product.get()).updateTime.isEqual(before.updateTime));
    assert.deepEqual((await f.product.get()).data(), before.data());
    assert.equal(await count(f, "sales"), 0); assert.equal(await count(f, "auditLogs"), 0);
    assert.equal((await query(f)).status, "not-recorded");
  });
}

test("R2 SDK metadata remains outside domain view and unchanged through sale/FIFO", async () => {
  const metadata = {point: new admin.firestore.GeoPoint(1, 2), ref: db.doc("synthetic/reference"),
    bytes: Buffer.from([1, 2, 3]), time: new admin.firestore.Timestamp(1900000000, 123456000), number: NaN};
  const f = await fixture({legacy: metadata, fiscal: metadata,
    lotes: [{quantidade: 5, validade: metadata.time, metadata}]});
  const before = (await f.product.get()).data();
  assert.equal((await send(f)).status, "confirmed");
  assert.deepEqual((await f.product.get()).data(), {...before, quantidade: 4,
    lotes: [{...before.lotes[0], quantidade: 4}]});
});

test("R2 SDK or nonfinite structural markers remain present and fail closed", async () => {
  for (const marker of ["attributeDefinitions", "attributes", "productId", "productKind", "variantSchemaVersion", "variantId"]) {
    for (const value of [NaN, new admin.firestore.GeoPoint(1, 2), db.doc("synthetic/reference"), Buffer.from([1])]) {
      const f = await fixture({[marker]: value}); const before = await f.product.get();
      await assert.rejects(() => send(f), e => e.code === "failed-precondition");
      assert.ok((await f.product.get()).updateTime.isEqual(before.updateTime));
      assert.equal(await count(f, "sales"), 0); assert.equal(await count(f, "auditLogs"), 0);
    }
  }
});

test("R2 rejected price receipt replays despite later nonfinite price, parent and SDK profile", async () => {
  const f = await fixture({price: NaN});
  const original = await send(f);
  assert.equal(original.status, "rejected"); assert.equal(original.reason, "invalid-current-price");
  const receipt = (await f.store.collection("auditLogs").get()).docs[0];
  await f.product.update({price: Infinity, attributeDefinitions: []});
  await f.product.collection("commercialProfiles").doc("current").set({point: new admin.firestore.GeoPoint(1, 2)});
  const before = await f.product.get();
  assert.deepEqual(await send(f), {...original, replayed: true});
  assert.deepEqual(await query(f), {...original, replayed: true});
  assert.ok((await receipt.ref.get()).updateTime.isEqual(receipt.updateTime));
  assert.ok((await f.product.get()).updateTime.isEqual(before.updateTime));
  assert.equal(await count(f, "sales"), 0); assert.equal(await count(f, "auditLogs"), 1);
});
