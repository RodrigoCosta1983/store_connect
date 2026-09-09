"use strict";


const assert =
    require("assert");

const admin =
    require("firebase-admin");

const {
  markBackupRetentionStorageDeleted,
} = require(
    "../../backups/markBackupRetentionStorageDeleted",
);

const {
  ACTIONS,
} = require(
    "../../backups/backupRetentionMarkStorageDeletedPlanner",
);

const {
  ACTIONS:
    DELETE_ACTIONS,
} = require(
    "../../backups/deleteBackupRetentionStorageArtifact",
);


// ============================================================================
// F5.6-D3-G5.3
// TRANSAÃ‡ÃƒO REAL claimed â†’ storage_deleted NO FIRESTORE EMULATOR
// ============================================================================
//
// âœ… Firestore Emulator real
// âœ… transaction real
// âœ… serverTimestamp real do Emulator
// âœ… snapshot permanece deleting
// âœ… retry idempotente
//
// âŒ sem produÃ§Ã£o
// âŒ sem Storage delete
//
// ============================================================================


const EXPECTED_FIRESTORE_HOST =
    "127.0.0.1:8080";

const PROJECT_ID =
    "store-connect-app";

const STORE_ID =
    "emulator-g5-mark-storage-deleted";

const BACKUP_ID =
    "backup-g5-storage-deleted";

const EXECUTION_ID =
    "worker-g5-a";

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


// ============================================================================
// SEGURANÃ‡A
// ============================================================================

function assertEmulatorEnvironment() {
  const host =
      String(
          process.env.FIRESTORE_EMULATOR_HOST ||
          "",
      ).trim();


  if (
    host !==
      EXPECTED_FIRESTORE_HOST
  ) {
    throw new Error(
        (
          "SEGURANÃ‡A: teste recusado. " +
          "FIRESTORE_EMULATOR_HOST deve ser " +
          `${EXPECTED_FIRESTORE_HOST}. ` +
          `Valor atual: "${host}".`
        ),
    );
  }
}


// ============================================================================
// ADMIN
// ============================================================================

