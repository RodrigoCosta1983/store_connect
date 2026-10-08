"use strict";

const {gunzipSync} = require("node:zlib");
const {createHash} = require("node:crypto");
const {TextDecoder} = require("node:util");
const {
  SNAPSHOT_VERSION, COLLECTION_NAMES, SETTING_NAMES, DEFAULT_LIMITS,
  TIMESTAMP_MIN_SECONDS, TIMESTAMP_MAX_SECONDS,
} = require("./storeSnapshotContract");

class StoreSnapshotValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = "StoreSnapshotValidationError";
    this.code = code;
  }
}
function fail(code) { throw new StoreSnapshotValidationError(code); }
function map(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value, keys, code) {
  if (!map(value) || Object.keys(value).length !== keys.length ||
      !keys.every((key) => Object.hasOwn(value, key))) fail(code);
}
function id(value) {
  return typeof value === "string" && value.length > 0 &&
    !value.includes("/") && !value.includes("\0") && value !== "." && value !== "..";
}

// Grammar-aware scan before JSON.parse. Keys are decoded, so unicode escapes
// cannot hide duplicates. Root container depth = 1; each map/array adds one.
// Explicit stack rejects excessive nesting before the native JSON parser.
function inspectJson(text, maxDepth) {
  let i = 0;
  function whitespace() { while (/[\x20\t\r\n]/.test(text[i] || "!")) i++; }
  function string() {
    const start = i++;
    while (i < text.length) {
      const ch = text[i++];
      if (ch === '"') {
        try { return JSON.parse(text.slice(start, i)); } catch (_) { fail("JSON_INVALID"); }
      }
      if (ch === "\\") i++;
    }
    fail("JSON_INVALID");
  }
  const frames = [{kind: "root", state: "value"}];
  function value() {
    whitespace();
    const ch = text[i];
    if (ch === "{" || ch === "[") {
      if (frames.length > maxDepth) fail("DEPTH_LIMIT");
      i++;
      frames.push({kind: ch, state: ch === "{" ? "keyOrEnd" : "valueOrEnd", keys: new Set()});
      return;
    }
    if (ch === '"') { string(); return; }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i));
    if (!token) fail("JSON_INVALID");
    i += token[0].length;
  }
  while (frames.length) {
    whitespace();
    const frame = frames[frames.length - 1];
    const end = frame.kind === "{" ? "}" : "]";
    if (frame.state === "done") { frames.pop(); continue; }
    if (frame.state === "keyOrEnd" || frame.state === "valueOrEnd") {
      if (text[i] === end) { i++; frames.pop(); continue; }
      frame.state = frame.kind === "{" ? "key" : "value";
    }
    if (frame.state === "key") {
      if (text[i] !== '"') fail("JSON_INVALID");
      const key = string();
      if (frame.keys.has(key)) fail("JSON_DUPLICATE_KEY");
      frame.keys.add(key);
      frame.state = "colon";
    } else if (frame.state === "colon") {
      if (text[i++] !== ":") fail("JSON_INVALID");
      frame.state = "value";
    } else if (frame.state === "value") {
      frame.state = frame.kind === "root" ? "done" : "commaOrEnd";
      value();
    } else if (frame.state === "commaOrEnd") {
      if (text[i] === end) { i++; frames.pop(); }
      else {
        if (text[i++] !== ",") fail("JSON_INVALID");
        frame.state = frame.kind === "{" ? "key" : "value";
      }
    }
  }
  whitespace();
  if (i !== text.length) fail("JSON_INVALID");
}

function safeValue(value, inventory) {
  const root = Object.create(null);
  const pending = [{value, parent: root, key: "value"}];
  while (pending.length) {
    const task = pending.pop();
    const result = task.value;
    if (typeof result === "number" && !Number.isFinite(result)) fail("INVALID_NUMBER");
    if (result === null || typeof result !== "object") {
      task.parent[task.key] = result;
      continue;
    }
    const copy = Array.isArray(result) ? [] : Object.create(null);
    task.parent[task.key] = copy;
    const keys = Object.keys(result);
    for (const key of keys) {
      if (["__proto__", "prototype", "constructor"].includes(key)) fail("DANGEROUS_KEY");
      // Reserve insertion order before stack traversal.
      copy[key] = null;
      pending.push({value: result[key], parent: copy, key});
    }
    if (Object.hasOwn(result, "__storeConnectType")) validateMarker(result, inventory);
  }
  return root.value;
}

