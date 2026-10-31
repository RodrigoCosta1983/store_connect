"use strict";
const {HttpsError} = require("firebase-functions/v2/https");

// Trusted SDK reads in the caller's existing transaction/store/product scope.
// Existence is enough: archived or malformed descendants cannot prove simple.
async function hasProductVariantStructure(transaction, productRef) {
  for (const collection of ["variants", "variantCombinations"]) {
    try {
      const snapshot = await transaction.get(productRef.collection(collection).limit(1));
      if (!snapshot || typeof snapshot.empty !== "boolean" || !Number.isInteger(snapshot.size) ||
          snapshot.size < 0 || snapshot.size > 1 || !Array.isArray(snapshot.docs) ||
          snapshot.docs.length !== snapshot.size || snapshot.empty !== (snapshot.size === 0)) {
        throw new TypeError("Inconclusive variant structure read.");
      }
      if (!snapshot.empty) return true;
    } catch (_) {
      // Never let a read error become absence or an immutable terminal receipt.
      throw new HttpsError("unavailable", "Não foi possível verificar a estrutura do produto.",
        {reason: "variant-structure-read-unavailable"});
    }
  }
  return false;
}
module.exports = {hasProductVariantStructure};
