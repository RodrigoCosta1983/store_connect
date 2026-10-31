"use strict";
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {FieldValue, Timestamp} = require("firebase-admin/firestore");
const contract = require("./saleV2Contract");
const shared = require("./commercialOperationContext");
const {createStoreWriterAdmission} = require("./storeWriterAdmission");
const {evaluateProductEligibility} = require("../contracts/productEligibilityC5");
const recovery = require("./offlineSaleRecoveryPolicy");

function parse(raw) {
  try {
    const required = ["schemaVersion", "requestId", "saleId", "scope", "items",
      "expectedTotalCents", "paymentMethod", "notes", "customerId", "createdAtMs"];
    contract.keys(raw, [...required, "payments"], required);
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.items) || raw.items.length > 100 ||
        !Number.isSafeInteger(raw.createdAtMs) || raw.createdAtMs < 0 || raw.createdAtMs > 8640000000000000 ||
        typeof raw.notes !== "string" || raw.notes.length > 2048) throw new TypeError();
    const normalized = contract.normalize({schemaVersion: 2, requestId: raw.requestId,
      saleId: raw.saleId, scope: raw.scope, origin: "online", saleKind: "instant",
      items: raw.items, expectedTotalCents: raw.expectedTotalCents,
      paymentMethod: raw.paymentMethod, notes: raw.notes, customerId: raw.customerId,
      ...(Object.hasOwn(raw, "payments") ? {payments: raw.payments} : {})});
    return {schemaVersion: 1, requestId: normalized.requestId, saleId: normalized.saleId,
      scope: normalized.scope, items: normalized.items, expectedTotalCents: normalized.expectedTotalCents,
      paymentMethod: normalized.paymentMethod, notes: normalized.notes,
      ...(normalized.payments ? {payments: normalized.payments} : {}),
      customerId: normalized.customerId, createdAtMs: raw.createdAtMs};
  } catch (_) { shared.fail("invalid-offline-command", "invalid-argument"); }
}
function splitDestination() {
  const project = admin.app().options.projectId;
  if (process.env.FUNCTIONS_EMULATOR === "true" && /^demo-/.test(project) &&
      process.env.GCLOUD_PROJECT === project && /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) return;
  if (["store-connect-app", "store-connect-hml"].includes(project) && process.env.GCLOUD_PROJECT === project &&
      process.env.F9_SPLIT_PAYMENTS_PROJECT === project && process.env.FUNCTIONS_EMULATOR !== "true" &&
      !process.env.FIRESTORE_EMULATOR_HOST) return;
  shared.fail("split-payments-disabled");
}
async function execute(request, queryOnly = false, splitOnly = false) {
  if (splitOnly) splitDestination();
  else if (!recovery.productionDestination(admin.app().options.projectId, process.env, queryOnly)) {
    shared.destination("F9_COMMERCIAL_OFFLINE_PROJECT");
  }
  if (!request.auth?.uid) shared.fail("authentication-required", "unauthenticated");
  if (request.auth.token?.firebase?.tenant) shared.fail("tenant-context-unsupported", "permission-denied");
  const input = parse(request.data), requestHash = contract.hash(input), db = admin.firestore();
  if (splitOnly && (input.paymentMethod !== "Misto" || !input.payments)) shared.fail("split-payments-required", "invalid-argument");
  const protocol = splitOnly ? "syncSplitPaymentSaleV1" : "syncOfflineSaleV1";
  const admission = createStoreWriterAdmission(db, "syncOfflineSaleV1", request.auth.uid);
  return db.runTransaction(async tx => {
    const {store, data, role} = await shared.authorize(tx, db, request.auth, input.scope);
    const receiptRef = store.collection("auditLogs").doc((splitOnly ? "split-payment-sale-v1-" : "offline-sale-v1-") + contract.hash(input.saleId));
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) return recovery.replayReceipt(receipt, input, requestHash, request.auth.uid, protocol);
    const saleRef = store.collection("sales").doc(input.saleId);
    if ((await tx.get(saleRef)).exists) return {status: "identity-conflict", requestId: input.requestId};
    const slots = splitOnly ? ["variant-sale-v1-", "sale-v2-", "deferred-sale-v1-", "offline-sale-v1-"]
      .map(prefix => store.collection("auditLogs").doc(prefix + contract.hash(input.saleId))) : [];
    for (const slot of slots) if ((await tx.get(slot)).exists) return {status: "identity-conflict", requestId: input.requestId};
    if (queryOnly) return {status: "not-recorded", requestId: input.requestId, definitive: false, canAutoResend: splitOnly};
    if (!splitOnly) await recovery.authorizeProductionRecovery(tx, db, input, requestHash, request.auth.uid);
    await admission(tx, store.id);
    if (!["active", "trial", "overdue"].includes(data.subscriptionStatus)) shared.fail("subscription-ineligible");
    const prepared = []; let result, customerName = null;
    try {
      if (input.customerId !== null) {
        const customer = await tx.get(store.collection("customers").doc(input.customerId));
        if (!customer.exists || typeof customer.data().name !== "string" || !customer.data().name.trim()) shared.fail("customer-unavailable");
        customerName = customer.data().name;
      }
      for (const item of input.items) {
        const ref = store.collection("products").doc(item.productId), snapshot = await tx.get(ref);
        const commercial = await tx.get(ref.collection("commercialProfiles").doc("current"));
        if (!snapshot.exists) shared.fail("product-unavailable");
        const product = snapshot.data();
        for (const operation of ["read", "sale"]) {
          const fields = operation === "read" ? shared.structuralFields : [...shared.structuralFields, "isArchived", "price", "costPrice"];
          const eligibility = evaluateProductEligibility({protocol: "legacyV2", operation,
            scope: {projectId: input.scope.projectId, storeId: store.id}, identity: {productId: ref.id, variantId: null},
            entity: shared.eligibilitySnapshot(snapshot, fields), commercial: shared.eligibilitySnapshot(commercial)});
          if (eligibility.status !== "compatible") shared.fail("product-ineligible");
        }
        if (product.isArchived === true || typeof product.name !== "string" || !product.name.trim()) shared.fail("product-unavailable");
        let cents; try { cents = contract.priceCents(product.price); } catch (_) { shared.fail("invalid-current-price"); }
        if (cents !== item.expectedUnitPriceCents) shared.fail("price-conflict");
        prepared.push({ref, patch: shared.stock(product, item.quantity), historical: {
          productId: item.productId, name: product.name, price: cents / 100, quantity: item.quantity}});
      }
      result = {status: "confirmed", requestId: input.requestId, saleId: input.saleId,
        totalCents: input.expectedTotalCents, replayed: false,
        shouldRequestNfce: String(data.subscriptionType || data.plan || data.plano || data.subscriptionPlan || "")
          .trim().toLowerCase() === "business" && data.perfilFiscal?.configurado === true};
    } catch (e) {
      if (!(e instanceof HttpsError) || e.code !== "failed-precondition") throw e;
      result = {status: "rejected", requestId: input.requestId, reason: e.details.reason, replayed: false};
    }
    if (result.status === "confirmed") {
      for (const row of prepared) tx.update(row.ref, row.patch);
      tx.create(saleRef, {totalAmount: input.expectedTotalCents / 100, products: prepared.map(row => row.historical),
        createdAt: Timestamp.fromMillis(input.createdAtMs), syncedAt: FieldValue.serverTimestamp(),
        storeId: store.id, notes: input.notes, paymentMethod: input.paymentMethod, isPaid: true,
        ...(input.payments ? {payments: input.payments} : {}),
        customerId: input.customerId, customerName, localSaleId: input.saleId, syncOrigin: "offline", syncedBy: request.auth.uid});
    }
    tx.create(receiptRef, {protocol, actorUid: request.auth.uid, role, storeId: store.id,
      requestHash, command: input, result, createdAt: FieldValue.serverTimestamp()});
    for (const slot of slots) tx.create(slot, {schemaVersion: 1, protocol: "split-payment-identity-reservation-v1",
      actorUid: request.auth.uid, storeId: store.id, saleId: input.saleId, receiptPath: receiptRef.path, createdAt: FieldValue.serverTimestamp()});
    return result;
  }, queryOnly ? {readOnly: true} : undefined);
}
module.exports = {syncOfflineSaleV1: onCall(shared.options, r => execute(r)),
  getOfflineSaleResultV1: onCall(shared.options, r => execute(r, true)),
  syncSplitPaymentSaleV1: onCall(shared.options, r => execute(r, false, true)),
  getSplitPaymentSaleResultV1: onCall(shared.options, r => execute(r, true, true))};
