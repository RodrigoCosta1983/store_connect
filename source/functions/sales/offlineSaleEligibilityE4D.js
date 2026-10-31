"use strict";

// Dedicated new-effect policy, D01-D06. These predicates are necessary, never
// sufficient commit authorization: syncOfflineSale additionally proves owner,
// subscription, absent S, historical archive permission and prepares stock/FIFO
// from transactional snapshots before submitting any write. No replay uses this.
const {evaluateProductEligibility} = require("../contracts/productEligibilityC5");
const {HttpsError} = require("firebase-functions/v2/https");
const markers = Object.freeze(["productKind", "variantSchemaVersion", "productId", "variantId",
  "attributes", "attributeDefinitions", "priceCents", "costCents", "commercial", "commercialProfiles"]);
const money = markers.slice(6);
const blocked = () => { throw new HttpsError("failed-precondition", "Produto incompatível com novo efeito offline."); };

function assertOfflineItems(raw, normalized) {
  const seen = new Set();
  for (let i = 0; i < normalized.length; i++) {
    if (Object.hasOwn(raw[i], "variantId")) {
      throw new HttpsError("invalid-argument", "Item offline não pode conter variantId.");
    }
    const id = normalized[i].productId;
    if (seen.has(id)) throw new HttpsError("invalid-argument", "productId duplicado na venda offline.");
    seen.add(id);
  }
}

function assertOfflineProduct({scope, productId, product, commercial}) {
  // Exact presence/value projection: never JSON stringify SDK/null/undefined/NaN
  // into a different marker. C5 rejects unsupported values; we fail closed.
  const current = product.data();
  const data = Object.fromEntries(markers.filter(k => Object.hasOwn(current, k)).map(k => [k, current[k]]));
  const time = t => ({seconds: String(t.seconds), nanoseconds: t.nanoseconds});
  let structural;
  try {
    structural = evaluateProductEligibility({protocol: "inspection", operation: "read", scope,
      identity: {productId, variantId: null},
      entity: {exists: product.exists, data, updateTime: time(product.updateTime)},
      commercial: commercial.exists ? {exists: true, data: commercial.data(), updateTime: time(commercial.updateTime)} : {exists: false}});
  } catch (error) {
    if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
    blocked();
  }
  // Inspection does not authorize offline effects. Independent offline predicates
  // restrict its classification and authorities; archive and stock remain real.
  if (structural.status !== "compatible" || !["legacySimple", "simple"].includes(structural.kind) ||
      commercial.exists || money.some(k => Object.hasOwn(data, k))) blocked();
}

module.exports = {assertOfflineItems, assertOfflineProduct};
