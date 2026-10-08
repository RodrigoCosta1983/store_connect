"use strict";

const {Timestamp, GeoPoint, DocumentReference} = require("firebase-admin/firestore");
const {canonicalStringify, validId, fail} = require("./storeRestoreTransform");

// Synchronous reconstruction only. The reference factory must return SDK refs;
// no reads, writes or initialization are performed here.
function decodeStoreSnapshotValue(value, options = {}) {
  canonicalStringify(value, "INVALID_DECODE_VALUE");
  const {targetStoreId, approvedReferencePaths = [], referenceFactory} = options;
  if (!Array.isArray(approvedReferencePaths) ||
      approvedReferencePaths.some((path) => typeof path !== "string")) fail("INVALID_REFERENCE_APPROVAL");
  const approved = new Set(approvedReferencePaths);
  function decode(item) {
    if (item === null || typeof item !== "object") return item;
    if (Array.isArray(item)) return item.map(decode);
    switch (item.__storeConnectType) {
      case "timestamp": return new Timestamp(item.seconds, item.nanoseconds);
      case "geoPoint": return new GeoPoint(item.latitude, item.longitude);
      case "bytes": return Buffer.from(item.base64, "base64");
      case "documentReference": {
        const parts = item.path.split("/");
        if (!validId(targetStoreId) || parts[0] !== "stores" || parts[1] !== targetStoreId ||
            !["products", "customers", "categories", "sales", "cash_flow"].includes(parts[2]) ||
            !approved.has(item.path) || typeof referenceFactory !== "function") fail("BLOCKED_REFERENCE");
        const ref = referenceFactory(item.path);
        if (!(ref instanceof DocumentReference) || ref.path !== item.path) fail("INVALID_REFERENCE_FACTORY");
        return ref;
      }
      default: return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, decode(child)]));
    }
  }
  return decode(value);
}

module.exports = {decodeStoreSnapshotValue};
