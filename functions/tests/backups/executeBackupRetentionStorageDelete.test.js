"use strict";


const assert =
    require("assert");

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


// ============================================================================
// F5.6-D3-G6.3
// EXECUTOR COMPLETO COM FIRESTORE + STORAGE FAKES
// ============================================================================
//
// âœ… prepare real
// âœ… inspector real
// âœ… delete helper real
// âœ… mark storage_deleted real
//
// âœ… Firestore fake
// âœ… Storage fake
//
// âŒ sem Emulator
// âŒ sem produÃ§Ã£o
//
// ============================================================================


const STORE_ID =
    "store-test";

const BACKUP_ID =
    "backup-test";

const EXECUTION_ID =
    "worker-a";

const OTHER_EXECUTION_ID =
    "worker-b";

const NOW =
    "2026-09-30T12:00:00.000Z";

const VALID_CHECKSUM =
    "a".repeat(64);

const OTHER_CHECKSUM =
    "b".repeat(64);

const GENERATION =
    "1234567890123456";

const STORAGE_PATH =
    (
      `store_backups/` +
      `${STORE_ID}/` +
      `${BACKUP_ID}/` +
      `snapshot.json.gz`
    );


// ============================================================================
// FIXTURES
// ============================================================================

function createSnapshot(
    overrides = {},
) {
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

    checksumSha256:
      VALID_CHECKSUM,

    retentionDeleteOperationId:
      BACKUP_ID,

    retentionDeleteReason:
      "retention_policy",

    ...overrides,
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
        "2026-01-01T12:00:00.000Z",

      storagePath:
        STORAGE_PATH,

      checksum:
        VALID_CHECKSUM,

      compressedBytes:
        123456,
    },

    createdAt:
      "2026-09-30T11:50:00.000Z",

    updatedAt:
      "2026-09-30T11:55:00.000Z",

    claimedAt:
      "2026-09-30T11:50:00.000Z",

    storageDeletedAt:
      null,

    completedAt:
      null,

    blockedAt:
      null,

    attemptCount:
      1,

    lastAttemptAt:
      "2026-09-30T11:55:00.000Z",

    lastError:
      null,

    leaseOwner:
      EXECUTION_ID,

    leaseAcquiredAt:
      "2026-09-30T11:55:00.000Z",

    leaseExpiresAt:
      "2026-09-30T12:15:00.000Z",

    ...overrides,
  };
}


// ============================================================================
// FIRESTORE FAKE
// ============================================================================

function createDocRef(
    path,
) {
  return {
    path,

    collection(
        name,
    ) {
      return {
        doc(
            id,
        ) {
          return createDocRef(
              `${path}/${name}/${id}`,
          );
        },
      };
    },
  };
}


function createFakeFirestore({
  snapshot =
    createSnapshot(),

  operation =
    createOperation(),
} = {}) {
  const writes = [];

  const snapshotPath =
      (
        `storeBackups/${STORE_ID}/` +
        `snapshots/${BACKUP_ID}`
      );

  const operationPath =
      (
        `storeBackups/${STORE_ID}/` +
        `retentionDeletes/${BACKUP_ID}`
      );


  const state =
      new Map([
        [
          snapshotPath,
          snapshot,
        ],

        [
          operationPath,
          operation,
        ],
      ]);


  const db = {
    collection(
        name,
    ) {
      return {
        doc(
            id,
        ) {
          return createDocRef(
              `${name}/${id}`,
          );
        },
      };
    },


    async runTransaction(
        callback,
    ) {
      const transaction = {
        async get(
            ref,
        ) {
          const exists =
              state.has(
                  ref.path,
              );


          return {
            exists,

            data() {
              return exists
                ? state.get(
                    ref.path,
                )
                : undefined;
            },
          };
        },


        update(
            ref,
            data,
        ) {
          writes.push({
            path:
              ref.path,

            data,
          });


          const previous =
              state.get(
                  ref.path,
              ) || {};


          state.set(
              ref.path,
              {
                ...previous,
                ...data,
              },
          );
        },
      };


      return callback(
          transaction,
      );
    },
  };


  return {
    db,
    state,
    writes,
    snapshotPath,
    operationPath,
  };
}


// ============================================================================
// STORAGE FAKE
// ============================================================================

function createFakeStorage({
  missing =
    false,

  storageChecksum =
    VALID_CHECKSUM,

  metadataError =
    null,

  deleteError =
    null,
} = {}) {
  const calls = [];

  let objectExists =
      !missing;


  const file = {
    async getMetadata() {
      calls.push({
        type:
          "getMetadata",
      });


      if (metadataError) {
        throw metadataError;
      }


      if (!objectExists) {
        const error =
            new Error(
                "Not Found",
            );

        error.code =
            404;

        throw error;
      }


      return [
        {
          generation:
            GENERATION,

          metadata: {
            storeId:
              STORE_ID,

            backupId:
              BACKUP_ID,

            checksumSha256:
              storageChecksum,
          },
        },
      ];
    },


    async delete(
        options,
    ) {
      calls.push({
        type:
          "delete",

        options,
      });


      if (deleteError) {
        throw deleteError;
      }


      objectExists =
          false;
    },
  };


  const bucket = {
    file(
        path,
    ) {
      calls.push({
        type:
          "file",

        path,
      });


      return file;
    },
  };


  return {
    bucket,
    calls,

    objectExists() {
      return objectExists;
    },
  };
}


