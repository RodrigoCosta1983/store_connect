"use strict";


const assert =
    require("assert");

const {
  planBackupRetentionScheduleRunCompletion,
  ACTIONS,
} = require(
    "../../backups/backupRetentionScheduleRunCompletionPlanner",
);

const {
  getRetentionScheduleEventIdentity,
} = require(
    "../../backups/backupRetentionScheduleEvent",
);


// ============================================================================
// F5.6-D3-G9.6-D10
// TESTE DO PLANNER DE CONCLUSÃƒO DO LEDGER
// ============================================================================

function run() {
  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "F5.6-D3-G9.6-D10 â€” CONCLUSÃƒO DO LEDGER",
  );

  console.log(
      "============================================================",
  );


  const storeId =
      "store-g9-completion-test";


  const executionId =
      "worker-g9-completion";


  const scheduleIdentity =
      getRetentionScheduleEventIdentity({
        jobName:
          "firebase-schedule-scheduledBackupRetention-us-central1",

        scheduleTime:
          "2026-09-09T07:00:00.000Z",
      });


  const runId =
      scheduleIdentity.runId;


  const startedLedger = {
    version:
      1,

    storeId,

    runId,

    status:
      "started",

    scheduleTime:
      scheduleIdentity.scheduleTime,

    jobName:
      scheduleIdentity.jobName,

    identityHashSha256:
      scheduleIdentity.identityHashSha256,

    freshBudgetGranted:
      true,

    freshBudgetMax:
      1,
  };


  // ==========================================================================
  // 1. STARTED â†’ COMPLETE
  // ==========================================================================

  const started =
      planBackupRetentionScheduleRunCompletion({
        storeId,

        runId,

        scheduleIdentity,

        existingRun:
          startedLedger,

        executionId,
      });


  assert.strictEqual(
      started.action,
      ACTIONS.COMPLETE,
  );


  assert.strictEqual(
      started.allowed,
      true,
  );


  assert.strictEqual(
      started.shouldWrite,
      true,
  );


  assert.strictEqual(
      started.storeId,
      storeId,
  );


  assert.strictEqual(
      started.runId,
      runId,
  );


  assert.strictEqual(
      started.executionId,
      executionId,
  );


  console.log(
      "âœ… started â†’ COMPLETE + shouldWrite=true",
  );


  // ==========================================================================
  // 2. COMPLETED â†’ ALREADY_COMPLETED
  // ==========================================================================

  const completed =
      planBackupRetentionScheduleRunCompletion({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...startedLedger,

          status:
            "completed",
        },

        executionId,
      });


  assert.strictEqual(
      completed.action,
      ACTIONS.ALREADY_COMPLETED,
  );


  assert.strictEqual(
      completed.allowed,
      true,
  );


  assert.strictEqual(
      completed.shouldWrite,
      false,
  );


  console.log(
      "âœ… completed â†’ ALREADY_COMPLETED + zero write",
  );


  // ==========================================================================
  // 3. LEDGER AUSENTE
  // ==========================================================================

  const missingLedger =
      planBackupRetentionScheduleRunCompletion({
        storeId,

        runId,

        scheduleIdentity,

        existingRun:
          null,

        executionId,
      });


  assert.strictEqual(
      missingLedger.action,
      ACTIONS.BLOCKED,
  );


  assert.strictEqual(
      missingLedger.allowed,
      false,
  );


  console.log(
      "âœ… ledger ausente â†’ BLOCKED",
  );


  // ==========================================================================
  // 4. EXECUTION ID AUSENTE
  // ==========================================================================

  const missingExecution =
      planBackupRetentionScheduleRunCompletion({
        storeId,

        runId,

        scheduleIdentity,

        existingRun:
          startedLedger,

        executionId:
          "",
      });


  assert.strictEqual(
      missingExecution.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… executionId ausente â†’ BLOCKED",
  );


  // ==========================================================================
  // 5. STORE DIVERGENTE
  // ==========================================================================

  const badStore =
      planBackupRetentionScheduleRunCompletion({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...startedLedger,

          storeId:
            "outra-loja",
        },

        executionId,
      });


  assert.strictEqual(
      badStore.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… storeId divergente â†’ BLOCKED",
  );


  // ==========================================================================
  // 6. RUN ID DIVERGENTE
  // ==========================================================================

  const badRun =
      planBackupRetentionScheduleRunCompletion({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...startedLedger,

          runId:
            (
              "retention-schedule-" +
              "b".repeat(64)
            ),
        },

        executionId,
      });


  assert.strictEqual(
      badRun.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… runId divergente â†’ BLOCKED",
  );


  // ==========================================================================
  // 7. SCHEDULE TIME DIVERGENTE
  // ==========================================================================

  const badScheduleTime =
      planBackupRetentionScheduleRunCompletion({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...startedLedger,

          scheduleTime:
            "2026-09-10T07:00:00.000Z",
        },

        executionId,
      });


  assert.strictEqual(
      badScheduleTime.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… scheduleTime divergente â†’ BLOCKED",
  );


  // ==========================================================================
  // 8. JOB NAME DIVERGENTE
  // ==========================================================================

  const badJob =
      planBackupRetentionScheduleRunCompletion({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...startedLedger,

          jobName:
            "outro-job",
        },

        executionId,
      });


  assert.strictEqual(
      badJob.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… jobName divergente â†’ BLOCKED",
  );


  // ==========================================================================
  // 9. HASH DIVERGENTE
  // ==========================================================================

  const badHash =
      planBackupRetentionScheduleRunCompletion({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...startedLedger,

          identityHashSha256:
            "c".repeat(64),
        },

        executionId,
      });


  assert.strictEqual(
      badHash.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… hash divergente â†’ BLOCKED",
  );


  // ==========================================================================
  // 10. VERSÃƒO INVÃLIDA
  // ==========================================================================

  const badVersion =
      planBackupRetentionScheduleRunCompletion({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...startedLedger,

          version:
            2,
        },

        executionId,
      });


  assert.strictEqual(
      badVersion.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… versÃ£o invÃ¡lida â†’ BLOCKED",
  );


  // ==========================================================================
  // 11. STATUS INVÃLIDO
  // ==========================================================================

  const badStatus =
      planBackupRetentionScheduleRunCompletion({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...startedLedger,

          status:
            "failed",
        },

        executionId,
      });


  assert.strictEqual(
      badStatus.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… status invÃ¡lido â†’ BLOCKED",
  );


  // ==========================================================================
  // 12. FRESH BUDGET INCONSISTENTE
  // ==========================================================================

  const badBudget =
      planBackupRetentionScheduleRunCompletion({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...startedLedger,

          freshBudgetGranted:
            false,
        },

        executionId,
      });


  assert.strictEqual(
      badBudget.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… ledger com fresh budget inconsistente â†’ BLOCKED",
  );


  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… PLANNER DE CONCLUSÃƒO DO LEDGER PASSOU",
  );

  console.log(
      "============================================================",
  );

  console.log("");
}


run();