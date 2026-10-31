"use strict";

const {createHash} = require("node:crypto");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const contract = require("./productMutationContract");
const {authorize, validate, options} = require("./productEditState");
const {assertMutationScope} = require("./productMutationScope");
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
const validators = {updateProductV2: contract.validateUpdateProductV2,
  adjustProductStockV1: contract.validateAdjustProductStock};

// Full command is required: a bare requestId cannot establish payload identity.
// Hashes are computed server-side with the writer's existing normalization.
const getProductMutationResult = onCall(options, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "É necessário estar autenticado.");
  const input = validate((data) => {
    contract.keys(data, ["operation", "command", "expectedStoreId"], "Payload",
      ["operation", "command", "expectedStoreId"]);
    if (!Object.hasOwn(validators, data.operation)) throw new TypeError("Operação inválida.");
    return {operation: data.operation, command: validators[data.operation](data.command),
      expectedStoreId: contract.id(data.expectedStoreId, "expectedStoreId")};
  }, request.data);
  const db = admin.firestore();
  return db.runTransaction(async (transaction) => {
    const store = await authorize(transaction, db, request.auth);
    if (store.id !== input.expectedStoreId) throw new HttpsError("permission-denied", "Escopo da tentativa mudou.");
    const {operation, command} = input;
    assertMutationScope(command, request.auth.uid, store.id);
    const base = {operation, requestId: command.requestId, productId: command.productId};
    const ref = store.collection("auditLogs").doc(digest([operation, store.id, request.auth.uid, command.requestId]));
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return {...base, status: "not-recorded", definitive: false};
    const saved = snapshot.data();
    if (saved.action !== operation || saved.entityId !== command.productId || saved.storeId !== store.id ||
        saved.performedBy?.uid !== request.auth.uid || saved.requestHash !== digest(canonical(command))) {
      return {...base, status: "identity-conflict", definitive: true};
    }
    if (saved.outcome === "rejected") {
      if (!saved.error || !["aborted", "failed-precondition", "not-found", "already-exists", "invalid-argument"].includes(saved.error.code)) {
        throw new HttpsError("internal", "Resultado persistido inválido.");
      }
      return {...base, status: "rejected", definitive: true,
        error: {code: saved.error.code, reason: typeof saved.error.reason === "string" ? saved.error.reason : null}};
    }
    const result = saved.result;
    if (!result || result.success !== true || result.productId !== command.productId || result.requestId !== command.requestId ||
        typeof result.changed !== "boolean") throw new HttpsError("internal", "Resultado persistido inválido.");
    return {...base, status: "confirmed", definitive: true, result: {success: true,
      productId: command.productId, requestId: command.requestId, changed: result.changed, replayed: true}};
  });
});

module.exports = {getProductMutationResult};
