"use strict";

// F10-B: read-only, dependency-free DTOs. No persistence or commercial resolver.
const own = (value, key) => Object.hasOwn(value, key);
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError("Expected a plain DTO object.");
  }
  return value;
}
function keys(value, allowed, required = allowed) {
  object(value);
  if (Object.keys(value).some((k) => !allowed.includes(k)) ||
      required.some((k) => !own(value, k))) throw new TypeError("Invalid DTO fields.");
}
function id(value) {
  if (typeof value !== "string" || !value || value.trim() !== value ||
      value.includes("/") || value === "." || value === ".." || /^__.*__$/.test(value) ||
      Buffer.byteLength(value, "utf8") > 1500 || /[\u0000-\u001f\ud800-\udfff]/u.test(value)) {
    throw new TypeError("Invalid stable ID.");
  }
  return value;
}
function label(value) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Invalid label.");
  return value;
}
function integer(value) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError("Expected a nonnegative safe integer.");
  }
  return value;
}
// Copy before freezing: never freeze or mutate caller-owned input. DTO boundary
// accepts JSON-like data, not SDK Timestamp/Reference objects or undefined.
function snapshot(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || ancestors.has(value)) throw new TypeError("Invalid snapshot value.");
  if (!Array.isArray(value)) object(value);
  ancestors.add(value);
  const result = Array.isArray(value) ? Array.from(value, (v) => snapshot(v, ancestors)) :
    Object.fromEntries(Object.keys(value).map((k) => [k, snapshot(value[k], ancestors)]));
  ancestors.delete(value);
  return Object.freeze(result);
}
function field(data, key) {
  object(data);
  if (!own(data, key)) return Object.freeze({state: "omitted"});
  if (data[key] === null) return Object.freeze({state: "null", value: null});
  return Object.freeze({state: "value", value: snapshot(data[key])});
}
class AttributeValueDto {
  constructor(data) {
    keys(data, ["valueId", "label"]);
    this.valueId = id(data.valueId);
    this.label = label(data.label);
    Object.freeze(this);
  }
}
class AttributeDefinitionDto {
  constructor(data) {
    keys(data, ["attributeId", "label", "values"]);
    this.attributeId = id(data.attributeId);
    this.label = label(data.label);
    if (!Array.isArray(data.values)) throw new TypeError("Expected attribute values.");
    const seen = new Set();
    this.values = Object.freeze(data.values.map((raw) => {
      const value = new AttributeValueDto(raw);
      if (seen.has(value.valueId)) throw new TypeError("Duplicate value ID.");
      seen.add(value.valueId);
      return value;
    }));
    Object.freeze(this);
  }
}
function definitions(raw) {
  if (!Array.isArray(raw)) throw new TypeError("Expected attribute definitions.");
  const seen = new Set();
  return Object.freeze(raw.map((data) => {
    const definition = new AttributeDefinitionDto(data);
    if (seen.has(definition.attributeId)) throw new TypeError("Duplicate attribute ID.");
    seen.add(definition.attributeId);
    return definition;
  }));
}
function canonicalCombination(raw, definitionDtos) {
  if (!Array.isArray(raw) || !Array.isArray(definitionDtos) ||
      definitionDtos.some((d) => !(d instanceof AttributeDefinitionDto))) {
    throw new TypeError("Expected attributes and validated definitions.");
  }
  const byId = new Map(definitionDtos.map((d) => [d.attributeId, d]));
  if (byId.size !== definitionDtos.length) throw new TypeError("Duplicate attribute definition.");
  const seen = new Set();
  const pairs = raw.map((pair) => {
    keys(pair, ["attributeId", "valueId"]);
    const attributeId = id(pair.attributeId);
    const valueId = id(pair.valueId);
    const definition = byId.get(attributeId);
    if (seen.has(attributeId)) throw new TypeError("Duplicate selected attribute.");
    if (!definition || !definition.values.some((v) => v.valueId === valueId)) {
      throw new TypeError("Unknown attribute or value.");
    }
    seen.add(attributeId);
    return Object.freeze({attributeId, valueId});
  }).sort((a, b) => a.attributeId < b.attributeId ? -1 : a.attributeId > b.attributeId ? 1 : 0);
  // Structural signature only. Completeness/allowed combinations remain C05.
  return Object.freeze({pairs: Object.freeze(pairs),
    key: JSON.stringify(pairs.map((p) => [p.attributeId, p.valueId]))});
}
function uniqueCombinations(combinations) {
  const seen = new Set();
  for (const combination of combinations) {
    if (!combination || typeof combination.key !== "string" || seen.has(combination.key)) {
      throw new TypeError("Duplicate or invalid combination.");
    }
    seen.add(combination.key);
  }
}
class ItemIdentityDto {
  constructor(data) {
    keys(data, ["productId", "variantId"]);
    this.productId = id(data.productId);
    this.variantId = data.variantId === null ? null : id(data.variantId);
    this.key = JSON.stringify([this.productId, this.variantId]);
    Object.freeze(this);
  }
}
// In-memory interpretation matches F9 reservationOwner, including its legacy
// ID semantics. This does not normalize COD, create reservations or rewrite raw.
class CodeOwnerDto {
  constructor(raw) {
    object(raw);
    const legacy = !own(raw, "ownerType");
    const ownerType = legacy ? "product" : raw.ownerType;
    const variantId = legacy && raw.variantId === undefined ? null : raw.variantId;
    const valid = (v) => typeof v === "string" && v.trim() === v && v.length > 0 &&
      !v.includes("/") && v !== "." && v !== "..";
    if (!valid(raw.productId) || (ownerType === "product" ? variantId !== null :
      ownerType !== "variant" || !valid(variantId))) throw new TypeError("Invalid COD owner.");
    this.ownerType = ownerType;
    this.productId = raw.productId;
    this.variantId = variantId;
    Object.freeze(this);
  }
}
class LotDto {
  constructor(raw) {
    object(raw);
    integer(raw.quantidade);
    // Pure timestamp DTO; an SDK adapter must supply exact seconds/nanoseconds.
    keys(raw.validade, ["seconds", "nanoseconds"]);
    if (typeof raw.validade.seconds !== "string" || !/^(0|-[1-9]\d*|[1-9]\d*)$/.test(raw.validade.seconds) ||
        BigInt(raw.validade.seconds) < -62135596800n || BigInt(raw.validade.seconds) > 253402300799n ||
        !Number.isInteger(raw.validade.nanoseconds) || raw.validade.nanoseconds < 0 ||
        raw.validade.nanoseconds > 999999999 || Object.is(raw.validade.nanoseconds, -0)) {
      throw new TypeError("Invalid exact timestamp DTO.");
    }
    this.data = snapshot(raw); // Preserve optional lot IDs and metadata; invent none.
    Object.freeze(this);
  }
}
class StockDto {
  constructor(raw) {
    keys(raw, ["quantidade", "lotes"], ["quantidade"]);
    this.quantidade = integer(raw.quantidade);
    this.lotsField = field(raw, "lotes");
    if (own(raw, "lotes")) {
      if (!Array.isArray(raw.lotes)) throw new TypeError("Invalid lot list; null is not manual stock.");
      this.lots = Object.freeze(raw.lotes.map((lot) => new LotDto(lot)));
      const sum = this.lots.reduce((n, lot) => integer(n + lot.data.quantidade), 0);
      if (this.lots.length && sum !== this.quantidade) throw new TypeError("Inconsistent stock.");
    }
    Object.freeze(this);
  }
}
const optionalFields = ["name", "cod", "barcode", "price", "costPrice", "imageUrl", "fiscal",
  "minimumStock", "quantidade", "lotes", "isArchived", "categoryIds", "categoryId", "categoryName"];
