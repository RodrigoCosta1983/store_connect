"use strict";

const planner = require("./storeRestorePlanner");
const executor = require("./storeRestoreEmulator");
const verifier = require("./storeRestoreVerifier");
const result = require("./storeRestoreResult");
const {canonicalStringify, validId, fail} = require("./storeRestoreTransform");

/** Internal Emulator-only coordination. snapshot is R1A's snapshot; targetState
 * is the caller's pre-restore baseline. R1C checks that baseline against Firestore.
 * Transport guards stay in R1C/R1E, before their first Firestore access.
 * Only executor rejection becomes EXECUTION_FAILED; other stage errors propagate.
 */
async function runStoreRestoreFlow(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("INVALID_RESTORE_FLOW_INPUT");
  // Snapshot caller input synchronously, including the baseline used by R1E.
  const value = JSON.parse(canonicalStringify(input, "INVALID_RESTORE_FLOW_INPUT"));
  const required = ["snapshot", "sourceStoreId", "targetStoreId", "targetState", "mode", "projectId"];
  if (!required.every((key) => Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => ![...required, "policy"].includes(key)) ||
      typeof value.projectId !== "string" || !value.projectId ||
      !validId(value.sourceStoreId) || !validId(value.targetStoreId) ||
      value.sourceStoreId === value.targetStoreId) fail("INVALID_RESTORE_FLOW_INPUT");
  const {projectId, ...planningInput} = value;
  const plan = planner.buildStoreRestorePlan(planningInput);
  const {targetStoreId, targetState: baselineState} = value;
  let execution;
  try {
    execution = await executor.restoreStoreToEmulator({plan, desiredState: plan.desiredState, targetStoreId, projectId});
  } catch (_) {
    // Never forward arbitrary error payloads, messages, stacks or credentials.
    return result.buildStoreRestoreResult({plan, executionError: new Error("EXECUTOR_FAILED")});
  }
  const verification = await verifier.verifyStoreRestoreInEmulator({plan, baselineState, targetStoreId, projectId});
  return result.buildStoreRestoreResult({plan, execution, verification});
}

module.exports = {runStoreRestoreFlow};
