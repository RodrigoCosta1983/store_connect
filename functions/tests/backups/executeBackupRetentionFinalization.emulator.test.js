"use strict";


const assert =
    require("assert");

const admin =
    require("firebase-admin");

const {
  executeBackupRetentionFinalization,
} = require(
    "../../backups/executeBackupRetentionFinalization",
);

const {
  ACTIONS:
    FINALIZE_ACTIONS,

  getAuditId,
} = require(
    "../../backups/backupRetentionFinalizePlanner",
);

const {
  ACTIONS:
    INSPECTION_ACTIONS,
} = require(
    "../../backups/inspectBackupRetentionStorageArtifact",
);


// ============================================================================
// F5.6-D3-G7.4
// STORAGE REAL â†’ FINALIZAÃ‡ÃƒO REAL NOS EMULATORS
// ============================================================================
//
// âœ… Firestore Emulator
// âœ… Storage Emulator
// âœ… inspector real
// âœ… transaction final real
// âœ… audit real
// âœ… delete metadata real
// âœ… completed real
// âœ… retry idempotente
//
// âŒ sem produÃ§Ã£o
// âŒ sem Scheduler
//
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
    "emulator-g7-storage-finalization";

const BACKUP_ID =
    "backup-g7-storage-finalization";

const EXECUTION_ID =
    "worker-g7-storage-finalization";

const NOW =
    "2026-09-30T12:00:00.000Z";

const VALID_CHECKSUM =
    "a".repeat(64);

const STORAGE_PATH =
    (
      `store_backups/` +
      `${STORE_ID}/` +
      `${BACKUP_ID}/` +
      `snapshot.json.gz`
    );

