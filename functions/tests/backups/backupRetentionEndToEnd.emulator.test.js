"use strict";


const assert =
    require("assert");

const admin =
    require("firebase-admin");

const {
  calculateBackupRetention,
} = require(
    "../../backups/backupRetention",
);

const {
  claimBackupRetentionDelete,
} = require(
    "../../backups/claimBackupRetentionDelete",
);

const {
  executeBackupRetentionStorageDelete,
} = require(
    "../../backups/executeBackupRetentionStorageDelete",
);

const {
  executeBackupRetentionFinalization,
} = require(
    "../../backups/executeBackupRetentionFinalization",
);

const {
  ACTIONS:
    CLAIM_ACTIONS,
} = require(
    "../../backups/backupRetentionClaimPlanner",
);

const {
  ACTIONS:
    MARK_ACTIONS,
} = require(
    "../../backups/backupRetentionMarkStorageDeletedPlanner",
);

const {
  ACTIONS:
    STORAGE_DELETE_ACTIONS,
} = require(
    "../../backups/backupRetentionStorageDeletePlanner",
);

const {
  ACTIONS:
    FINALIZE_ACTIONS,

  getAuditId,
} = require(
    "../../backups/backupRetentionFinalizePlanner",
);


// ============================================================================
// F5.6-D3-G8.1
// END-TO-END COMPLETO DA RETENÃ‡ÃƒO â€” EMULATORS
// ============================================================================
//
// ready
//   â†“
// polÃ­tica de retenÃ§Ã£o
//   â†“
// claim
//   â†“
// deleting + claimed
//   â†“
// delete fÃ­sico Storage
//   â†“
// storage_deleted
//   â†“
// nova confirmaÃ§Ã£o de ausÃªncia
//   â†“
// audit + delete metadata + completed
//
// âœ… Firestore Emulator
// âœ… Storage Emulator
// âœ… polÃ­tica real
// âœ… validator real
// âœ… claim real
// âœ… delete real
// âœ… mark real
// âœ… finalizaÃ§Ã£o real
// âœ… retry idempotente
// âœ… dailyRuns preservado
//
// âŒ sem produÃ§Ã£o
// âŒ sem Scheduler
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
    "emulator-g8-end-to-end";

const TARGET_BACKUP_ID =
    "backup-g8-target";

const EXECUTION_ID =
    "worker-g8-end-to-end";

const NOW =
    new Date(
        "2026-09-30T12:00:00.000Z",
    );

const VALID_CHECKSUM =
    "a".repeat(64);

const TOTAL_SNAPSHOTS =
    12;

const DAILY_RUN_ID =
    "2026-01-05";

