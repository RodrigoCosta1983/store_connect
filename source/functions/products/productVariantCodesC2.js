"use strict";

// Creation only, local F10 service. No release, reassignment or repair.
const {HttpsError} = require("firebase-functions/v2/https");
const {normalizeCod, codeRef, reservationOwner, duplicateCod} = require("./productCodeReservation");
const invalid = () => { throw new HttpsError("failed-precondition", "c2-code-integrity-review-required"); };

async function prepareCodeCreation(tx, store, cod, owner) {
  if (!cod) return () => {};
  reservationOwner(owner);
  const ref = codeRef(store, cod);
  const reserved = await tx.get(ref);
  if (reserved.exists) {
    const raw = reserved.data();
    reservationOwner(raw); // Includes legacy F9; never rewrite it.
    if (raw.cod !== cod) invalid();
    // Even an orphan or matching owner is occupied; creation cannot adopt it.
    throw duplicateCod();
  }
  // F9's transactional legacy scan, extended to all local product variants.
  // This intentionally expensive defensive scan is not a commercial rollout.
  const products = await tx.get(store.collection("products"));
  for (const product of products.docs) {
    if (normalizeCod(product.data().cod) === cod) throw duplicateCod();
    const variants = await tx.get(product.ref.collection("variants"));
    for (const variant of variants.docs) {
      const existingCod = normalizeCod(variant.data().cod);
      if (!existingCod) continue;
      const index = await tx.get(codeRef(store, existingCod));
      if (!index.exists) invalid();
      const raw = index.data();
      const existingOwner = reservationOwner(raw);
      if (raw.cod !== existingCod || existingOwner.ownerType !== "variant" ||
          existingOwner.productId !== product.id || existingOwner.variantId !== variant.id) invalid();
      if (existingCod === cod) throw duplicateCod();
    }
  }
  // Caller completes all other reads before invoking this closure.
  return () => tx.create(ref, {cod, ...owner});
}
module.exports = {prepareCodeCreation};
