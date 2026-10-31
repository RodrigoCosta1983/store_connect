"use strict";

// Shared V2 transaction; demo stays local-only and commercial stays staged.
// Deliberately absent from the deployment functions/index.js.
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {Timestamp, FieldValue} = require("firebase-admin/firestore");
const contract = require("./saleV2Contract");
const {evaluateProductEligibility} = require("../contracts/productEligibilityC5");
const {requireTransactionalWriterAdmission} = require("./transactionalWriterAdmission");
const {createStoreWriterAdmission} = require("./storeWriterAdmission");
// Same nonterminal HttpsError channel as subscription/auth gates. Never a receipt.
class EligibilityBlocked extends HttpsError {
  constructor(reason) { super("failed-precondition", "Produto incompatível com venda V2.", {reason}); }
}
// Complete field dependencies of C5-D/D1 for legacy read/sale. Stock, FIFO,
// fiscal and arbitrary SDK metadata remain on the real snapshot, not this view.
const structuralFields = ["productKind", "variantSchemaVersion", "productId", "variantId",
  "attributes", "attributeDefinitions", "priceCents", "costCents", "commercial", "commercialProfiles"];
function eligibilitySnapshot(snapshot, fields) {
  if (!snapshot.exists) return {exists: false};
  // Preserve own presence and exact values of every selected domain field.
  const adapt = (value) => {
    if (value instanceof Timestamp) {
      return {seconds: String(value.seconds), nanoseconds: value.nanoseconds};
    }
    if (Array.isArray(value)) return value.map(adapt);
    if (value && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, adapt(entry)]));
    }
    return value;
  };
  const data = snapshot.data();
  const view = fields ? Object.fromEntries(fields.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])) : data;
  return {exists: true, data: adapt(view), updateTime: {
    seconds: String(snapshot.updateTime.seconds), nanoseconds: snapshot.updateTime.nanoseconds}};
}
const roles = new Set(["admin", "gerente", "operador", "caixa", "vendedor"]);
const text = (v) => typeof v === "string" ? v.trim().toLowerCase() : "";
const options = {timeoutSeconds: 60, memory: "256MiB"};
function fail(reason, code = "failed-precondition") {
  throw new HttpsError(code, "Venda não confirmada: " + reason, {reason});
}
function localOnly() {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") ||
      !/^demo-/.test(process.env.GCLOUD_PROJECT || "") ||
      admin.app().options.projectId !== process.env.GCLOUD_PROJECT) fail("local-emulator-only");
}
function parse(data) {
  if (Array.isArray(data?.items) && data.items.some(item => item && Object.hasOwn(item, "variantId"))) {
    fail("invalid-command", "invalid-argument");
  }
  try { return contract.normalize(data); } catch (e) {
    if (e instanceof TypeError) fail("invalid-command", "invalid-argument");
    throw e;
  }
}
async function authorize(tx, db, auth, scope) {
  if (!auth || typeof auth.uid !== "string") fail("authentication-required", "unauthenticated");
  const snapshot = await tx.get(db.collection("users").doc(auth.uid));
  const user = snapshot.data() || {};
  if (!snapshot.exists || !roles.has(text(user.role)) || text(user.accessStatus) === "revoked") fail("sale-access-denied", "permission-denied");
  let storeId;
  try { storeId = contract.id(user.storeId); } catch (_) { fail("invalid-membership", "permission-denied"); }
  if (scope.uid !== auth.uid || scope.storeId !== storeId || scope.projectId !== admin.app().options.projectId) {
    fail("sale-scope-mismatch", "permission-denied");
  }
  const store = db.collection("stores").doc(storeId);
  const current = await tx.get(store);
  if (!current.exists) fail("store-unavailable", "permission-denied");
  return {store, data: current.data(), role: text(user.role)};
}
function stock(product, quantity) {
  const valid = (n) => Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0);
  const lots = Object.hasOwn(product, "lotes") ? product.lotes : [];
  if (!valid(product.quantidade) || !Array.isArray(lots)) fail("invalid-current-stock");
  let sum = 0;
  for (const lot of lots) {
    if (!lot || typeof lot !== "object" || Array.isArray(lot) || !valid(lot.quantidade) ||
        !(lot.validade instanceof Timestamp)) fail("invalid-current-stock");
    sum += lot.quantidade;
    if (!valid(sum)) fail("invalid-current-stock");
  }
  if (lots.length && sum !== product.quantidade) fail("inconsistent-current-stock");
  if (quantity > product.quantidade) fail("insufficient-stock");
  const patch = {quantidade: product.quantidade - quantity};
  if (lots.length) {
    let remaining = quantity;
    patch.lotes = lots.map((lot, index) => ({lot, index})).sort((a, b) =>
      a.lot.validade.seconds - b.lot.validade.seconds ||
      a.lot.validade.nanoseconds - b.lot.validade.nanoseconds || a.index - b.index)
      .flatMap(({lot}) => {
        const removed = Math.min(remaining, lot.quantidade);
        remaining -= removed;
        const amount = lot.quantidade - removed;
        return amount ? [{...lot, quantidade: amount}] : [];
      });
    if (remaining !== 0) fail("inconsistent-current-stock");
  }
  return patch;
}
function replay(saved, input, requestHash, uid) {
  if (saved.protocol !== "confirmSaleV2" || saved.saleId !== input.saleId ||
      saved.storeId !== input.scope.storeId || saved.actorUid !== uid || saved.requestHash !== requestHash) {
    return {status: "identity-conflict", saleId: input.saleId};
  }
  if (!saved.result || !["confirmed", "rejected"].includes(saved.result.status) || saved.result.saleId !== input.saleId) {
    fail("invalid-receipt", "internal");
  }
  return {...saved.result, replayed: true};
}
async function execute(request, queryOnly = false, admitNewEffects = null, destinationGate = localOnly) {
  destinationGate();
  if (!request.auth) fail("authentication-required", "unauthenticated");
  const input = parse(request.data);
  const requestHash = contract.hash(input);
  const db = admin.firestore();
  const admitWriter = createStoreWriterAdmission(db, "confirmSaleV2", request.auth.uid);
  return db.runTransaction(async (tx) => {
    const {store, data, role} = await authorize(tx, db, request.auth, input.scope);
    // auditLogs already denies client writes in the existing local Rules.
    // Store/sale identity only: never key uniqueness by actor.
    const receiptRef = store.collection("auditLogs").doc("sale-v2-" + contract.hash(input.saleId));
    const saleRef = store.collection("sales").doc(input.saleId);
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      // Result lookup is private to the original actor, not knowledge of ID.
      if (queryOnly && receipt.data().actorUid !== request.auth.uid) fail("result-access-denied", "permission-denied");
      return replay(receipt.data(), input, requestHash, request.auth.uid);
    }
    const existing = await tx.get(saleRef);
    if (existing.exists) return {status: "identity-conflict", saleId: input.saleId};
    if (queryOnly) return {status: "not-recorded", saleId: input.saleId, definitive: false};
    await admitWriter(tx, store.id);
    // Local composition only. Auth/receipt/result precede admission; denial is
    // nonterminal and must never be caught as a sealed commercial rejection.
    if (admitNewEffects) await admitNewEffects(tx, store);
    // Preserve online subscription eligibility, including the legacy trial
    // default. Auth/revocation always precede receipt; subscription only gates
    // NEW effects, never hides a committed V2 result. V1 remains untouched.
    const subscription = data.subscriptionStatus == null ? "trial" : data.subscriptionStatus;
    if (!["active", "trial", "overdue"].includes(subscription)) fail("subscription-ineligible");
    let prepared;
    let customerName = null;
    let rejection;
    try {
      if (input.customerId !== null) {
        const customer = await tx.get(store.collection("customers").doc(input.customerId));
        if (!customer.exists || typeof customer.data().name !== "string" || !customer.data().name.trim()) fail("customer-unavailable");
        customerName = customer.data().name;
      }
      prepared = [];
      for (const item of input.items) {
        const ref = store.collection("products").doc(item.productId);
        const snapshot = await tx.get(ref);
        const commercial = await tx.get(ref.collection("commercialProfiles").doc("current"));
        if (!snapshot.exists) fail("product-unavailable");
        const product = snapshot.data();
        const checkEligibility = (operation, fields) => {
          let eligibility;
          try {
            eligibility = evaluateProductEligibility({protocol: "legacyV2", operation,
              scope: {projectId: input.scope.projectId, storeId: store.id},
              identity: {productId: ref.id, variantId: null},
              entity: eligibilitySnapshot(snapshot, fields), commercial: eligibilitySnapshot(commercial)});
          } catch (e) {
            if (!(e instanceof TypeError || e instanceof RangeError)) throw e;
            throw new EligibilityBlocked("invalid-eligibility-snapshot");
          }
          if (eligibility.status !== "compatible") throw new EligibilityBlocked(eligibility.reason);
        };
        // Existing read policy checks type/profile before monetary adaptation.
        // This is not sale authorization. Invalid raw prices reach B07-B unchanged.
        checkEligibility("read", structuralFields);
        if (product.isArchived === true) fail("product-archived");
        if (Object.hasOwn(product, "isArchived") && typeof product.isArchived !== "boolean") fail("invalid-product-state");
        let cents;
        try { cents = contract.priceCents(product.price); } catch (_) { fail("invalid-current-price"); }
        checkEligibility("sale", [...structuralFields, "isArchived", "price", "costPrice"]);
        if (cents !== item.expectedUnitPriceCents) fail("price-conflict");
        if (typeof product.name !== "string" || !product.name.trim()) fail("invalid-product-name");
        prepared.push({ref, patch: stock(product, item.quantity), historical: {
          productId: item.productId, name: product.name, quantity: item.quantity, price: cents / 100}});
      }
      // Ensure the old monetary-unit total can represent the exact V2 cents.
      let legacyTotal;
      try { legacyTotal = contract.priceCents(input.expectedTotalCents / 100); }
      catch (_) { fail("incompatible-legacy-total"); }
      if (legacyTotal !== input.expectedTotalCents) fail("incompatible-legacy-total");
    } catch (e) {
      if (e instanceof EligibilityBlocked || !(e instanceof HttpsError) || e.code !== "failed-precondition") throw e;
      rejection = e.details.reason;
    }
    const result = rejection ? {status: "rejected", saleId: input.saleId, reason: rejection, replayed: false} :
      {status: "confirmed", saleId: input.saleId, totalCents: input.expectedTotalCents, replayed: false};
    // All reads and preparation precede ALL writes. A rejected business command
    // seals only its identity; no stock/sale writes have been queued.
    if (!rejection) {
      for (const entry of prepared) tx.update(entry.ref, entry.patch);
      tx.create(saleRef, {totalAmount: input.expectedTotalCents / 100,
        products: prepared.map((entry) => entry.historical),
        createdAt: FieldValue.serverTimestamp(), storeId: store.id,
        notes: input.notes, paymentMethod: input.paymentMethod, isPaid: true,
        ...(input.payments ? {payments: input.payments} : {}),
        customerId: input.customerId, customerName, localSaleId: input.saleId, syncOrigin: "online"});
    }
    tx.create(receiptRef, {protocol: "confirmSaleV2", schemaVersion: 2,
      requestId: input.requestId, saleId: input.saleId, storeId: store.id,
      actorUid: request.auth.uid, role, requestHash, result,
      createdAt: FieldValue.serverTimestamp()});
    return result;
  });
}
const confirmSaleV2 = onCall(options, (request) => execute(request));
// Requires the frozen command as evidence; never accepts arbitrary store/ID lookup.
const getSaleMutationResultV1 = onCall(options, (request) => execute(request, true));
// Extra local fixture policy only; it cannot replace the mandatory official
// store admission now applied by execute to every new effect.
// Every invocation still passes execute's mandatory demo/loopback localOnly gate.
function createLocalAdmittedSaleHandlers({controlForStore, admits}) {
  if (typeof controlForStore !== "function" || typeof admits !== "function") {
    throw new TypeError("Local admission requires an explicit control resolver and policy.");
  }
  const admitNewEffects = (transaction, store) => requireTransactionalWriterAdmission(
    transaction, controlForStore(store), admits);
  return Object.freeze({
    confirmSaleV2: (request) => execute(request, false, admitNewEffects),
    getSaleMutationResultV1: (request) => execute(request, true, admitNewEffects),
  });
}
// Commercial handlers use the same transaction and mandatory D1-D4 admission.
// No caller can supply this gate through callable data.
function commercialDestination() {
  const project = admin.app().options.projectId;
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    localOnly();
    return;
  }
  if (project !== "store-connect-hml" ||
      process.env.GCLOUD_PROJECT !== project || process.env.FIRESTORE_EMULATOR_HOST ||
      process.env.F9_COMMERCIAL_CHECKOUT_PROJECT !== project) fail("commercial-checkout-disabled");
}
const commercialOptions = {...options, enforceAppCheck: true};
const confirmCommercialSaleV2 = onCall(commercialOptions,
  request => execute(request, false, null, commercialDestination));
const getCommercialSaleMutationResultV1 = onCall(commercialOptions,
  request => execute(request, true, null, commercialDestination));
module.exports = {confirmSaleV2, getSaleMutationResultV1, createLocalAdmittedSaleHandlers,
  confirmCommercialSaleV2, getCommercialSaleMutationResultV1,
  saleTransactionPrimitives: Object.freeze({authorize, stock, eligibilitySnapshot, structuralFields})};