function stockOf(data) {
  const raw = {quantidade: data.quantidade};
  if (own(data, "lotes")) raw.lotes = data.lotes;
  return new StockDto(raw);
}
class SimpleProductDto {
  constructor(productId, raw) {
    object(raw);
    const legacy = !own(raw, "productKind") && !own(raw, "variantSchemaVersion");
    if (!legacy) {
      keys(raw, ["productKind", "variantSchemaVersion", ...optionalFields], ["productKind", "variantSchemaVersion"]);
      if (raw.productKind !== "simple" || raw.variantSchemaVersion !== 1) throw new TypeError("Invalid simple discriminator.");
    }
    this.productId = id(productId);
    this.productKind = "simple";
    this.isLegacy = legacy;
    this.isSellable = true; // Structural kind, not an authorization/stock decision.
    this.data = snapshot(raw); // Legacy unknown fields preserved, never defaulted.
    Object.freeze(this);
  }
  field(key) { return field(this.data, key); }
  stock() { return stockOf(this.data); }
}
class VariantParentDto {
  constructor(productId, raw) {
    keys(raw, ["productKind", "variantSchemaVersion", "attributeDefinitions", ...optionalFields],
      ["productKind", "variantSchemaVersion", "attributeDefinitions"]);
    if (raw.productKind !== "variantParent" || raw.variantSchemaVersion !== 1) throw new TypeError("Invalid parent discriminator.");
    this.productId = id(productId);
    this.productKind = "variantParent";
    this.isSellable = false;
    this.attributeDefinitions = definitions(raw.attributeDefinitions);
    this.data = snapshot(raw); // Legacy price/stock on a parent confer no sellability.
    Object.freeze(this);
  }
  field(key) { return field(this.data, key); }
}
class VariantDto {
  constructor(variantId, raw, parent) {
    keys(raw, ["variantSchemaVersion", "productId", "attributes", ...optionalFields],
      ["variantSchemaVersion", "productId", "attributes"]);
    if (!(parent instanceof VariantParentDto) || raw.variantSchemaVersion !== 1 || raw.productId !== parent.productId) {
      throw new TypeError("Invalid variant version or parent.");
    }
    this.variantId = id(variantId); // Caller supplies stable ID, never generated here.
    this.productId = id(raw.productId);
    this.identity = new ItemIdentityDto({productId: this.productId, variantId: this.variantId});
    this.combination = canonicalCombination(raw.attributes, parent.attributeDefinitions);
    this.isSellable = true; // Kind only; archive/price/stock policy deliberately unresolved.
    this.data = snapshot(raw);
    Object.freeze(this);
  }
  field(key) { return field(this.data, key); }
  stock() { return stockOf(this.data); }
}
function productDto(productId, raw) {
  object(raw);
  return raw.productKind === "variantParent" ? new VariantParentDto(productId, raw) : new SimpleProductDto(productId, raw);
}
// No write serializer, mutation API, commercial inheritance or V3 sale hash.
module.exports = {field, AttributeValueDto, AttributeDefinitionDto, definitions,
  canonicalCombination, uniqueCombinations, ItemIdentityDto, CodeOwnerDto,
  LotDto, StockDto, SimpleProductDto, VariantParentDto, VariantDto, productDto};
