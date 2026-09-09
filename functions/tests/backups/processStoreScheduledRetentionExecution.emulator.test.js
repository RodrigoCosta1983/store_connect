"use strict";


const assert =
    require("assert");

const admin =
    require("firebase-admin");

const {
  processStoreScheduledRetentionExecution,
} = require(
    "../../backups/processStoreScheduledRetentionExecution",
);

const {
  getRetentionScheduleEventIdentity,
} = require(
    "../../backups/backupRetentionScheduleEvent",
);

const {
  ACTIONS:
    RUN_ACTIONS,
} = require(
    "../../backups/backupRetentionScheduleRunPlanner",
);

const {
  ACTIONS:
    COMPLETION_ACTIONS,
} = require(
    "../../backups/backupRetentionScheduleRunCompletionPlanner",
);

const {
  getAuditId,
} = require(
    "../../backups/backupRetentionFinalizePlanner",
);


// ============================================================================
// F5.6-D3-G9.6-D14
// RETRY REAL DA LOJA PROTEGIDO PELO LEDGER
// FIRESTORE + STORAGE EMULATOR
// ============================================================================
//
// Prova:
//
// PRIMEIRA EXECUÃ‡ÃƒO DO EVENTO:
//
// âœ… ledger inexistente;
// âœ… GRANT_FRESH_BUDGET;
// âœ… budget = 1;
// âœ… exatamente 1 fresh delete;
// âœ… operaÃ§Ã£o completed;
// âœ… Storage removido;
// âœ… auditoria criada;
// âœ… ledger completed.
//
// RETRY DO MESMO EVENTO:
//
// âœ… mesmo runId;
// âœ… RESUME_ONLY;
// âœ… budget = 0;
// âœ… ainda existem candidatos fresh;
// âœ… ZERO novos fresh deletes;
// âœ… nenhuma segunda retentionDelete;
// âœ… nenhum segundo audit;
// âœ… nenhum segundo artefato removido;
// âœ… ledger permanece completed;
// âœ… conclusÃ£o â†’ ALREADY_COMPLETED.
//
// ============================================================================


// ============================================================================
// CONFIGURAÃ‡ÃƒO
// ============================================================================

const EXPECTED_FIRESTORE_HOST =
    "127.0.0.1:8080";

const EXPECTED_STORAGE_HOST =
    "127.0.0.1:9199";

const PROJECT_ID =
    "store-connect-app";

const BUCKET_NAME =
    "store-connect-app.firebasestorage.app";

const STORE_ID =
    "emulator-g9-scheduled-store-retry";

const TOTAL_SNAPSHOTS =
    12;

const FIRST_TARGET_BACKUP_ID =
    "backup-g9-scheduled-retry-00";

const EXECUTION_FIRST =
    "worker-g9-scheduled-first";

const EXECUTION_RETRY =
    "worker-g9-scheduled-retry";

const JOB_NAME =
    "firebase-schedule-scheduledBackupRetention-us-central1";

const SCHEDULE_TIME =
    "2026-09-09T07:00:00.000Z";

const VALID_CHECKSUM =
    "d".repeat(64);

const DAILY_RUN_ID =
    "2026-01-05";

const NOW_FIRST =
    new Date(
        "2026-09-30T12:00:00.000Z",
    );

const NOW_RETRY =
    new Date(
        "2026-09-30T12:05:00.000Z",
    );


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

  const storageHost =
      String(
          process.env
              .FIREBASE_STORAGE_EMULATOR_HOST ||
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


  if (
    storageHost !==
      EXPECTED_STORAGE_HOST
  ) {
    throw new Error(
        (
          "SEGURANÃ‡A: FIREBASE_STORAGE_EMULATOR_HOST deve ser " +
          `${EXPECTED_STORAGE_HOST}. Atual: "${storageHost}".`
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

      storageBucket:
        BUCKET_NAME,
    });
  }


  return {
    db:
      admin.firestore(),

    bucket:
      admin
          .storage()
          .bucket(
              BUCKET_NAME,
          ),
  };
}


// ============================================================================
// HELPERS
// ============================================================================

function timestamp(
    value,
) {
  return admin.firestore
      .Timestamp
      .fromDate(
          new Date(
              value,
          ),
      );
}


function getBackupId(
    index,
) {
  return (
    `backup-g9-scheduled-retry-` +
    `${String(index).padStart(2, "0")}`
  );
}