const AUDIT_ID =
    getAuditId(
        BACKUP_ID,
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


function createSnapshot() {
  return {
    storeId:
      STORE_ID,

    type:
      "automatic",

    status:
      "deleting",

    createdAt:
      timestamp(
          "2026-01-01T12:00:00.000Z",
      ),

    storagePath:
      STORAGE_PATH,

    checksumSha256:
      VALID_CHECKSUM,

    retentionDeleteOperationId:
      BACKUP_ID,

    retentionDeleteReason:
      "retention_policy",

    retentionDeleteStartedAt:
      timestamp(
          "2026-09-30T11:45:00.000Z",
      ),
  };
}


function createOperation() {
  return {
    version:
      1,

    storeId:
      STORE_ID,

    backupId:
      BACKUP_ID,

    status:
      "storage_deleted",

    reason:
      "retention_policy",

    snapshot: {
      type:
        "automatic",

      originalStatus:
        "ready",

      createdAt:
        timestamp(
            "2026-01-01T12:00:00.000Z",
        ),

      storagePath:
        STORAGE_PATH,

      checksum:
        VALID_CHECKSUM,

      compressedBytes:
        123456,
    },

    createdAt:
      timestamp(
          "2026-09-30T11:40:00.000Z",
      ),

    updatedAt:
      timestamp(
          "2026-09-30T11:55:00.000Z",
      ),

    claimedAt:
      timestamp(
          "2026-09-30T11:45:00.000Z",
      ),

    storageDeletedAt:
      timestamp(
          "2026-09-30T11:55:00.000Z",
      ),

    completedAt:
      null,

    blockedAt:
      null,

    attemptCount:
      1,

    lastAttemptAt:
      timestamp(
          "2026-09-30T11:55:00.000Z",
      ),

    lastError:
      null,

    leaseOwner:
      EXECUTION_ID,

    leaseAcquiredAt:
      timestamp(
          "2026-09-30T11:45:00.000Z",
      ),

    leaseExpiresAt:
      timestamp(
          "2026-09-30T12:15:00.000Z",
      ),
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
      "F5.6-D3-G7.4 â€” STORAGE â†’ FINALIZAÃ‡ÃƒO NOS EMULATORS",
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


  const snapshotRef =
      storeBackupsRef
          .collection(
              "snapshots",
          )
          .doc(
              BACKUP_ID,
          );


  const operationRef =
      storeBackupsRef
          .collection(
              "retentionDeletes",
          )
          .doc(
              BACKUP_ID,
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


  const file =
      bucket.file(
          STORAGE_PATH,
      );


  // ==========================================================================
  // 3. LIMPA FIXTURE ANTERIOR
  // ==========================================================================

  await Promise.all([
    snapshotRef.delete(),
    operationRef.delete(),
    auditRef.delete(),

    file.delete({
      ignoreNotFound:
        true,
    }),
  ]);


  // ==========================================================================
  // 4. PREPARA storage_deleted
  // ==========================================================================

  await snapshotRef.set(
      createSnapshot(),
  );


  await operationRef.set(
      createOperation(),
  );


  await assertStorageMissing(
      file,
  );


  console.log(
      "âœ… estado preparado: storage_deleted + snapshot deleting",
  );


  console.log(
      "âœ… artefato fisicamente ausente no Storage Emulator",
  );


  // ==========================================================================
  // 5. EXECUTA FINALIZAÃ‡ÃƒO
  // ==========================================================================

  const result =
      await executeBackupRetentionFinalization({
        db,

        bucket,

        storeId:
          STORE_ID,

        backupId:
          BACKUP_ID,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assert.strictEqual(
      result.stage,
      "finalize",
  );


  assert.strictEqual(
      result.storageInspection.action,
      INSPECTION_ACTIONS
          .ARTIFACT_ALREADY_MISSING,
  );


  assert.strictEqual(
      result.storageInspection.allowed,
      true,
  );


  assert.strictEqual(
      result.action,
      FINALIZE_ACTIONS
          .FINALIZE_ALLOWED,
  );


  assert.strictEqual(
      result.allowed,
      true,
  );


  assert.strictEqual(
      result.wrote,
      true,
  );


  console.log(
      "âœ… inspector real confirmou ARTIFACT_ALREADY_MISSING",
  );


  console.log(
      "âœ… transaction final retornou FINALIZE_ALLOWED",
  );


  // ==========================================================================
  // 6. CONFIRMA ESTADO FINAL
  // ==========================================================================

  const [
    snapshotAfter,
    operationAfter,
    auditAfter,
  ] =
      await Promise.all([
        snapshotRef.get(),
        operationRef.get(),
        auditRef.get(),
      ]);


  assert.strictEqual(
      snapshotAfter.exists,
      false,
  );


  assert.strictEqual(
      operationAfter.exists,
      true,
  );


  assert.strictEqual(
      auditAfter.exists,
      true,
  );


  const operationData =
      operationAfter.data();

  const auditData =
      auditAfter.data();


  assert.strictEqual(
      operationData.status,
      "completed",
  );


  assert(
      operationData.completedAt &&
      typeof operationData
          .completedAt
          .toDate ===
        "function",
  );


  assert.strictEqual(
      auditData.action,
      "store_backup_retention_deleted",
  );


  assert.strictEqual(
      auditData.backupId,
      BACKUP_ID,
  );


  assert.strictEqual(
      auditData.before.storagePath,
      STORAGE_PATH,
  );


  assert.strictEqual(
      auditData.before.checksumSha256,
      VALID_CHECKSUM,
  );


  await assertStorageMissing(
      file,
  );


  console.log(
      "âœ… snapshot metadata removida",
  );


  console.log(
      "âœ… operation persistida como completed",
  );


  console.log(
      "âœ… auditoria determinÃ­stica criada",
  );


  console.log(
      "âœ… Storage permaneceu fisicamente ausente",
  );


  // ==========================================================================
  // 7. GUARDA TIMESTAMPS
  // ==========================================================================

  const completedAtBeforeRetry =
      operationData.completedAt;

  const updatedAtBeforeRetry =
      operationData.updatedAt;

  const auditCreatedAtBeforeRetry =
      auditData.createdAt;


  // ==========================================================================
  // 8. RETRY DO EXECUTOR
  // ==========================================================================

  const retry =
      await executeBackupRetentionFinalization({
        db,

        bucket,

        storeId:
          STORE_ID,

        backupId:
          BACKUP_ID,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assert.strictEqual(
      retry.stage,
      "finalize",
  );


  assert.strictEqual(
      retry.action,
      FINALIZE_ACTIONS
          .ALREADY_COMPLETED,
  );


  assert.strictEqual(
      retry.wrote,
      false,
  );


  console.log(
      "âœ… retry â†’ ALREADY_COMPLETED",
  );


  // ==========================================================================
  // 9. PROVA ZERO NOVA ESCRITA
  // ==========================================================================

  const [
    operationAfterRetry,
    auditAfterRetry,
    snapshotAfterRetry,
  ] =
      await Promise.all([
        operationRef.get(),
        auditRef.get(),
        snapshotRef.get(),
      ]);


  const operationRetryData =
      operationAfterRetry.data();

  const auditRetryData =
      auditAfterRetry.data();


  assert(
      operationRetryData
          .completedAt
          .isEqual(
              completedAtBeforeRetry,
          ),
  );


  assert(
      operationRetryData
          .updatedAt
          .isEqual(
              updatedAtBeforeRetry,
          ),
  );


  assert(
      auditRetryData
          .createdAt
          .isEqual(
              auditCreatedAtBeforeRetry,
          ),
  );


  assert.strictEqual(
      snapshotAfterRetry.exists,
      false,
  );


  await assertStorageMissing(
      file,
  );


  console.log(
      "âœ… retry gerou zero nova escrita",
  );


  console.log(
      "âœ… continua exatamente uma auditoria e nenhum snapshot",
  );


  // ==========================================================================
  // FINAL
  // ==========================================================================

  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… STORAGE â†’ FINALIZAÃ‡ÃƒO INTEGRADA PASSOU",
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