"use strict";

const {Firestore, Timestamp, GeoPoint, DocumentReference} = require("firebase-admin/firestore");
const {COLLECTION_NAMES, SETTING_NAMES} = require("./storeSnapshotContract");
const {canonicalStringify, canonicalState, validateState, hash, validId, fail,
  StoreRestoreValidationError} = require("./storeRestoreTransform");

const ACTIONS = ["create", "overwrite", "delete", "unchanged", "preserve"];
const HOSTS = ["127.0.0.1:8080", "localhost:8080", "[::1]:8080"];
const namespace = (name) => name === "cashFlow" ? "cash_flow" : name;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const clone = (value) => JSON.parse(canonicalStringify(value));

function guard(projectId) {
  if (!HOSTS.includes(process.env.FIRESTORE_EMULATOR_HOST)) fail("INVALID_EMULATOR_HOST");
  if (projectId !== "demo-store-connect-restore") fail("INVALID_EMULATOR_PROJECT");
}

// The authenticated pre-restore targetState supplies preserve payloads which
// R1B intentionally does not copy into desiredState. No merge rule is inferred.
function validateExpectedFromPlan(plan, baselineState) {
  canonicalStringify(plan, "INVALID_RESTORE_PLAN");
  const keys = ["planVersion", "transformVersion", "mode", "sourceStoreId", "targetStoreId", "crossStore",
    "snapshotVersion", "policy", "collections", "settings", "plannedCounts", "warnings", "blockers",
    "baselineHash", "desiredStateHash", "desiredState", "planHash"];
  if (!plan || Object.keys(plan).sort().join() !== keys.sort().join() || !Array.isArray(plan.warnings)) fail("INVALID_RESTORE_PLAN");
  validateState(baselineState);
  const {planHash, ...body} = plan;
  if (hash(body) !== planHash || plan.planVersion !== 1 || plan.transformVersion !== 1 ||
      plan.snapshotVersion !== 1 || !["MERGE_A1", "REPLACE"].includes(plan.mode) ||
      !validId(plan.sourceStoreId) || !validId(plan.targetStoreId) ||
      plan.sourceStoreId === plan.targetStoreId || plan.crossStore !== true ||
      canonicalStringify(plan.policy) !== '{"version":1}' ||
      !Array.isArray(plan.blockers) || plan.blockers.length ||
      hash(canonicalState(baselineState)) !== plan.baselineHash ||
      hash(plan.desiredState) !== plan.desiredStateHash) fail("INVALID_RESTORE_PLAN");
  validateState(plan.desiredState);
  const expected = canonicalState(baselineState);
  const totals = Object.fromEntries(ACTIONS.map((a) => [a, 0]));
  if (Object.keys(plan.collections).sort().join() !== [...COLLECTION_NAMES].sort().join() ||
      !plan.settings || plan.settings.strategy !== "ROOT_FIELD_UPDATES" ||
      plan.settings.v1NormalizedNulls !== true) fail("INVALID_RESTORE_PLAN");
  const settings = [...plan.settings.set, ...plan.settings.unchanged];
  if (settings.length !== SETTING_NAMES.length || new Set(settings).size !== settings.length ||
      settings.some((key) => !SETTING_NAMES.includes(key)) ||
      Object.keys(plan.desiredState.storeSettings).length !== SETTING_NAMES.length ||
      canonicalStringify(plan.plannedCounts.settings) !== canonicalStringify({set: plan.settings.set.length,
        unchanged: plan.settings.unchanged.length})) fail("INVALID_RESTORE_PLAN");
  for (const key of settings) {
    const equal = Object.hasOwn(expected.storeSettings, key) &&
      hash(expected.storeSettings[key]) === hash(plan.desiredState.storeSettings[key]);
    if (equal !== plan.settings.unchanged.includes(key)) fail("INVALID_RESTORE_PLAN");
    expected.storeSettings[key] = clone(plan.desiredState.storeSettings[key]);
  }
  for (const name of COLLECTION_NAMES) {
    const actions = plan.collections[name];
    if (Object.keys(actions).sort().join() !== [...ACTIONS].sort().join()) fail("INVALID_RESTORE_PLAN");
    const before = new Map(expected.collections[name].map((d) => [d.id, d.data]));
    const desired = new Map(plan.desiredState.collections[name].map((d) => [d.id, d.data]));
    const seen = new Set(); const result = new Map();
    for (const action of ACTIONS) {
      const ids = actions[action];
      if (!Array.isArray(ids) || ids.length !== plan.plannedCounts.collections[name][action]) fail("INVALID_RESTORE_PLAN");
      totals[action] += ids.length;
      for (const id of ids) {
        if (!validId(id) || seen.has(id) ||
            desired.has(id) !== ["create", "overwrite", "unchanged"].includes(action) ||
            (action === "create" ? before.has(id) : !before.has(id)) ||
            (action === "unchanged" && hash(before.get(id)) !== hash(desired.get(id))) ||
            (action === "overwrite" && hash(before.get(id)) === hash(desired.get(id)))) fail("INVALID_RESTORE_PLAN");
        seen.add(id);
        if (action === "preserve") result.set(id, before.get(id));
        else if (action !== "delete") result.set(id, desired.get(id));
      }
    }
    if ([...before.keys(), ...desired.keys()].some((id) => !seen.has(id)) ||
        actions[plan.mode === "REPLACE" ? "preserve" : "delete"].length) fail("INVALID_RESTORE_PLAN");
    expected.collections[name] = [...result].map(([id, data]) => ({id, data}));
  }
  if (canonicalStringify(totals) !== canonicalStringify(plan.plannedCounts.totals)) fail("INVALID_RESTORE_PLAN");
  return canonicalState(expected);
}

