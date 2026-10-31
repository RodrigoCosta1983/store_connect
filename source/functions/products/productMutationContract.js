"use strict";

const {validateCategoryIds} = require("./productCategoryContract");
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const FISCAL_FIELDS = [
  "ncm", "origem", "cfop", "unidade", "cest", "icmsSituacaoTributaria",
  "pisSituacaoTributaria", "cofinsSituacaoTributaria",
  "ibsCbsSituacaoTributaria", "ibsCbsClassificacaoTributaria",
];
const SET_FIELDS = ["name", "price", "minimumStock", "imageUrl", "cod", "barcode", "costPrice"];
const REMOVE_FIELDS = ["cod", "barcode", "costPrice"];

function object(value, label) {
  if (!value || typeof value !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(label + " deve ser um objeto simples.");
  }
  return value;
}
function keys(value, allowed, label, required = []) {
  object(value, label);
  if (Object.keys(value).some((key) => !allowed.includes(key)) ||
      required.some((key) => !has(value, key))) throw new TypeError(label + " possui campos inválidos.");
}
function id(value, label) {
  if (typeof value !== "string" || !value || value.trim() !== value ||
      value.includes("/") || value === "." || value === "..") throw new TypeError(label + " inválido.");
  return value;
}
function requestId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 128) {
    throw new TypeError("requestId inválido.");
  }
  return value;
}
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(label + " deve ser inteiro seguro >= 0.");
  return value;
}
function expectedTime(value) {
  keys(value, ["seconds", "nanoseconds"], "expectedUpdateTime", ["seconds", "nanoseconds"]);
  const seconds = Number(value.seconds);
  if (typeof value.seconds !== "string" || String(seconds) !== value.seconds ||
      !Number.isSafeInteger(seconds) || seconds < -62135596800 || seconds > 253402300799 ||
      !Number.isInteger(value.nanoseconds) || value.nanoseconds < 0 ||
      value.nanoseconds >= 1e9 || value.nanoseconds % 1000 !== 0) {
    throw new TypeError("expectedUpdateTime deve preservar a precisão do Firestore.");
  }
  return {seconds: value.seconds, nanoseconds: value.nanoseconds};
}
function envelope(data, version, body, additional = []) {
  const required = ["schemaVersion", "requestId", "productId", "expectedUpdateTime", body, ...additional];
  keys(data, [...required, "scope"], "Payload", required);
  if (data.schemaVersion !== version) throw new TypeError("schemaVersion inválido.");
  const result = {schemaVersion: version, requestId: requestId(data.requestId),
    productId: id(data.productId, "productId"), expectedUpdateTime: expectedTime(data.expectedUpdateTime)};
  if (has(data, "scope")) {
    keys(data.scope, ["projectId", "uid", "storeId"], "scope", ["projectId", "uid", "storeId"]);
    result.scope = Object.fromEntries(["projectId", "uid", "storeId"].map((key) => [key, id(data.scope[key], key)]));
  }
  return result;
}
function removal(value, allowed) {
  if (!Array.isArray(value) || value.some((key) => !allowed.includes(key)) ||
      new Set(value).size !== value.length) throw new TypeError("Lista remove inválida.");
  return value.slice().sort();
}
function fieldValue(key, value) {
  if (["price", "costPrice"].includes(key)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TypeError(key + " inválido.");
    return value;
  }
  if (key === "minimumStock") return integer(value, key);
  if (typeof value !== "string") throw new TypeError(key + " deve ser string.");
  if (key === "imageUrl") return value;
  const normalized = key === "cod" ? value.trim().toUpperCase() : value.trim();
  if (!normalized || (key === "cod" && normalized.length > 40)) throw new TypeError(key + " inválido.");
  return normalized;
}
function patch(value, allowedSet, allowedRemove, fiscal = false) {
  keys(value, ["set", "remove"], "Patch");
  const set = {};
  if (has(value, "set")) {
    keys(value.set, allowedSet, "set");
    for (const key of Object.keys(value.set)) {
      const field = value.set[key];
      if (fiscal) {
        if (field !== null && typeof field !== "string") throw new TypeError("Campo fiscal deve ser string ou null.");
        set[key] = field;
      } else set[key] = fieldValue(key, field);
    }
  }
  const remove = has(value, "remove") ? removal(value.remove, allowedRemove) : [];
  if (remove.some((key) => has(set, key))) throw new TypeError("Campo presente em set e remove.");
  return {set, remove};
}
function validateUpdateProductV2(data) {
  const result = envelope(data, 2, "changes");
  keys(data.changes, ["set", "remove", "fiscal", "categories"], "changes");
  const changes = patch(Object.fromEntries(Object.entries(data.changes)
    .filter(([key]) => ["set", "remove"].includes(key))), SET_FIELDS, REMOVE_FIELDS);
  if (has(data.changes, "fiscal")) {
    changes.fiscal = patch(data.changes.fiscal, FISCAL_FIELDS, FISCAL_FIELDS, true);
  }
  if (has(data.changes, "categories")) {
    keys(data.changes.categories, ["ids"], "categories", ["ids"]);
    const ids = validateCategoryIds(data.changes.categories.ids);
    ids.forEach((value) => id(value, "categoryId"));
    changes.categories = {ids};
  }
  if (!Object.keys(changes.set).length && !changes.remove.length &&
      !changes.categories && (!changes.fiscal ||
        (!Object.keys(changes.fiscal.set).length && !changes.fiscal.remove.length))) {
    throw new TypeError("changes deve conter alteração explícita.");
  }
  return {...result, changes};
}
function validity(value) {
  if (!Number.isSafeInteger(value) || value < -62135596800000 || value > 253402300799999) {
    throw new TypeError("validadeMs inválida.");
  }
  return value;
}
function lot(value) {
  keys(value, ["quantidade", "validadeMs"], "Lote", ["quantidade", "validadeMs"]);
  const quantidade = integer(value.quantidade, "quantidade");
  if (!quantidade) throw new TypeError("Lote novo deve possuir saldo positivo.");
  return {quantidade, validadeMs: validity(value.validadeMs)};
}
function validateAdjustProductStock(data) {
  const result = envelope(data, 1, "stockChange", ["reason"]);
  if (typeof data.reason !== "string" || !data.reason.trim()) throw new TypeError("reason obrigatório.");
  object(data.stockChange, "stockChange");
  const change = data.stockChange;
  let stockChange;
  switch (change.kind) {
    case "setManualQuantity":
      keys(change, ["kind", "quantity"], "stockChange", ["quantity"]);
      stockChange = {kind: change.kind, quantity: integer(change.quantity, "quantity")};
      break;
    case "convertToManual":
      keys(change, ["kind", "quantity", "acknowledgement"], "stockChange", ["quantity", "acknowledgement"]);
      if (change.acknowledgement !== true) throw new TypeError("Conversão exige confirmação explícita.");
      stockChange = {kind: change.kind, quantity: integer(change.quantity, "quantity"), acknowledgement: true};
      break;
    case "convertToLots":
      keys(change, ["kind", "lots"], "stockChange", ["lots"]);
      if (!Array.isArray(change.lots) || !change.lots.length) throw new TypeError("lots obrigatório.");
      stockChange = {kind: change.kind, lots: change.lots.map(lot)};
      break;
    case "editLots": {
      keys(change, ["kind", "operations"], "stockChange", ["operations"]);
      if (!Array.isArray(change.operations) || !change.operations.length) throw new TypeError("operations obrigatório.");
      const seen = new Set();
      const operations = change.operations.map((operation) => {
        object(operation, "Operação de lote");
        if (operation.op === "add") {
          keys(operation, ["op", "quantidade", "validadeMs"], "add", ["quantidade", "validadeMs"]);
          return {op: "add", ...lot({quantidade: operation.quantidade, validadeMs: operation.validadeMs})};
        }
        const index = integer(operation.index, "index");
        if (seen.has(index)) throw new TypeError("Índice duplicado.");
        seen.add(index);
        if (operation.op === "remove") {
          keys(operation, ["op", "index"], "remove", ["index"]);
          return {op: "remove", index};
        }
        if (operation.op !== "update") throw new TypeError("Operação desconhecida.");
        keys(operation, ["op", "index", "set"], "update", ["index", "set"]);
        keys(operation.set, ["quantidade", "validadeMs"], "set do lote");
        if (!Object.keys(operation.set).length) throw new TypeError("Patch de lote vazio.");
        const set = {};
        if (has(operation.set, "quantidade")) set.quantidade = integer(operation.set.quantidade, "quantidade");
        if (has(operation.set, "validadeMs")) set.validadeMs = validity(operation.set.validadeMs);
        return {op: "update", index, set};
      });
      stockChange = {kind: change.kind, operations};
      break;
    }
    default: throw new TypeError("stockChange.kind inválido.");
  }
  return {...result, reason: data.reason.trim(), stockChange};
}

module.exports = {validateUpdateProductV2, validateAdjustProductStock,
  expectedTime, keys, id, requestId, has, FISCAL_FIELDS, SET_FIELDS};
