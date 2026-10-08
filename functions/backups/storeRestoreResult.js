"use strict";

const {COLLECTION_NAMES, SETTING_NAMES} = require("./storeSnapshotContract");
const {canonicalStringify, hash, validateState, validId, fail} = require("./storeRestoreTransform");
const ACTIONS = ["create", "overwrite", "delete", "unchanged", "preserve"];
const COUNTS = ["expectedDocuments", "actualDocuments", "matchedDocuments",
  "missingDocuments", "unexpectedDocuments", "mismatchedDocuments"];
const TYPES = ["MISSING_DOCUMENT", "UNEXPECTED_DOCUMENT", "TYPE_MISMATCH",
  "VALUE_MISMATCH", "MISSING_FIELD", "UNEXPECTED_FIELD"];
function check(condition) { if (!condition) fail("INVALID_RESTORE_RESULT"); }
function object(value) { check(value && typeof value === "object" && !Array.isArray(value)); }
function count(value) { check(Number.isSafeInteger(value) && value >= 0); return value; }
function exact(value, keys) {
  object(value); check(Object.keys(value).sort().join() === [...keys].sort().join());
}
function sum(values) { return count(values.reduce((a, b) => a + count(b), 0)); }

/** Pure consolidation of an R1B plan, the resolved R1C/D return value and an
 * R1E report. The caller must supply the report from this execution: R1E does
 * not carry plan identity. No timestamps, payloads or raw error strings escape.
 * executionError is the caught executor error, mutually exclusive with execution.
 * Failed execution has unknown writes/batches, including after committed chunks.
 */