function expectedFromPlan(plan, baselineState) {
  try { return validateExpectedFromPlan(plan, baselineState); }
  catch (error) {
    if (error instanceof StoreRestoreValidationError) throw error;
    fail("INVALID_RESTORE_PLAN");
  }
}

function type(value, encoded) {
  if (value === null) return "null";
  if (value instanceof Timestamp) return "timestamp";
  if (value instanceof GeoPoint) return "geoPoint";
  if (value instanceof DocumentReference) return "documentReference";
  if (Buffer.isBuffer(value)) return "bytes";
  if (Array.isArray(value)) return "array";
  if (encoded && value && typeof value === "object" && value.__storeConnectType) return value.__storeConnectType;
  if (value && typeof value === "object" && ![null, Object.prototype].includes(Object.getPrototypeOf(value))) {
    fail("UNSUPPORTED_VERIFICATION_TYPE");
  }
  return typeof value === "object" ? "object" : typeof value;
}

// Report individual scalar differences only. Containers/documents are never
// logged or embedded wholesale; credential-like fields are always redacted.
function reportValue(value, kind, path) {
  if (/(secret|token|password|credential|private.?key|key\.properties|api.?key)/i.test(path)) return "[REDACTED]";
  if (kind === "timestamp") return {seconds: value.seconds, nanoseconds: value.nanoseconds};
  if (kind === "geoPoint") return {latitude: value.latitude, longitude: value.longitude};
  if (kind === "documentReference") return {path: value.path};
  if (kind === "bytes") return {base64: Buffer.isBuffer(value) ? value.toString("base64") : value.base64};
  if (["object", "array"].includes(kind)) return {type: kind};
  if (kind === "undefined") return {absent: true};
  if (kind === "number" && !Number.isFinite(value)) return {number: String(value)};
  return value;
}

/** Pure comparison. actualState contains SDK values, never encoded markers.
 * Root fields outside the seven approved settings are outside this contract.
 * All documents in the five collections are read and counted, including extras.
 */
