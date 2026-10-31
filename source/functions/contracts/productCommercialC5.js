"use strict";

// Pure proposed configuration, NOT a Firestore schema or a write command.
const {field, SimpleProductDto, ItemIdentityDto} = require("./productVariantsV1");
const has = (v, k) => Object.hasOwn(v, k);
const FISCAL_FIELDS = Object.freeze([
  "ncm", "origem", "cfop", "unidade", "cest", "icmsSituacaoTributaria",
  "pisSituacaoTributaria", "cofinsSituacaoTributaria",
  "ibsCbsSituacaoTributaria", "ibsCbsClassificacaoTributaria",
]);
function keys(v, allowed, required = []) {
  if (!v || typeof v !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
      Reflect.ownKeys(v).some(k => typeof k !== "string" || !allowed.includes(k)) ||
      required.some(k => !has(v, k))) throw new TypeError("Invalid commercial DTO fields.");
}
function integer(v) {
  if (!Number.isSafeInteger(v) || v < 0 || Object.is(v, -0)) throw new TypeError("Expected safe nonnegative integer.");
  return v;
}
function text(v) {
  if (typeof v !== "string" || !v.trim()) throw new TypeError("Expected nonempty text.");
  return v; // No normalization, barcode digit loss, URL fetching or upload.
}
function fiscal(v) {
  keys(v, FISCAL_FIELDS);
  const result = {};
  for (const k of Object.keys(v)) {
    if (v[k] !== null && typeof v[k] !== "string") throw new TypeError("Fiscal value must be string or null.");
    result[k] = v[k];
  }
  return Object.freeze(result); // Structural only: no tax validity assertion.
}
const validators = {priceCents: integer, costCents: integer, imageUrl: text,
  fiscal, barcode: text, minimumStock: integer};
function optional(raw, key, validate) {
  if (!has(raw, key)) return Object.freeze({state: "omitted"});
  if (raw[key] === null) return Object.freeze({state: "null", value: null});
  return Object.freeze({state: "value", value: validate(raw[key])});
}
class ProductCommercialDto {
  constructor(raw) {
    keys(raw, Object.keys(validators));
    for (const [k, validate] of Object.entries(validators)) this[k] = optional(raw, k, validate);
    Object.freeze(this);
  }
}
function policy(v, validate, {removable = false, exception = false} = {}) {
  keys(v, ["mode", "value", "reason"], ["mode"]);
  if (v.mode === "inherit" || (removable && v.mode === "remove")) {
    keys(v, ["mode"], ["mode"]);
    return Object.freeze({mode: v.mode});
  }
  if (v.mode !== "override") throw new TypeError("Invalid inheritance mode.");
  keys(v, exception ? ["mode", "value", "reason"] : ["mode", "value"],
      exception ? ["mode", "value", "reason"] : ["mode", "value"]);
  const result = {mode: "override", value: validate(v.value)};
  if (exception) result.reason = text(v.reason); // Declared rationale, never proof of authorization/audit.
  return Object.freeze(result);
}
class VariantCommercialDto {
  constructor(raw) {
    keys(raw, Object.keys(validators));
    for (const k of ["priceCents", "costCents", "imageUrl", "fiscal"]) {
      this[k] = optional(raw, k, v => policy(v, validators[k], {
        removable: k === "imageUrl", exception: k === "costCents" || k === "fiscal",
      }));
    }
    this.barcode = optional(raw, "barcode", text); // Never inherited, never COD.
    this.minimumStock = optional(raw, "minimumStock", integer); // Individual configuration only.
    Object.freeze(this);
  }
}
function resolved(parentField, variantField) {
  if (variantField.state === "null") return Object.freeze({source: "unresolved", state: "null", value: null});
  if (variantField.state === "omitted" || variantField.value.mode === "inherit") {
    return Object.freeze({source: "parent", ...parentField});
  }
  const p = variantField.value;
  if (p.mode === "remove") return Object.freeze({source: "variant", state: "removed"});
  return Object.freeze({source: "variant", state: "value", value: p.value,
    ...(has(p, "reason") ? {reason: p.reason} : {})});
}
function resolveCommercial(parent, variant) {
  if (!(parent instanceof ProductCommercialDto) || !(variant instanceof VariantCommercialDto)) {
    throw new TypeError("Expected validated commercial DTOs.");
  }
  const result = {};
  for (const k of ["priceCents", "costCents", "imageUrl", "fiscal"]) result[k] = resolved(parent[k], variant[k]);
  for (const k of ["barcode", "minimumStock"]) result[k] = Object.freeze({source: "variant", ...variant[k]});
  return Object.freeze(result); // No sellability, price quote, stock decision or commit proof.
}
// Explicit strict conversion only. No rounding of legacy values with extra decimals.
function legacyMoneyToCents(v) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || Object.is(v, -0)) {
    throw new TypeError("Invalid legacy money.");
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(v));
  if (!match) throw new TypeError("Legacy money requires an explicit precision decision.");
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError("Unsafe legacy cents.");
  return Number(cents);
}
function observeLegacyCommercial(dto) {
  if (!(dto instanceof SimpleProductDto)) throw new TypeError("Expected F10-B simple product.");
  return Object.freeze(Object.fromEntries(["price", "costPrice", "imageUrl", "fiscal", "barcode", "minimumStock"]
      .map(k => [k, field(dto.data, k)]))); // Preserve omitted/null/value, including opaque legacy fiscal.
}
// Pure result over a supplied candidate set. Caller must establish completeness,
// store scope, archive policy and authorization before any operational selection.
function barcodeMatches(barcode, candidates) {
  text(barcode);
  if (!Array.isArray(candidates)) throw new TypeError("Expected candidates.");
  const seen = new Set(), matches = [];
  for (const candidate of candidates) {
    keys(candidate, ["identity", "barcode"], ["identity"]);
    if (!(candidate.identity instanceof ItemIdentityDto) || seen.has(candidate.identity.key)) {
      throw new TypeError("Invalid or duplicate candidate identity.");
    }
    seen.add(candidate.identity.key);
    const observed = optional(candidate, "barcode", text);
    if (observed.state === "value" && observed.value === barcode) matches.push(candidate.identity);
  }
  const status = matches.length === 0 ? "notFound" : matches.length === 1 ? "uniqueInCandidates" : "ambiguous";
  return Object.freeze({status, matches: Object.freeze(matches)}); // No automatic selected item.
}
module.exports = {FISCAL_FIELDS, ProductCommercialDto, VariantCommercialDto,
  resolveCommercial, legacyMoneyToCents, observeLegacyCommercial, barcodeMatches};
