"use strict";


const assert =
    require("assert");

const admin =
    require("firebase-admin");

const {
  prepareBackupRetentionStorageDelete,
} = require(
    "../../backups/prepareBackupRetentionStorageDelete",
);

const {
  ACTIONS,
} = require(
    "../../backups/backupRetentionStorageDeletePlanner",
);


// ============================================================================
// F5.6-D3-G6.2
// PREPARE STORAGE DELETE NO FIRESTORE EMULATOR
// ============================================================================
//
// âœ… Firestore Emulator real
// âœ… Timestamp real
// âœ… transaction somente leitura
// âœ… valida ausÃªncia de writes
//
// âŒ sem Storage
// âŒ sem delete()
// âŒ sem produÃ§Ã£o
//
// ============================================================================


const EXPECTED_FIRESTORE_HOST =
    "127.0.0.1:8080";

const PROJECT_ID =
    "store-connect-app";

const STORE_ID =
    "emulator-g6-prepare-storage-delete";

const BACKUP_ID =
    "backup-g6-prepare";

const EXECUTION_ID =
    "worker-g6-a";

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
          "2026-09-30T11:50:00.000Z",
      ),
  };
}


function createOperation(
    overrides = {},
) {
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
          "2026-09-30T11:50:00.000Z",
      ),

    updatedAt:
      timestamp(
          "2026-09-30T11:55:00.000Z",
      ),

    claimedAt:
      timestamp(
          "2026-09-30T11:50:00.000Z",
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
      timestamp(
          "2026-09-30T11:55:00.000Z",
      ),

    lastError:
      null,

    leaseOwner:
      EXECUTION_ID,

    leaseAcquiredAt:
      timestamp(
          "2026-09-30T11:55:00.000Z",
      ),

    leaseExpiresAt:
      timestamp(
          "2026-09-30T12:15:00.000Z",
      ),

    ...overrides,
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
      "F5.6-D3-G6.2 â€” PREPARE STORAGE DELETE NO EMULATOR",
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
  // 1. PREPARA ESTADO
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
  // 2. CAPTURA ESTADO ANTES
  // ==========================================================================

  const snapshotBefore =
      await snapshotRef.get();

  const operationBefore =
      await operationRef.get();


  const snapshotBeforeData =
      snapshotBefore.data();

  const operationBeforeData =
      operationBefore.data();


  // ==========================================================================
  // 3. EXECUTA PREPARE REAL
  // ==========================================================================

  const result =
      await prepareBackupRetentionStorageDelete({
        db,

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
      result.action,
      ACTIONS.DELETE_STORAGE_ALLOWED,
  );

  assert.strictEqual(
      result.allowed,
      true,
  );

  assert.strictEqual(
      result.preparedFromFirestore,
      true,
  );

  assert.strictEqual(
      result.storagePath,
      STORAGE_PATH,
  );

  assert.strictEqual(
      result.checksum,
      VALID_CHECKSUM,
  );


  console.log(
      "âœ… transaction retornou DELETE_STORAGE_ALLOWED",
  );


  // ==========================================================================
  // 4. CONFIRMA ZERO WRITES
  // ==========================================================================

  const snapshotAfter =
      await snapshotRef.get();

  const operationAfter =
      await operationRef.get();


  const snapshotAfterData =
      snapshotAfter.data();

  const operationAfterData =
      operationAfter.data();


  assert.deepStrictEqual(
      snapshotAfterData,
      snapshotBeforeData,
  );


  assert.deepStrictEqual(
      operationAfterData,
      operationBeforeData,
  );


  console.log(
      "âœ… snapshot e operation permaneceram idÃªnticos",
  );


  // ==========================================================================
  // 5. LEASE INSUFICIENTE COM TIMESTAMP REAL
  // ==========================================================================

  await operationRef.set(
      createOperation({
        leaseExpiresAt:
          timestamp(
              "2026-09-30T12:00:59.999Z",
          ),
      }),
  );


  const shortLeaseResult =
      await prepareBackupRetentionStorageDelete({
        db,

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
      shortLeaseResult.action,
      ACTIONS.BLOCKED,
  );

  assert.strictEqual(
      shortLeaseResult.allowed,
      false,
  );


  assert(
      Array.isArray(
          shortLeaseResult.reasons,
      ) &&
      shortLeaseResult.reasons.some(
          (reason) =>
            reason.code ===
            "insufficient-lease-time-for-storage-delete",
      ),
  );


  console.log(
      "âœ… Timestamp real com lease < 60s â†’ BLOCKED",
  );


  // ==========================================================================
  // 6. STORAGE_DELETED
  // ==========================================================================

  await operationRef.set(
      createOperation({
        status:
          "storage_deleted",
      }),
  );


  const alreadyDeletedResult =
      await prepareBackupRetentionStorageDelete({
        db,

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
      alreadyDeletedResult.action,
      ACTIONS.ALREADY_STORAGE_DELETED,
  );

  assert.strictEqual(
      alreadyDeletedResult.allowed,
      false,
  );


  console.log(
      "âœ… storage_deleted â†’ ALREADY_STORAGE_DELETED",
  );


  // ==========================================================================
  // FINAL
  // ==========================================================================

  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… PREPARE STORAGE DELETE NO EMULATOR PASSOU",
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