function initializeFirestore() {
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
// FIXTURES
// ============================================================================

function createSnapshot() {
  return {
    storeId:
      STORE_ID,

    type:
      "automatic",

    status:
      "deleting",

    createdAt:
      "2026-01-01T12:00:00.000Z",

    storagePath:
      STORAGE_PATH,

    // Contrato oficial do snapshot.
    checksumSha256:
      VALID_CHECKSUM,

    retentionDeleteOperationId:
      BACKUP_ID,

    retentionDeleteReason:
      "retention_policy",

    retentionDeleteStartedAt:
      admin.firestore.Timestamp.fromDate(
          new Date(
              "2026-09-30T11:50:00.000Z",
          ),
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
      "claimed",

    reason:
      "retention_policy",

    snapshot: {
      type:
        "automatic",

      originalStatus:
        "ready",

      createdAt:
        "2026-01-01T12:00:00.000Z",

      storagePath:
        STORAGE_PATH,

      // Contrato interno congelado.
      checksum:
        VALID_CHECKSUM,

      compressedBytes:
        123456,
    },

    createdAt:
      admin.firestore.Timestamp.fromDate(
          new Date(
              "2026-09-30T11:50:00.000Z",
          ),
      ),

    updatedAt:
      admin.firestore.Timestamp.fromDate(
          new Date(
              "2026-09-30T11:55:00.000Z",
          ),
      ),

    claimedAt:
      admin.firestore.Timestamp.fromDate(
          new Date(
              "2026-09-30T11:50:00.000Z",
          ),
      ),

    storageDeletedAt:
      null,

    completedAt:
      null,

    blockedAt:
      null,

    attemptCount:
      1,

    lastAttemptAt:
      admin.firestore.Timestamp.fromDate(
          new Date(
              "2026-09-30T11:55:00.000Z",
          ),
      ),

    lastError:
      null,

    leaseOwner:
      EXECUTION_ID,

    leaseAcquiredAt:
      admin.firestore.Timestamp.fromDate(
          new Date(
              "2026-09-30T11:55:00.000Z",
          ),
      ),

    leaseExpiresAt:
      admin.firestore.Timestamp.fromDate(
          new Date(
              "2026-09-30T12:15:00.000Z",
          ),
      ),
  };
}


function createDeleteResult() {
  return {
    action:
      DELETE_ACTIONS.STORAGE_ABSENCE_CONFIRMED,

    allowed:
      true,

    storeId:
      STORE_ID,

    backupId:
      BACKUP_ID,

    storagePath:
      STORAGE_PATH,

    generation:
      "1234567890123456",

    alreadyMissing:
      false,

    reasons: [],
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
      "F5.6-D3-G5.3 â€” FIRESTORE EMULATOR MARK STORAGE_DELETED",
  );

  console.log(
      "============================================================",
  );


  assertEmulatorEnvironment();


  console.log(
      "âœ… trava confirmou Firestore Emulator",
  );


  const db =
      initializeFirestore();


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


  // ==========================================================================
  // 1. PREPARA ESTADO REAL NO EMULATOR
  // ==========================================================================

  await snapshotRef.set(
      createSnapshot(),
  );


  await operationRef.set(
      createOperation(),
  );


  console.log(
      "âœ… estado claimed + snapshot deleting preparado",
  );


  // ==========================================================================
  // 2. EXECUTA TRANSACTION REAL
  // ==========================================================================

  const result =
      await markBackupRetentionStorageDeleted({
        db,

        storeId:
          STORE_ID,

        backupId:
          BACKUP_ID,

        deleteResult:
          createDeleteResult(),

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assert.strictEqual(
      result.action,
      ACTIONS.MARK_STORAGE_DELETED,
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
      "âœ… transaction retornou MARK_STORAGE_DELETED",
  );


  // ==========================================================================
  // 3. CONFIRMA OPERAÃ‡ÃƒO PERSISTIDA
  // ==========================================================================

  const operationAfter =
      await operationRef.get();


  assert.strictEqual(
      operationAfter.exists,
      true,
  );


  const operationData =
      operationAfter.data();


  assert.strictEqual(
      operationData.status,
      "storage_deleted",
  );


  assert(
      operationData.storageDeletedAt &&
      typeof operationData
          .storageDeletedAt
          .toDate ===
        "function",
      "storageDeletedAt deveria ser Timestamp.",
  );


  assert.strictEqual(
      operationData.lastError,
      null,
  );


  console.log(
      "âœ… operaÃ§Ã£o persistida como storage_deleted",
  );


  // ==========================================================================
  // 4. SNAPSHOT DEVE CONTINUAR deleting
  // ==========================================================================

  const snapshotAfter =
      await snapshotRef.get();


  assert.strictEqual(
      snapshotAfter.exists,
      true,
  );


  const snapshotData =
      snapshotAfter.data();


  assert.strictEqual(
      snapshotData.status,
      "deleting",
  );

  assert.strictEqual(
      snapshotData.retentionDeleteOperationId,
      BACKUP_ID,
  );


  console.log(
      "âœ… snapshot permaneceu deleting e nÃ£o foi removido",
  );


  // ==========================================================================
  // 5. RETRY IDEMPOTENTE
  // ==========================================================================

  const updatedAtBeforeRetry =
      operationData.updatedAt;


  const retryResult =
      await markBackupRetentionStorageDeleted({
        db,

        storeId:
          STORE_ID,

        backupId:
          BACKUP_ID,

        deleteResult:
          null,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assert.strictEqual(
      retryResult.action,
      ACTIONS.ALREADY_STORAGE_DELETED,
  );

  assert.strictEqual(
      retryResult.wrote,
      false,
  );


  const operationAfterRetry =
      await operationRef.get();


  const retryData =
      operationAfterRetry.data();


  assert.strictEqual(
      retryData.status,
      "storage_deleted",
  );


  assert(
      updatedAtBeforeRetry.isEqual(
          retryData.updatedAt,
      ),
      (
        "updatedAt mudou no retry, " +
        "indicando write inesperado."
      ),
  );


  console.log(
      "âœ… retry â†’ ALREADY_STORAGE_DELETED e zero write",
  );


  // ==========================================================================
  // FINAL
  // ==========================================================================

  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… TESTE REAL DA TRANSIÃ‡ÃƒO STORAGE_DELETED PASSOU",
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