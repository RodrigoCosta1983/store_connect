"use strict";

const {createHash} = require("node:crypto");
const {HttpsError, onCall} = require("firebase-functions/v2/https");
const {assertAsaasBindingOrigin} = (() => {
  const {classifyAsaasBindingOrigin} = require("./asaasBindingOrigin");
  return {assertAsaasBindingOrigin(data, config) {
    if (!classifyAsaasBindingOrigin(data, config).allowed) throw new HttpsError("failed-precondition", "Vinculo financeiro exige conferencia.");
  }};
})();
const {assertStoreFinancialAdmission} = require("./storeFinancialAdmission");
const COLLECTION = "asaasSubscriptionAttempts";
const RECEIPTS = "asaasSubscriptionExecutionReceipts";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const documentDigest = value => hash(String(value || "").replace(/\D/g, ""));
function proofHash(value) {
  function canonical(v) {
    if (Array.isArray(v)) return v.map(canonical);
    return v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  }
  return hash(canonical(value));
}
function attemptRef(db, config, storeId) {
  return db.collection(COLLECTION).doc(hash([config.projectId, config.environment, storeId]));
}
async function authorize(db, config, request, {write = false} = {}) {
  const uid = request.auth?.uid, storeId = request.data?.storeId;
  if (!uid) throw new HttpsError("unauthenticated", "Autenticacao necessaria.");
  if (typeof storeId !== "string" || !storeId || storeId.includes("/")) throw new HttpsError("invalid-argument", "Loja invalida.");
  const [user, store] = await Promise.all([db.collection("users").doc(uid).get(), db.collection("stores").doc(storeId).get()]);
  const u = user.exists ? user.data() : {}, s = store.exists ? store.data() : {};
  if (!store.exists || u.storeId !== storeId || u.role !== "admin" || u.accessStatus === "revoked" || s.ownerId !== uid) {
    throw new HttpsError("permission-denied", "Somente o proprietario pode consultar ou contratar.");
  }
  if (write) {
    assertAsaasBindingOrigin(s, config);
    await assertStoreFinancialAdmission({db, config, storeId, storeData: s, operation: "subscription.create"});
  }
  return {uid, storeId, store: s};
}
async function runSubscriptionAttempt({db, FieldValue, config, request, execute}) {
  const owner = await authorize(db, config, request, {write: true});
  const input = request.data;
  if (input.schemaVersion !== 1 || input.consentToContract !== true || !/^[a-f0-9]{32}$/.test(input.requestId || "")) {
    throw new HttpsError("failed-precondition", "Atualize o aplicativo e confirme expressamente a contratacao.");
  }
  const command = {schemaVersion: 1, operation: "subscription.create", consentToContract: true,
    requestId: input.requestId, uid: owner.uid, storeId: owner.storeId,
    projectId: config.projectId, environment: config.environment,
    // Fingerprint protects a frozen legacy-document fallback without persisting it here.
    documentHash: documentDigest(input.cpfCnpj)};
  const fingerprint = hash(command), ref = attemptRef(db, config, owner.storeId);
  const reservation = await db.runTransaction(async tx => {
    const [old, user, store] = await Promise.all([tx.get(ref), tx.get(db.collection("users").doc(owner.uid)), tx.get(db.collection("stores").doc(owner.storeId))]);
    const u = user.exists ? user.data() : {}, s = store.exists ? store.data() : {};
    if (u.storeId !== owner.storeId || u.role !== "admin" || u.accessStatus === "revoked" || s.ownerId !== owner.uid) throw new HttpsError("permission-denied", "Vinculo alterado.");
    assertAsaasBindingOrigin(s, config);
    await assertStoreFinancialAdmission({db, config, storeId: owner.storeId, storeData: s, operation: "subscription.create", transaction: tx});
    if (old.exists) {
      const record = old.data();
      if (record.fingerprint !== fingerprint) throw new HttpsError("failed-precondition", "Existe tentativa financeira original. Nao crie outra identidade.");
      if (record.status === "completed") return {replay: record.result};
      throw new HttpsError("failed-precondition", "Tentativa inconclusiva. Conferencia autorizada necessaria; nenhum reenvio permitido.");
    }
    tx.create(ref, {schemaVersion: 1, command, fingerprint, status: "in_progress", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
    return {reserved: true};
  });
  if (reservation.replay) return reservation.replay;
  try {
    // Exactly one invocation is allowed after reservation; no TTL takeover.
    const result = await execute();
    if (!result || result.success !== true) throw Error("inconclusive_provider_result");
    // Independent evidence survives failure of the active pointer's completion.
    // Never backfill a receipt merely from an ID found in a store/provider.
    const receipt = db.collection(RECEIPTS).doc(fingerprint);
    await db.runTransaction(async tx => {
      const [active, previous] = await Promise.all([tx.get(ref), tx.get(receipt)]);
      if (!active.exists || active.data().fingerprint !== fingerprint || active.data().status !== "in_progress") throw Error("attempt_changed");
      const evidence = {schemaVersion: 1, command, fingerprint, result, resultHash: proofHash(result)};
      if (previous.exists) {
        const saved = previous.data();
        if (saved.fingerprint !== fingerprint || saved.resultHash !== evidence.resultHash || proofHash(saved.command) !== proofHash(command)) throw Error("execution_receipt_conflict");
      } else tx.create(receipt, {...evidence, createdAt: FieldValue.serverTimestamp()});
    });
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().fingerprint !== fingerprint || snap.data().status !== "in_progress") throw Error("attempt_changed");
      tx.update(ref, {status: "completed", result, updatedAt: FieldValue.serverTimestamp()});
    });
    return result;
  } catch (_) {
    // Provider may have accepted a write. Never reopen this slot automatically.
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.data().fingerprint === fingerprint && snap.data().status === "in_progress") {
        tx.update(ref, {status: "needs_review", errorCode: "financial_result_inconclusive", updatedAt: FieldValue.serverTimestamp()});
      }
    });
    throw new HttpsError("failed-precondition", "Resultado financeiro inconclusivo. Consulte o estado original; nao repita a contratacao.");
  }
}
function inactiveReason(store) {
  if (store.subscriptionStatus !== "inactive") return null;
  if (["trial_expired", "overdue", "cancelled"].includes(store.subscriptionInactiveReason)) return store.subscriptionInactiveReason;
  // Historical timestamps alone cannot classify an unknown inactivation.
  return "unknown";
}
async function readSubscriptionState({db, config, request}) {
  const owner = await authorize(db, config, request);
  const snap = await attemptRef(db, config, owner.storeId).get();
  const attempt = snap.exists ? snap.data() : null;
  const customer = !!owner.store.asaasCustomerId, subscription = !!owner.store.asaasSubscriptionId;
  const billingState = customer && subscription ? "bound" : customer || subscription ? "incomplete_binding" : "no_subscription";
  return {schemaVersion: 1, subscriptionStatus: owner.store.subscriptionStatus || "unknown",
    subscriptionType: owner.store.subscriptionType || "unknown", inactiveReason: inactiveReason(owner.store),
    attemptStatus: attempt?.status || "none", requestId: attempt?.command?.requestId || null,
    billingState,
    canStart: !attempt && billingState === "no_subscription" && config.operationsEnabled === true,
    operationsEnabled: config.operationsEnabled === true, authority: "firestore_only",
    // No customer/subscription IDs, personal data or billing URLs in a query.
  };
}
function subscriptionStateCallable({db, config}) {
  return onCall({enforceAppCheck: true}, request => readSubscriptionState({db: db(), config: config(), request}));
}
module.exports = {COLLECTION, RECEIPTS, proofHash, documentDigest, attemptRef, authorize, runSubscriptionAttempt, readSubscriptionState, inactiveReason, subscriptionStateCallable};
