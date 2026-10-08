"use strict";

const {COLLECTION_NAMES, SETTING_NAMES} = require("./storeSnapshotContract");
const {transformStoreSnapshot, canonicalStringify, hash, validateState,
  canonicalState, fail} = require("./storeRestoreTransform");

/** Pure dry run. Action arrays contain IDs; desiredState holds execution data.
 * REPLACE only covers five collections. Settings are future root field updates.
 */
function buildStoreRestorePlan(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !["snapshot", "sourceStoreId", "targetStoreId", "targetState", "mode", "policy"].includes(key))) {
    fail("INVALID_PLANNER_INPUT");
  }
  const {snapshot, sourceStoreId, targetStoreId, targetState, mode, policy} = input;
  if (!["MERGE_A1", "REPLACE"].includes(mode)) fail("INVALID_MODE");
  const transformed = transformStoreSnapshot({snapshot, sourceStoreId, targetStoreId, policy});
  validateState(targetState);
  const baseline = canonicalState(targetState);
  const {desiredState} = transformed;
  const collections = {};
  const plannedCounts = {collections: {}, totals: {create: 0, overwrite: 0, delete: 0, unchanged: 0, preserve: 0}};
  for (const name of COLLECTION_NAMES) {
    const actions = {create: [], overwrite: [], delete: [], unchanged: [], preserve: []};
    const target = new Map(baseline.collections[name].map((doc) => [doc.id, doc.data]));
    const desiredIds = new Set();
    for (const doc of desiredState.collections[name]) {
      desiredIds.add(doc.id);
      const action = !target.has(doc.id) ? "create" :
        canonicalStringify(target.get(doc.id)) === canonicalStringify(doc.data) ? "unchanged" : "overwrite";
      actions[action].push(doc.id);
    }
    for (const doc of baseline.collections[name]) if (!desiredIds.has(doc.id)) {
      actions[mode === "REPLACE" ? "delete" : "preserve"].push(doc.id);
    }
    collections[name] = actions;
    plannedCounts.collections[name] = {};
    for (const action of Object.keys(actions)) {
      plannedCounts.collections[name][action] = actions[action].length;
      plannedCounts.totals[action] += actions[action].length;
    }
  }
  const settings = {set: [], unchanged: [], v1NormalizedNulls: true, strategy: "ROOT_FIELD_UPDATES"};
  for (const key of SETTING_NAMES) {
    const equal = Object.hasOwn(baseline.storeSettings, key) &&
      canonicalStringify(baseline.storeSettings[key]) === canonicalStringify(desiredState.storeSettings[key]);
    settings[equal ? "unchanged" : "set"].push(key);
  }
  plannedCounts.settings = {set: settings.set.length, unchanged: settings.unchanged.length};
  const plan = {planVersion: 1, transformVersion: transformed.transformVersion, mode,
    sourceStoreId, targetStoreId, crossStore: transformed.crossStore, snapshotVersion: snapshot.snapshotVersion,
    policy: transformed.policy, collections, settings, plannedCounts,
    warnings: transformed.warnings, blockers: transformed.blockers,
    baselineHash: hash(baseline), desiredStateHash: hash(desiredState), desiredState};
  plan.planHash = hash(plan);
  return plan;
}

module.exports = {buildStoreRestorePlan};
