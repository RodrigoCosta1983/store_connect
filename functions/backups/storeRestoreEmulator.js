"use strict";

const {Firestore, Timestamp, GeoPoint, DocumentReference} = require("firebase-admin/firestore");
const {COLLECTION_NAMES, SETTING_NAMES} = require("./storeSnapshotContract");
const {canonicalStringify, hash, validateState, canonicalState, validId, fail} = require("./storeRestoreTransform");
const {decodeStoreSnapshotValue} = require("./storeSnapshotDecoder");

const PROJECT_ID = "demo-store-connect-restore";
const HOSTS = ["127.0.0.1:8080", "localhost:8080", "[::1]:8080"];
const ACTIONS = ["create", "overwrite", "delete", "unchanged", "preserve"];
const namespace = (name) => name === "cashFlow" ? "cash_flow" : name;
function guard(projectId) {
  if (!HOSTS.includes(process.env.FIRESTORE_EMULATOR_HOST)) fail("INVALID_EMULATOR_HOST");
  if (projectId !== PROJECT_ID) fail("INVALID_EMULATOR_PROJECT");
}
function exact(value, keys) {
  if (!value || Array.isArray(value) || Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) {
    fail("INVALID_RESTORE_PLAN");
  }
}
function encode(value) {
  if (value instanceof Timestamp) return {__storeConnectType: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds};
  if (value instanceof GeoPoint) return {__storeConnectType: "geoPoint", latitude: value.latitude, longitude: value.longitude};
  if (value instanceof DocumentReference) return {__storeConnectType: "documentReference", path: value.path};
  if (Buffer.isBuffer(value)) return {__storeConnectType: "bytes", base64: value.toString("base64")};
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  return value;
}
function validatePlan(plan, desiredState, targetStoreId) {
  canonicalStringify(plan, "INVALID_RESTORE_PLAN");
  exact(plan, ["planVersion", "transformVersion", "mode", "sourceStoreId", "targetStoreId", "crossStore",
    "snapshotVersion", "policy", "collections", "settings", "plannedCounts", "warnings", "blockers",
    "baselineHash", "desiredStateHash", "desiredState", "planHash"]);
  const {planHash, ...body} = plan;
  if (hash(body) !== planHash || hash(desiredState) !== plan.desiredStateHash ||
      canonicalStringify(desiredState) !== canonicalStringify(plan.desiredState) ||
      plan.planVersion !== 1 || plan.transformVersion !== 1 || plan.snapshotVersion !== 1 ||
      !["MERGE_A1", "REPLACE"].includes(plan.mode) || !validId(plan.sourceStoreId) ||
      !validId(targetStoreId) || targetStoreId !== plan.targetStoreId ||
      targetStoreId === plan.sourceStoreId || plan.crossStore !== true ||
      canonicalStringify(plan.policy) !== '{"version":1}' ||
      !Array.isArray(plan.blockers) || plan.blockers.length || !Array.isArray(plan.warnings) ||
      !/^[a-f0-9]{64}$/.test(plan.baselineHash)) fail("INVALID_RESTORE_PLAN");
  validateState(desiredState);
  exact(desiredState.storeSettings, SETTING_NAMES);
  exact(plan.collections, COLLECTION_NAMES);
  exact(plan.plannedCounts, ["collections", "totals", "settings"]);
  exact(plan.plannedCounts.collections, COLLECTION_NAMES);
  exact(plan.plannedCounts.totals, ACTIONS);
  const totals = Object.fromEntries(ACTIONS.map((a) => [a, 0]));
  for (const name of COLLECTION_NAMES) {
    exact(plan.collections[name], ACTIONS);
    exact(plan.plannedCounts.collections[name], ACTIONS);
    const seen = new Set(); const desiredIds = new Set(desiredState.collections[name].map((d) => d.id));
    for (const action of ACTIONS) {
      const ids = plan.collections[name][action];
      if (!Array.isArray(ids) || ids.some((id) => !validId(id) || seen.has(id) ||
          (seen.add(id), desiredIds.has(id) !== ["create", "overwrite", "unchanged"].includes(action))) ||
          ids.length !== plan.plannedCounts.collections[name][action]) fail("INVALID_RESTORE_PLAN");
      totals[action] += ids.length;
    }
    if ([...desiredIds].some((id) => !seen.has(id)) ||
        plan.collections[name][plan.mode === "REPLACE" ? "preserve" : "delete"].length) fail("INVALID_RESTORE_PLAN");
  }
  if (canonicalStringify(totals) !== canonicalStringify(plan.plannedCounts.totals)) fail("INVALID_RESTORE_PLAN");
  exact(plan.settings, ["set", "unchanged", "v1NormalizedNulls", "strategy"]);
  const settings = [...plan.settings.set, ...plan.settings.unchanged];
  if (!Array.isArray(plan.settings.set) || !Array.isArray(plan.settings.unchanged) ||
      new Set(settings).size !== SETTING_NAMES.length || settings.length !== SETTING_NAMES.length ||
      settings.some((k) => !SETTING_NAMES.includes(k)) || plan.settings.v1NormalizedNulls !== true ||
      plan.settings.strategy !== "ROOT_FIELD_UPDATES" ||
      canonicalStringify(plan.plannedCounts.settings) !== canonicalStringify({set: plan.settings.set.length,
        unchanged: plan.settings.unchanged.length})) fail("INVALID_RESTORE_PLAN");
  const approved = [];
  function visit(value, context, path) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value) && value.some(Array.isArray)) fail("UNSUPPORTED_NESTED_ARRAY");
    // Firestore stores microseconds. Never silently truncate an SDK timestamp.
    if (value.__storeConnectType === "timestamp" && value.nanoseconds % 1000 !== 0) fail("TIMESTAMP_PRECISION_LOSS");
    if (value.__storeConnectType === "documentReference") {
      if (!plan.warnings.some((w) => w.code === "CROSS_STORE_REFERENCE_REMAPPED" &&
          w.collection === context.collection && w.documentId === context.documentId && w.path === path)) fail("BLOCKED_REFERENCE");
      approved.push(value.path); return;
    }
    for (const [key, child] of Object.entries(value)) visit(child, context,
      path + "/" + key.replace(/~/g, "~0").replace(/\//g, "~1"));
  }
  for (const key of ["logoUrl", "pixQrCodePath", "pixQrCodeUrl"]) {
    if (typeof desiredState.storeSettings[key] === "string" && desiredState.storeSettings[key]) fail("BLOCKED_DEPENDENCY");
  }
  visit(desiredState.storeSettings, {}, "/storeSettings");
  for (const name of COLLECTION_NAMES) for (const doc of desiredState.collections[name]) {
    if ((name === "sales" && (Object.hasOwn(doc.data, "fiscal") ||
        (Object.hasOwn(doc.data, "storeId") && doc.data.storeId !== targetStoreId))) ||
        (["products", "categories"].includes(name) && typeof doc.data.imageUrl === "string" && doc.data.imageUrl)) fail("BLOCKED_DEPENDENCY");
    visit(doc.data, {collection: name, documentId: doc.id}, "/data");
  }
  return approved;
}