function buildStoreRestoreResult(input) {
  object(input);
  check(Object.keys(input).every((k) => ["plan", "execution", "executionError", "verification", "status"].includes(k)));
  const {plan, execution, executionError, verification} = input;
  exact(plan, ["planVersion", "transformVersion", "mode", "sourceStoreId", "targetStoreId", "crossStore",
    "snapshotVersion", "policy", "collections", "settings", "plannedCounts", "warnings", "blockers",
    "baselineHash", "desiredStateHash", "desiredState", "planHash"]);
  canonicalStringify(plan);
  const {planHash, ...body} = plan;
  check(hash(body) === planHash && hash(plan.desiredState) === plan.desiredStateHash);
  check(plan.planVersion === 1 && plan.transformVersion === 1 && plan.snapshotVersion === 1);
  check(["MERGE_A1", "REPLACE"].includes(plan.mode));
  check(validId(plan.sourceStoreId) && validId(plan.targetStoreId) && plan.sourceStoreId !== plan.targetStoreId &&
    plan.crossStore === true && /^[a-f0-9]{64}$/.test(plan.baselineHash) &&
    canonicalStringify(plan.policy) === '{"version":1}' && Array.isArray(plan.warnings));
  check(Array.isArray(plan.blockers) && plan.blockers.length === 0);
  validateState(plan.desiredState);
  exact(plan.desiredState.storeSettings, SETTING_NAMES);
  exact(plan.collections, COLLECTION_NAMES);
  exact(plan.plannedCounts, ["collections", "totals", "settings"]);
  exact(plan.plannedCounts.collections, COLLECTION_NAMES);
  exact(plan.plannedCounts.totals, ACTIONS);
  for (const name of COLLECTION_NAMES) {
    exact(plan.collections[name], ACTIONS);
    exact(plan.plannedCounts.collections[name], ACTIONS);
    const ids = new Set();
    const desiredIds = new Set(plan.desiredState.collections[name].map((d) => d.id));
    for (const action of ACTIONS) {
      const list = plan.collections[name][action];
      check(Array.isArray(list) && list.length === count(plan.plannedCounts.collections[name][action]));
      for (const id of list) {
        check(validId(id) && !ids.has(id) && desiredIds.has(id) === ["create", "overwrite", "unchanged"].includes(action));
        ids.add(id);
      }
    }
    check([...desiredIds].every((id) => ids.has(id)));
    check(plan.collections[name][plan.mode === "REPLACE" ? "preserve" : "delete"].length === 0);
  }
  const totals = {};
  for (const action of ACTIONS) {
    totals[action] = sum(COLLECTION_NAMES.map((n) => plan.plannedCounts.collections[n][action]));
    check(totals[action] === count(plan.plannedCounts.totals[action]));
  }
  exact(plan.settings, ["set", "unchanged", "v1NormalizedNulls", "strategy"]);
  check(Array.isArray(plan.settings.set) && Array.isArray(plan.settings.unchanged));
  const settings = [...plan.settings.set, ...plan.settings.unchanged];
  check(settings.length === SETTING_NAMES.length && new Set(settings).size === settings.length &&
    settings.every((k) => SETTING_NAMES.includes(k)) && plan.settings.strategy === "ROOT_FIELD_UPDATES" &&
    plan.settings.v1NormalizedNulls === true);
  exact(plan.plannedCounts.settings, ["set", "unchanged"]);
  check(count(plan.plannedCounts.settings.set) === plan.settings.set.length &&
    count(plan.plannedCounts.settings.unchanged) === plan.settings.unchanged.length);
  // Settings are one root write, not one operation per field (R1C/D contract).
  const plannedOperations = sum([totals.create, totals.overwrite, totals.delete, plan.settings.set.length ? 1 : 0]);
  const failed = executionError !== undefined && executionError !== null;
  if (failed) { object(executionError); check(execution === undefined || execution === null); }
  else {
    exact(execution, ["writes", "batches"]);
    check(count(execution.writes) === plannedOperations);
    count(execution.batches);
    check(execution.writes === 0 ? execution.batches === 0 :
      execution.batches > 0 && execution.batches <= execution.writes && execution.batches >= Math.ceil(execution.writes / 400));
  }
  let report = null;
  if (verification !== undefined && verification !== null) {
    exact(verification, ["ok", "summary", "collections", "mismatches"]);
    check(typeof verification.ok === "boolean" && Array.isArray(verification.mismatches));
    exact(verification.summary, COUNTS);
    exact(verification.collections, ["storeSettings", ...COLLECTION_NAMES.map((n) => n === "cashFlow" ? "cash_flow" : n)]);
    for (const stats of Object.values(verification.collections)) {
      exact(stats, COUNTS); COUNTS.forEach((k) => count(stats[k]));
      check(sum([stats.matchedDocuments, stats.missingDocuments, stats.mismatchedDocuments]) === stats.expectedDocuments);
      const accounted = sum([stats.matchedDocuments, stats.mismatchedDocuments, stats.unexpectedDocuments]);
      check(plan.mode === "REPLACE" ? accounted === stats.actualDocuments : accounted <= stats.actualDocuments);
    }
    check(verification.collections.storeSettings.expectedDocuments === 1);
    for (const name of COLLECTION_NAMES) {
      const key = name === "cashFlow" ? "cash_flow" : name;
      const expected = sum([plan.desiredState.collections[name].length, plan.collections[name].preserve.length]);
      check(verification.collections[key].expectedDocuments === expected);
    }
    const summary = {};
    for (const key of COUNTS) {
      summary[key] = count(verification.summary[key]);
      check(summary[key] === sum(Object.values(verification.collections).map((s) => s[key])));
    }
    const divergenceCodes = Object.fromEntries(TYPES.map((t) => [t, 0]));
    // Preserve counts of R1E issues without copying paths, IDs or values.
    for (const issue of verification.mismatches) {
      exact(issue, ["collection", "documentId", "path", "type", "expected", "actual"]);
      check(Object.hasOwn(verification.collections, issue.collection) && validId(issue.documentId) &&
        typeof issue.path === "string" && TYPES.includes(issue.type));
      divergenceCodes[issue.type]++;
    }
    const divergentDocuments = sum([summary.missingDocuments, summary.unexpectedDocuments, summary.mismatchedDocuments]);
    check(verification.ok === (verification.mismatches.length === 0));
    check((divergentDocuments === 0) === verification.ok);
    check(divergenceCodes.MISSING_DOCUMENT === summary.missingDocuments &&
      divergenceCodes.UNEXPECTED_DOCUMENT === summary.unexpectedDocuments);
    const fieldIssues = verification.mismatches.length - summary.missingDocuments - summary.unexpectedDocuments;
    check(fieldIssues >= summary.mismatchedDocuments && (summary.mismatchedDocuments !== 0 || fieldIssues === 0));
    report = {ok: verification.ok, summary, divergenceCount: verification.mismatches.length, divergenceCodes};
  }
  check(failed || report !== null);
  const status = failed ? "EXECUTION_FAILED" : report.ok ? "SUCCESS" : "VERIFICATION_FAILED";
  check(input.status === undefined || input.status === status);
  return {status, mode: plan.mode,
    plan: {planVersion: plan.planVersion, planHash, desiredStateHash: plan.desiredStateHash,
      plannedCounts: JSON.parse(canonicalStringify(plan.plannedCounts))},
    execution: {completed: !failed, writes: failed ? null : execution.writes,
      batches: failed ? null : execution.batches, errorCode: failed ? "EXECUTOR_FAILED" : null},
    verification: report,
    summary: {plannedOperations, materializedOperations: failed ? null : execution.writes,
      created: failed ? null : totals.create, updated: failed ? null : totals.overwrite,
      preserved: failed ? null : totals.preserve, deleted: failed ? null : totals.delete,
      unchanged: failed ? null : totals.unchanged,
      // actualDocuments includes the settings root and MERGE extras, per R1E.
      verifiedDocuments: report ? report.summary.actualDocuments : null,
      matchedDocuments: report ? report.summary.matchedDocuments : null,
      missingDocuments: report ? report.summary.missingDocuments : null,
      unexpectedDocuments: report ? report.summary.unexpectedDocuments : null,
      mismatchedDocuments: report ? report.summary.mismatchedDocuments : null}};
}

module.exports = {buildStoreRestoreResult};