function getStoragePath(
    backupId,
) {
  return (
    `store_backups/` +
    `${STORE_ID}/` +
    `${backupId}/` +
    `snapshot.json.gz`
  );
}


function createReadySnapshot({
  backupId,
  index,
}) {
  return {
    storeId:
      STORE_ID,

    type:
      "automatic",

    status:
      "ready",

    createdAt:
      timestamp(
          (
            "2026-01-05T12:" +
            `${String(index).padStart(2, "0")}:00.000Z`
          ),
      ),

    createdBy:
      "system",

    createdByRole:
      "system",

    reason:
      "Backup automÃ¡tico diÃ¡rio",

    snapshotVersion:
      1,

    storagePath:
      getStoragePath(
          backupId,
      ),

    counts: {
      products:
        1,

      customers:
        0,

      categories:
        1,

      sales:
        0,

      cashFlow:
        0,
    },

    originalSizeBytes:
      1000,

    compressedSizeBytes:
      500,

    checksumSha256:
      VALID_CHECKSUM,
  };
}


function isNotFoundError(
    error,
) {
  const code =
      String(
          error?.code ??
          "",
      ).toLowerCase();

  const message =
      String(
          error?.message ??
          "",
      ).toLowerCase();


  return (
    code === "404" ||
    code === "not-found" ||
    code === "storage/object-not-found" ||
    message.includes(
        "not found",
    )
  );
}


async function storageExists(
    file,
) {
  try {
    await file.getMetadata();

    return true;
  } catch (error) {
    if (
      isNotFoundError(
          error,
      )
    ) {
      return false;
    }

    throw error;
  }
}


