"use strict";


const assert =
    require("assert");

const admin =
    require("firebase-admin");

const {
  finalizeBackupRetentionDelete,
} = require(
    "../../backups/finalizeBackupRetentionDelete",
);

const {
  ACTIONS,
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
// F5.6-D3-G7.3
// TRANSACTION FINAL â€” FIRESTORE EMULATOR
// ============================================================================
//
// âœ… Firestore Emulator real
// âœ… transaction real
// âœ… audit real
// âœ… delete da metadata real
// âœ… operation â†’ completed real
// âœ… retry idempotente
//
// âŒ sem produÃ§Ã£o
// âŒ sem Scheduler
//
// A confirmaÃ§Ã£o de ausÃªncia usada aqui Ã© fixture interna controlada.
// A integraÃ§Ã£o real com o Storage serÃ¡ testada no bloco seguinte.
//
// ============================================================================


// ============================================================================
// CONFIGURAÃ‡ÃƒO
// ============================================================================

const EXPECTED_FIRESTORE_HOST =
    "127.0.0.1:8080";

const PROJECT_ID =
    "store-connect-app";

const STORE_ID =
    "emulator-g7-finalization";

const BACKUP_ID =
    "backup-g7-finalization";

const EXECUTION_ID =
    "worker-g7-finalization";

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


  if (
    firestoreHost !==
      EXPECTED_FIRESTORE_HOST
  ) {
    throw new Error(
        (
          "SEGURANÃ‡A: teste recusado. " +
          "FIRESTORE_EMULATOR_HOST deve ser " +
          `${EXPECTED_FIRESTORE_HOST}. ` +
          `Valor atual: "${firestoreHost}".`
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


  return admin.firestore();
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


function createMissingInspection() {
  return {
    action:
      INSPECTION_ACTIONS
          .ARTIFACT_ALREADY_MISSING,

    allowed:
      true,

    storeId:
      STORE_ID,

    backupId:
      BACKUP_ID,

    storagePath:
      STORAGE_PATH,

    generation:
      null,

    reasons:
      [],
  };
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
      "F5.6-D3-G7.3 â€” FINALIZAÃ‡ÃƒO NO FIRESTORE EMULATOR",
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


  const db =
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


  // ==========================================================================
  // 3. LIMPA FIXTURE ANTERIOR
  // ==========================================================================

  await Promise.all([
    snapshotRef.delete(),
    operationRef.delete(),
    auditRef.delete(),
  ]);


  // ==========================================================================
  // 4. PREPARA ESTADO
  // ==========================================================================

  await snapshotRef.set(
      createSnapshot(),
  );


  await operationRef.set(
      createOperation(),
  );


  console.log(
      "âœ… estado preparado: storage_deleted + snapshot deleting",
  );


  // ==========================================================================
  // 5. FINALIZA
  // ==========================================================================

  const result =
      await finalizeBackupRetentionDelete({
        db,

        storeId:
          STORE_ID,

        backupId:
          BACKUP_ID,

        storageInspection:
          createMissingInspection(),

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assert.strictEqual(
      result.action,
      ACTIONS.FINALIZE_ALLOWED,
  );


  assert.strictEqual(
      result.allowed,
      true,
  );


  assert.strictEqual(
      result.wrote,
      true,
  );


  assert.strictEqual(
      result.auditId,
      AUDIT_ID,
  );


  console.log(
      "âœ… transaction retornou FINALIZE_ALLOWED",
  );


  // ==========================================================================
  // 6. CONFIRMA ESTADO PERSISTIDO
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
      "completedAt deveria ser Timestamp.",
  );


  assert.strictEqual(
      operationData.lastError,
      null,
  );


  console.log(
      "âœ… snapshot metadata foi removida",
  );


  console.log(
      "âœ… operation foi persistida como completed",
  );


  // ==========================================================================
  // 7. CONFIRMA AUDITORIA
  // ==========================================================================

  assert.strictEqual(
      auditData.action,
      "store_backup_retention_deleted",
  );


  assert.strictEqual(
      auditData.entityType,
      "backup",
  );


  assert.strictEqual(
      auditData.entityId,
      BACKUP_ID,
  );


  assert.strictEqual(
      auditData.storeId,
      STORE_ID,
  );


  assert.strictEqual(
      auditData.backupId,
      BACKUP_ID,
  );


  assert.strictEqual(
      auditData.operationId,
      BACKUP_ID,
  );


  assert.strictEqual(
      auditData.performedBy.uid,
      "system",
  );


  assert.strictEqual(
      auditData.performedBy.role,
      "system",
  );


  assert.strictEqual(
      auditData.reason,
      "retention_policy",
  );


  assert.strictEqual(
      auditData.before.storagePath,
      STORAGE_PATH,
  );


  assert.strictEqual(
      auditData.before.checksumSha256,
      VALID_CHECKSUM,
  );


  assert.strictEqual(
      auditData.after.storageDeleted,
      true,
  );


  assert.strictEqual(
      auditData.after.metadataDeleted,
      true,
  );


  assert(
      auditData.createdAt &&
      typeof auditData
          .createdAt
          .toDate ===
        "function",
      "createdAt da auditoria deveria ser Timestamp.",
  );


  console.log(
      "âœ… auditoria determinÃ­stica foi criada corretamente",
  );


  // ==========================================================================
  // 8. GUARDA TIMESTAMPS PARA PROVAR RETRY SEM WRITE
  // ==========================================================================

  const completedAtBeforeRetry =
      operationData.completedAt;

  const updatedAtBeforeRetry =
      operationData.updatedAt;

  const auditCreatedAtBeforeRetry =
      auditData.createdAt;


  // ==========================================================================
  // 9. RETRY
  // ==========================================================================

  const retryResult =
      await finalizeBackupRetentionDelete({
        db,

        storeId:
          STORE_ID,

        backupId:
          BACKUP_ID,

        storageInspection:
          null,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assert.strictEqual(
      retryResult.action,
      ACTIONS.ALREADY_COMPLETED,
  );


  assert.strictEqual(
      retryResult.allowed,
      false,
  );


  assert.strictEqual(
      retryResult.wrote,
      false,
  );


  console.log(
      "âœ… retry â†’ ALREADY_COMPLETED",
  );


  // ==========================================================================
  // 10. CONFIRMA ZERO NOVA ESCRITA NO RETRY
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
      "Retry nÃ£o deveria alterar completedAt.",
  );


  assert(
      operationRetryData
          .updatedAt
          .isEqual(
              updatedAtBeforeRetry,
          ),
      "Retry nÃ£o deveria alterar updatedAt.",
  );


  assert(
      auditRetryData
          .createdAt
          .isEqual(
              auditCreatedAtBeforeRetry,
          ),
      "Retry nÃ£o deveria recriar auditoria.",
  );


  assert.strictEqual(
      snapshotAfterRetry.exists,
      false,
  );


  console.log(
      "âœ… retry gerou zero nova escrita",
  );


  console.log(
      "âœ… continua existindo exatamente uma auditoria determinÃ­stica",
  );


  // ==========================================================================
  // FINAL
  // ==========================================================================

  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… FINALIZAÃ‡ÃƒO NO FIRESTORE EMULATOR PASSOU",
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