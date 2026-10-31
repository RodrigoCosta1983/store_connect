"use strict";

// Domain checks only. No authorization, command normalization, I/O or commit proof.
const {ItemIdentityDto, field} = require("./productVariantsV1");
const {projectCommercialRead} = require("./productCommercialPersistenceC5");
const {resolveCommercial} = require("./productCommercialC5");
const {priceCents} = require("../sales/saleV2Contract");
const own = (v, k) => Object.hasOwn(v, k);
function keys(v, allowed, required = allowed) {
  if (!v || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
      Reflect.ownKeys(v).some(k => typeof k !== "string" || !allowed.includes(k) ||
        !own(Object.getOwnPropertyDescriptor(v, k), "value")) ||
      required.some(k => !own(v, k))) throw new TypeError("Invalid eligibility input.");
}
const operations = Object.freeze({
  legacyV1: Object.freeze(["read", "cadastral", "stock", "sale", "import", "fiado", "offline", "catalog", "fiscal"]),
  legacyV2: Object.freeze(["read", "cadastral", "stock", "sale"]),
  inspection: Object.freeze(["read"]),
  f10C3: Object.freeze(["stock"]),
  futureV3: Object.freeze(["read", "sale", "cadastral", "import", "fiado", "offline", "catalog", "fiscal"]),
});
function kindOf(data, identity) {
  if (identity.variantId !== null) {
    return !own(data, "productKind") && !own(data, "variantId") && !own(data, "attributeDefinitions") &&
      data.variantSchemaVersion === 1 && data.productId === identity.productId ? "variant" : null;
  }
  if (!own(data, "productKind") && !own(data, "variantSchemaVersion")) {
    // Presence, even null/empty, makes a simple classification ambiguous.
    return ["productId", "attributes", "variantId", "attributeDefinitions"].some(k => own(data, k)) ? null : "legacySimple";
  }
  if (data.variantSchemaVersion !== 1 || !["simple", "variantParent"].includes(data.productKind) ||
      own(data, "variantId") || own(data, "productId")) return null;
  if (own(data, "attributes") || (data.productKind === "simple" && own(data, "attributeDefinitions"))) return null;
  return data.productKind;
}
function active(data, kind) {
  return own(data, "isArchived") ? data.isArchived === false : kind === "legacySimple";
}
function ambiguousMoney(data) {
  return ["priceCents", "costCents", "commercial", "commercialProfiles"].some(k => own(data, k));
}
function projection(scope, identity, kind, entity, commercial) {
  return projectCommercialRead({...scope, productId: identity.productId, variantId: identity.variantId,
    kind: kind === "legacySimple" ? "simple" : kind}, entity, commercial);
}
function evaluateProductEligibility(input) {
  keys(input, ["protocol", "operation", "scope", "identity", "entity", "commercial", "parent"],
      ["protocol", "operation", "scope", "identity", "entity", "commercial"]);
  keys(input.scope, ["projectId", "storeId"]);
  keys(input.identity, ["productId", "variantId"]);
  const identity = new ItemIdentityDto(input.identity);
  const scope = Object.freeze({...input.scope});
  const result = (status, reason, extra = {}) => Object.freeze({status, reason, scope, identity,
    protocol: input.protocol, operation: input.operation, check: "pure-domain-only", ...extra});
  if (typeof input.protocol !== "string" || typeof input.operation !== "string" ||
      !own(operations, input.protocol) || !operations[input.protocol].includes(input.operation)) {
    return result("blocked", "unsupported-protocol-operation");
  }
  // Use C5-B to validate/copy exact snapshot envelopes, even before type classification.
  const probeIdentity = new ItemIdentityDto({productId: identity.productId, variantId: null});
  const probe = projection(scope, probeIdentity, "simple", input.entity, input.commercial);
  const {entity, commercial} = probe.snapshots;
  if (!entity.exists) return result("blocked", "entity-absent");
  const data = entity.data, kind = kindOf(data, identity);
  if (!kind) return result("blocked", "invalid-kind-or-identity");
  const legacy = input.protocol === "legacyV1" || input.protocol === "legacyV2";
  if (legacy && identity.variantId !== null) return result("blocked", "variant-not-supported");
  if (legacy && kind === "variantParent") return result("blocked", "parent-not-supported");
  if (input.operation === "sale" && kind === "variantParent") return result("blocked", "parent-not-sellable");
  if (own(input, "parent") && !(kind === "variant" && ["futureV3", "f10C3", "inspection"].includes(input.protocol))) {
    return result("blocked", "unexpected-parent-context");
  }
  // Structural inspection is intentionally separate from every new-effect predicate.
  if (input.protocol === "inspection") return result("compatible", "structural-read-only", {kind});
  if (ambiguousMoney(data)) return result("blocked", "unsupported-top-level-money");
  if (legacy) {
    if (commercial.exists) return result("blocked", "commercial-profile-not-supported");
    if (input.operation === "offline") return result("blocked", "offline-history-context-required");
    if (input.operation === "fiscal") return result("blocked", "historical-fiscal-context-required");
    if (["read", "cadastral"].includes(input.operation)) return result("compatible", "legacy-domain-only", {kind});
    if (!active(data, kind)) return result("blocked", "entity-not-active");
    if (input.operation === "stock") return result("compatible", "legacy-stock-domain-only", {kind});
    if (!own(data, "price") || typeof data.price !== "number" || !Number.isFinite(data.price) ||
        data.price < 0 || Object.is(data.price, -0)) return result("blocked", "invalid-legacy-price");
    if (own(data, "costPrice") && data.costPrice !== null && (typeof data.costPrice !== "number" || !Number.isFinite(data.costPrice) ||
        data.costPrice < 0 || Object.is(data.costPrice, -0))) return result("blocked", "invalid-legacy-cost");
    if (input.protocol === "legacyV2") {
      try { priceCents(data.price); } catch (_) { return result("blocked", "incompatible-v2-price"); }
    }
    return result("compatible", "legacy-money-domain-only", {kind});
  }
  if (input.protocol === "futureV3" && ["cadastral", "import", "fiado", "offline", "catalog", "fiscal"].includes(input.operation)) {
    return result("blocked", "future-operation-contract-pending");
  }
  if (input.protocol === "futureV3" && kind !== "variant" && input.operation !== "read") {
    return result("blocked", "simple-v3-rollout-not-approved");
  }
  if (input.protocol === "f10C3" && kind !== "variant") return result("blocked", "c3-requires-variant");
  let parent;
  if (kind === "variant") {
    if (!own(input, "parent")) return result("blocked", "parent-context-required");
    keys(input.parent, ["scope", "identity", "entity", "commercial"]);
    keys(input.parent.scope, ["projectId", "storeId"]);
    keys(input.parent.identity, ["productId", "variantId"]);
    const parentIdentity = new ItemIdentityDto(input.parent.identity);
    if (parentIdentity.productId !== identity.productId || parentIdentity.variantId !== null ||
        Object.keys(scope).some(k => scope[k] !== input.parent.scope[k])) return result("blocked", "parent-identity-mismatch");
    parent = projection(scope, parentIdentity, "variantParent", input.parent.entity, input.parent.commercial);
    if (!parent.snapshots.entity.exists || kindOf(parent.snapshots.entity.data, parentIdentity) !== "variantParent") {
      return result("blocked", "invalid-parent");
    }
    if (!active(parent.snapshots.entity.data, "variantParent")) return result("blocked", "parent-not-active");
  }
  if (input.protocol === "f10C3") {
    if (!active(data, kind)) return result("blocked", "entity-not-active");
    return result("compatible", "c3-stock-domain-only", {kind}); // Price/profile never authorizes stock.
  }
  const current = projection(scope, identity, kind, entity, commercial);
  if (current.status !== "commercialV1") return result("blocked", "commercial-profile-unusable");
  if (parent && (parent.status !== "commercialV1" || ambiguousMoney(parent.snapshots.entity.data))) {
    return result("blocked", "parent-commercial-profile-unusable");
  }
  if (input.operation === "read") return result("compatible", "commercial-read-only", {kind});
  if (!active(data, kind)) return result("blocked", "entity-not-active");
  const resolved = resolveCommercial(parent.configuration, current.configuration).priceCents;
  if (resolved.state !== "value") return result("blocked", "effective-price-unresolved");
  if (resolved.value === 0) return result("blocked", "free-sale-policy-pending");
  if (parent.configuration.priceCents.state !== "value") return result("blocked", "base-price-policy-pending");
  return result("blocked", "v3-confirmation-contract-pending", {
    priceCandidate: Object.freeze({unitPriceCents: resolved.value, source: resolved.source}),
  }); // Positive crypto/DTO/domain checks cannot authorize a future sale.
}
function legacyItemIdentityBarrier(raw) {
  // Call before old normalization; an explicit variantId, including null, must not disappear.
  keys(raw, ["productId", "variantId"], ["productId"]);
  if (own(raw, "variantId")) throw new TypeError("Legacy item must not carry variantId.");
  return new ItemIdentityDto({productId: raw.productId, variantId: null});
}
function observeHistoricalItem(input) {
  keys(input, ["protocol", "item"]);
  if (!["legacyV1", "legacyV2"].includes(input.protocol)) throw new TypeError("Unsupported historical protocol.");
  // Copies all unknown historical fields, without changing units, IDs, price or quantities.
  const data = field({item: input.item}, "item").value;
  if (!data || typeof data !== "object" || Array.isArray(data) || own(data, "variantId")) {
    throw new TypeError("Incompatible historical item identity.");
  }
  const identity = legacyItemIdentityBarrier({productId: data.productId});
  return Object.freeze({status: "compatible", check: "historical-observation-only", identity, data});
}
module.exports = {evaluateProductEligibility, legacyItemIdentityBarrier, observeHistoricalItem};
