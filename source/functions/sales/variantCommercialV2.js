"use strict";
const admin = require("firebase-admin");
const {FieldValue, Timestamp} = require("firebase-admin/firestore");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {isDeepStrictEqual: equal} = require("node:util");
const {localMutationSupport: core, firestoreValue} = require("../products/productVariantsC1");
const contract = require("./saleV2Contract");
const shared = require("./commercialOperationContext");
const previous = require("./variantSaleV1");
const {planDeferredInstallments} = require("./createDeferredSaleV1");
const {createStoreWriterAdmission, validControl, controlRef} = require("./storeWriterAdmission");
const {evaluateProductEligibility} = require("../contracts/productEligibilityC5");
const {variantSaleReadSupport: reads} = previous;
const fail = (reason, code = "failed-precondition") => { throw new HttpsError(code, reason, {reason}); };
const protocol = "confirmVariantCommercialV2";
const {normalizeSalePayments} = require("./splitPaymentBreakdown");
function parse(raw) {
  const required = ["schemaVersion", "requestId", "saleId", "scope", "origin", "saleKind", "expectedAdmissionEpoch",
    "items", "expectedTotalCents", "paymentMethod", "notes", "customerId", "deferred", "createdAtMs"];
  contract.keys(raw, [...required, "payments"], required);
  if (raw.schemaVersion !== 4 || !["online", "offline"].includes(raw.origin) || !["instant", "deferred"].includes(raw.saleKind) ||
      raw.origin === "offline" && raw.saleKind !== "instant" || raw.requestId !== raw.saleId ||
      core.stableId(raw.saleId).length > 128 || !Array.isArray(raw.items) || !raw.items.length || raw.items.length > 100 ||
      typeof raw.notes !== "string" || raw.notes.length > 2048 || !Number.isSafeInteger(raw.createdAtMs) ||
      raw.createdAtMs < 946684800000 || raw.createdAtMs > 4165516800000) throw new TypeError("Invalid commercial V4.");
  const seen = new Set(); let total = 0;
  const items = raw.items.map(i => {
    contract.keys(i, Object.hasOwn(i, "variantId") ? ["productId", "variantId", "quantity", "expectedUnitPriceCents"] :
      ["productId", "quantity", "expectedUnitPriceCents"]);
    const productId = core.stableId(i.productId), variantId = Object.hasOwn(i, "variantId") ? core.stableId(i.variantId) : null;
    const key = JSON.stringify([productId, variantId]);
    if (seen.has(key)) throw new TypeError("Duplicate tuple."); seen.add(key);
    const quantity = reads.integer(i.quantity, true), expectedUnitPriceCents = reads.integer(i.expectedUnitPriceCents, true);
    total = reads.integer(total + reads.integer(quantity * expectedUnitPriceCents));
    return {productId, ...(variantId === null ? {} : {variantId}), quantity, expectedUnitPriceCents};
  }).sort((a, b) => JSON.stringify([a.productId, a.variantId ?? null]) < JSON.stringify([b.productId, b.variantId ?? null]) ? -1 : 1);
  if (total !== raw.expectedTotalCents || total > 100000000000 || !items.some(i => i.variantId)) throw new TypeError("Invalid total/variant set.");
  if (raw.saleKind === "deferred") {
    if (Object.hasOwn(raw, "payments")) throw new TypeError("Deferred split unsupported.");
    core.stableId(raw.customerId);
    contract.keys(raw.deferred, ["installmentCount", "firstDueDate", "utcOffsetMinutes"]);
    if (!Number.isInteger(raw.deferred.installmentCount) || raw.deferred.installmentCount < 1 || raw.deferred.installmentCount > 12 ||
        typeof raw.deferred.firstDueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.deferred.firstDueDate) ||
        !Number.isInteger(raw.deferred.utcOffsetMinutes) || Math.abs(raw.deferred.utcOffsetMinutes) > 840 || raw.paymentMethod !== "A prazo") throw new TypeError("Invalid installment plan.");
    planDeferredInstallments({...raw.deferred, expectedTotalCents: total});
  } else if (raw.customerId !== null || raw.deferred !== null ||
      !["Dinheiro", "PIX", "Cartão de crédito", "Cartão de débito", "Misto"].includes(raw.paymentMethod)) throw new TypeError("Invalid instant payment.");
  const payments = raw.saleKind === "instant" ? normalizeSalePayments(raw.paymentMethod, raw.payments, total) : undefined;
  return core.canonical({...raw, ...(payments ? {payments} : {}), scope: core.scopeOf(raw.scope), items,
    expectedAdmissionEpoch: reads.integer(raw.expectedAdmissionEpoch, true)});
}
function identityRefs(store, id) {
  return ["variant-sale-v1-", "sale-v2-", "deferred-sale-v1-", "offline-sale-v1-"].map(p => store.collection("auditLogs").doc(p + contract.hash(id)));
}
const receiptRef = (store, id) => store.collection("auditLogs").doc("variant-commercial-v2-" + contract.hash(id));
async function simple(tx, store, scope, item) {
  const ref = store.collection("products").doc(item.productId), saved = await tx.get(ref), commercial = await tx.get(ref.collection("commercialProfiles").doc("current"));
  if (!saved.exists) fail("product-unavailable");
  const d = saved.data();
  for (const operation of ["read", "sale"]) {
    const status = evaluateProductEligibility({protocol: "legacyV2", operation,
      scope: {projectId: scope.projectId, storeId: store.id}, identity: {productId: ref.id, variantId: null},
      entity: shared.eligibilitySnapshot(saved, operation === "read" ? shared.structuralFields : [...shared.structuralFields, "isArchived", "price", "costPrice"]),
      commercial: shared.eligibilitySnapshot(commercial)});
    if (status.status !== "compatible") fail("simple-product-ineligible");
  }
  for (const collection of ["variants", "variantCombinations"]) if (!(await tx.get(ref.collection(collection).limit(1))).empty) fail("simple-product-has-variants");
  if (d.isArchived === true || typeof d.name !== "string" || !d.name.trim()) fail("product-unavailable");
  const price = contract.priceCents(d.price);
  const historical = {productId: item.productId, name: d.name, quantity: item.quantity, price: price / 100,
    unitPriceCents: price, subtotalCents: reads.integer(price * item.quantity)};
  if (d.costPrice != null) historical.costCents = contract.priceCents(d.costPrice);
  const fiscal = require("../fiscal/variantFiscalSnapshotV1").capture({productId: item.productId, variantId: null}, d.fiscal, price, item.quantity);
  if (fiscal) historical.fiscalSnapshotV1 = fiscal;
  return {ref, native: d, price, historical};
}
async function execute(db, request, queryOnly = false) {
  previous.environment(db);
  const input = core.validate(() => parse(request.data));
  const admissions = [input.origin === "offline" ? "syncOfflineSaleV1" : input.saleKind === "deferred" ? "createDeferredSaleV1" : "confirmSaleV2",
    "adjustVariantStockC3"].map(w => createStoreWriterAdmission(db, w, request.auth?.uid));
  return db.runTransaction(async tx => {
    const {store, data, role} = await shared.authorize(tx, db, request.auth, input.scope);
    const ref = receiptRef(store, input.saleId), saved = await tx.get(ref);
    if (saved.exists) {
      const r = saved.data();
      if (r.actorUid !== input.scope.uid) fail("result-access-denied", "permission-denied");
      if (r.protocol !== protocol || !equal(r.command, input)) return {status: "identity-conflict", saleId: input.saleId};
      if (!["confirmed", "rejected"].includes(r.result?.status)) fail("invalid-commercial-receipt");
      return {...r.result, replayed: true};
    }
    const saleRef = store.collection("sales").doc(input.saleId), sale = await tx.get(saleRef);
    if (sale.exists) return {status: "identity-conflict", saleId: input.saleId};
    const slots = identityRefs(store, input.saleId);
    for (const slot of slots) if ((await tx.get(slot)).exists) return {status: "identity-conflict", saleId: input.saleId};
    if (queryOnly) return {status: "not-recorded", saleId: input.saleId, definitive: false};
    shared.destination(input.origin === "offline" ? "F9_COMMERCIAL_OFFLINE_PROJECT" : input.saleKind === "deferred" ?
      "F9_COMMERCIAL_FIADO_PROJECT" : "F9_COMMERCIAL_CHECKOUT_PROJECT");
    if (input.saleKind === "deferred") shared.destination("F9_COMMERCIAL_RECEIVABLES_PROJECT");
    for (const admit of admissions) await admit(tx, store.id);
    const control = (await tx.get(controlRef(db, store.id))).data();
    if (!validControl(control) || control.mode !== "authoritative" || control.epoch !== input.expectedAdmissionEpoch) fail("variant-commercial-epoch-conflict");
    if (!["active", "trial", "overdue"].includes(data.subscriptionStatus ?? "trial")) fail("subscription-ineligible");
    const prepared = [], parents = new Map(); let result, customerName = null;
    try {
      if (input.saleKind === "deferred") {
        const customer = await tx.get(store.collection("customers").doc(input.customerId));
        if (!customer.exists || customer.data().isArchived === true || typeof customer.data().name !== "string" || !customer.data().name.trim()) fail("customer-unavailable");
        customerName = customer.data().name;
      }
      for (const item of input.items) {
        let row;
        if (!item.variantId) row = await simple(tx, store, input.scope, item);
        else {
          if (!parents.has(item.productId)) parents.set(item.productId, await reads.readParent(tx, store, input.scope, item.productId));
          const p = parents.get(item.productId), vref = p.ref.collection("variants").doc(item.variantId);
          const v = await reads.leaf(tx, store, input.scope, p, await tx.get(vref));
          row = {ref: vref, native: v.snapshot, price: v.price, historical: {productId: item.productId, variantId: item.variantId,
            name: v.name, parentName: v.parentName, variantName: v.row.data.name ?? null, attributes: v.attributes,
            cod: v.row.data.cod ?? null, parentCod: p.parent.data.cod ?? null, quantity: item.quantity,
            price: v.price / 100, unitPriceCents: v.price, subtotalCents: reads.integer(v.price * item.quantity), commercialSnapshot: v.resolved}};
          const fiscal = require("../fiscal/variantFiscalSnapshotV1").capture(v.identity,
            v.resolved.fiscal.state === "value" ? v.resolved.fiscal.value : null, v.price, item.quantity);
          if (fiscal) row.historical.fiscalSnapshotV1 = fiscal;
        }
        if (row.price !== item.expectedUnitPriceCents) fail("price-conflict");
        row.patch = shared.stock(row.native, item.quantity); prepared.push(row);
      }
      result = {status: "confirmed", saleId: input.saleId, requestId: input.requestId, totalCents: input.expectedTotalCents, replayed: false};
    } catch (e) {
      if (!(e instanceof HttpsError) || e.code !== "failed-precondition") throw e;
      result = {status: "rejected", saleId: input.saleId, requestId: input.requestId, reason: e.details.reason, replayed: false};
    }
    const now = FieldValue.serverTimestamp();
    if (result.status === "confirmed") {
      const installments = input.saleKind === "deferred" ? planDeferredInstallments({...input.deferred, expectedTotalCents: input.expectedTotalCents}) : [];
      for (const row of prepared) tx.update(row.ref, {...row.patch, updatedAt: now});
      tx.create(saleRef, {schemaVersion: 4, commercialProtocol: protocol, totalCents: input.expectedTotalCents,
        totalAmount: input.expectedTotalCents / 100, products: prepared.map(r => r.historical),
        createdAt: input.origin === "offline" ? Timestamp.fromMillis(input.createdAtMs) : now, syncedAt: now,
        storeId: store.id, notes: input.notes, paymentMethod: input.paymentMethod,
        ...(input.payments ? {payments: input.payments} : {}),
        isPaid: input.saleKind === "instant", totalPaidAmount: input.saleKind === "instant" ? input.expectedTotalCents / 100 : 0,
        paidAmount: input.saleKind === "instant" ? input.expectedTotalCents / 100 : 0, customerId: input.customerId, customerName,
        installmentCount: installments.length || 1, installments, ...(installments.length ? {dueDate: installments[0].dueDate,
          deferredCalendar: input.deferred} : {}), localSaleId: input.saleId, syncOrigin: input.origin,
        createdBy: input.scope.uid, fiscalStatus: "f10-fiscal-snapshot-required"});
    }
    tx.create(ref, {schemaVersion: 4, protocol, command: input, actorUid: input.scope.uid, role, result,
      stock: result.status === "confirmed" ? prepared.map(r => ({productId: r.historical.productId, variantId: r.historical.variantId ?? null,
        before: firestoreValue(r.native), after: firestoreValue({...r.native, ...r.patch})})) : [], createdAt: now});
    for (const slot of slots) tx.create(slot, {schemaVersion: 1, protocol: "f10-sale-identity-reservation-v1",
      saleId: input.saleId, storeId: store.id, actorUid: input.scope.uid, receiptPath: ref.path, createdAt: now});
    return result;
  });
}
const wrap = fn => onCall({region: "us-central1", timeoutSeconds: 60, enforceAppCheck: true}, r => {
  if (!r.auth?.uid) fail("authentication-required", "unauthenticated");
  return fn(admin.firestore(), r);
});
module.exports = {confirmVariantCommercialV2: wrap(execute), getVariantCommercialResultV2: wrap((db, r) => execute(db, r, true)),
  parse, identityRefs, receiptRef, protocol};
