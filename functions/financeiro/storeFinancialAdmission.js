"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {classifyAsaasBindingOrigin} = require("./asaasBindingOrigin");

// Root collection: no client allow match in the current Rules. Never consume
// a field on stores/{id}, a store subcollection or a Flutter supplied grant.
const COLLECTION = "asaasFinancialAdmission";
const OPERATIONS = Object.freeze([
  "subscription.create", "subscription.change-plan", "subscription.webhook",
  "subscription.reconcile", "subscription.overdue",
  "subscription.read",
  "subscription.review",
]);

async function checkStoreFinancialAdmission({
  db, storeId, storeData, config, operation, transaction,
}) {
  if (!config || !((config.environment === "sandbox" && config.projectId === "store-connect-hml") ||
      (config.environment === "production" && config.projectId === "store-connect-app"))) {
    return {allowed: false, reason: "invalid_runtime_context"};
  }
  if (typeof storeId !== "string" || !storeId || storeId.includes("/") ||
      !OPERATIONS.includes(operation)) {
    return {allowed: false, reason: "invalid_admission_context"};
  }
  const origin = classifyAsaasBindingOrigin(storeData, config);
  if (!origin.allowed || (operation !== "subscription.create" &&
      (origin.kind !== "verified_binding" || !storeData.asaasSubscriptionId))) {
    return {allowed: false, reason: "unverified_binding_origin"};
  }
  // This module cannot enable PROD. The independent global gate remains first.
  if (config.operationsEnabled !== true) {
    return {allowed: false, reason: "operations_disabled"};
  }
  if (config.environment === "sandbox") {
    return {allowed: true, reason: "sandbox_existing_policy"};
  }
  const ref = db.collection(COLLECTION).doc(storeId);
  const snap = transaction ? await transaction.get(ref) : await ref.get();
  const grant = snap.exists ? snap.data() : null;
  if (grant && (grant.schemaVersion !== 1 || grant.enabled !== true ||
      grant.storeId !== storeId || grant.environment !== config.environment ||
      grant.projectId !== config.projectId || !Array.isArray(grant.operations) ||
      !grant.operations.includes(operation))) {
    return {allowed: false, reason: "store_not_admitted"};
  }
  if(config.publicRollout!==true&&!grant)return {allowed:false,reason:'store_not_admitted'};
  const ownerId=storeData?.ownerId;
  if(typeof ownerId!=='string'||!ownerId||ownerId.includes('/'))return {allowed:false,reason:'invalid_owner'};
  const ownerRef=db.collection('users').doc(ownerId);
  const ownerSnap=transaction?await transaction.get(ownerRef):await ownerRef.get();
  const owner=ownerSnap.exists?ownerSnap.data():{};
  if(owner.storeId!==storeId||owner.role!=='admin'||owner.accessStatus==='revoked')return {allowed:false,reason:'invalid_owner'};
  return {allowed:true,reason:grant?'backend_store_grant':'public_canonical_owner'};
}

async function assertStoreFinancialAdmission(context) {
  const admission = await checkStoreFinancialAdmission(context);
  if (!admission.allowed) {
    throw new HttpsError("failed-precondition",
        "Operacao financeira nao autorizada para esta loja e ambiente.");
  }
  return admission;
}

module.exports = {COLLECTION, OPERATIONS,
  checkStoreFinancialAdmission, assertStoreFinancialAdmission};
