"use strict";
const {createHash} = require("node:crypto");
const {HttpsError} = require("firebase-functions/v2/https");
const {authorize} = require("./subscriptionAttempt");
const {assertStoreFinancialAdmission} = require("./storeFinancialAdmission");
const {mayRecoverInactive} = require("./financialStatusPolicy");
const {checkBillingState} = require("./asaasWebhookLocalProcessor");

// Directed recovery for missing webhooks. Reads Asaas only; writes Firestore
// atomically with an immutable reconciliation receipt. Never creates a payment.
async function reconcileFinancialState({db, FieldValue, config, request, readBillingState}) {
  const owner = await authorize(db, config, request);
  await assertStoreFinancialAdmission({db, config, storeId: owner.storeId, storeData: owner.store, operation: "subscription.reconcile"});
  if (config.environment !== "sandbox" || !config.operationsEnabled) throw new HttpsError("failed-precondition", "Recuperacao PROD permanece bloqueada.");
  if (!/^[a-f0-9]{32}$/.test(request.data?.requestId || "")) throw new HttpsError("invalid-argument", "Identidade de consulta necessaria.");
  const identity = {storeId: owner.storeId, uid: owner.uid, requestId: request.data.requestId, projectId: config.projectId, environment: config.environment};
  const key = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  const audit = db.collection("asaasFinancialReconciliations").doc(key), ref = db.collection("stores").doc(owner.storeId);
  const old = await audit.get();
  if (old.exists) return old.data().result;
  const before = await ref.get(), store = before.data();
  const billing = checkBillingState(await readBillingState(store.asaasSubscriptionId, {eventType: "RECONCILIATION"}, store, owner.storeId));
  if (store.subscriptionStatus === "inactive" && !mayRecoverInactive(store, billing)) {
    throw new HttpsError("failed-precondition", "Inativacao sem prova conclusiva; acesso preservado.");
  }
  if (billing.hasOverdue || billing.officialSubscriptionActive !== true || billing.hasSettledPayment !== true ||
      !["active", "overdue", "inactive", "pending"].includes(store.subscriptionStatus)) {
    throw new HttpsError("failed-precondition", "Pagamento atual nao comprovado ou ha debito. Nenhuma reativacao.");
  }
  return db.runTransaction(async tx => {
    const [receipt, fresh, user] = await Promise.all([tx.get(audit), tx.get(ref), tx.get(db.collection("users").doc(owner.uid))]);
    if (receipt.exists) return receipt.data().result;
    if (!fresh.exists || !fresh.updateTime.isEqual(before.updateTime) || fresh.data().ownerId !== owner.uid ||
        !user.exists || user.data().storeId !== owner.storeId || user.data().role !== "admin" || user.data().accessStatus === "revoked") {
      throw new HttpsError("aborted", "Vinculo ou estado alterado; nenhuma reativacao.");
    }
    await assertStoreFinancialAdmission({db, config, transaction: tx, storeId: owner.storeId, storeData: fresh.data(), operation: "subscription.reconcile"});
    const result = {status: "confirmed", subscriptionStatus: "active", authority: "verified_read_only_billing", requestId: identity.requestId};
    tx.update(ref, {subscriptionStatus: "active", subscriptionInactiveReason: FieldValue.delete(), blockedAt: FieldValue.delete(),
      overdueSince: FieldValue.delete(), overdueDueDate: FieldValue.delete(), lastPaymentDate: FieldValue.serverTimestamp(),
      ...(billing.nextDueDate ? {nextDueDate: billing.nextDueDate} : {})});
    tx.create(audit, {schemaVersion: 1, identity, previousStatus: store.subscriptionStatus, previousReason: store.subscriptionInactiveReason || null,
      result, createdAt: FieldValue.serverTimestamp()});
    return result;
  });
}
module.exports = {reconcileFinancialState};