// ============================================================================
// HELPERS
// ============================================================================

function countCalls(
    calls,
    type,
) {
  return calls.filter(
      (call) =>
        call.type === type,
  ).length;
}


// ============================================================================
// TESTES
// ============================================================================

async function run() {
  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "F5.6-D3-G6.3 â€” EXECUTOR STORAGE DELETE",
  );

  console.log(
      "============================================================",
  );


  // ==========================================================================
  // 1. FLUXO COMPLETO
  // ==========================================================================

  {
    const firestore =
        createFakeFirestore();

    const storage =
        createFakeStorage();


    const result =
        await executeBackupRetentionStorageDelete({
          db:
            firestore.db,

          bucket:
            storage.bucket,

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
        result.wrote,
        true,
    );

    assert.strictEqual(
        storage.objectExists(),
        false,
    );

    assert.strictEqual(
        countCalls(
            storage.calls,
            "delete",
        ),
        1,
    );

    assert.strictEqual(
        firestore.writes.length,
        1,
    );

    assert.strictEqual(
        firestore.state.get(
            firestore.operationPath,
        ).status,
        "storage_deleted",
    );

    assert.strictEqual(
        firestore.state.get(
            firestore.snapshotPath,
        ).status,
        "deleting",
    );


    console.log(
        "âœ… fluxo completo â†’ Storage ausente + operation storage_deleted",
    );
  }


  // ==========================================================================
  // 2. ARQUIVO JÃ AUSENTE
  // ==========================================================================

  {
    const firestore =
        createFakeFirestore();

    const storage =
        createFakeStorage({
          missing:
            true,
        });


    const result =
        await executeBackupRetentionStorageDelete({
          db:
            firestore.db,

          bucket:
            storage.bucket,

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
        MARK_ACTIONS.MARK_STORAGE_DELETED,
    );

    assert.strictEqual(
        result.storageDelete.alreadyMissing,
        true,
    );

    assert.strictEqual(
        countCalls(
            storage.calls,
            "delete",
        ),
        0,
    );

    assert.strictEqual(
        firestore.state.get(
            firestore.operationPath,
        ).status,
        "storage_deleted",
    );


    console.log(
        "âœ… arquivo jÃ¡ ausente â†’ nenhum delete() e marca storage_deleted",
    );
  }


  // ==========================================================================
  // 3. PREPARE BLOQUEIA â†’ STORAGE NEM Ã‰ TOCADO
  // ==========================================================================

  {
    const firestore =
        createFakeFirestore({
          operation:
            createOperation({
              leaseOwner:
                OTHER_EXECUTION_ID,
            }),
        });

    const storage =
        createFakeStorage();


    const result =
        await executeBackupRetentionStorageDelete({
          db:
            firestore.db,

          bucket:
            storage.bucket,

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
        "prepare",
    );

    assert.strictEqual(
        result.allowed,
        false,
    );

    assert.strictEqual(
        storage.calls.length,
        0,
    );

    assert.strictEqual(
        firestore.writes.length,
        0,
    );


    console.log(
        "âœ… prepare bloqueou â†’ Storage zero chamadas e Firestore zero writes",
    );
  }


  // ==========================================================================
  // 4. INSPECTOR DETECTA CHECKSUM DIFERENTE
  // ==========================================================================

  {
    const firestore =
        createFakeFirestore();

    const storage =
        createFakeStorage({
          storageChecksum:
            OTHER_CHECKSUM,
        });


    const result =
        await executeBackupRetentionStorageDelete({
          db:
            firestore.db,

          bucket:
            storage.bucket,

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
        "inspection",
    );

    assert.strictEqual(
        result.allowed,
        false,
    );

    assert.strictEqual(
        countCalls(
            storage.calls,
            "delete",
        ),
        0,
    );

    assert.strictEqual(
        firestore.writes.length,
        0,
    );

    assert.strictEqual(
        storage.objectExists(),
        true,
    );


    console.log(
        "âœ… checksum divergente â†’ inspector bloqueia antes do delete",
    );
  }


  // ==========================================================================
  // 5. ERRO TEMPORÃRIO NO DELETE
  // ==========================================================================

  {
    const firestore =
        createFakeFirestore();

    const temporaryError =
        new Error(
            "Storage indisponÃ­vel",
        );

    temporaryError.code =
        503;


    const storage =
        createFakeStorage({
          deleteError:
            temporaryError,
        });


    let caught =
        null;


    try {
      await executeBackupRetentionStorageDelete({
        db:
          firestore.db,

        bucket:
          storage.bucket,

        storeId:
          STORE_ID,

        backupId:
          BACKUP_ID,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });
    } catch (error) {
      caught =
          error;
    }


    assert.strictEqual(
        caught,
        temporaryError,
    );

    assert.strictEqual(
        firestore.writes.length,
        0,
    );

    assert.strictEqual(
        firestore.state.get(
            firestore.operationPath,
        ).status,
        "claimed",
    );


    console.log(
        "âœ… erro 503 â†’ propagado e operation permanece claimed",
    );
  }


  // ==========================================================================
  // FINAL
  // ==========================================================================

  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… TODOS OS TESTES DO EXECUTOR STORAGE DELETE PASSARAM",
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