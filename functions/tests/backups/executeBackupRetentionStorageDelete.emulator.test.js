"use strict";


const assert =
    require("assert");

const zlib =
    require("zlib");

const admin =
    require("firebase-admin");

const {
  executeBackupRetentionStorageDelete,
} = require(
    "../../backups/executeBackupRetentionStorageDelete",
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


// ============================================================================
// F5.6-D3-G6.4
// EXECUTOR INTEGRADO â€” FIRESTORE + STORAGE EMULATOR
// ============================================================================
//
// Fluxo REAL nos Emulators:
//
// Firestore Emulator
//      â†“
// prepare
//      â†“
// Storage Emulator
//      â†“
// inspect
//      â†“
// delete fÃ­sico
//      â†“
// Firestore Emulator
//      â†“
// claimed â†’ storage_deleted
//
// Depois:
//
// retry
//      â†“
// ALREADY_STORAGE_DELETED
//      â†“
// zero novo write
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
    "emulator-g6-integrated-storage-delete";

const BACKUP_ID =
    "backup-g6-integrated";

const EXECUTION_ID =
    "worker-g6-integrated";

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
  const firestoreHost =
      String(
          process.env.FIRESTORE_EMULATOR_HOST ||
          "",
      ).trim();

  const storageHost =
      String(
          process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
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


  if (
    storageHost !==
      EXPECTED_STORAGE_HOST
  ) {
    throw new Error(
        (
          "SEGURANÃ‡A: teste recusado. " +
          "FIREBASE_STORAGE_EMULATOR_HOST deve ser " +
          `${EXPECTED_STORAGE_HOST}. ` +
          `Valor atual: "${storageHost}".`
        ),
    );
  }
}


// ============================================================================
// ADMIN
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
          "2026-09-30T11:50:00.000Z",
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
      "F5.6-D3-G6.4 â€” EXECUTOR INTEGRADO NOS EMULATORS",
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
  } = initializeFirebase();


  console.log(
      `âœ… bucket emulado: ${bucket.name}`,
  );


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


  const file =
      bucket.file(
          STORAGE_PATH,
      );


  // ==========================================================================
  // 3. ESTADO FIRESTORE
  // ==========================================================================

  await snapshotRef.set(
      createSnapshot(),
  );


  await operationRef.set(
      createOperation(),
  );


  console.log(
      "âœ… Firestore preparado: claimed + snapshot deleting",
  );


  // ==========================================================================
  // 4. CRIA ARTEFATO REAL NO STORAGE EMULATOR
  // ==========================================================================

  const payload =
      zlib.gzipSync(
          Buffer.from(
              JSON.stringify({
                test:
                  true,

                storeId:
                  STORE_ID,

                backupId:
                  BACKUP_ID,
              }),
              "utf8",
          ),
      );


  await file.save(
      payload,
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
              BACKUP_ID,

            snapshotVersion:
              "1",

            checksumSha256:
              VALID_CHECKSUM,
          },
        },
      },
  );


  const [
    metadataBefore,
  ] =
      await file.getMetadata();


  assert(
      typeof metadataBefore.generation ===
        "string" &&
      /^\d+$/.test(
          metadataBefore.generation,
      ),
      "Generation do Storage deveria ser vÃ¡lida.",
  );


  console.log(
      (
        "âœ… artefato criado no Storage Emulator, " +
        `generation=${metadataBefore.generation}`
      ),
  );


  // ==========================================================================
  // 5. EXECUTA FLUXO INTEGRADO
  // ==========================================================================

  const result =
      await executeBackupRetentionStorageDelete({
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
      "mark-storage-deleted",
  );


  assert.strictEqual(
      result.action,
      MARK_ACTIONS.MARK_STORAGE_DELETED,
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
      result.storageDelete.alreadyMissing,
      false,
  );


  console.log(
      "âœ… executor completou prepare â†’ inspect â†’ delete â†’ mark",
  );


  // ==========================================================================
  // 6. CONFIRMA AUSÃŠNCIA FÃSICA
  // ==========================================================================

  await assertStorageMissing(
      file,
  );


  console.log(
      "âœ… ausÃªncia fÃ­sica confirmada no Storage Emulator",
  );


  // ==========================================================================
  // 7. CONFIRMA FIRESTORE
  // ==========================================================================

  const operationAfter =
      await operationRef.get();

  const snapshotAfter =
      await snapshotRef.get();


  assert.strictEqual(
      operationAfter.exists,
      true,
  );


  assert.strictEqual(
      snapshotAfter.exists,
      true,
  );


  const operationData =
      operationAfter.data();

  const snapshotData =
      snapshotAfter.data();


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


  assert.strictEqual(
      snapshotData.status,
      "deleting",
  );


  assert.strictEqual(
      snapshotData.retentionDeleteOperationId,
      BACKUP_ID,
  );


  console.log(
      "âœ… Firestore persistiu operation=storage_deleted",
  );


  console.log(
      "âœ… snapshot permaneceu deleting",
  );


  // ==========================================================================
  // 8. CAPTURA updatedAt PARA PROVAR IDEMPOTÃŠNCIA
  // ==========================================================================

  const updatedAtBeforeRetry =
      operationData.updatedAt;


  assert(
      updatedAtBeforeRetry &&
      typeof updatedAtBeforeRetry
          .isEqual ===
        "function",
      "updatedAt deveria ser Timestamp.",
  );


  // ==========================================================================
  // 9. RETRY COMPLETO
  // ==========================================================================

  const retryResult =
      await executeBackupRetentionStorageDelete({
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
      retryResult.stage,
      "prepare",
  );


  assert.strictEqual(
      retryResult.action,
      STORAGE_DELETE_ACTIONS
          .ALREADY_STORAGE_DELETED,
  );


  assert.strictEqual(
      retryResult.allowed,
      false,
  );


  console.log(
      "âœ… retry parou no prepare â†’ ALREADY_STORAGE_DELETED",
  );


  // ==========================================================================
  // 10. RETRY NÃƒO ESCREVE NOVAMENTE
  // ==========================================================================

  const operationAfterRetry =
      await operationRef.get();


  const operationRetryData =
      operationAfterRetry.data();


  assert(
      operationRetryData.updatedAt.isEqual(
          updatedAtBeforeRetry,
      ),
      "Retry nÃ£o deveria alterar updatedAt.",
  );


  assert.strictEqual(
      operationRetryData.status,
      "storage_deleted",
  );


  await assertStorageMissing(
      file,
  );


  console.log(
      "âœ… retry gerou zero novo write e Storage continuou ausente",
  );


  // ==========================================================================
  // FINAL
  // ==========================================================================

  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… FLUXO INTEGRADO FIRESTORE + STORAGE EMULATOR PASSOU",
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