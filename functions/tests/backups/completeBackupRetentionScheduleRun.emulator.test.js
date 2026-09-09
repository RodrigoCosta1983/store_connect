"use strict";


const assert =
    require("assert");

const admin =
    require("firebase-admin");

const {
  acquireBackupRetentionScheduleRunBudget,
} = require(
    "../../backups/acquireBackupRetentionScheduleRunBudget",
);

const {
  completeBackupRetentionScheduleRun,
} = require(
    "../../backups/completeBackupRetentionScheduleRun",
);

const {
  ACTIONS:
    COMPLETION_ACTIONS,
} = require(
    "../../backups/backupRetentionScheduleRunCompletionPlanner",
);

const {
  ACTIONS:
    RUN_ACTIONS,
} = require(
    "../../backups/backupRetentionScheduleRunPlanner",
);

const {
  getRetentionScheduleEventIdentity,
} = require(
    "../../backups/backupRetentionScheduleEvent",
);


// ============================================================================
// F5.6-D3-G9.6-D12
// CONCLUSÃƒO DO LEDGER â€” FIRESTORE EMULATOR + CONCORRÃŠNCIA
// ============================================================================
//
// Prova:
//
// âœ… ledger started Ã© criado;
// âœ… started â†’ COMPLETE;
// âœ… status final completed;
// âœ… completedAt persistido;
// âœ… completedByExecutionId persistido;
// âœ… retry â†’ ALREADY_COMPLETED;
// âœ… retry faz zero write;
// âœ… duas conclusÃµes concorrentes â†’ exatamente 1 COMPLETE;
// âœ… concorrente perdedor â†’ ALREADY_COMPLETED;
// âœ… ledger continua Ãºnico e Ã­ntegro.
//
// âŒ sem Storage;
// âŒ sem Scheduler;
// âŒ sem produÃ§Ã£o.
//
// ============================================================================


// ============================================================================
// CONFIGURAÃ‡ÃƒO
// ============================================================================

const EXPECTED_FIRESTORE_HOST =
    "127.0.0.1:8080";

const PROJECT_ID =
    "store-connect-app";

const STORE_NORMAL =
    "emulator-g9-completion-normal";

const STORE_CONCURRENT =
    "emulator-g9-completion-concurrent";

const JOB_NAME =
    "firebase-schedule-scheduledBackupRetention-us-central1";

const SCHEDULE_TIME =
    "2026-09-09T07:00:00.000Z";

const EXECUTION_NORMAL =
    "worker-g9-completion-normal";

const EXECUTION_RETRY =
    "worker-g9-completion-retry";

const EXECUTION_A =
    "worker-g9-completion-a";

const EXECUTION_B =
    "worker-g9-completion-b";


// ============================================================================
// SEGURANÃ‡A
// ============================================================================

function assertEmulatorEnvironment() {
  const firestoreHost =
      String(
          process.env
              .FIRESTORE_EMULATOR_HOST ||
          "",
      ).trim();


  if (
    firestoreHost !==
      EXPECTED_FIRESTORE_HOST
  ) {
    throw new Error(
        (
          "SEGURANÃ‡A: FIRESTORE_EMULATOR_HOST deve ser " +
          `${EXPECTED_FIRESTORE_HOST}. Atual: "${firestoreHost}".`
        ),
    );
  }
}


// ============================================================================
// FIREBASE
// ============================================================================

function initializeFirebase() {
  if (
    admin.apps.length ===
      0
  ) {
    admin.initializeApp({
      projectId:
        PROJECT_ID,
    });
  }


  return {
    db:
      admin.firestore(),
  };
}


// ============================================================================
// HELPERS
// ============================================================================

function getRunRef({
  db,
  storeId,
  runId,
}) {
  return db
      .collection(
          "storeBackups",
      )
      .doc(
          storeId,
      )
      .collection(
          "retentionScheduleRuns",
      )
      .doc(
          runId,
      );
}


async function cleanupRun({
  db,
  storeId,
  runId,
}) {
  await getRunRef({
    db,
    storeId,
    runId,
  }).delete();
}


