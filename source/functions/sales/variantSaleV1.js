"use strict";
const admin = require("firebase-admin");
const {FieldValue, FieldPath, Timestamp} = require("firebase-admin/firestore");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {isDeepStrictEqual: equal} = require("node:util");
const {localMutationSupport: core, firestoreValue} = require("../products/productVariantsC1");
const {variantReadSupport: reads} = require("../products/productVariantsReadB2A");
const commercial = require("../contracts/productCommercialC5");
const {projectCommercialRead} = require("../contracts/productCommercialPersistenceC5");
const {evaluateProductEligibility} = require("../contracts/productEligibilityC5");
const shared = require("./commercialOperationContext");
const v2 = require("./saleV2Contract");
const {createStoreWriterAdmission, validControl, controlRef} = require("./storeWriterAdmission");
const protocol = "confirmVariantSaleV1";
const fail = (reason, code = "failed-precondition") => { throw new HttpsError(code, reason, {reason}); };
function environment(db) {
  if (/^demo-/.test(db.projectId || "")) return core.environment(db);
  if (db.projectId !== "store-connect-hml" || process.env.GCLOUD_PROJECT !== db.projectId ||
      process.env.F10_VARIANT_SALES_PROJECT !== db.projectId || process.env.FIRESTORE_EMULATOR_HOST) fail("f10-sale-environment-denied");
}
function integer(v, positive = false) {
  if (!Number.isSafeInteger(v) || Object.is(v, -0) || v < (positive ? 1 : 0)) throw new TypeError("Invalid safe integer.");
  return v;
}
function parse(raw) {
  v2.keys(raw, ["schemaVersion", "requestId", "saleId", "scope", "origin", "saleKind", "expectedAdmissionEpoch",
    "items", "expectedTotalCents", "paymentMethod", "notes", "customerId"]);
  if (raw.schemaVersion !== 3 || raw.origin !== "online" || raw.saleKind !== "instant" ||
      core.stableId(raw.requestId) !== core.stableId(raw.saleId) || raw.requestId.length > 128 ||
      !["Dinheiro", "PIX", "Cartão de crédito", "Cartão de débito"].includes(raw.paymentMethod) ||
      raw.customerId !== null || typeof raw.notes !== "string" || raw.notes.length > 2048 ||
      !Array.isArray(raw.items) || !raw.items.length || raw.items.length > 100) throw new TypeError("Invalid online variant sale.");
  const seen = new Set(); let total = 0;
  const items = raw.items.map(item => {
    v2.keys(item, ["productId", "variantId", "quantity", "expectedUnitPriceCents"]);
    const productId = core.stableId(item.productId), variantId = core.stableId(item.variantId);
    const key = JSON.stringify([productId, variantId]);
    if (seen.has(key)) throw new TypeError("Duplicate item tuple.");
    seen.add(key);
    const quantity = integer(item.quantity, true), price = integer(item.expectedUnitPriceCents, true);
    total = integer(total + integer(quantity * price));
    return {productId, variantId, quantity, expectedUnitPriceCents: price};
  }).sort((a, b) => {
    const ka = JSON.stringify([a.productId, a.variantId]), kb = JSON.stringify([b.productId, b.variantId]);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  if (integer(raw.expectedTotalCents, true) !== total || v2.priceCents(total / 100) !== total) throw new TypeError("Invalid total.");
  return core.canonical({...raw, scope: core.scopeOf(raw.scope), expectedAdmissionEpoch: integer(raw.expectedAdmissionEpoch, true), items});
}
async function admission(tx, db, store, expected) {
  const s = await tx.get(controlRef(db, store.id));
  if (!s.exists || !validControl(s.data()) || s.data().mode !== "authoritative") fail("variant-sale-admission-denied");
  if (expected !== undefined && s.data().epoch !== expected) fail("variant-sale-epoch-conflict");
  return s.data().epoch;
}
function eligibleSubscription(data) {
  if (!["active", "trial", "overdue"].includes(data.subscriptionStatus ?? "trial")) fail("subscription-ineligible");
}
async function profile(tx, ref, context, entity) {
  const s = await tx.get(ref.collection("commercialProfiles").doc("current"));
  const snap = s.exists ? {exists: true, ...reads.snapshot(s)} : {exists: false};
  const p = projectCommercialRead(context, {exists: true, data: entity.data, updateTime: entity.updateTime}, snap);
  if (p.status !== "commercialV1") fail("variant-commercial-unavailable");
  return {projection: p, snapshot: snap};
}
function context(scope, productId, variantId) {
  return {projectId: scope.projectId, storeId: scope.storeId, productId, variantId, kind: variantId === null ? "variantParent" : "variant"};
}
async function readParent(tx, store, scope, productId) {
  // Use C1/C2/B02's structural, COD and exact snapshot checks.
  let p;
  try { p = await reads.readParent(tx, store, productId); } catch (e) {
    if (e instanceof TypeError || e instanceof RangeError) fail("invalid-variant-parent"); throw e;
  }
  if (!p || p.parent.data.isArchived !== false) fail("variant-parent-unavailable");
  if (p.parent.data.quantidade !== 0 || !Array.isArray(p.parent.data.lotes) || p.parent.data.lotes.length ||
      typeof p.parent.data.name !== "string" || !p.parent.data.name.trim()) fail("invalid-parent-commercial-state");
  p.commercial = await profile(tx, p.ref, context(scope, productId, null), p.parent);
  return p;
}
async function leaf(tx, store, scope, p, saved) {
  if (!saved.exists) fail("variant-unavailable");
  let row;
  try { row = await reads.readVariant(tx, store, p.ref, p.parentDto, saved); } catch (e) {
    if (e instanceof TypeError || e instanceof RangeError) fail("invalid-variant-state"); throw e;
  }
  if (row.data.isArchived !== false) fail("variant-archived");
  const c = await profile(tx, saved.ref, context(scope, p.ref.id, saved.id), row);
  const identity = {productId: p.ref.id, variantId: saved.id};
  const check = evaluateProductEligibility({protocol: "futureV3", operation: "read",
    scope: {projectId: scope.projectId, storeId: scope.storeId}, identity,
    entity: {exists: true, ...row}, commercial: c.snapshot,
    parent: {scope: {projectId: scope.projectId, storeId: scope.storeId}, identity: {productId: p.ref.id, variantId: null},
      entity: {exists: true, data: p.parent.data, updateTime: p.parent.updateTime}, commercial: p.commercial.snapshot}});
  if (check.status !== "compatible") fail(check.reason);
  // Explicit new online confirmation contract. The old futureV3 sale predicate
  // remains blocked; a read/DTO candidate alone never authorizes a sale.
  const resolved = commercial.resolveCommercial(p.commercial.projection.configuration, c.projection.configuration);
  if (p.commercial.projection.configuration.priceCents.state !== "value" || resolved.priceCents.state !== "value" ||
      !Number.isSafeInteger(resolved.priceCents.value) || resolved.priceCents.value <= 0) fail("effective-price-unavailable");
  v2.priceCents(resolved.priceCents.value / 100); // Lossless legacy historical projection.
  const attributes = row.data.attributes.map(pair => {
    const a = p.parentDto.attributeDefinitions.find(a => a.attributeId === pair.attributeId);
    return {...pair, attributeLabel: a.label, valueLabel: a.values.find(v => v.valueId === pair.valueId).label};
  });
  return {row, resolved, attributes, parentName: p.parent.data.name,
    name: `${p.parent.data.name} — ${attributes.map(a => a.attributeLabel + ": " + a.valueLabel).join(" · ")}`,
    identity, price: resolved.priceCents.value, snapshot: saved.data()};
}
function receipt(store, saleId) { return store.collection("auditLogs").doc("variant-sale-v1-" + v2.hash(saleId)); }
function crossProtocolSlots(store, saleId) {
  // Explicit reservations, never counterfeit F9 results. Existing protocols
  // reject an incompatible protocol in their own private identity slot. Reads
  // and creates serialize BOTH directions, including rejected F10 commands.
  return ["sale-v2-", "deferred-sale-v1-", "offline-sale-v1-"].map(prefix =>
    store.collection("auditLogs").doc(prefix + v2.hash(saleId)));
}
function replay(saved, input) {
  const raw = saved.data();
  if (raw.actorUid !== input.scope.uid) fail("result-access-denied", "permission-denied");
  if (raw.protocol !== protocol || !equal(raw.command, input)) return {status: "identity-conflict", saleId: input.saleId};
  if (raw.schemaVersion !== 3 || !(raw.createdAt instanceof Timestamp) ||
      !["confirmed", "rejected"].includes(raw.result?.status) || raw.result.saleId !== input.saleId) fail("invalid-variant-sale-receipt");
  return {...raw.result, replayed: true};
}
async function execute(db, request, queryOnly = false) {
  environment(db);
  const input = core.validate(() => parse(request.data));
  const admits = ["confirmSaleV2", "adjustVariantStockC3"].map(w => createStoreWriterAdmission(db, w, request.auth?.uid));
  return db.runTransaction(async tx => {
    const {store, data, role} = await shared.authorize(tx, db, request.auth, input.scope);
    const proof = receipt(store, input.saleId), saved = await tx.get(proof);
    if (saved.exists) return replay(saved, input);
    const saleRef = store.collection("sales").doc(input.saleId);
    if ((await tx.get(saleRef)).exists) return {status: "identity-conflict", saleId: input.saleId};
    const slots = crossProtocolSlots(store, input.saleId);
    for (const slot of slots) if ((await tx.get(slot)).exists) return {status: "identity-conflict", saleId: input.saleId};
    if (queryOnly) return {status: "not-recorded", saleId: input.saleId, definitive: false};
    for (const admit of admits) await admit(tx, store.id);
    await admission(tx, db, store, input.expectedAdmissionEpoch);
    eligibleSubscription(data);
    const prepared = []; let result;
    try {
      const parents = new Map();
      for (const item of input.items) {
        if (!parents.has(item.productId)) parents.set(item.productId, await readParent(tx, store, input.scope, item.productId));
        const p = parents.get(item.productId), ref = p.ref.collection("variants").doc(item.variantId);
        const v = await leaf(tx, store, input.scope, p, await tx.get(ref));
        if (v.price !== item.expectedUnitPriceCents) fail("price-conflict");
        const patch = shared.stock(v.snapshot, item.quantity);
        const historical = {productId: item.productId, variantId: item.variantId, name: v.name,
          parentName: v.parentName, variantName: v.row.data.name ?? null, attributes: v.attributes,
          cod: v.row.data.cod ?? null, parentCod: p.parent.data.cod ?? null,
          quantity: item.quantity, price: v.price / 100, unitPriceCents: v.price,
          subtotalCents: integer(v.price * item.quantity), commercialSnapshot: v.resolved};
        prepared.push({ref, patch, historical, stockBefore: firestoreValue(v.snapshot),
          stockAfter: firestoreValue({...v.snapshot, ...patch})});
      }
      result = {status: "confirmed", saleId: input.saleId, requestId: input.requestId,
        totalCents: input.expectedTotalCents, replayed: false};
    } catch (e) {
      if (!(e instanceof HttpsError) || e.code !== "failed-precondition") throw e;
      result = {status: "rejected", saleId: input.saleId, requestId: input.requestId, reason: e.details.reason, replayed: false};
    }
    const now = FieldValue.serverTimestamp();
    if (result.status === "confirmed") {
      for (const row of prepared) tx.update(row.ref, {...row.patch, updatedAt: now});
      tx.create(saleRef, {schemaVersion: 3, commercialProtocol: protocol, totalAmount: input.expectedTotalCents / 100,
        totalCents: input.expectedTotalCents, totalPaidAmount: input.expectedTotalCents / 100,
        products: prepared.map(p => p.historical), createdAt: now, storeId: store.id,
        notes: input.notes, paymentMethod: input.paymentMethod, isPaid: true, customerId: null, customerName: null,
        localSaleId: input.saleId, syncOrigin: "online", createdBy: input.scope.uid, fiscalStatus: "f10-fiscal-not-enabled"});
    }
    tx.create(proof, {schemaVersion: 3, protocol, command: input, result, actorUid: input.scope.uid, role,
      stock: result.status === "confirmed" ? prepared.map(p => ({identity: {productId: p.historical.productId,
        variantId: p.historical.variantId}, before: p.stockBefore, after: p.stockAfter})) : [], createdAt: now});
    for (const slot of slots) tx.create(slot, {schemaVersion: 1, protocol: "f10-sale-identity-reservation-v1",
      saleId: input.saleId, storeId: store.id, actorUid: input.scope.uid, receiptPath: proof.path, createdAt: now});
    return result;
  });
}
async function choices(db, request) {
  environment(db);
  const input = core.validate(() => {v2.keys(request.data, ["scope", "productId"]);
    return {scope: core.scopeOf(request.data.scope), productId: core.stableId(request.data.productId)};});
  return db.runTransaction(async tx => {
    const {store, data} = await shared.authorize(tx, db, request.auth, input.scope);
    eligibleSubscription(data);
    const epoch = await admission(tx, db, store);
    const p = await readParent(tx, store, input.scope, input.productId);
    const rows = await tx.get(p.ref.collection("variants").orderBy(FieldPath.documentId()).limit(201));
    if (rows.size > 200) fail("variant-selection-limit");
    const variants = [];
    for (const saved of rows.docs) {
      try {
        const v = await leaf(tx, store, input.scope, p, saved);
        variants.push({...v.identity, name: v.name, attributes: v.attributes, cod: v.row.data.cod ?? null,
          unitPriceCents: v.price, availableQuantity: v.row.data.quantidade,
          status: v.row.data.quantidade > 0 ? "available" : "out-of-stock"});
      } catch (e) {
        if (!(e instanceof HttpsError) || e.details?.reason !== "variant-archived") throw e;
        variants.push({productId: p.ref.id, variantId: saved.id, status: "archived"});
      }
    }
    return {status: "available", scope: input.scope, productId: p.ref.id, parentName: p.parent.data.name,
      admissionEpoch: epoch, variants};
  });
}
const wrap = fn => onCall({region: "us-central1", timeoutSeconds: 60, enforceAppCheck: true}, request => {
  if (!request.auth?.uid) fail("authentication-required", "unauthenticated");
  return fn(admin.firestore(), request);
});
module.exports = {confirmVariantSaleV1: wrap((db, r) => execute(db, r)),
  getVariantSaleResultV1: wrap((db, r) => execute(db, r, true)),
  getVariantSaleChoicesV1: wrap(choices), execute, choices, parse, environment,
  variantSaleReadSupport: {readParent, leaf, integer}};