function validateMarker(result, inventory) {
  const type = result.__storeConnectType;
  const shapes = {
    timestamp: ["__storeConnectType", "seconds", "nanoseconds"],
    geoPoint: ["__storeConnectType", "latitude", "longitude"],
    bytes: ["__storeConnectType", "base64"],
    documentReference: ["__storeConnectType", "path"],
  };
  if (typeof type !== "string" || !Object.hasOwn(shapes, type)) fail("UNKNOWN_TYPE_MARKER");
  exact(result, shapes[type], "INVALID_TYPE_MARKER");
  if (type === "timestamp" &&
      (!Number.isSafeInteger(result.seconds) || result.seconds < TIMESTAMP_MIN_SECONDS ||
       result.seconds > TIMESTAMP_MAX_SECONDS || !Number.isInteger(result.nanoseconds) ||
       result.nanoseconds < 0 || result.nanoseconds > 999999999)) fail("INVALID_TIMESTAMP");
  if (type === "geoPoint" &&
      (!Number.isFinite(result.latitude) || Math.abs(result.latitude) > 90 ||
       !Number.isFinite(result.longitude) || Math.abs(result.longitude) > 180)) fail("INVALID_GEOPOINT");
  if (type === "bytes" &&
      (typeof result.base64 !== "string" ||
       result.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.base64) ||
       Buffer.from(result.base64, "base64").toString("base64") !== result.base64)) fail("INVALID_BYTES");
  if (type === "documentReference") {
    const path = result.path;
    if (typeof path !== "string" || !path || path.includes("\0")) fail("INVALID_DOCUMENT_REFERENCE");
    const segments = path.split("/");
    if (segments.length % 2 !== 0 || segments.some((part) => !id(part))) fail("INVALID_DOCUMENT_REFERENCE");
    inventory.documentReferences.push(path);
  }
  inventory.typeCounts[type]++;
}

/** Pure synchronous API. expectedMetadata uses typed values (version is number).
 * Returns null-prototype snapshot maps, calculated technical metadata and inventory.
 * No Firebase SDK reconstruction or I/O. All thrown validation messages are codes.
 */
