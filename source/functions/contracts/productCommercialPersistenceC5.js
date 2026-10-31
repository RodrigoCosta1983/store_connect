"use strict";

// Read-only proposal. Inputs are exact snapshot DTOs, never Firebase SDK objects.
const {ItemIdentityDto, field} = require("./productVariantsV1");
const {ProductCommercialDto, VariantCommercialDto} = require("./productCommercialC5");
const own = (v, k) => Object.hasOwn(v, k);
function object(v) {
  if (!v || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw new TypeError("Expected plain object.");
}
function keys(v, allowed, required = allowed) {
  object(v);
  if (Reflect.ownKeys(v).some(k => typeof k !== "string" || !allowed.includes(k)) ||
      required.some(k => !own(v, k))) throw new TypeError("Invalid snapshot envelope.");
}
function copy(v, ancestors = new Set()) {
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "object" || ancestors.has(v)) throw new TypeError("Unsupported snapshot value.");
  if (!Array.isArray(v)) object(v);
  const names = Reflect.ownKeys(v).filter(k => !(Array.isArray(v) && k === "length"));
  if (names.some(k => typeof k !== "string" || !Object.getOwnPropertyDescriptor(v, k).enumerable ||
      !own(Object.getOwnPropertyDescriptor(v, k), "value"))) throw new TypeError("Expected JSON data properties.");
  if (Array.isArray(v) && (names.length !== v.length || names.some((k, i) => k !== String(i)))) {
    throw new TypeError("Expected dense array.");
  }
  ancestors.add(v);
  const result = Array.isArray(v) ? v.map(x => copy(x, ancestors)) :
    Object.fromEntries(names.map(k => [k, copy(v[k], ancestors)]));
  ancestors.delete(v);
  return Object.freeze(result);
}
function exactTime(v) {
  keys(v, ["seconds", "nanoseconds"]);
  if (typeof v.seconds !== "string" || !/^(0|-[1-9]\d*|[1-9]\d*)$/.test(v.seconds) ||
      BigInt(v.seconds) < -62135596800n || BigInt(v.seconds) > 253402300799n ||
      !Number.isInteger(v.nanoseconds) || v.nanoseconds < 0 || v.nanoseconds > 999999999 ||
      Object.is(v.nanoseconds, -0)) throw new TypeError("Invalid exact timestamp.");
  return copy(v); // Not Date/ISO, milliseconds, or a replacement F9 baseline validator.
}
function snapshot(v) {
  keys(v, v?.exists === false ? ["exists"] : ["exists", "data", "updateTime"]);
  if (v.exists === false) return Object.freeze({exists: false});
  if (v.exists !== true) throw new TypeError("Invalid snapshot existence.");
  object(v.data);
  return Object.freeze({exists: true, data: copy(v.data), updateTime: exactTime(v.updateTime)});
}
function contextOf(raw) {
  keys(raw, ["projectId", "storeId", "productId", "variantId", "kind"]);
  const result = copy(raw);
  for (const k of ["projectId", "storeId"]) new ItemIdentityDto({productId: result[k], variantId: null});
  new ItemIdentityDto(resultIdentity(result));
  if (!["simple", "variantParent", "variant"].includes(result.kind) ||
      (result.kind === "variant") !== (result.variantId !== null)) throw new TypeError("Invalid entity kind.");
  return result;
}
function resultIdentity(c) { return {productId: c.productId, variantId: c.variantId}; }
const legacyFields = ["price", "costPrice", "imageUrl", "fiscal", "barcode", "minimumStock"];
function entityKindMatches(data, context) {
  if (context.kind === "variant") return data.variantSchemaVersion === 1 && data.productId === context.productId && !own(data, "productKind");
  const legacy = !own(data, "productKind") && !own(data, "variantSchemaVersion");
  return legacy ? context.kind === "simple" : data.variantSchemaVersion === 1 && data.productKind === context.kind;
}
function projectCommercialRead(rawContext, rawEntity, rawCommercial) {
  const context = contextOf(rawContext), entity = snapshot(rawEntity), commercial = snapshot(rawCommercial);
  const base = {context, snapshots: Object.freeze({entity, commercial})};
  const outcome = (status, reason) => Object.freeze({...base, status, reason});
  if (!entity.exists) return outcome("unavailable", "entity-absent");
  if (!entityKindMatches(entity.data, context)) return outcome("blocked", "entity-identity-mismatch");
  const legacy = Object.freeze(Object.fromEntries(legacyFields.map(k => [k, field(entity.data, k)])));
  if (!commercial.exists) return Object.freeze({...base, status: "legacyObservation", legacy});
  const data = commercial.data;
  if (data.schemaVersion !== 1) return outcome("blocked", "unsupported-commercial-version");
  try {
    keys(data, ["schemaVersion", "identity", "configuration"]);
    const identity = contextOf(data.identity);
    if (Object.keys(context).some(k => context[k] !== identity[k])) return outcome("blocked", "commercial-identity-mismatch");
    // Reject a second monetary source, including equal values and null. No dual-read precedence.
    if (own(entity.data, "price") || own(entity.data, "costPrice")) return outcome("blocked", "mixed-monetary-representations");
    const configuration = context.kind === "variant" ? new VariantCommercialDto(data.configuration) :
      new ProductCommercialDto(data.configuration);
    return Object.freeze({...base, status: "commercialV1", configuration, legacy});
  } catch (error) {
    if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
    return outcome("blocked", "invalid-commercial-document");
  }
}
module.exports = {projectCommercialRead};
