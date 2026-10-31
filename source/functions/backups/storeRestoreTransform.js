"use strict";

const {createHash} = require("node:crypto");
const {COLLECTION_NAMES, SETTING_NAMES, SNAPSHOT_VERSION,
  TIMESTAMP_MIN_SECONDS, TIMESTAMP_MAX_SECONDS} = require("./storeSnapshotContract");

class StoreRestoreValidationError extends Error {
  constructor(code) { super(code); this.name = "StoreRestoreValidationError"; this.code = code; }
}
function fail(code) { throw new StoreRestoreValidationError(code); }
function map(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [null, Object.prototype].includes(Object.getPrototypeOf(value));
}
function validId(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("/") &&
    !value.includes("\0") && value !== "." && value !== "..";
}
function exact(value, keys, code) {
  if (!map(value) || Object.keys(value).length !== keys.length ||
      !keys.every((key) => Object.hasOwn(value, key))) fail(code);
}
// Canonical JSON keeps business arrays ordered and sorts maps by UTF-16 keys.
// Reject non-JSON inputs, accessors, cycles and reserved keys without exposing values.
function canonicalStringify(value, code = "INVALID_PLANNER_INPUT") {
  const ancestors = new Set();
  function encode(item) {
    if (item === null || typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if ((!map(item) && !Array.isArray(item)) || ancestors.has(item)) fail(code);
    ancestors.add(item);
    const keys = Object.keys(item);
    if (Object.getOwnPropertySymbols(item).length || keys.some((key) =>
      ["__proto__", "constructor", "prototype"].includes(key) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(item, key), "value"))) fail(code);
    let result;
    if (Array.isArray(item)) {
      if (keys.length !== item.length || keys.some((key, i) => key !== String(i))) fail(code);
      result = "[" + item.map(encode).join(",") + "]";
    } else {
      if (Object.hasOwn(item, "__storeConnectType")) validateMarker(item, code);
      result = "{" + keys.sort().map((key) => JSON.stringify(key) + ":" + encode(item[key])).join(",") + "}";
    }
    ancestors.delete(item);
    return result;
  }
  try { return encode(value); } catch (error) {
    if (error instanceof StoreRestoreValidationError) throw error;
    fail(code);
  }
}
function validateMarker(value, code) {
  const shapes = {timestamp: ["seconds", "nanoseconds"], geoPoint: ["latitude", "longitude"],
    bytes: ["base64"], documentReference: ["path"]};
  const type = value.__storeConnectType;
  if (!Object.hasOwn(shapes, type)) fail(code);
  exact(value, ["__storeConnectType", ...shapes[type]], code);
  if (type === "documentReference" && (typeof value.path !== "string" ||
      value.path.split("/").length % 2 || !value.path.split("/").every(validId))) fail(code);
  if (type === "timestamp" && (!Number.isSafeInteger(value.seconds) ||
      value.seconds < TIMESTAMP_MIN_SECONDS || value.seconds > TIMESTAMP_MAX_SECONDS ||
      !Number.isInteger(value.nanoseconds) || value.nanoseconds < 0 || value.nanoseconds > 999999999)) fail(code);
  if (type === "geoPoint" && (!Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 ||
      !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180)) fail(code);
  if (type === "bytes" && (typeof value.base64 !== "string" || value.base64.length % 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64) ||
      Buffer.from(value.base64, "base64").toString("base64") !== value.base64)) fail(code);
}
function hash(value) { return createHash("sha256").update(canonicalStringify(value)).digest("hex"); }
function normalizePolicy(policy = {version: 1}) {
  exact(policy, ["version"], "INVALID_TRANSFORM_POLICY");
  if (policy.version !== 1) fail("INVALID_TRANSFORM_POLICY");
  return {version: 1};
}
function validateState(state, snapshot = false) {
  const code = snapshot ? "INVALID_SNAPSHOT_CONTRACT" : "INVALID_TARGET_STATE";
  canonicalStringify(state, code);
  exact(state, snapshot ? ["snapshotVersion", "metadata", "storeSettings", "collections"] :
    ["storeSettings", "collections"], code);
  if (snapshot && (state.snapshotVersion !== SNAPSHOT_VERSION || !map(state.metadata) ||
      !validId(state.metadata.storeId))) fail(code);
  if (!map(state.storeSettings) || Object.keys(state.storeSettings).some((key) => !SETTING_NAMES.includes(key)) ||
      (snapshot && !SETTING_NAMES.every((key) => Object.hasOwn(state.storeSettings, key)))) fail(code);
  for (const key of SETTING_NAMES) {
    if (!Object.hasOwn(state.storeSettings, key)) continue;
    const value = state.storeSettings[key];
    if (key === "pixQrCodeUpdatedAt" || value === null) continue;
    if (typeof value !== (key === "lowStockThreshold" ? "number" : "string")) fail(code);
  }
  exact(state.collections, COLLECTION_NAMES, snapshot ? code : "INVALID_TARGET_COLLECTION");
  for (const name of COLLECTION_NAMES) {
    if (!Array.isArray(state.collections[name])) fail(snapshot ? code : "INVALID_TARGET_COLLECTION");
    const ids = new Set();
    for (const doc of state.collections[name]) {
      exact(doc, ["id", "data"], code);
      if (!validId(doc.id) || !map(doc.data) || Object.hasOwn(doc.data, "__storeConnectType")) fail(code);
      if (ids.has(doc.id)) fail(snapshot ? code : "DUPLICATE_TARGET_ID");
      ids.add(doc.id);
    }
  }
}
function canonicalState(state) {
  return {storeSettings: JSON.parse(canonicalStringify(state.storeSettings)), collections:
    Object.fromEntries(COLLECTION_NAMES.map((name) => [name, state.collections[name].map((doc) =>
      JSON.parse(canonicalStringify(doc))).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)]))};
}

