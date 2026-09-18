"use strict";

// Contrato puro F7.9-B1. Sem SDK, I/O, relogio ou mutacao de entradas.
const CATALOG_REQUEST_STATUSES = Object.freeze([
  "pending", "in_progress", "completed", "cancelled",
]);
const CATALOG_REQUEST_ACTIONS = Object.freeze(["start", "complete", "cancel"]);

// Categorias locais; a futura camada callable traduz code/reason para sua API.
class CatalogRequestContractError extends Error {
  constructor(code, reason) {
    super(reason);
    this.name = "CatalogRequestContractError";
    this.code = code;
    this.reason = reason;
  }
}

function fail(reason, code = "validation") {
  throw new CatalogRequestContractError(code, reason);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requirePlainObject(value, reason = "invalid-payload") {
  if (!value || typeof value !== "object" ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    fail(reason);
  }
  // Payloads JSON nao possuem accessors; nao executar getters de entrada.
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!hasOwn(descriptor, "value")) fail(reason);
  }
}

function validateCatalogRequestStatus(value) {
  if (!CATALOG_REQUEST_STATUSES.includes(value)) fail("invalid-status");
  return value;
}

function validateCatalogRequestAction(value) {
  if (!CATALOG_REQUEST_ACTIONS.includes(value)) fail("invalid-action");
  return value;
}

function normalizeCatalogRequestRole(value) {
  const role = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (role === "caixa" || role === "vendedor") return "operador";
  if (["admin", "gerente", "operador"].includes(role)) return role;
  fail("invalid-role");
}

function normalizeCatalogRequestCustomerName(value) {
  if (typeof value !== "string") fail("invalid-customer-name");
  const name = value.trim();
  if (!name || name.length > 120) fail("invalid-customer-name");
  return name;
}

function normalizeCatalogRequestCustomerPhone(value) {
  if (typeof value !== "string") fail("invalid-customer-phone");
  const phone = value.trim().replace(/[^0-9]/g, "");
  if (phone.length === 10 || phone.length === 11) return "55" + phone;
  if ((phone.length === 12 || phone.length === 13) && phone.startsWith("55")) {
    return phone;
  }
  fail("invalid-customer-phone");
}

// Sem argumento = propriedade ausente. undefined explicito nao e ausencia.
function normalizeCatalogRequestNote(value) {
  if (arguments.length === 0) return null;
  if (typeof value !== "string") fail("invalid-note");
  const note = value.trim();
  if (note.length > 500) fail("invalid-note");
  return note || null;
}

function classifyCatalogRequestVersion(payload) {
  requirePlainObject(payload);
  if (!hasOwn(payload, "requestVersion")) return 1;
  if (typeof payload.requestVersion !== "number" ||
      !Number.isInteger(payload.requestVersion) || payload.requestVersion !== 2) {
    fail("unsupported-request-version");
  }
  return 2;
}

function requireKeys(value, required, optional, extraReason) {
  const allowed = [...required, ...optional];
  if (Reflect.ownKeys(value).some((key) => !allowed.includes(key))) {
    fail(extraReason);
  }
  if (required.some((key) => !hasOwn(value, key))) fail("invalid-payload");
}

// Valida formato/chaves e dados novos. Slug/token, limite/quantidade e
// elegibilidade dos produtos continuam a cargo da integracao operacional.
function validateCatalogRequestPublicPayload(payload) {
  const version = classifyCatalogRequestVersion(payload);
  const customerFields = ["customerName", "customerPhone", "note"];
  if (version === 1 && customerFields.some((key) => hasOwn(payload, key))) {
    fail("customer-fields-require-version");
  }
  const required = ["publicSlug", "publicToken", "items"];
  if (version === 2) {
    required.push("requestVersion", "customerName", "customerPhone");
  }
  requireKeys(payload, required, version === 2 ? ["note"] : [],
      "unexpected-fields");
  if (!Array.isArray(payload.items)) fail("invalid-payload");
  for (const item of payload.items) {
    requirePlainObject(item);
    requireKeys(item, ["productId", "quantity"], [], "unexpected-item-fields");
  }
  if (version === 1) return {version: 1};
  return {
    version: 2,
    customerName: normalizeCatalogRequestCustomerName(payload.customerName),
    customerPhone: normalizeCatalogRequestCustomerPhone(payload.customerPhone),
    note: hasOwn(payload, "note") ?
      normalizeCatalogRequestNote(payload.note) : normalizeCatalogRequestNote(),
  };
}

