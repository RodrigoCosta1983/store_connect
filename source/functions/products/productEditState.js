"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const contract = require("./productMutationContract");
const roles = new Set(["admin", "gerente", "operador", "caixa", "vendedor"]);
const text = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";
const options = {timeoutSeconds: 30, memory: "256MiB"};

function validate(fn, value) {
  try { return fn(value); } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      throw new HttpsError("invalid-argument", error.message);
    }
    throw error;
  }
}
async function authorize(transaction, db, auth) {
  if (!auth) throw new HttpsError("unauthenticated", "É necessário estar autenticado.");
  const profile = await transaction.get(db.collection("users").doc(auth.uid));
  const user = profile.data() || {};
  if (!profile.exists || !roles.has(text(user.role)) || text(user.accessStatus) === "revoked") {
    throw new HttpsError("permission-denied", "Usuário não autorizado.");
  }
  let storeId;
  try { storeId = contract.id(user.storeId, "storeId"); } catch (_) {
    throw new HttpsError("permission-denied", "Perfil sem loja válida.");
  }
  const storeRef = db.collection("stores").doc(storeId);
  if (!(await transaction.get(storeRef)).exists) throw new HttpsError("not-found", "Loja não encontrada.");
  return storeRef;
}
function token(value) {
  if (!(value instanceof admin.firestore.Timestamp)) {
    throw new HttpsError("internal", "Versão autoritativa indisponível.");
  }
  return contract.expectedTime({seconds: String(value.seconds), nanoseconds: value.nanoseconds});
}
// An explicit projection: absent stays absent, null stays null. Unknown/internal
// fields never enter the DTO. Invalid legacy values are flagged, not defaulted.
function project(snapshot) {
  const current = snapshot.data();
  const product = {};
  const unavailable = [];
  const scalar = (key, valid) => {
    if (!contract.has(current, key)) return;
    const value = current[key];
    if (value === null || valid(value)) product[key] = value;
    else unavailable.push(key);
  };
  for (const key of ["name", "imageUrl", "cod", "barcode", "categoryId", "categoryName"]) {
    scalar(key, (v) => typeof v === "string");
  }
  for (const key of ["price", "costPrice", "quantidade", "minimumStock"]) {
    scalar(key, (v) => typeof v === "number" && Number.isFinite(v));
  }
  scalar("isArchived", (v) => typeof v === "boolean");
  scalar("categoryIds", (v) => Array.isArray(v) && v.every((id) => typeof id === "string"));
  if (contract.has(current, "fiscal")) {
    const fiscal = current.fiscal;
    if (fiscal === null) product.fiscal = null;
    else if (fiscal && [Object.prototype, null].includes(Object.getPrototypeOf(fiscal))) {
      product.fiscal = {};
      for (const key of contract.FISCAL_FIELDS) {
        if (!contract.has(fiscal, key)) continue;
        if (fiscal[key] === null || typeof fiscal[key] === "string") product.fiscal[key] = fiscal[key];
        else unavailable.push("fiscal." + key);
      }
    } else unavailable.push("fiscal");
  }
  if (contract.has(current, "lotes")) {
    if (current.lotes === null) product.lotes = null;
    else if (Array.isArray(current.lotes)) {
      product.lotes = current.lotes.map((lot, index) => {
        const result = {index};
        if (!lot || ![Object.prototype, null].includes(Object.getPrototypeOf(lot))) {
          unavailable.push("lotes." + index); return result;
        }
        if (contract.has(lot, "quantidade")) {
          if (lot.quantidade === null || (typeof lot.quantidade === "number" && Number.isFinite(lot.quantidade))) {
            result.quantidade = lot.quantidade;
          } else unavailable.push("lotes." + index + ".quantidade");
        }
        if (contract.has(lot, "validade")) {
          if (lot.validade === null) result.validade = null;
          else if (lot.validade instanceof admin.firestore.Timestamp) {
            result.validade = {seconds: String(lot.validade.seconds), nanoseconds: lot.validade.nanoseconds};
          } else unavailable.push("lotes." + index + ".validade");
        }
        return result;
      });
    } else unavailable.push("lotes");
  }
  return {schemaVersion: 1, productId: snapshot.id, expectedUpdateTime: token(snapshot.updateTime), product, unavailable};
}
const getProductEditState = onCall(options, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "É necessário estar autenticado.");
  const productId = validate((data) => {
    contract.keys(data, ["productId"], "Payload", ["productId"]);
    return contract.id(data.productId, "productId");
  }, request.data);
  const db = admin.firestore();
  return db.runTransaction(async (transaction) => {
    const store = await authorize(transaction, db, request.auth);
    const snapshot = await transaction.get(store.collection("products").doc(productId));
    if (!snapshot.exists) throw new HttpsError("not-found", "Produto não encontrado.");
    return {...project(snapshot), storeId: store.id, uid: request.auth.uid};
  });
});

module.exports = {getProductEditState, authorize, validate, project, options};
