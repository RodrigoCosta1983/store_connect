"use strict";

const admin = require("firebase-admin");
const {Timestamp, FieldValue} = require("firebase-admin/firestore");
const {HttpsError} = require("firebase-functions/v2/https");
const {requireTransactionalWriterAdmission} = require("./transactionalWriterAdmission");
const POLICY_REVISION = "f9-commercial-admission-1";
// Explicit families/domains; an omitted writer is never implicitly admitted.
const WRITERS = Object.freeze({
  syncOfflineSaleV1: {modes: ["legacy", "authoritative"], domains: ["sales", "stock", "offline"]},
  createDeferredSaleV1: {modes: ["legacy", "authoritative"], domains: ["sales", "stock", "receivables"]},
  createManualCashV1: {modes: ["legacy", "authoritative"], domains: ["cash"]},
  receiveDebtPaymentV1: {modes: ["legacy", "authoritative"], domains: ["sales", "receivables", "cash"]},
  confirmSaleV2: {modes: ["authoritative"], domains: ["sales", "stock"]},
  syncOfflineSale: {modes: ["legacy"], domains: ["sales", "stock", "offline"]},
  updateProduct: {modes: ["legacy"], domains: ["products", "stock", "cod"]},
  updateProductV2: {modes: ["authoritative"], domains: ["products", "cod", "taxonomy"]},
  adjustProductStockV1: {modes: ["authoritative"], domains: ["stock"]},
  createProduct: {modes: ["legacy", "authoritative"], domains: ["products", "stock", "cod", "taxonomy"]},
  archiveProduct: {modes: ["legacy", "authoritative"], domains: ["products", "cod"]},
  restoreProduct: {modes: ["legacy", "authoritative"], domains: ["products", "cod"]},
  setProductCategories: {modes: ["legacy", "authoritative"], domains: ["taxonomy"]},
  upsertCategory: {modes: ["legacy", "authoritative"], domains: ["taxonomy"]},
  deleteCategory: {modes: ["legacy", "authoritative"], domains: ["taxonomy"]},
  createProductC1: {modes: ["authoritative"], domains: ["products", "variants", "cod"]},
  createVariantC1: {modes: ["authoritative"], domains: ["variants", "stock", "cod"]},
  adjustVariantStockC3: {modes: ["authoritative"], domains: ["variants", "stock"]},
  archiveVariantC3: {modes: ["authoritative"], domains: ["variants", "stock"]},
  // Direct clients are enforced by Rules, never trusted as Admin writer IDs.
});
const MODES = ["legacy", "draining", "authoritative"];
const DRAIN_WRITERS = Object.freeze([...Object.keys(WRITERS), "S01", "S02", "SalesProvider.addOrder",
  "SalesProvider.receiveCustomerDebtPayment", "SalesProvider.markOrderAsPaid", "CashFlowProvider", "externalAdmin"]);
const controlRef = (db, storeId) => db.collection("storeWriterAdmission").doc(storeId);
const fail = (reason, code = "failed-precondition") => {
  throw new HttpsError(code, "Admissão comercial recusada.", {reason});
};
function validControl(data) {
  return !!data && data.schemaVersion === 1 && MODES.includes(data.mode) &&
    Number.isSafeInteger(data.epoch) && data.epoch > 0 &&
    data.policyRevision === POLICY_REVISION &&
    typeof data.changedBy === "string" && !!data.changedBy &&
    typeof data.lastTransitionId === "string" && !!data.lastTransitionId &&
    data.changedAt instanceof Timestamp;
}
// One instance per handler invocation, outside runTransaction. An automatic retry
// rereads policy but cannot silently refresh the epoch captured by this request.
function createStoreWriterAdmission(db, writer, uid) {
  if (!Object.hasOwn(WRITERS, writer)) throw new TypeError("Unknown writer.");
  let originalEpoch;
  let originalStore;
  return async (transaction, storeId) => {
    if (typeof uid !== "string" || !uid) fail("writer-authentication-required", "unauthenticated");
    const profile = await transaction.get(db.collection("users").doc(uid));
    const user = profile.data();
    if (!profile.exists || user.storeId !== storeId ||
        String(user.accessStatus || "").trim().toLowerCase() === "revoked") {
      fail("writer-membership-changed", "permission-denied");
    }
    const role = String(user.role || "").trim().toLowerCase();
    if (writer !== "syncOfflineSale" && !["admin", "gerente", "operador", "caixa", "vendedor"].includes(role) ||
        ["archiveProduct", "restoreProduct"].includes(writer) && role !== "admin") {
      fail("writer-role-changed", "permission-denied");
    }
    if (originalStore !== undefined && originalStore !== storeId) fail("writer-store-changed", "permission-denied");
    originalStore = storeId;
    await requireTransactionalWriterAdmission(transaction, controlRef(db, storeId), snapshot => {
      const data = snapshot.data();
      if (!validControl(data)) return false;
      if (originalEpoch === undefined) originalEpoch = data.epoch;
      return originalEpoch === data.epoch && WRITERS[writer].modes.includes(data.mode);
    });
  };
}

function localOnly(db) {
  if (!/^demo-/.test(db.projectId || "") || process.env.GCLOUD_PROJECT !== db.projectId ||
      !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) {
    fail("admission-management-local-only");
  }
}
// Trusted backend operator registry; no owner/role from the app grants access.
// No onCall/index export. The existing manager remains Emulator-only.
async function transitionStoreWriterAdmission(db, request) {
  localOnly(db);
  return transitionAdmission(db, request);
}

