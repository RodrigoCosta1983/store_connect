"use strict";

// Restore guardrails, not limits imposed on the backup producer.
const SNAPSHOT_VERSION = 1;
const COLLECTION_NAMES = Object.freeze([
  "products", "customers", "categories", "sales", "cashFlow",
]);
const SETTING_NAMES = Object.freeze([
  "name", "phone", "logoUrl", "lowStockThreshold", "pixQrCodePath",
  "pixQrCodeUrl", "pixQrCodeUpdatedAt",
]);
const DEFAULT_LIMITS = Object.freeze({
  MAX_COMPRESSED_BYTES: 32 * 1024 * 1024,
  MAX_ORIGINAL_BYTES: 128 * 1024 * 1024,
  MAX_EXPANSION_RATIO: 50,
  MAX_DOCUMENTS_TOTAL: 100000,
  MAX_DOCUMENTS_PER_COLLECTION: 100000,
  MAX_DOCUMENT_JSON_BYTES: 1024 * 1024,
  MAX_DEPTH: 20,
});
const TIMESTAMP_MIN_SECONDS = -62135596800;
const TIMESTAMP_MAX_SECONDS = 253402300799;

module.exports = {
  SNAPSHOT_VERSION, COLLECTION_NAMES, SETTING_NAMES, DEFAULT_LIMITS,
  TIMESTAMP_MIN_SECONDS, TIMESTAMP_MAX_SECONDS,
};
