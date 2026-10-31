"use strict";

const {createHash} = require("node:crypto");
const {HttpsError} = require("firebase-functions/v2/https");

function normalizeCod(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "O COD deve ser uma string.");
  }
  const cod = value.trim().toUpperCase();
  if (cod.length > 40) {
    throw new HttpsError("invalid-argument", "O COD deve ter no máximo 40 caracteres.");
  }
  return cod;
}

function codeRef(storeRef, cod) {
  return storeRef.collection("productCodes").doc(
    createHash("sha256").update(cod, "utf8").digest("hex"),
  );
}

function duplicateCod() {
  return new HttpsError("already-exists",
    "Este COD já está sendo usado por outro produto.",
    {reason: "duplicate-product-cod"});
}

// Legacy reservations are interpreted in memory only. No implicit migration.
// Recognizing a variant owner does not expose a variant reservation writer.
function reservationOwner(reservation) {
  const validId = (id) => typeof id === "string" && id.trim() === id &&
    id.length > 0 && !id.includes("/") && id !== "." && id !== "..";
  const legacy = !Object.hasOwn(reservation, "ownerType");
  const ownerType = legacy ? "product" : reservation.ownerType;
  const variantId = legacy && reservation.variantId === undefined
    ? null : reservation.variantId;
  if (!validId(reservation.productId) ||
      (ownerType === "product" ? variantId !== null :
        ownerType !== "variant" || !validId(variantId))) {
    throw new HttpsError("failed-precondition", "Proprietário da reserva do COD inválido.");
  }
  return {ownerType, productId: reservation.productId, variantId};
}

// All reads happen here; the returned closure must run only after the caller
// finishes its other transaction reads. Product and reservation commit together.
// Every reservation is retained permanently. Active COD is the entity's current
// COD with a valid reservation; a retained index alone is never an active alias.
// Physical client deletion remains prohibited by the existing product policy.
async function prepareCodeChange(transaction, storeRef, productId, oldValue, newValue) {
  const oldCod = normalizeCod(oldValue);
  const newCod = normalizeCod(newValue);
  const oldRef = oldCod ? codeRef(storeRef, oldCod) : null;
  const newRef = newCod ? codeRef(storeRef, newCod) : null;
  const oldSnapshot = oldRef ? await transaction.get(oldRef) : null;
  const newSnapshot = newRef
    ? (oldCod === newCod ? oldSnapshot : await transaction.get(newRef)) : null;

  // Include unreserved legacy/imported products and archived products. Read in
  // the transaction so concurrent product writers cannot bypass the check.
  if (newCod) {
    const products = await transaction.get(storeRef.collection("products"));
    for (const doc of products.docs) {
      if (doc.id !== productId && normalizeCod(doc.data().cod) === newCod) throw duplicateCod();
    }
  }
  if (oldRef && !oldSnapshot.exists) {
    throw new HttpsError("failed-precondition", "Reserva do COD ausente; revisão de integridade necessária.");
  }

  if (newSnapshot?.exists) {
    const reservation = newSnapshot.data();
    const owner = reservationOwner(reservation);
    if (reservation.cod !== newCod) {
      throw new HttpsError("failed-precondition", "Não foi possível validar a reserva do COD.");
    }
    if (owner.ownerType !== "product" || owner.productId !== productId) throw duplicateCod();
    // Matching ownership does not authorize reactivation of a historical COD.
    // Only keeping the already-current, valid reservation is permitted.
    if (oldCod !== newCod) throw duplicateCod();
  }
  if (oldSnapshot?.exists) {
    const reservation = oldSnapshot.data();
    const owner = reservationOwner(reservation);
    if (reservation.cod !== oldCod || owner.ownerType !== "product" || owner.productId !== productId) {
      throw new HttpsError("failed-precondition", "Não foi possível validar a reserva anterior do COD.");
    }
  }

  return () => {
    // Changing/removing COD never releases or rewrites its previous reservation.
    // Never silently reconcile a product whose previous reservation is missing.
    if (newRef && !newSnapshot.exists) {
      transaction.create(newRef, {cod: newCod, ownerType: "product", productId, variantId: null});
    }
  };
}

module.exports = {normalizeCod, codeRef, duplicateCod, reservationOwner, prepareCodeChange};