// Trusted administrative CLI only, never a callable. The operator registry,
// epoch/CAS, drain evidence and atomic audit below are shared without bypass.
async function transitionHmlStoreWriterAdmission(db, request) {
  if (db.projectId !== "store-connect-hml" || process.env.GCLOUD_PROJECT !== db.projectId ||
      process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR === "true") {
    fail("admission-management-hml-only");
  }
  return transitionAdmission(db, request);
}

async function transitionAdmission(db, request) {
  const uid = request.auth?.uid;
  if (typeof uid !== "string" || !uid) fail("operator-authentication-required", "unauthenticated");
  const input = request.data || {};
  const {storeId, requestId, expectedEpoch, mode, reason, evidenceId} = input;
  if (evidenceId !== undefined && (typeof evidenceId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(evidenceId))) fail("invalid-transition", "invalid-argument");
  for (const id of [storeId, requestId]) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) fail("invalid-transition", "invalid-argument");
  }
  if (!MODES.includes(mode) || !Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0 ||
      typeof reason !== "string" || !reason.trim() || reason.length > 1024 ||
      Object.keys(input).some(key => !["storeId", "requestId", "expectedEpoch", "mode", "reason", "evidenceId"].includes(key))) {
    fail("invalid-transition", "invalid-argument");
  }
  const command = {storeId, requestId, expectedEpoch, mode, reason, evidenceId: evidenceId || null};
  return db.runTransaction(async transaction => {
    const operator = await transaction.get(db.collection("writerAdmissionOperators").doc(uid));
    const access = operator.data();
    if (!operator.exists || access.enabled !== true || access.storeId !== storeId) fail("operator-access-denied", "permission-denied");
    const ref = controlRef(db, storeId);
    const audit = ref.collection("changes").doc(requestId);
    const prior = await transaction.get(audit);
    if (prior.exists) {
      if (prior.data().actorUid !== uid || JSON.stringify(prior.data().command) !== JSON.stringify(command)) {
        // Firestore map key order is not the command's identity.
        const {isDeepStrictEqual} = require("node:util");
        if (prior.data().actorUid !== uid || !isDeepStrictEqual(prior.data().command, command)) fail("transition-identity-conflict", "already-exists");
      }
      return {...prior.data().result, replayed: true};
    }
    const snapshot = await transaction.get(ref);
    const current = snapshot.data();
    if (!(await transaction.get(db.collection("stores").doc(storeId))).exists) fail("admission-store-unavailable");
    if (snapshot.exists && !validControl(current)) fail("invalid-admission-control");
    if ((snapshot.exists ? current.epoch : 0) !== expectedEpoch) fail("admission-epoch-conflict", "aborted");
    if ((!snapshot.exists && mode !== "legacy") || snapshot.exists &&
        !((current.mode === "legacy" && mode === "draining") ||
          (current.mode === "draining" && mode === "authoritative") ||
          (current.mode === "authoritative" && mode === "draining"))) fail("invalid-admission-transition");
    if (expectedEpoch >= Number.MAX_SAFE_INTEGER) fail("admission-epoch-exhausted");
    if (mode === "authoritative") {
      if (typeof evidenceId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(evidenceId)) fail("drain-evidence-required");
      const proof = await transaction.get(db.collection("writerAdmissionEvidence").doc(evidenceId));
      const evidence = proof.data();
      // Backend operator attestation, not a proof generated from a timer or UI.
      if (!proof.exists || evidence.schemaVersion !== 1 || evidence.storeId !== storeId || evidence.epoch !== expectedEpoch ||
          evidence.policyRevision !== POLICY_REVISION || evidence.projectId !== db.projectId ||
          evidence.actorUid !== uid || !(evidence.createdAt instanceof Timestamp) ||
          !["legacyClientsBlocked", "legacyAdminDrained", "pendingOperationsResolved", "offlineReady",
            "receivablesReady", "cashReady", "variantsReady", "allWritersReviewed"].every(key => evidence[key] === true)) {
        fail("drain-evidence-incomplete");
      }
      if (typeof evidence.inventoryRef !== "string" || !evidence.inventoryRef.trim() ||
          !/^[a-f0-9]{64}$/.test(evidence.artifactSha256 || "") || evidence.unresolvedOperationCount !== 0 ||
          !Array.isArray(evidence.coveredWriters) || !DRAIN_WRITERS.every(writer => evidence.coveredWriters.includes(writer)) ||
          !(evidence.drainStartedAt instanceof Timestamp) ||
          !(evidence.drainCompletedAt instanceof Timestamp) ||
          evidence.drainCompletedAt.seconds < evidence.drainStartedAt.seconds ||
          evidence.drainCompletedAt.seconds === evidence.drainStartedAt.seconds &&
          evidence.drainCompletedAt.nanoseconds < evidence.drainStartedAt.nanoseconds) fail("drain-evidence-incomplete");
    }
    const epoch = expectedEpoch + 1;
    const result = {storeId, mode, epoch, policyRevision: POLICY_REVISION, replayed: false};
    const now = FieldValue.serverTimestamp();
    transaction.set(ref, {schemaVersion: 1, mode, epoch, policyRevision: POLICY_REVISION,
      changedBy: uid, changedAt: now, lastTransitionId: requestId});
    transaction.create(audit, {command, actorUid: uid, fromMode: current?.mode || null,
      fromEpoch: expectedEpoch, result, createdAt: now});
    return result;
  });
}
module.exports = {POLICY_REVISION, WRITERS, DRAIN_WRITERS, validControl, controlRef,
  createStoreWriterAdmission, transitionStoreWriterAdmission, transitionHmlStoreWriterAdmission};