async function createStartedLedger({
  db,
  storeId,
  scheduleIdentity,
}) {
  const result =
      await acquireBackupRetentionScheduleRunBudget({
        db,

        storeId,

        scheduleIdentity,

        maxFreshDeletes:
          1,
      });


  assert.strictEqual(
      result.action,
      RUN_ACTIONS.GRANT_FRESH_BUDGET,
  );


  assert.strictEqual(
      result.wrote,
      true,
  );


  return result;
}


// ============================================================================
// TESTE
// ============================================================================

async function run() {
  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "F5.6-D3-G9.6-D12 â€” CONCLUSÃƒO PERSISTENTE DO LEDGER",
  );

  console.log(
      "============================================================",
  );


  // ==========================================================================
  // 1. TRAVA
  // ==========================================================================

  assertEmulatorEnvironment();


  console.log(
      "âœ… trava confirmou Firestore Emulator",
  );


  const {
    db,
  } =
      initializeFirebase();


  // ==========================================================================
  // 2. IDENTIDADE
  // ==========================================================================

  const scheduleIdentity =
      getRetentionScheduleEventIdentity({
        jobName:
          JOB_NAME,

        scheduleTime:
          SCHEDULE_TIME,
      });


  const {
    runId,
  } =
      scheduleIdentity;


  console.log(
      `âœ… runId determinÃ­stico: ${runId}`,
  );


  // ==========================================================================
  // 3. LIMPEZA
  // ==========================================================================

  await Promise.all([
    cleanupRun({
      db,

      storeId:
        STORE_NORMAL,

      runId,
    }),

    cleanupRun({
      db,

      storeId:
        STORE_CONCURRENT,

      runId,
    }),
  ]);


  // ==========================================================================
  // CENÃRIO A â€” CONCLUSÃƒO NORMAL
  // ==========================================================================

  await createStartedLedger({
    db,

    storeId:
      STORE_NORMAL,

    scheduleIdentity,
  });


  const normalRunRef =
      getRunRef({
        db,

        storeId:
          STORE_NORMAL,

        runId,
      });


  const beforeCompletion =
      await normalRunRef.get();


  assert.strictEqual(
      beforeCompletion.data().status,
      "started",
  );


  console.log(
      "âœ… ledger normal criado como started",
  );


  // ==========================================================================
  // 4. STARTED â†’ COMPLETE
  // ==========================================================================

  const completed =
      await completeBackupRetentionScheduleRun({
        db,

        storeId:
          STORE_NORMAL,

        scheduleIdentity,

        executionId:
          EXECUTION_NORMAL,
      });


  assert.strictEqual(
      completed.action,
      COMPLETION_ACTIONS.COMPLETE,
  );


  assert.strictEqual(
      completed.allowed,
      true,
  );


  assert.strictEqual(
      completed.shouldWrite,
      true,
  );


  assert.strictEqual(
      completed.wrote,
      true,
  );


  console.log(
      "âœ… started â†’ COMPLETE + wrote=true",
  );


  // ==========================================================================
  // 5. CONFIRMA FIRESTORE
  // ==========================================================================

  const afterCompletion =
      await normalRunRef.get();


  const completedData =
      afterCompletion.data();


  assert.strictEqual(
      completedData.status,
      "completed",
  );


  assert.strictEqual(
      completedData.completedByExecutionId,
      EXECUTION_NORMAL,
  );


  assert(
      completedData.completedAt,
  );


  assert(
      completedData.updatedAt,
  );


  assert.strictEqual(
      completedData.lastError,
      null,
  );


  assert.strictEqual(
      completedData.storeId,
      STORE_NORMAL,
  );


  assert.strictEqual(
      completedData.runId,
      runId,
  );


  assert.strictEqual(
      completedData.freshBudgetGranted,
      true,
  );


  assert.strictEqual(
      completedData.freshBudgetMax,
      1,
  );


  console.log(
      "âœ… ledger persistido como completed e Ã­ntegro",
  );


  // ==========================================================================
  // 6. RETRY APÃ“S COMPLETED
  // ==========================================================================

  const retry =
      await completeBackupRetentionScheduleRun({
        db,

        storeId:
          STORE_NORMAL,

        scheduleIdentity,

        executionId:
          EXECUTION_RETRY,
      });


  assert.strictEqual(
      retry.action,
      COMPLETION_ACTIONS.ALREADY_COMPLETED,
  );


  assert.strictEqual(
      retry.allowed,
      true,
  );


  assert.strictEqual(
      retry.shouldWrite,
      false,
  );


  assert.strictEqual(
      retry.wrote,
      false,
  );


  const afterRetry =
      await normalRunRef.get();


  assert.deepStrictEqual(
      afterRetry.data(),
      completedData,
  );


  console.log(
      "âœ… retry â†’ ALREADY_COMPLETED + zero write",
  );


  // ==========================================================================
  // CENÃRIO B â€” CONCORRÃŠNCIA
  // ==========================================================================

  await createStartedLedger({
    db,

    storeId:
      STORE_CONCURRENT,

    scheduleIdentity,
  });


  const concurrentRunRef =
      getRunRef({
        db,

        storeId:
          STORE_CONCURRENT,

        runId,
      });


  const concurrentBefore =
      await concurrentRunRef.get();


  assert.strictEqual(
      concurrentBefore.data().status,
      "started",
  );


  console.log(
      "âœ… ledger concorrente preparado como started",
  );


  // ==========================================================================
  // 7. DUAS CONCLUSÃ•ES AO MESMO TEMPO
  // ==========================================================================

  console.log(
      "ðŸ§ª iniciando duas conclusÃµes concorrentes...",
  );


  const concurrentResults =
      await Promise.all([
        completeBackupRetentionScheduleRun({
          db,

          storeId:
            STORE_CONCURRENT,

          scheduleIdentity,

          executionId:
            EXECUTION_A,
        }),

        completeBackupRetentionScheduleRun({
          db,

          storeId:
            STORE_CONCURRENT,

          scheduleIdentity,

          executionId:
            EXECUTION_B,
        }),
      ]);


  const completes =
      concurrentResults.filter(
          (result) =>
            result.action ===
              COMPLETION_ACTIONS.COMPLETE,
      );


  const alreadyCompleted =
      concurrentResults.filter(
          (result) =>
            result.action ===
              COMPLETION_ACTIONS.ALREADY_COMPLETED,
      );


  assert.strictEqual(
      completes.length,
      1,
  );


  assert.strictEqual(
      alreadyCompleted.length,
      1,
  );


  assert.strictEqual(
      completes[0].wrote,
      true,
  );


  assert.strictEqual(
      alreadyCompleted[0].wrote,
      false,
  );


  console.log(
      "âœ… concorrÃªncia â†’ exatamente 1 COMPLETE + 1 ALREADY_COMPLETED",
  );


  // ==========================================================================
  // 8. LEDGER FINAL
  // ==========================================================================

  const concurrentAfter =
      await concurrentRunRef.get();


  const concurrentData =
      concurrentAfter.data();


  assert.strictEqual(
      concurrentData.status,
      "completed",
  );


  assert(
      concurrentData.completedAt,
  );


  assert(
      concurrentData.updatedAt,
  );


  assert(
      (
        concurrentData.completedByExecutionId ===
          EXECUTION_A ||
        concurrentData.completedByExecutionId ===
          EXECUTION_B
      ),
  );


  assert.strictEqual(
      concurrentData.freshBudgetGranted,
      true,
  );


  assert.strictEqual(
      concurrentData.freshBudgetMax,
      1,
  );


  console.log(
      "âœ… ledger concorrente terminou completed e Ã­ntegro",
  );


  // ==========================================================================
  // 9. EXATAMENTE UM DOCUMENTO
  // ==========================================================================

  const runsSnapshot =
      await db
          .collection(
              "storeBackups",
          )
          .doc(
              STORE_CONCURRENT,
          )
          .collection(
              "retentionScheduleRuns",
          )
          .get();


  assert.strictEqual(
      runsSnapshot.size,
      1,
  );


  console.log(
      "âœ… existe exatamente um ledger persistente",
  );


  // ==========================================================================
  // FINAL
  // ==========================================================================

  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… CONCLUSÃƒO DO LEDGER + CONCORRÃŠNCIA PASSARAM",
  );

  console.log(
      "============================================================",
  );

  console.log("");
}


// ============================================================================
// EXECUÃ‡ÃƒO
// ============================================================================

run().catch(
    (error) => {
      console.error(
          "âŒ TESTE FALHOU:",
          error,
      );

      process.exitCode =
          1;
    },
);