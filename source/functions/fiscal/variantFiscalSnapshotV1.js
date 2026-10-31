"use strict";
const {createHash} = require("node:crypto");
const {isDeepStrictEqual: equal} = require("node:util");
const {HttpsError} = require("firebase-functions/v2/https");
const {FISCAL_FIELDS} = require("../contracts/productCommercialC5");
const {localMutationSupport: core} = require("../products/productVariantsC1");
const fail = reason => { throw new HttpsError("failed-precondition", "Dados fiscais históricos da identidade vendável indisponíveis.", {reason}); };
function capture(identity, fiscal, unitPriceCents, quantity) {
  if (!fiscal || typeof fiscal !== "object" || Array.isArray(fiscal)) return null;
  const fields = {};
  for (const key of FISCAL_FIELDS) if (Object.hasOwn(fiscal, key)) {
    if (fiscal[key] !== null && typeof fiscal[key] !== "string") fail("invalid-fiscal-field");
    fields[key] = fiscal[key];
  }
  const code = identity.variantId === null ? identity.productId : "v-" + createHash("sha256")
    .update(JSON.stringify([identity.productId, identity.variantId])).digest("hex");
  const value = {schemaVersion: 1, identity, codigoProduto: code, fiscal: fields, unitPriceCents, quantity,
    source: "server-sale-commit"};
  return {...value, hash: core.hash(core.canonical(value))};
}
function read(item) {
  const value = item.fiscalSnapshotV1;
  if (!value || value.schemaVersion !== 1 || value.source !== "server-sale-commit") fail("variant-fiscal-snapshot-required");
  const {hash, ...body} = value;
  if (hash !== core.hash(core.canonical(body)) || !equal(value.identity,
    {productId: item.productId, variantId: item.variantId ?? null}) || value.quantity !== item.quantity ||
      value.unitPriceCents !== item.unitPriceCents || item.price !== item.unitPriceCents / 100) fail("variant-fiscal-snapshot-conflict");
  // Tax validity is enforced by the existing item builder for the current
  // issuer/year. A hash is integrity metadata, never tax authorization.
  return {name: item.name, fiscal: value.fiscal, codigoProduto: value.codigoProduto};
}
module.exports = {capture, read};
