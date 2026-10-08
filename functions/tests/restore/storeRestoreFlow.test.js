"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const planner = require("../../backups/storeRestorePlanner");
const executor = require("../../backups/storeRestoreEmulator");
const verifier = require("../../backups/storeRestoreVerifier");
const builder = require("../../backups/storeRestoreResult");
const {runStoreRestoreFlow: run} = require("../../backups/storeRestoreFlow");
const {COLLECTION_NAMES, SETTING_NAMES} = require("../../backups/storeSnapshotContract");
function fixture(mode = "MERGE_A1") {
  const collections = Object.fromEntries(COLLECTION_NAMES.map((n) => [n, []]));
  return {snapshot: {snapshotVersion: 1, metadata: {storeId: "flow-A"},
    storeSettings: Object.fromEntries(SETTING_NAMES.map((k) => [k, null])), collections},
  sourceStoreId: "flow-A", targetStoreId: "flow-B", targetState: {storeSettings: {}, collections},
  mode, projectId: "demo-store-connect-restore"};
}
async function doubles(work, options = {}) {
  const originals = [planner.buildStoreRestorePlan, executor.restoreStoreToEmulator,
    verifier.verifyStoreRestoreInEmulator, builder.buildStoreRestoreResult];
  const calls = []; let plan; let execution; let verification;
  planner.buildStoreRestorePlan = (input) => {
    calls.push("planner"); plan = originals[0](input); return plan;
  };
  executor.restoreStoreToEmulator = async (input) => {
    calls.push("executor"); assert.equal(input.plan, plan); assert.equal(input.desiredState, plan.desiredState);
    if (options.error !== undefined) throw options.error;
    if (options.onExecution) options.onExecution();
    execution = {writes: 1, batches: 1}; return execution;
  };
  verifier.verifyStoreRestoreInEmulator = async (input) => {
    calls.push("verifier"); assert.equal(input.plan, plan);
    if (options.verifierError) throw options.verifierError;
    assert.deepEqual(input.baselineState.storeSettings, {});
    const actualState = JSON.parse(JSON.stringify(plan.desiredState));
    if (options.mismatch) actualState.storeSettings.name = "wrong";
    verification = verifier.compareStoreRestoreState({...input, actualState}); return verification;
  };
  builder.buildStoreRestoreResult = (input) => {
    calls.push("result"); assert.equal(input.plan, plan);
    if (Object.hasOwn(input, "executionError")) {
      assert.equal(input.executionError.message, "EXECUTOR_FAILED");
      assert.equal(Object.hasOwn(input, "verification"), false);
    } else {
      assert.equal(input.execution, execution); assert.equal(input.verification, verification);
    }
    return originals[3](input);
  };
  try { await work(calls); }
  finally {
    [planner.buildStoreRestorePlan, executor.restoreStoreToEmulator,
      verifier.verifyStoreRestoreInEmulator, builder.buildStoreRestoreResult] = originals;
  }
}
for (const mode of ["MERGE_A1", "REPLACE"]) test("canonical SUCCESS and stage order " + mode, async () => {
  await doubles(async (calls) => {
    const input = fixture(mode); const before = JSON.stringify(input); const r = await run(input);
    assert.deepEqual(calls, ["planner", "executor", "verifier", "result"]);
    assert.equal(r.status, "SUCCESS"); assert.equal(r.mode, mode);
    assert.deepEqual(Object.keys(r), ["status", "mode", "plan", "execution", "verification", "summary"]);
    assert.equal(JSON.stringify(input), before);
  });
});
for (const error of [new Error("password=SECRET"), "token=SECRET", null]) test("execution rejection sanitized " + typeof error, async () => {
  await doubles(async (calls) => {
    const r = await run(fixture());
    assert.deepEqual(calls, ["planner", "executor", "result"]);
    assert.equal(r.status, "EXECUTION_FAILED"); assert.equal(r.execution.writes, null);
    assert.equal(r.verification, null); assert.ok(!JSON.stringify(r).includes("SECRET"));
    assert.equal(Object.hasOwn(r.execution, "rollback"), false);
  }, {error});
});
test("verification failure forwarded without retry or repair", async () => {
  await doubles(async (calls) => {
    const r = await run(fixture()); assert.equal(r.status, "VERIFICATION_FAILED");
    assert.equal(r.summary.mismatchedDocuments, 1);
    assert.deepEqual(calls, ["planner", "executor", "verifier", "result"]);
  }, {mismatch: true});
});
test("verifier exception propagates; no result or retry", async () => {
  const error = new Error("VERIFIER_FAILED");
  await doubles(async (calls) => {
    await assert.rejects(run(fixture()), (e) => e === error);
    assert.deepEqual(calls, ["planner", "executor", "verifier"]);
  }, {verifierError: error});
});
test("caller mutation during executor cannot change verification baseline", async () => {
  const input = fixture();
  await doubles(async () => { assert.equal((await run(input)).status, "SUCCESS"); },
    {onExecution: () => { input.targetState.storeSettings.name = "mutation"; input.targetStoreId = "other"; }});
});
for (const key of ["snapshot", "sourceStoreId", "targetStoreId", "targetState", "mode", "projectId"]) {
  test("missing required " + key, async () => {
    await doubles(async (calls) => {
      const input = fixture(); delete input[key]; await assert.rejects(run(input)); assert.deepEqual(calls, []);
    });
  });
}
for (const input of [null, [], "invalid", {}, {...fixture(), extra: true},
  {...fixture(), targetStoreId: "bad/id"}, {...fixture(), targetStoreId: "flow-A"},
  {...fixture(), projectId: null}]) test("invalid input " + JSON.stringify(input).slice(0, 45), async () => {
  await doubles(async (calls) => { await assert.rejects(run(input)); assert.deepEqual(calls, []); });
});
for (const mode of ["CREATE", "MERGE_A2", "unknown"]) test("mode rejected by R1B " + mode, async () => {
  await doubles(async (calls) => {
    await assert.rejects(run(fixture(mode)), {code: "INVALID_MODE"}); assert.deepEqual(calls, ["planner"]);
  });
});
test("R1F invariant rejection propagates without SUCCESS", async () => {
  const original = builder.buildStoreRestoreResult;
  await doubles(async (calls) => {
    builder.buildStoreRestoreResult = (input) => { calls.push("result"); return original({...input, verification: null}); };
    await assert.rejects(run(fixture())); assert.deepEqual(calls, ["planner", "executor", "verifier", "result"]);
  });
});