/** Receives R1A result.snapshot, never the gzip or the whole parser result.
 * Policy v1 is closed: no dependency exemptions or operational authorization.
 */
function transformStoreSnapshot(input) {
  if (!map(input) || Object.keys(input).some((key) =>
    !["snapshot", "sourceStoreId", "targetStoreId", "policy"].includes(key))) fail("INVALID_PLANNER_INPUT");
  const {snapshot, sourceStoreId, targetStoreId, policy} = input;
  if (!validId(sourceStoreId) || !validId(targetStoreId)) fail("INVALID_STORE_ID");
  const normalizedPolicy = normalizePolicy(policy);
  validateState(snapshot, true);
  if (snapshot.metadata.storeId !== sourceStoreId) fail("INVALID_SNAPSHOT_CONTRACT");
  const crossStore = sourceStoreId !== targetStoreId;
  const desiredState = canonicalState(snapshot);
  const warnings = [{code: "V1_NORMALIZED_NULL"}];
  const blockers = [];
  const namespaces = ["products", "customers", "categories", "sales", "cash_flow"];
  function issue(list, code, context, path) { list.push({code, ...context, path}); }
  function visit(value, context, path, fiscalHistory = false) {
    if (value === null || typeof value !== "object") return;
    if (value.__storeConnectType === "documentReference") {
      if (!crossStore) return;
      const parts = value.path.split("/");
      if (parts[0] === "stores" && parts[1] === sourceStoreId) {
        if (parts.length === 2) issue(blockers, "SOURCE_STORE_ROOT_REFERENCE", context, path);
        else if (!namespaces.includes(parts[2])) issue(blockers, "UNSUPPORTED_SOURCE_NAMESPACE", context, path);
        else if (!fiscalHistory) {
          parts[1] = targetStoreId; value.path = parts.join("/");
          issue(warnings, "CROSS_STORE_REFERENCE_REMAPPED", context, path);
        }
      } else issue(blockers, "EXTERNAL_DOCUMENT_REFERENCE", context, path);
      return;
    }
    for (const key of Object.keys(value).sort()) {
      const childPath = path + "/" + key.replace(/~/g, "~0").replace(/\//g, "~1");
      if (crossStore && ["createdBy", "updatedBy", "archivedBy", "syncedBy"].includes(key)) {
        issue(warnings, "UID_HISTORY_PRESENT", context, childPath);
      }
      visit(value[key], context, childPath, fiscalHistory ||
        (context.collection === "sales" && path === "/data" && key === "fiscal"));
    }
  }
  function dependency(value, code, context, path) {
    if (crossStore && typeof value === "string" && value.length > 0) issue(blockers, code, context, path);
  }
  dependency(desiredState.storeSettings.logoUrl, "SOURCE_SCOPED_MEDIA_REFERENCE", {}, "/storeSettings/logoUrl");
  for (const key of ["pixQrCodePath", "pixQrCodeUrl"]) {
    dependency(desiredState.storeSettings[key], "PIX_REFERENCE_REQUIRES_POLICY", {}, "/storeSettings/" + key);
  }
  visit(desiredState.storeSettings, {}, "/storeSettings");
  for (const name of COLLECTION_NAMES) for (const doc of desiredState.collections[name]) {
    const context = {collection: name, documentId: doc.id};
    if (crossStore && name === "sales") {
      if (Object.hasOwn(doc.data, "storeId")) {
        if (typeof doc.data.storeId !== "string" || ![sourceStoreId, targetStoreId].includes(doc.data.storeId)) {
          issue(blockers, "SALES_STORE_ID_CONFLICT", context, "/data/storeId");
        } else if (doc.data.storeId === sourceStoreId) {
          doc.data.storeId = targetStoreId;
          issue(warnings, "SALES_STORE_ID_REMAPPED", context, "/data/storeId");
        } else issue(warnings, "SALES_STORE_ID_ALREADY_TARGET", context, "/data/storeId");
      }
      if (Object.hasOwn(doc.data, "fiscal")) issue(blockers, "FISCAL_HISTORY_REQUIRES_POLICY", context, "/data/fiscal");
    }
    if (["products", "categories"].includes(name)) {
      dependency(doc.data.imageUrl, "SOURCE_SCOPED_MEDIA_REFERENCE", context, "/data/imageUrl");
    }
    visit(doc.data, context, "/data");
  }
  const sortIssues = (items) => items.sort((a, b) => {
    const x = canonicalStringify(a); const y = canonicalStringify(b); return x < y ? -1 : x > y ? 1 : 0;
  });
  return {transformVersion: 1, crossStore, policy: normalizedPolicy, desiredState,
    warnings: sortIssues(warnings), blockers: sortIssues(blockers)};
}

module.exports = {transformStoreSnapshot, StoreRestoreValidationError, canonicalStringify,
  hash, validateState, canonicalState, validId, fail};