function resolveCatalogRequestActorName(profile) {
  if (!profile || typeof profile !== "object") return null;
  for (const field of ["name", "username", "fullName"]) {
    const value = profile[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function isTrimmedString(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

// Nao autentica nem consulta perfil. O chamador valida auth/perfil/store e
// lifecycle persistido separadamente. UIDs sao identidades exatas, sem coercao.
function decideCatalogRequestTransition(input = {}) {
  const status = validateCatalogRequestStatus(input?.status);
  const action = validateCatalogRequestAction(input?.action);
  const role = normalizeCatalogRequestRole(input?.role);
  const uid = input.authUid;
  if (!isTrimmedString(uid)) fail("invalid-auth-uid");

  const sameActor =
    (action === "start" && status === "in_progress" &&
      input.attendedByUid === uid) ||
    (action === "complete" && status === "completed" &&
      input.completedByUid === uid) ||
    (action === "cancel" && status === "cancelled" &&
      input.cancelledByUid === uid);
  if (sameActor) return {allowed: true, changed: false, status};
  if (status === "completed" || status === "cancelled") {
    fail("catalog-request-terminal", "precondition");
  }
  if (status === "pending" && action === "complete") {
    fail("catalog-request-not-in-progress", "precondition");
  }
  if (status === "in_progress" && action === "start") {
    fail("catalog-request-already-attended", "conflict");
  }
  if (status === "in_progress" && role === "operador" &&
      input.attendedByUid !== uid) {
    fail("catalog-request-not-assignee", "permission");
  }
  const nextStatus = {
    start: "in_progress", complete: "completed", cancel: "cancelled",
  }[action];
  return {allowed: true, changed: true, status: nextStatus};
}

// Sem predicate, valida SOMENTE presenca de At (nao-null/undefined).
// NAO reconhece Timestamp: a integracao deve fornecer um predicate puro
// que valide o tipo real. Nao chama toDate/toMillis e nao converte para ISO.
// Todos ausentes/null = grupo ausente. Grupo completo exige as tres chaves;
// ByName deve estar presente, podendo ser null. Undefined explicito e invalido.
function validateCatalogRequestLifecycle(saved, isTimestamp) {
  requirePlainObject(saved, "invalid-lifecycle");
  const status = validateCatalogRequestStatus(saved.status);
  if (isTimestamp !== undefined && typeof isTimestamp !== "function") {
    fail("invalid-timestamp-validator");
  }
  const groups = {};
  for (const group of ["attended", "completed", "cancelled"]) {
    const keys = [group + "ByUid", group + "ByName", group + "At"];
    const absent = keys.every((key) => !hasOwn(saved, key) || saved[key] === null);
    if (absent) {
      groups[group] = false;
      continue;
    }
    const [uid, name, at] = keys.map((key) => saved[key]);
    if (!keys.every((key) => hasOwn(saved, key)) || !isTrimmedString(uid) ||
        (name !== null && !isTrimmedString(name)) || at == null ||
        (isTimestamp !== undefined && isTimestamp(at) !== true)) {
      fail("invalid-lifecycle");
    }
    groups[group] = true;
  }
  const {attended, completed, cancelled} = groups;
  const valid = {
    pending: !attended && !completed && !cancelled,
    in_progress: attended && !completed && !cancelled,
    completed: attended && completed && !cancelled,
    cancelled: cancelled && !completed,
  }[status];
  if (!valid) fail("invalid-lifecycle");
  return true;
}

function ownOrNull(saved, key) {
  return hasOwn(saved, key) ? saved[key] ?? null : null;
}

// Projecoes de campos adicionais, nao validadores completos de documento.
// O chamador valida o schema antes de usa-las. Nao incluem campos base/items.
function projectCatalogRequestListFields(saved) {
  requirePlainObject(saved, "invalid-document");
  return {
    customerName: ownOrNull(saved, "customerName"),
    customerPhone: ownOrNull(saved, "customerPhone"),
    attendedByName: ownOrNull(saved, "attendedByName"),
  };
}

// At e copiado como valor opaco: somente a integracao serializa Timestamp.
function projectCatalogRequestDetailFields(saved) {
  requirePlainObject(saved, "invalid-document");
  const fields = {
    requestVersion: classifyCatalogRequestVersion(saved) === 1 ? null : 2,
    customerName: ownOrNull(saved, "customerName"),
    customerPhone: ownOrNull(saved, "customerPhone"),
    note: ownOrNull(saved, "note"),
  };
  for (const group of ["attended", "completed", "cancelled"]) {
    for (const suffix of ["ByUid", "ByName", "At"]) {
      const key = group + suffix;
      fields[key] = ownOrNull(saved, key);
    }
  }
  return fields;
}

module.exports = Object.freeze({
  CATALOG_REQUEST_STATUSES,
  CATALOG_REQUEST_ACTIONS,
  CatalogRequestContractError,
  validateCatalogRequestStatus,
  validateCatalogRequestAction,
  normalizeCatalogRequestRole,
  normalizeCatalogRequestCustomerName,
  normalizeCatalogRequestCustomerPhone,
  normalizeCatalogRequestNote,
  classifyCatalogRequestVersion,
  validateCatalogRequestPublicPayload,
  resolveCatalogRequestActorName,
  decideCatalogRequestTransition,
  validateCatalogRequestLifecycle,
  projectCatalogRequestListFields,
  projectCatalogRequestDetailFields,
});
