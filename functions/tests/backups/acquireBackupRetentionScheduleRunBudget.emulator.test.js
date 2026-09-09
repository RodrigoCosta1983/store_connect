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
  ACTIONS,
} = require(
    "../../backups/backupRetentionScheduleRunPlanner",
);

const {
  getRetentionScheduleEventIdentity,
} = require(
    "../../backups/backupRetentionScheduleEvent",
);


// ============================================================================
// F5.6-D3-G9.6-D8
// LEDGER DO SCHEDULER â€” FIRESTORE EMULATOR + CONCORRÃŠNCIA
// ============================================================================
//
// Prova:
//
// âœ… primeira chamada â†’ GRANT_FRESH_BUDGET;
// âœ… ledger Ã© criado antes da execuÃ§Ã£o destrutiva;
// âœ… retry do mesmo evento â†’ RESUME_ONLY;
// âœ… retry recebe maxFreshDeletes=0;
// âœ… retry nÃ£o escreve novamente;
// âœ… duas chamadas concorrentes â†’ somente um GRANT;
// âœ… concorrente perdedor â†’ RESUME_ONLY;
// âœ… existe exatamente um ledger.
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
    "emulator-g9-ledger-normal";

const STORE_CONCURRENT =
    "emulator-g9-ledger-concurrent";

const JOB_NAME =
    "firebase-schedule-scheduledBackupRetention-us-central1";

const SCHEDULE_TIME =
    "2026-09-09T07:00:00.000Z";


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


// ============================================================================
// TESTE
// ============================================================================

async function run() {
  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "F5.6-D3-G9.6-D8 â€” LEDGER DO SCHEDULER NO FIRESTORE",
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
  // 2. IDENTIDADE DETERMINÃSTICA
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
  // CENÃRIO A â€” PRIMEIRA CHAMADA
  // ==========================================================================

  const first =
      await acquireBackupRetentionScheduleRunBudget({
        db,

        storeId:
          STORE_NORMAL,

        scheduleIdentity,

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
      first.wrote,
      true,
  );


  console.log(
      "âœ… primeira tentativa â†’ GRANT_FRESH_BUDGET + wrote=true",
  );


  // ==========================================================================
  // 4. LEDGER REAL CRIADO
  // ==========================================================================

  const normalRunRef =
      getRunRef({
        db,

        storeId:
          STORE_NORMAL,

        runId,
      });


  const normalRunDoc =
      await normalRunRef.get();


  assert.strictEqual(
      normalRunDoc.exists,
      true,
  );


  const normalData =
      normalRunDoc.data();


  assert.strictEqual(
      normalData.version,
      1,
  );


  assert.strictEqual(
      normalData.storeId,
      STORE_NORMAL,
  );


  assert.strictEqual(
      normalData.runId,
      runId,
  );


  assert.strictEqual(
      normalData.status,
      "started",
  );


  assert.strictEqual(
      normalData.scheduleTime,
      scheduleIdentity.scheduleTime,
  );


  assert.strictEqual(
      normalData.jobName,
      scheduleIdentity.jobName,
  );


  assert.strictEqual(
      normalData.identityHashSha256,
      scheduleIdentity.identityHashSha256,
  );


  assert.strictEqual(
      normalData.freshBudgetGranted,
      true,
  );


  assert.strictEqual(
      normalData.freshBudgetMax,
      1,
  );


  assert(
      normalData.createdAt,
  );


  assert(
      normalData.updatedAt,
  );


  assert.strictEqual(
      normalData.completedAt,
      null,
  );


  assert.strictEqual(
      normalData.lastError,
      null,
  );


  console.log(
      "âœ… ledger persistido corretamente antes da execuÃ§Ã£o destrutiva",
  );


  // ==========================================================================
  // 5. RETRY DO MESMO EVENTO
  // ==========================================================================

  const retry =
      await acquireBackupRetentionScheduleRunBudget({
        db,

        storeId:
          STORE_NORMAL,

        scheduleIdentity,

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
      retry.wrote,
      false,
  );


  console.log(
      "âœ… retry â†’ RESUME_ONLY + maxFreshDeletes=0 + zero write",
  );


  // ==========================================================================
  // 6. LEDGER NÃƒO DEVE TER SIDO ALTERADO PELO RETRY
  // ==========================================================================

  const normalAfterRetry =
      await normalRunRef.get();


  assert.deepStrictEqual(
      normalAfterRetry.data(),
      normalData,
  );


  console.log(
      "âœ… retry preservou o ledger sem qualquer alteraÃ§Ã£o",
  );


  // ==========================================================================
  // CENÃRIO B â€” CONCORRÃŠNCIA REAL
  // ==========================================================================

  console.log(
      "ðŸ§ª iniciando duas transactions concorrentes...",
  );


  const concurrentResults =
      await Promise.all([
        acquireBackupRetentionScheduleRunBudget({
          db,

          storeId:
            STORE_CONCURRENT,

          scheduleIdentity,

          maxFreshDeletes:
            1,
        }),

        acquireBackupRetentionScheduleRunBudget({
          db,

          storeId:
            STORE_CONCURRENT,

          scheduleIdentity,

          maxFreshDeletes:
            1,
        }),
      ]);


  // ==========================================================================
  // 7. SOMENTE UM GRANT
  // ==========================================================================

  const grants =
      concurrentResults.filter(
          (result) =>
            result.action ===
              ACTIONS.GRANT_FRESH_BUDGET,
      );


  const resumes =
      concurrentResults.filter(
          (result) =>
            result.action ===
              ACTIONS.RESUME_ONLY,
      );


  assert.strictEqual(
      grants.length,
      1,
  );


  assert.strictEqual(
      resumes.length,
      1,
  );


  assert.strictEqual(
      grants[0].maxFreshDeletes,
      1,
  );


  assert.strictEqual(
      grants[0].wrote,
      true,
  );


  assert.strictEqual(
      resumes[0].maxFreshDeletes,
      0,
  );


  assert.strictEqual(
      resumes[0].wrote,
      false,
  );


  console.log(
      "âœ… concorrÃªncia â†’ exatamente 1 GRANT + 1 RESUME_ONLY",
  );


  // ==========================================================================
  // 8. EXISTE EXATAMENTE UM LEDGER
  // ==========================================================================

  const concurrentRunRef =
      getRunRef({
        db,

        storeId:
          STORE_CONCURRENT,

        runId,
      });


  const concurrentRunDoc =
      await concurrentRunRef.get();


  assert.strictEqual(
      concurrentRunDoc.exists,
      true,
  );


  const concurrentData =
      concurrentRunDoc.data();


  assert.strictEqual(
      concurrentData.storeId,
      STORE_CONCURRENT,
  );


  assert.strictEqual(
      concurrentData.runId,
      runId,
  );


  assert.strictEqual(
      concurrentData.status,
      "started",
  );


  assert.strictEqual(
      concurrentData.freshBudgetGranted,
      true,
  );


  assert.strictEqual(
      concurrentData.freshBudgetMax,
      1,
  );


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
      "âœ… LEDGER + CONCORRÃŠNCIA PASSARAM NO FIRESTORE EMULATOR",
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