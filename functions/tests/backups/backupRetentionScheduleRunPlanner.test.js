"use strict";


const assert =
    require("assert");

const {
  planBackupRetentionScheduleRun,
  ACTIONS,
  isValidRunId,
} = require(
    "../../backups/backupRetentionScheduleRunPlanner",
);

const {
  getRetentionScheduleEventIdentity,
} = require(
    "../../backups/backupRetentionScheduleEvent",
);


// ============================================================================
// F5.6-D3-G9.6-D6
// TESTE DO PLANNER DO LEDGER DO SCHEDULER
// ============================================================================

function run() {
  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "F5.6-D3-G9.6-D6 â€” PLANNER DO LEDGER DO SCHEDULER",
  );

  console.log(
      "============================================================",
  );


  const storeId =
      "store-g9-ledger-test";


  const scheduleIdentity =
      getRetentionScheduleEventIdentity({
        jobName:
          "firebase-schedule-scheduledBackupRetention-us-central1",

        scheduleTime:
          "2026-09-09T07:00:00.000Z",
      });


  const runId =
      scheduleIdentity.runId;


  // ==========================================================================
  // 1. RUN ID VÃLIDO
  // ==========================================================================

  assert.strictEqual(
      isValidRunId(
          runId,
      ),
      true,
  );


  console.log(
      "âœ… runId vÃ¡lido reconhecido",
  );


  // ==========================================================================
  // 2. PRIMEIRA TENTATIVA â†’ GRANT
  // ==========================================================================

  const first =
      planBackupRetentionScheduleRun({
        storeId,

        runId,

        scheduleIdentity,

        existingRun:
          null,

        maxFreshDeletes:
          1,
      });


  assert.strictEqual(
      first.action,
      ACTIONS.GRANT_FRESH_BUDGET,
  );


  assert.strictEqual(
      first.allowed,
      true,
  );


  assert.strictEqual(
      first.maxFreshDeletes,
      1,
  );


  assert.strictEqual(
      first.shouldCreateLedger,
      true,
  );


  assert.strictEqual(
      first.storeId,
      storeId,
  );


  assert.strictEqual(
      first.runId,
      runId,
  );


  console.log(
      "âœ… primeira tentativa â†’ GRANT_FRESH_BUDGET",
  );


  // ==========================================================================
  // 3. LEDGER PERSISTIDO
  // ==========================================================================

  const existingRun = {
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
  // 4. RETRY â†’ RESUME ONLY
  // ==========================================================================

  const retry =
      planBackupRetentionScheduleRun({
        storeId,

        runId,

        scheduleIdentity,

        existingRun,

        maxFreshDeletes:
          1,
      });


  assert.strictEqual(
      retry.action,
      ACTIONS.RESUME_ONLY,
  );


  assert.strictEqual(
      retry.allowed,
      true,
  );


  assert.strictEqual(
      retry.maxFreshDeletes,
      0,
  );


  assert.strictEqual(
      retry.shouldCreateLedger,
      false,
  );


  assert.strictEqual(
      retry.originalFreshBudget,
      1,
  );


  console.log(
      "âœ… retry do mesmo evento â†’ RESUME_ONLY + budget 0",
  );


  // ==========================================================================
  // 5. LEDGER COMPLETED TAMBÃ‰M â†’ RESUME ONLY
  // ==========================================================================

  const completedRetry =
      planBackupRetentionScheduleRun({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...existingRun,

          status:
            "completed",
        },

        maxFreshDeletes:
          1,
      });


  assert.strictEqual(
      completedRetry.action,
      ACTIONS.RESUME_ONLY,
  );


  assert.strictEqual(
      completedRetry.maxFreshDeletes,
      0,
  );


  console.log(
      "âœ… ledger completed â†’ continua sem novo fresh budget",
  );


  // ==========================================================================
  // 6. OUTRA OCORRÃŠNCIA â†’ OUTRO LEDGER
  // ==========================================================================

  const nextIdentity =
      getRetentionScheduleEventIdentity({
        jobName:
          scheduleIdentity.jobName,

        scheduleTime:
          "2026-09-10T07:00:00.000Z",
      });


  const nextRun =
      planBackupRetentionScheduleRun({
        storeId,

        runId:
          nextIdentity.runId,

        scheduleIdentity:
          nextIdentity,

        existingRun:
          null,

        maxFreshDeletes:
          1,
      });


  assert.strictEqual(
      nextRun.action,
      ACTIONS.GRANT_FRESH_BUDGET,
  );


  assert.strictEqual(
      nextRun.maxFreshDeletes,
      1,
  );


  console.log(
      "âœ… nova ocorrÃªncia â†’ novo fresh budget",
  );


  // ==========================================================================
  // 7. MISMATCH DE STORE
  // ==========================================================================

  const badStore =
      planBackupRetentionScheduleRun({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...existingRun,

          storeId:
            "outra-loja",
        },

        maxFreshDeletes:
          1,
      });


  assert.strictEqual(
      badStore.action,
      ACTIONS.BLOCKED,
  );


  assert.strictEqual(
      badStore.allowed,
      false,
  );


  assert.strictEqual(
      badStore.maxFreshDeletes,
      0,
  );


  console.log(
      "âœ… ledger com storeId divergente â†’ BLOCKED",
  );


  // ==========================================================================
  // 8. MISMATCH DE RUN ID
  // ==========================================================================

  const badRun =
      planBackupRetentionScheduleRun({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...existingRun,

          runId:
            nextIdentity.runId,
        },

        maxFreshDeletes:
          1,
      });


  assert.strictEqual(
      badRun.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… ledger com runId divergente â†’ BLOCKED",
  );


  // ==========================================================================
  // 9. MISMATCH DE SCHEDULE TIME
  // ==========================================================================

  const badScheduleTime =
      planBackupRetentionScheduleRun({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...existingRun,

          scheduleTime:
            "2026-09-10T07:00:00.000Z",
        },

        maxFreshDeletes:
          1,
      });


  assert.strictEqual(
      badScheduleTime.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… ledger com scheduleTime divergente â†’ BLOCKED",
  );


  // ==========================================================================
  // 10. MISMATCH DE JOB NAME
  // ==========================================================================

  const badJob =
      planBackupRetentionScheduleRun({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...existingRun,

          jobName:
            "outro-job",
        },

        maxFreshDeletes:
          1,
      });


  assert.strictEqual(
      badJob.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… ledger com jobName divergente â†’ BLOCKED",
  );


  // ==========================================================================
  // 11. MISMATCH DE HASH
  // ==========================================================================

  const badHash =
      planBackupRetentionScheduleRun({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...existingRun,

          identityHashSha256:
            "b".repeat(64),
        },

        maxFreshDeletes:
          1,
      });


  assert.strictEqual(
      badHash.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… ledger com hash divergente â†’ BLOCKED",
  );


  // ==========================================================================
  // 12. VERSÃƒO INVÃLIDA
  // ==========================================================================

  const badVersion =
      planBackupRetentionScheduleRun({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...existingRun,

          version:
            2,
        },

        maxFreshDeletes:
          1,
      });


  assert.strictEqual(
      badVersion.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… versÃ£o desconhecida do ledger â†’ BLOCKED",
  );


  // ==========================================================================
  // 13. STATUS INVÃLIDO
  // ==========================================================================

  const badStatus =
      planBackupRetentionScheduleRun({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...existingRun,

          status:
            "invalid",
        },

        maxFreshDeletes:
          1,
      });


  assert.strictEqual(
      badStatus.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… status invÃ¡lido â†’ BLOCKED",
  );


  // ==========================================================================
  // 14. FRESH BUDGET NÃƒO CONFIRMADO
  // ==========================================================================

  const budgetNotGranted =
      planBackupRetentionScheduleRun({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...existingRun,

          freshBudgetGranted:
            false,
        },

        maxFreshDeletes:
          1,
      });


  assert.strictEqual(
      budgetNotGranted.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… ledger sem confirmaÃ§Ã£o de budget â†’ BLOCKED",
  );


  // ==========================================================================
  // 15. BUDGET INVÃLIDO NO LEDGER
  // ==========================================================================

  const invalidStoredBudget =
      planBackupRetentionScheduleRun({
        storeId,

        runId,

        scheduleIdentity,

        existingRun: {
          ...existingRun,

          freshBudgetMax:
            0,
        },

        maxFreshDeletes:
          1,
      });


  assert.strictEqual(
      invalidStoredBudget.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… budget persistido invÃ¡lido â†’ BLOCKED",
  );


  // ==========================================================================
  // 16. INPUTS INVÃLIDOS
  // ==========================================================================

  const missingStore =
      planBackupRetentionScheduleRun({
        storeId:
          "",

        runId,

        scheduleIdentity,

        existingRun:
          null,

        maxFreshDeletes:
          1,
      });


  assert.strictEqual(
      missingStore.action,
      ACTIONS.BLOCKED,
  );


  const invalidRunId =
      planBackupRetentionScheduleRun({
        storeId,

        runId:
          "run-invalido",

        scheduleIdentity,

        existingRun:
          null,

        maxFreshDeletes:
          1,
      });


  assert.strictEqual(
      invalidRunId.action,
      ACTIONS.BLOCKED,
  );


  const invalidBudget =
      planBackupRetentionScheduleRun({
        storeId,

        runId,

        scheduleIdentity,

        existingRun:
          null,

        maxFreshDeletes:
          0,
      });


  assert.strictEqual(
      invalidBudget.action,
      ACTIONS.BLOCKED,
  );


  console.log(
      "âœ… inputs invÃ¡lidos â†’ BLOCKED",
  );


  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… PLANNER DO LEDGER PASSOU",
  );

  console.log(
      "============================================================",
  );

  console.log("");
}


run();