async function restoreStoreToEmulator({plan, desiredState, targetStoreId, projectId}) {
  guard(projectId);
  // Freeze caller data before any asynchronous work.
  plan = JSON.parse(canonicalStringify(plan));
  desiredState = JSON.parse(canonicalStringify(desiredState));
  const approvedReferencePaths = validatePlan(plan, desiredState, targetStoreId);
  // Explicit transport settings prevent a preconfigured production client bypass.
  const db = new Firestore({projectId, host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false});
  try {
    const decoded = decodeStoreSnapshotValue(desiredState, {targetStoreId, approvedReferencePaths,
      referenceFactory: (path) => db.doc(path)});
    const root = db.doc("stores/" + targetStoreId);
    const rootSnapshot = await root.get();
    const baseline = {storeSettings: {}, collections: {}};
    const rootData = rootSnapshot.data() || {};
    for (const key of SETTING_NAMES) if (Object.hasOwn(rootData, key)) baseline.storeSettings[key] = encode(rootData[key]);
    for (const name of COLLECTION_NAMES) {
      const docs = await root.collection(namespace(name)).get();
      baseline.collections[name] = docs.docs.map((d) => ({id: d.id, data: encode(d.data())}));
    }
    if (hash(canonicalState(baseline)) !== plan.baselineHash) fail("STALE_RESTORE_BASELINE");
    // Check every action against the approved baseline without invoking the planner.
    for (const name of COLLECTION_NAMES) {
      const before = new Map(baseline.collections[name].map((d) => [d.id, d.data]));
      const desired = new Map(desiredState.collections[name].map((d) => [d.id, d.data]));
      for (const action of ACTIONS) for (const id of plan.collections[name][action]) {
        if ((action === "create" && before.has(id)) || (action !== "create" && !before.has(id)) ||
            (action === "unchanged" && hash(before.get(id)) !== hash(desired.get(id))) ||
            (action === "overwrite" && hash(before.get(id)) === hash(desired.get(id)))) fail("INVALID_RESTORE_PLAN");
      }
      const ids = new Set(ACTIONS.flatMap((a) => plan.collections[name][a]));
      if ([...before.keys()].some((id) => !ids.has(id))) fail("INVALID_RESTORE_PLAN");
    }
    for (const key of plan.settings.unchanged) if (!Object.hasOwn(baseline.storeSettings, key) ||
        hash(baseline.storeSettings[key]) !== hash(desiredState.storeSettings[key])) fail("INVALID_RESTORE_PLAN");
    for (const key of plan.settings.set) if (Object.hasOwn(baseline.storeSettings, key) &&
        hash(baseline.storeSettings[key]) === hash(desiredState.storeSettings[key])) fail("INVALID_RESTORE_PLAN");
    const writes = [];
    const sizes = [];
    if (plan.settings.set.length) writes.push((batch) => batch.set(root,
      Object.fromEntries(plan.settings.set.map((k) => [k, decoded.storeSettings[k]])), {mergeFields: plan.settings.set}));
    if (plan.settings.set.length) sizes.push(Buffer.byteLength(canonicalStringify(desiredState.storeSettings)) * 2 + 1024);
    for (const name of COLLECTION_NAMES) {
      const docs = new Map(decoded.collections[name].map((d) => [d.id, d.data]));
      const encodedDocs = new Map(desiredState.collections[name].map((d) => [d.id, d.data]));
      for (const action of ["create", "overwrite", "delete"]) for (const id of plan.collections[name][action]) {
        const ref = root.collection(namespace(name)).doc(id);
        sizes.push(action === "delete" ? 1024 : Buffer.byteLength(canonicalStringify(encodedDocs.get(id))) * 2 + 1024);
        writes.push((batch) => action === "delete" ? batch.delete(ref) :
          action === "create" ? batch.create(ref, docs.get(id)) : batch.set(ref, docs.get(id)));
      }
    }
    const prepared = [];
    // Prepare every operation after validating the complete materializable state.
    // Batches are atomic individually; a multi-batch restore is not atomic globally.
    let batch = db.batch(); let count = 0; let bytes = 0;
    for (let i = 0; i < writes.length; i++) {
      if (sizes[i] > 8 * 1024 * 1024) fail("RESTORE_WRITE_TOO_LARGE");
      if (count === 400 || bytes + sizes[i] > 8 * 1024 * 1024) {
        prepared.push(batch); batch = db.batch(); count = 0; bytes = 0;
      }
      writes[i](batch); count++; bytes += sizes[i];
    }
    if (count) prepared.push(batch);
    for (const batch of prepared) { guard(projectId); await batch.commit(); }
    return {writes: writes.length, batches: prepared.length};
  } finally { await db.terminate(); }
}

module.exports = {restoreStoreToEmulator};