function parseStoreSnapshotV1(gzipBytes, options = {}) {
  if (!map(options) || Object.keys(options).some((key) => !["expectedMetadata", "limits"].includes(key))) fail("INVALID_INPUT");
  const {expectedMetadata = {}, limits = {}} = options;
  if (!(gzipBytes instanceof Uint8Array) || !map(expectedMetadata) || !map(limits)) fail("INVALID_INPUT");
  const policy = {...DEFAULT_LIMITS};
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(policy, key) ||
        (key === "MAX_EXPANSION_RATIO" ? !Number.isFinite(value) || value <= 0 : !Number.isSafeInteger(value) || value < 1)) fail("INVALID_INPUT");
    policy[key] = value;
  }
  const expectedKeys = ["checksumSha256", "compressedSizeBytes", "originalSizeBytes", "snapshotVersion", "storeId"];
  for (const [key, value] of Object.entries(expectedMetadata)) {
    if (!expectedKeys.includes(key)) fail("INVALID_INPUT");
    if (key === "checksumSha256" ? typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value) :
      key === "storeId" ? !id(value) : !Number.isSafeInteger(value) || value < 0) fail("INVALID_INPUT");
  }
  const compressedSizeBytes = gzipBytes.byteLength;
  if (compressedSizeBytes > policy.MAX_COMPRESSED_BYTES) fail("COMPRESSED_SIZE_LIMIT");
  if (!compressedSizeBytes) fail("GZIP_INVALID");
  const checksumSha256 = createHash("sha256").update(gzipBytes).digest("hex");
  function compare(key, actual, code) {
    if (Object.hasOwn(expectedMetadata, key) && expectedMetadata[key] !== actual) fail(code);
  }
  compare("checksumSha256", checksumSha256, "CHECKSUM_MISMATCH");
  compare("compressedSizeBytes", compressedSizeBytes, "COMPRESSED_SIZE_MISMATCH");
  let original;
  try {
    original = gunzipSync(gzipBytes, {maxOutputLength: policy.MAX_ORIGINAL_BYTES});
  } catch (error) {
    fail(error.code === "ERR_BUFFER_TOO_LARGE" ? "ORIGINAL_SIZE_LIMIT" : "GZIP_INVALID");
  }
  const originalSizeBytes = original.length;
  if (originalSizeBytes > policy.MAX_ORIGINAL_BYTES) fail("ORIGINAL_SIZE_LIMIT");
  if (originalSizeBytes / compressedSizeBytes > policy.MAX_EXPANSION_RATIO) fail("EXPANSION_RATIO_LIMIT");
  compare("originalSizeBytes", originalSizeBytes, "ORIGINAL_SIZE_MISMATCH");
  let text;
  try { text = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(original); }
  catch (_) { fail("UTF8_INVALID"); }
  inspectJson(text, policy.MAX_DEPTH);
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { fail("JSON_INVALID"); }
  const inventory = {documentReferences: [], typeCounts: {
    timestamp: 0, geoPoint: 0, bytes: 0, documentReference: 0,
  }, documentIds: Object.create(null), documentJsonBytes: Object.create(null), totalDocuments: 0};
  const snapshot = safeValue(parsed, inventory);
  exact(snapshot, ["snapshotVersion", "metadata", "storeSettings", "collections"], "INVALID_ROOT");
  if (snapshot.snapshotVersion !== SNAPSHOT_VERSION) fail("UNSUPPORTED_VERSION");
  const metadata = snapshot.metadata;
  exact(metadata, ["storeId", "createdAt", "createdBy", "createdByRole", "type", "reason", "counts"], "INVALID_METADATA");
  if (!id(metadata.storeId) || ![metadata.createdBy, metadata.createdByRole, metadata.type].every(
      (item) => typeof item === "string" && item.length > 0) ||
      !(metadata.reason === null || typeof metadata.reason === "string") ||
      !map(metadata.createdAt) || metadata.createdAt.__storeConnectType !== "timestamp") fail("INVALID_METADATA");
  exact(metadata.counts, COLLECTION_NAMES, "INVALID_METADATA");
  if (!COLLECTION_NAMES.every((name) => Number.isSafeInteger(metadata.counts[name]) && metadata.counts[name] >= 0)) fail("INVALID_METADATA");
  const settings = snapshot.storeSettings;
  exact(settings, SETTING_NAMES, "INVALID_SETTINGS");
  for (const key of ["name", "phone", "logoUrl", "pixQrCodePath", "pixQrCodeUrl"]) {
    if (settings[key] !== null && typeof settings[key] !== "string") fail("INVALID_SETTINGS");
  }
  if (settings.lowStockThreshold !== null && typeof settings.lowStockThreshold !== "number") fail("INVALID_SETTINGS");
  // pixQrCodeUpdatedAt is producer's value || null, recursively encoded; no invented timestamp restriction.
  exact(snapshot.collections, COLLECTION_NAMES, "INVALID_COLLECTIONS");
  for (const name of COLLECTION_NAMES) {
    const documents = snapshot.collections[name];
    if (!Array.isArray(documents)) fail("INVALID_COLLECTIONS");
    if (documents.length > policy.MAX_DOCUMENTS_PER_COLLECTION) fail("DOCUMENTS_PER_COLLECTION_LIMIT");
    inventory.totalDocuments += documents.length;
    if (inventory.totalDocuments > policy.MAX_DOCUMENTS_TOTAL) fail("DOCUMENTS_TOTAL_LIMIT");
    if (documents.length !== metadata.counts[name]) fail("COUNTS_MISMATCH");
    const ids = new Set();
    inventory.documentIds[name] = [];
    inventory.documentJsonBytes[name] = [];
    for (const document of documents) {
      exact(document, ["id", "data"], "INVALID_DOCUMENT");
      if (!id(document.id) || !map(document.data) || Object.hasOwn(document.data, "__storeConnectType")) fail("INVALID_DOCUMENT");
      if (ids.has(document.id)) fail("DUPLICATE_DOCUMENT_ID");
      ids.add(document.id);
      const bytes = Buffer.byteLength(JSON.stringify({id: document.id, data: document.data}), "utf8");
      if (bytes > policy.MAX_DOCUMENT_JSON_BYTES) fail("DOCUMENT_SIZE_LIMIT");
      inventory.documentIds[name].push(document.id);
      inventory.documentJsonBytes[name].push(bytes);
    }
  }
  compare("snapshotVersion", snapshot.snapshotVersion, "SNAPSHOT_VERSION_MISMATCH");
  compare("storeId", metadata.storeId, "STORE_ID_MISMATCH");
  return {snapshot, technicalMetadata: {
    checksumSha256, compressedSizeBytes, originalSizeBytes,
    snapshotVersion: snapshot.snapshotVersion, storeId: metadata.storeId,
    counts: metadata.counts,
  }, inventory};
}

module.exports = {parseStoreSnapshotV1, StoreSnapshotValidationError};
