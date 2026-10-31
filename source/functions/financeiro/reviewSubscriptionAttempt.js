"use strict";
const {HttpsError} = require("firebase-functions/v2/https");
const {authorize, attemptRef, RECEIPTS, proofHash, documentDigest} = require("./subscriptionAttempt");
const {assertStoreFinancialAdmission} = require("./storeFinancialAdmission");

// Terminal success only for a server execution receipt AND current official
// evidence. No non-execution inference, new POST, ID adoption or slot deletion.
async function reviewSubscriptionAttempt({db, FieldValue, config, request, readOfficial}) {
  const owner = await authorize(db, config, request);
  if (config.environment !== "sandbox" || !config.operationsEnabled) throw new HttpsError("failed-precondition", "Revisao PROD permanece bloqueada.");
  await assertStoreFinancialAdmission({db, config, storeId: owner.storeId, storeData: owner.store, operation: "subscription.review"});
  const ref = attemptRef(db, config, owner.storeId), snap = await ref.get();
  const record = snap.exists ? snap.data() : null;
  if (!record || !/^[a-f0-9]{64}$/.test(record.fingerprint || "") || record.command?.schemaVersion !== 1 ||
      record.command?.operation !== "subscription.create" || record.command?.consentToContract !== true ||
      record.command?.uid !== owner.uid || record.command?.requestId !== request.data?.requestId ||
      record.command?.storeId !== owner.storeId || record.command?.projectId !== config.projectId || record.command?.environment !== config.environment) {
    throw new HttpsError("failed-precondition", "Intencao original nao comprovada.");
  }
  if (record.status === "completed") return {status: "completed", authority: "original_attempt"};
  if (!["needs_review", "in_progress"].includes(record.status)) throw new HttpsError("failed-precondition", "Estado nao revisavel.");
  const receiptRef = db.collection(RECEIPTS).doc(record.fingerprint), receiptSnap = await receiptRef.get();
  const receipt = receiptSnap.exists ? receiptSnap.data() : null;
  const storeRef = db.collection("stores").doc(owner.storeId), storeSnap = await storeRef.get(), store = storeSnap.data();
  if (!store || typeof store.asaasSubscriptionId !== "string" || !store.asaasSubscriptionId ||
      !receipt || receipt.result?.success !== true || receipt.schemaVersion !== 1 || receipt.fingerprint !== record.fingerprint ||
      proofHash(receipt.command) !== proofHash(record.command) || receipt.resultHash !== proofHash(receipt.result) ||
      receipt.result?.success !== true || receipt.result.subscriptionId !== store.asaasSubscriptionId || !store.asaasCustomerId) {
    throw new HttpsError("failed-precondition", "Sem recibo de execucao consistente. Preservar bloqueio; suporte necessario.");
  }
  const evidence = await readOfficial(store.asaasCustomerId, store.asaasSubscriptionId);
  const customer = evidence?.customer, sub = evidence?.subscription;
  if (!customer || !sub || customer.id !== store.asaasCustomerId || customer.externalReference !== owner.storeId ||
      customer.deleted === true || documentDigest(customer.cpfCnpj) !== record.command.documentHash ||
      sub.id !== store.asaasSubscriptionId || sub.customer !== customer.id || sub.externalReference !== owner.storeId ||
      sub.deleted === true || sub.status !== "ACTIVE") throw new HttpsError("failed-precondition", "Prova oficial divergente ou inconclusiva.");
  return db.runTransaction(async tx => {
    const [fresh, proof, current, user] = await Promise.all([tx.get(ref), tx.get(receiptRef), tx.get(storeRef), tx.get(db.collection("users").doc(owner.uid))]);
    if (!fresh.exists || !fresh.updateTime.isEqual(snap.updateTime) || !proof.exists || !proof.updateTime.isEqual(receiptSnap.updateTime) ||
        !current.exists || !current.updateTime.isEqual(storeSnap.updateTime) || current.data().ownerId !== owner.uid ||
        !user.exists || user.data().role !== "admin" || user.data().storeId !== owner.storeId || user.data().accessStatus === "revoked") {
      throw new HttpsError("aborted", "Evidencia ou vinculo alterado; bloqueio preservado.");
    }
    await assertStoreFinancialAdmission({db, config, transaction: tx, storeId: owner.storeId, storeData: current.data(), operation: "subscription.review"});
    tx.update(ref, {status: "completed", result: receipt.result, review: {schemaVersion: 1, receiptHash: receipt.resultHash,
      reviewerUid: owner.uid, conclusion: "execution_receipt_and_official_binding", reviewedAt: FieldValue.serverTimestamp()},
      updatedAt: FieldValue.serverTimestamp()});
    return {status: "completed", authority: "execution_receipt_and_official_binding"};
  });
}
module.exports = {reviewSubscriptionAttempt};
