"use strict";
const {HttpsError} = require("firebase-functions/v2/https");
const contract = require("./saleV2Contract");
const PROJECT = "store-connect-app";
const COLLECTION = "offlineSaleRecoveryAuthorizations";
function fail(reason) {
  throw new HttpsError("failed-precondition", "Recuperação offline exige conferência autorizada.", {reason});
}
function productionDestination(project, env, readOnly) {
  if (project !== PROJECT) return false;
  if (env.GCLOUD_PROJECT !== PROJECT || env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_CLOUD_PROJECT !== PROJECT ||
      env.FUNCTIONS_EMULATOR === "true" || env.FIRESTORE_EMULATOR_HOST) fail("offline-runtime-mismatch");
  // Reading an original receipt must not depend on admission for NEW effects.
  if (!readOnly && env.F9_COMMERCIAL_OFFLINE_PROJECT !== PROJECT) fail("offline-production-writes-disabled");
  return true;
}
async function authorizeProductionRecovery(tx, db, input, requestHash, uid) {
  if (input.scope.projectId !== PROJECT) return;
  // Trusted backend-only attestation, never a client payload/boolean. Its Rules
  // protection must be verified before any rollout; this code never creates it.
  const ref = db.collection(COLLECTION).doc(contract.hash([input.scope.storeId, input.saleId]));
  const snap = await tx.get(ref), a = snap.exists ? snap.data() : null;
  if (!a || a.schemaVersion !== 1 || a.enabled !== true || a.priorExecutionResolved !== true ||
      a.projectId !== PROJECT || a.storeId !== input.scope.storeId || a.actorUid !== uid ||
      a.requestId !== input.requestId || a.saleId !== input.saleId || a.requestHash !== requestHash ||
      typeof a.approvedBy !== "string" || !a.approvedBy || !/^[a-f0-9]{64}$/.test(a.evidenceSha256 || "")) {
    fail("offline-recovery-authorization-required");
  }
}
function replayReceipt(snapshot, input, requestHash, uid, protocol = "syncOfflineSaleV1") {
  const saved = snapshot.data();
  if (saved.actorUid !== uid) throw new HttpsError("permission-denied", "Comprovante de outro ator.", {reason: "result-access-denied"});
  const result = saved.result;
  if (saved.protocol !== protocol || saved.storeId !== input.scope.storeId ||
      saved.requestHash !== requestHash || !result || result.requestId !== input.requestId ||
      !["confirmed", "rejected"].includes(result.status) ||
      result.status === "confirmed" && (result.saleId !== input.saleId || result.totalCents !== input.expectedTotalCents) ||
      result.status === "rejected" && (typeof result.reason !== "string" || !result.reason)) {
    return {status: "identity-conflict", requestId: input.requestId};
  }
  return {...result, replayed: true};
}
module.exports = {PROJECT, COLLECTION, productionDestination, authorizeProductionRecovery, replayReceipt};