function compareStoreRestoreState({plan, baselineState, actualState}) {
  const expected = expectedFromPlan(plan, baselineState);
  if (!actualState || !actualState.storeSettings || !actualState.collections ||
      Object.keys(actualState.collections).sort().join() !== [...COLLECTION_NAMES].sort().join()) fail("INVALID_VERIFICATION_STATE");
  const mismatches = []; const collections = {};
  const counts = () => ({expectedDocuments: 0, actualDocuments: 0, matchedDocuments: 0,
    missingDocuments: 0, unexpectedDocuments: 0, mismatchedDocuments: 0});
  function issue(collection, documentId, path, divergence, exp, act) {
    mismatches.push({collection, documentId, path, type: divergence,
      expected: reportValue(exp, type(exp, true), path), actual: reportValue(act, type(act, false), path)});
  }
  function walk(exp, act, path, collection, id) {
    const e = type(exp, true); const a = type(act, false);
    if (e !== a) { issue(collection, id, path, "TYPE_MISMATCH", exp, act); return; }
    if (e === "object" || e === "array") {
      const keys = [...new Set([...Object.keys(exp), ...Object.keys(act)])].sort(compare);
      for (const key of keys) {
        const child = path + "/" + key.replace(/~/g, "~0").replace(/\//g, "~1");
        if (!Object.hasOwn(exp, key)) issue(collection, id, child, "UNEXPECTED_FIELD", undefined, act[key]);
        else if (!Object.hasOwn(act, key)) issue(collection, id, child, "MISSING_FIELD", exp[key], undefined);
        else walk(exp[key], act[key], child, collection, id);
      }
    } else {
      const x = reportValue(exp, e, ""); const y = reportValue(act, a, "");
      if (JSON.stringify(x) !== JSON.stringify(y)) issue(collection, id, path, "VALUE_MISMATCH", exp, act);
    }
  }
  function documents(name, wanted, actual, root = false) {
    if (!Array.isArray(actual) || actual.some((d) => !d || !validId(d.id) || !d.data ||
        type(d.data, false) !== "object") || new Set(actual.map((d) => d.id)).size !== actual.length) fail("INVALID_VERIFICATION_STATE");
    const counter = counts(); collections[name] = counter;
    counter.expectedDocuments = wanted.length; counter.actualDocuments = actual.length;
    const byId = new Map(actual.map((d) => [d.id, d.data]));
    for (const doc of wanted) {
      if (!byId.has(doc.id)) {
        counter.missingDocuments++; issue(name, doc.id, "", "MISSING_DOCUMENT", {}, undefined); continue;
      }
      const start = mismatches.length;
      const data = byId.get(doc.id);
      walk(doc.data, root ? Object.fromEntries(SETTING_NAMES.filter((k) => Object.hasOwn(data, k))
        .map((k) => [k, data[k]])) : data, "", name, doc.id);
      counter[mismatches.length === start ? "matchedDocuments" : "mismatchedDocuments"]++;
    }
    const expectedIds = new Set(wanted.map((d) => d.id));
    for (const doc of actual) if (!expectedIds.has(doc.id)) {
      // A delete action explicitly forbids this ID. REPLACE defines the whole
      // collection; MERGE_A1 makes no promise about newly introduced extra IDs.
      if (plan.mode === "REPLACE" || plan.collections[COLLECTION_NAMES.find((n) => namespace(n) === name)].delete.includes(doc.id)) {
        counter.unexpectedDocuments++; issue(name, doc.id, "", "UNEXPECTED_DOCUMENT", undefined, {});
      }
    }
  }
  documents("storeSettings", [{id: plan.targetStoreId, data: expected.storeSettings}],
    actualState.rootExists === false ? [] : [{id: plan.targetStoreId, data: actualState.storeSettings}], true);
  for (const name of [...COLLECTION_NAMES].sort((a, b) => compare(namespace(a), namespace(b)))) {
    documents(namespace(name), expected.collections[name], actualState.collections[name]);
  }
  mismatches.sort((a, b) => compare(a.collection, b.collection) || compare(a.documentId, b.documentId) ||
    compare(a.path, b.path) || compare(a.type, b.type));
  const summary = counts();
  for (const counter of Object.values(collections)) for (const key of Object.keys(summary)) summary[key] += counter[key];
  return {ok: mismatches.length === 0, summary, collections, mismatches};
}

async function verifyStoreRestoreInEmulator({plan, baselineState, targetStoreId, projectId}) {
  guard(projectId);
  plan = clone(plan); baselineState = clone(baselineState);
  expectedFromPlan(plan, baselineState);
  if (targetStoreId !== plan.targetStoreId) fail("INVALID_RESTORE_PLAN");
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const db = new Firestore({projectId, host, ssl: false});
  const check = () => { guard(projectId); if (process.env.FIRESTORE_EMULATOR_HOST !== host) fail("INVALID_EMULATOR_HOST"); };
  try {
    const root = db.doc("stores/" + targetStoreId);
    check(); const snapshot = await root.get();
    const actualState = {rootExists: snapshot.exists, storeSettings: snapshot.data() || {}, collections: {}};
    for (const name of COLLECTION_NAMES) {
      check(); const docs = await root.collection(namespace(name)).get();
      actualState.collections[name] = docs.docs.map((d) => ({id: d.id, data: d.data()}));
    }
    check();
    return compareStoreRestoreState({plan, baselineState, actualState});
  } finally { await db.terminate(); }
}

module.exports = {compareStoreRestoreState, verifyStoreRestoreInEmulator};