async function deleteCollectionDocs(
    collectionRef,
) {
  const snapshot =
      await collectionRef.get();


  if (
    snapshot.empty
  ) {
    return;
  }


  const batch =
      collectionRef
          .firestore
          .batch();


  for (
    const doc
    of snapshot.docs
  ) {
    batch.delete(
        doc.ref,
    );
  }


  await batch.commit();
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
      "F5.6-D3-G9.6-D14 â€” RETRY REAL PROTEGIDO PELO LEDGER",
  );

  console.log(
      "============================================================",
  );


  // ==========================================================================
  // 1. TRAVAS
  // ==========================================================================

  assertEmulatorEnvironment();


  console.log(
      "âœ… travas confirmaram Firestore + Storage Emulator",
  );


  const {
    db,
    bucket,
  } =
      initializeFirebase();


  // ==========================================================================
  // 2. IDENTIDADE DO EVENTO
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
  // 3. REFERÃŠNCIAS
  // ==========================================================================

  const storeBackupRef =
      db
          .collection(
              "storeBackups",
          )
          .doc(
              STORE_ID,
          );


  const snapshotsRef =
      storeBackupRef
          .collection(
              "snapshots",
          );


  const operationsRef =
      storeBackupRef
          .collection(
              "retentionDeletes",
          );


  const scheduleRunsRef =
      storeBackupRef
          .collection(
              "retentionScheduleRuns",
          );


  const scheduleRunRef =
      scheduleRunsRef
          .doc(
              runId,
          );


  const dailyRunsRef =
      storeBackupRef
          .collection(
              "dailyRuns",
          );


  const dailyRunRef =
      dailyRunsRef
          .doc(
              DAILY_RUN_ID,
          );


  const auditLogsRef =
      db
          .collection(
              "stores",
          )
          .doc(
              STORE_ID,
          )
          .collection(
              "auditLogs",
          );


  // ==========================================================================
  // 4. LIMPEZA
  // ==========================================================================

  await Promise.all([
    deleteCollectionDocs(
        snapshotsRef,
    ),

    deleteCollectionDocs(
        operationsRef,
    ),

    deleteCollectionDocs(
        scheduleRunsRef,
    ),

    deleteCollectionDocs(
        dailyRunsRef,
    ),

    deleteCollectionDocs(
        auditLogsRef,
    ),
  ]);


  for (
    let index = 0;
    index < TOTAL_SNAPSHOTS;
    index++
  ) {
    const backupId =
        getBackupId(
            index,
        );


    await bucket
        .file(
            getStoragePath(
                backupId,
            ),
        )
        .delete({
          ignoreNotFound:
            true,
        });
  }


  // ==========================================================================
  // 5. FIXTURES
  // ==========================================================================

  for (
    let index = 0;
    index < TOTAL_SNAPSHOTS;
    index++
  ) {
    const backupId =
        getBackupId(
            index,
        );


    await snapshotsRef
        .doc(
            backupId,
        )
        .set(
            createReadySnapshot({
              backupId,
              index,
            }),
        );


    await bucket
        .file(
            getStoragePath(
                backupId,
            ),
        )
        .save(
            Buffer.from(
                `G9 SCHEDULE RETRY ${backupId}`,
                "utf8",
            ),
            {
              resumable:
                false,

              metadata: {
                contentType:
                  "application/gzip",

                metadata: {
                  storeId:
                    STORE_ID,

                  backupId,

                  snapshotVersion:
                    "1",

                  checksumSha256:
                    VALID_CHECKSUM,
                },
              },
            },
        );
  }


  console.log(
      "âœ… 12 snapshots ready + 12 artefatos reais criados",
  );


  const dailyRunFixture = {
    status:
      "completed",

    backupId:
      "backup-sentinela",

    marker:
      "g9-scheduled-retry",

    success:
      true,
  };


  await dailyRunRef.set(
      dailyRunFixture,
  );


  // ==========================================================================
  // PRIMEIRA EXECUÃ‡ÃƒO
  // ==========================================================================

  const first =
      await processStoreScheduledRetentionExecution({
        db,

        bucket,

        storeId:
          STORE_ID,

        scheduleIdentity,

        executionId:
          EXECUTION_FIRST,

        maxFreshDeletes:
          1,

        now:
          NOW_FIRST,
      });


  // ==========================================================================
  // 6. PRIMEIRA EXECUÃ‡ÃƒO RECEBE BUDGET
  // ==========================================================================

  assert.strictEqual(
      first.scheduleRunBudgetAction,
      RUN_ACTIONS.GRANT_FRESH_BUDGET,
  );


  assert.strictEqual(
      first.scheduleRunFreshBudget,
      1,
  );


  assert.strictEqual(
      first.scheduleRunLedgerCreated,
      true,
  );


  assert.strictEqual(
      first.freshSelected,
      1,
  );


  assert.strictEqual(
      first.freshCompleted,
      1,
  );


  assert.strictEqual(
      first.errorCount,
      0,
  );


  assert.strictEqual(
      first.scheduleRunCompleted,
      true,
  );


  assert.strictEqual(
      first.scheduleRunCompletionAction,
      COMPLETION_ACTIONS.COMPLETE,
  );


  console.log(
      "âœ… primeira execuÃ§Ã£o â†’ budget 1 + exatamente 1 fresh delete",
  );


  // ==========================================================================
  // 7. TARGET FOI FINALIZADO
  // ==========================================================================

  const firstTargetSnapshot =
      await snapshotsRef
          .doc(
              FIRST_TARGET_BACKUP_ID,
          )
          .get();


  const firstTargetOperation =
      await operationsRef
          .doc(
              FIRST_TARGET_BACKUP_ID,
          )
          .get();


  const firstTargetAudit =
      await auditLogsRef
          .doc(
              getAuditId(
                  FIRST_TARGET_BACKUP_ID,
              ),
          )
          .get();


  assert.strictEqual(
      firstTargetSnapshot.exists,
      false,
  );


  assert.strictEqual(
      firstTargetOperation.exists,
      true,
  );


  assert.strictEqual(
      firstTargetOperation.data().status,
      "completed",
  );


  assert.strictEqual(
      firstTargetAudit.exists,
      true,
  );


  assert.strictEqual(
      await storageExists(
          bucket.file(
              getStoragePath(
                  FIRST_TARGET_BACKUP_ID,
              ),
          ),
      ),
      false,
  );


  console.log(
      "âœ… primeiro candidato foi removido e finalizado corretamente",
  );


  // ==========================================================================
  // 8. LEDGER COMPLETED
  // ==========================================================================

  const ledgerAfterFirst =
      await scheduleRunRef.get();


  assert.strictEqual(
      ledgerAfterFirst.exists,
      true,
  );


  const ledgerFirstData =
      ledgerAfterFirst.data();


  assert.strictEqual(
      ledgerFirstData.status,
      "completed",
  );


  assert.strictEqual(
      ledgerFirstData.freshBudgetGranted,
      true,
  );


  assert.strictEqual(
      ledgerFirstData.freshBudgetMax,
      1,
  );


  assert.strictEqual(
      ledgerFirstData.completedByExecutionId,
      EXECUTION_FIRST,
  );


  console.log(
      "âœ… ledger da ocorrÃªncia terminou completed",
  );


  // ==========================================================================
  // 9. ESTADO ANTES DO RETRY
  // ==========================================================================

  const snapshotsBeforeRetry =
      await snapshotsRef.get();


  const operationsBeforeRetry =
      await operationsRef.get();


  const auditsBeforeRetry =
      await auditLogsRef.get();


  assert.strictEqual(
      snapshotsBeforeRetry.size,
      11,
  );


  assert.strictEqual(
      operationsBeforeRetry.size,
      1,
  );


  assert.strictEqual(
      auditsBeforeRetry.size,
      1,
  );


  console.log(
      "âœ… antes do retry ainda existem 11 snapshots e candidatos pendentes",
  );


  // ==========================================================================
  // RETRY DO MESMO EVENTO
  // ==========================================================================

  const retry =
      await processStoreScheduledRetentionExecution({
        db,

        bucket,

        storeId:
          STORE_ID,

        scheduleIdentity,

        executionId:
          EXECUTION_RETRY,

        maxFreshDeletes:
          1,

        now:
          NOW_RETRY,
      });


  // ==========================================================================
  // 10. RETRY RECEBE ZERO FRESH BUDGET
  // ==========================================================================

  assert.strictEqual(
      retry.scheduleRunBudgetAction,
      RUN_ACTIONS.RESUME_ONLY,
  );


  assert.strictEqual(
      retry.scheduleRunFreshBudget,
      0,
  );


  assert.strictEqual(
      retry.scheduleRunLedgerCreated,
      false,
  );


  assert.strictEqual(
      retry.freshSelected,
      0,
  );


  assert.strictEqual(
      retry.freshCompleted,
      0,
  );


  assert(
      retry.freshDeferred >
        0,
      "O retry deveria encontrar candidatos fresh deferred.",
  );


  assert.strictEqual(
      retry.errorCount,
      0,
  );


  assert.strictEqual(
      retry.scheduleRunCompleted,
      true,
  );


  assert.strictEqual(
      retry.scheduleRunCompletionAction,
      COMPLETION_ACTIONS.ALREADY_COMPLETED,
  );


  console.log(
      "âœ… retry â†’ RESUME_ONLY + budget 0 + ZERO novos deletes",
  );


  // ==========================================================================
  // 11. NADA MAIS FOI DESTRUÃDO
  // ==========================================================================

  const snapshotsAfterRetry =
      await snapshotsRef.get();


  const operationsAfterRetry =
      await operationsRef.get();


  const auditsAfterRetry =
      await auditLogsRef.get();


  assert.strictEqual(
      snapshotsAfterRetry.size,
      11,
  );


  assert.strictEqual(
      operationsAfterRetry.size,
      1,
  );


  assert.strictEqual(
      auditsAfterRetry.size,
      1,
  );


  console.log(
      "âœ… retry nÃ£o removeu segundo snapshot/operaÃ§Ã£o/auditoria",
  );


  // ==========================================================================
  // 12. OUTROS 11 ARTEFATOS CONTINUAM NO STORAGE
  // ==========================================================================

  for (
    let index = 1;
    index < TOTAL_SNAPSHOTS;
    index++
  ) {
    const backupId =
        getBackupId(
            index,
        );


    const exists =
        await storageExists(
            bucket.file(
                getStoragePath(
                    backupId,
                ),
            ),
        );


    assert.strictEqual(
        exists,
        true,
        `Artefato ${backupId} deveria permanecer intacto.`,
    );
  }


  console.log(
      "âœ… outros 11 artefatos permaneceram intactos",
  );


  // ==========================================================================
  // 13. LEDGER NÃƒO FOI ALTERADO PELO RETRY
  // ==========================================================================

  const ledgerAfterRetry =
      await scheduleRunRef.get();


  assert.deepStrictEqual(
      ledgerAfterRetry.data(),
      ledgerFirstData,
  );


  console.log(
      "âœ… retry preservou exatamente o ledger completed original",
  );


  // ==========================================================================
  // 14. DAILY RUN
  // ==========================================================================

  const dailyRunAfter =
      await dailyRunRef.get();


  assert.deepStrictEqual(
      dailyRunAfter.data(),
      dailyRunFixture,
  );


  console.log(
      "âœ… dailyRuns permaneceu absolutamente inalterado",
  );


  // ==========================================================================
  // FINAL
  // ==========================================================================

  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… RETRY REAL PROTEGIDO PELO LEDGER PASSOU",
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