const AUDIT_ID =
    getAuditId(
        TARGET_BACKUP_ID,
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


function getBackupId(
    index,
) {
  if (
    index ===
      0
  ) {
    return TARGET_BACKUP_ID;
  }


  return (
    `backup-g8-${String(index)
        .padStart(2, "0")}`
  );
}


function getCreatedAt(
    index,
) {
  // --------------------------------------------------------------------------
  // Todos ficam no mesmo dia/semana.
  //
  // O TARGET Ã© o mais antigo.
  //
  // Isso produz mais snapshots do que a retenÃ§Ã£o diÃ¡ria/semanal precisa
  // preservar, tornando o target um candidato determinÃ­stico a delete.
  // --------------------------------------------------------------------------

  return timestamp(
      (
        "2026-01-05T12:" +
        `${String(index).padStart(2, "0")}:00.000Z`
      ),
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
      getCreatedAt(
          index,
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


async function assertStorageMissing(
    file,
) {
  try {
    await file.getMetadata();
  } catch (error) {
    if (
      isNotFoundError(
          error,
      )
    ) {
      return;
    }


    throw error;
  }


  throw new Error(
      "O artefato ainda existe no Storage Emulator.",
  );
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
      "F5.6-D3-G8.1 â€” END-TO-END COMPLETO DA RETENÃ‡ÃƒO",
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
  // 2. REFERÃŠNCIAS
  // ==========================================================================

  const storeBackupsRef =
      db
          .collection(
              "storeBackups",
          )
          .doc(
              STORE_ID,
          );


  const snapshotsRef =
      storeBackupsRef
          .collection(
              "snapshots",
          );


  const operationRef =
      storeBackupsRef
          .collection(
              "retentionDeletes",
          )
          .doc(
              TARGET_BACKUP_ID,
          );


  const dailyRunRef =
      storeBackupsRef
          .collection(
              "dailyRuns",
          )
          .doc(
              DAILY_RUN_ID,
          );


  const auditRef =
      db
          .collection(
              "stores",
          )
          .doc(
              STORE_ID,
          )
          .collection(
              "auditLogs",
          )
          .doc(
              AUDIT_ID,
          );


  const targetSnapshotRef =
      snapshotsRef
          .doc(
              TARGET_BACKUP_ID,
          );


  const targetStoragePath =
      getStoragePath(
          TARGET_BACKUP_ID,
      );


  const targetFile =
      bucket.file(
          targetStoragePath,
      );


  // ==========================================================================
  // 3. MONTA FIXTURES
  // ==========================================================================

  const snapshotFixtures =
      [];


  for (
    let index = 0;
    index < TOTAL_SNAPSHOTS;
    index++
  ) {
    const backupId =
        getBackupId(
            index,
        );


    snapshotFixtures.push({
      backupId,

      data:
        createReadySnapshot({
          backupId,
          index,
        }),
    });
  }


  // ==========================================================================
  // 4. LIMPA EXECUÃ‡ÃƒO ANTERIOR
  // ==========================================================================

  const cleanupPromises =
      snapshotFixtures.map(
          ({
            backupId,
          }) =>
            snapshotsRef
                .doc(
                    backupId,
                )
                .delete(),
      );


  cleanupPromises.push(
      operationRef.delete(),
  );


  cleanupPromises.push(
      auditRef.delete(),
  );


  cleanupPromises.push(
      dailyRunRef.delete(),
  );


  cleanupPromises.push(
      targetFile.delete({
        ignoreNotFound:
          true,
      }),
  );


  await Promise.all(
      cleanupPromises,
  );


  // ==========================================================================
  // 5. CRIA OS 12 BACKUPS READY
  // ==========================================================================

  for (
    const fixture
    of snapshotFixtures
  ) {
    await snapshotsRef
        .doc(
            fixture.backupId,
        )
        .set(
            fixture.data,
        );
  }


  console.log(
      `âœ… ${TOTAL_SNAPSHOTS} snapshots automÃ¡ticos ready criados`,
  );


  // ==========================================================================
  // 6. DAILY RUN QUE NÃƒO PODE SER ALTERADO
  // ==========================================================================

  const dailyRunFixture = {
    status:
      "completed",

    backupId:
      "historical-daily-run",

    marker:
      "must-remain-unchanged",

    success:
      true,
  };


  await dailyRunRef.set(
      dailyRunFixture,
  );


  // ==========================================================================
  // 7. CONFIRMA POLÃTICA ANTES DO CLAIM
  // ==========================================================================

  const policyInput =
      snapshotFixtures.map(
          ({
            backupId,
            data,
          }) => ({
            ...data,

            backupId,
          }),
      );


  const retentionResult =
      calculateBackupRetention(
          policyInput,
      );


  const targetIsDeleteCandidate =
      retentionResult
          .deleteCandidates
          .some(
              (backup) =>
                backup.backupId ===
                  TARGET_BACKUP_ID,
          );


  assert.strictEqual(
      targetIsDeleteCandidate,
      true,
      "O target deveria ser candidato Ã  exclusÃ£o.",
  );


  console.log(
      "âœ… polÃ­tica real classificou o target como deleteCandidate",
  );


  // ==========================================================================
  // 8. CRIA ARTEFATO FÃSICO DO TARGET
  // ==========================================================================

  await targetFile.save(
      Buffer.from(
          "STORE&CONNECT G8 END-TO-END",
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

            backupId:
              TARGET_BACKUP_ID,

            snapshotVersion:
              "1",

            checksumSha256:
              VALID_CHECKSUM,
          },
        },
      },
  );


  const [
    storageMetadata,
  ] =
      await targetFile.getMetadata();


  assert(
      typeof storageMetadata.generation ===
        "string" &&
      /^\d+$/.test(
          storageMetadata.generation,
      ),
  );


  console.log(
      (
        "âœ… artefato fÃ­sico do target criado, generation=" +
        storageMetadata.generation
      ),
  );


  // ==========================================================================
  // 9. CLAIM REAL
  // ==========================================================================

  const claim =
      await claimBackupRetentionDelete({
        db,

        storeId:
          STORE_ID,

        backupId:
          TARGET_BACKUP_ID,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assert.strictEqual(
      claim.action,
      CLAIM_ACTIONS.CREATE_CLAIM,
  );


  const [
    snapshotAfterClaim,
    operationAfterClaim,
  ] =
      await Promise.all([
        targetSnapshotRef.get(),
        operationRef.get(),
      ]);


  assert.strictEqual(
      snapshotAfterClaim.exists,
      true,
  );


  assert.strictEqual(
      snapshotAfterClaim.data().status,
      "deleting",
  );


  assert.strictEqual(
      operationAfterClaim.exists,
      true,
  );


  assert.strictEqual(
      operationAfterClaim.data().status,
      "claimed",
  );


  assert.strictEqual(
      operationAfterClaim.data().leaseOwner,
      EXECUTION_ID,
  );


  console.log(
      "âœ… claim real â†’ snapshot deleting + operation claimed",
  );


  // ==========================================================================
  // 10. DELETE FÃSICO COMPLETO
  // ==========================================================================

  const storageDelete =
      await executeBackupRetentionStorageDelete({
        db,

        bucket,

        storeId:
          STORE_ID,

        backupId:
          TARGET_BACKUP_ID,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assert.strictEqual(
      storageDelete.action,
      MARK_ACTIONS
          .MARK_STORAGE_DELETED,
  );


  assert.strictEqual(
      storageDelete.wrote,
      true,
  );


  await assertStorageMissing(
      targetFile,
  );


  const operationAfterStorageDelete =
      await operationRef.get();


  const snapshotAfterStorageDelete =
      await targetSnapshotRef.get();


  assert.strictEqual(
      operationAfterStorageDelete
          .data()
          .status,
      "storage_deleted",
  );


  assert.strictEqual(
      snapshotAfterStorageDelete.exists,
      true,
  );


  assert.strictEqual(
      snapshotAfterStorageDelete
          .data()
          .status,
      "deleting",
  );


  console.log(
      "âœ… Storage removido fisicamente",
  );


  console.log(
      "âœ… operation â†’ storage_deleted",
  );


  console.log(
      "âœ… snapshot ainda deleting antes da finalizaÃ§Ã£o",
  );


  // ==========================================================================
  // 11. FINALIZAÃ‡ÃƒO COMPLETA
  // ==========================================================================

  const finalization =
      await executeBackupRetentionFinalization({
        db,

        bucket,

        storeId:
          STORE_ID,

        backupId:
          TARGET_BACKUP_ID,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assert.strictEqual(
      finalization.action,
      FINALIZE_ACTIONS
          .FINALIZE_ALLOWED,
  );


  assert.strictEqual(
      finalization.wrote,
      true,
  );


  // ==========================================================================
  // 12. CONFIRMA ESTADO FINAL
  // ==========================================================================

  const [
    finalSnapshot,
    finalOperation,
    finalAudit,
    finalDailyRun,
  ] =
      await Promise.all([
        targetSnapshotRef.get(),
        operationRef.get(),
        auditRef.get(),
        dailyRunRef.get(),
      ]);


  assert.strictEqual(
      finalSnapshot.exists,
      false,
  );


  assert.strictEqual(
      finalOperation.exists,
      true,
  );


  assert.strictEqual(
      finalOperation.data().status,
      "completed",
  );


  assert(
      finalOperation.data().completedAt &&
      typeof finalOperation
          .data()
          .completedAt
          .toDate ===
        "function",
  );


  assert.strictEqual(
      finalAudit.exists,
      true,
  );


  assert.strictEqual(
      finalAudit.data().action,
      "store_backup_retention_deleted",
  );


  assert.strictEqual(
      finalAudit.data().backupId,
      TARGET_BACKUP_ID,
  );


  assert.strictEqual(
      finalAudit.data().before.storagePath,
      targetStoragePath,
  );


  assert.strictEqual(
      finalAudit.data().before.checksumSha256,
      VALID_CHECKSUM,
  );


  assert.strictEqual(
      finalDailyRun.exists,
      true,
  );


  assert.deepStrictEqual(
      finalDailyRun.data(),
      dailyRunFixture,
  );


  await assertStorageMissing(
      targetFile,
  );


  console.log(
      "âœ… metadata do target removida",
  );


  console.log(
      "âœ… operation â†’ completed",
  );


  console.log(
      "âœ… auditoria determinÃ­stica criada",
  );


  console.log(
      "âœ… dailyRuns permaneceu absolutamente inalterado",
  );


  // ==========================================================================
  // 13. GUARDA ESTADO PARA RETRIES
  // ==========================================================================

  const completedAtBeforeRetry =
      finalOperation
          .data()
          .completedAt;

  const updatedAtBeforeRetry =
      finalOperation
          .data()
          .updatedAt;

  const auditCreatedAtBeforeRetry =
      finalAudit
          .data()
          .createdAt;


  // ==========================================================================
  // 14. RETRY DO DELETE
  // ==========================================================================

  const retryStorageDelete =
      await executeBackupRetentionStorageDelete({
        db,

        bucket,

        storeId:
          STORE_ID,

        backupId:
          TARGET_BACKUP_ID,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assert.strictEqual(
      retryStorageDelete.stage,
      "prepare",
  );


  assert.strictEqual(
      retryStorageDelete.action,
      STORAGE_DELETE_ACTIONS
          .ALREADY_COMPLETED,
  );


  console.log(
      "âœ… retry do delete â†’ ALREADY_COMPLETED",
  );


  // ==========================================================================
  // 15. RETRY DA FINALIZAÃ‡ÃƒO
  // ==========================================================================

  const retryFinalization =
      await executeBackupRetentionFinalization({
        db,

        bucket,

        storeId:
          STORE_ID,

        backupId:
          TARGET_BACKUP_ID,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assert.strictEqual(
      retryFinalization.action,
      FINALIZE_ACTIONS
          .ALREADY_COMPLETED,
  );


  assert.strictEqual(
      retryFinalization.wrote,
      false,
  );


  console.log(
      "âœ… retry da finalizaÃ§Ã£o â†’ ALREADY_COMPLETED",
  );


  // ==========================================================================
  // 16. PROVA QUE RETRIES NÃƒO ALTERARAM NADA
  // ==========================================================================

  const [
    operationAfterRetry,
    auditAfterRetry,
    snapshotAfterRetry,
    dailyRunAfterRetry,
  ] =
      await Promise.all([
        operationRef.get(),
        auditRef.get(),
        targetSnapshotRef.get(),
        dailyRunRef.get(),
      ]);


  assert(
      operationAfterRetry
          .data()
          .completedAt
          .isEqual(
              completedAtBeforeRetry,
          ),
  );


  assert(
      operationAfterRetry
          .data()
          .updatedAt
          .isEqual(
              updatedAtBeforeRetry,
          ),
  );


  assert(
      auditAfterRetry
          .data()
          .createdAt
          .isEqual(
              auditCreatedAtBeforeRetry,
          ),
  );


  assert.strictEqual(
      snapshotAfterRetry.exists,
      false,
  );


  assert.deepStrictEqual(
      dailyRunAfterRetry.data(),
      dailyRunFixture,
  );


  await assertStorageMissing(
      targetFile,
  );


  console.log(
      "âœ… retries nÃ£o criaram segunda exclusÃ£o nem nova auditoria",
  );


  console.log(
      "âœ… estado completed permaneceu idÃªntico",
  );


  // ==========================================================================
  // FINAL
  // ==========================================================================

  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… END-TO-END COMPLETO DA RETENÃ‡ÃƒO PASSOU",
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