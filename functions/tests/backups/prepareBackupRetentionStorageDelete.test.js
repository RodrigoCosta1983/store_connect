"use strict";


const assert =
    require("assert");

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
// F5.6-D3-G6.1
// TESTES DA PREPARAÃ‡ÃƒO DO DELETE FÃSICO
// ============================================================================
//
// âœ… Firestore fake
// âœ… transaction simulada
// âœ… estado relido do Firestore
// âœ… planner real
// âœ… zero writes
//
// âŒ sem Storage
// âŒ sem delete()
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

    // Contrato oficial atual do snapshot.
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

    attemptCount:
      1,

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

  const reads = [];

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
      new Map();


  if (snapshot !== null) {
    state.set(
        snapshotPath,
        snapshot,
    );
  }


  if (operation !== null) {
    state.set(
        operationPath,
        operation,
    );
  }


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
          reads.push(
              ref.path,
          );


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
            type:
              "update",

            path:
              ref.path,

            data,
          });

          throw new Error(
              "WRITE INESPERADO: update()",
          );
        },


        set(
            ref,
            data,
        ) {
          writes.push({
            type:
              "set",

            path:
              ref.path,

            data,
          });

          throw new Error(
              "WRITE INESPERADO: set()",
          );
        },


        create(
            ref,
            data,
        ) {
          writes.push({
            type:
              "create",

            path:
              ref.path,

            data,
          });

          throw new Error(
              "WRITE INESPERADO: create()",
          );
        },


        delete(
            ref,
        ) {
          writes.push({
            type:
              "delete",

            path:
              ref.path,
          });

          throw new Error(
              "WRITE INESPERADO: delete()",
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
    reads,
    writes,
    snapshotPath,
    operationPath,
  };
}


// ============================================================================
// HELPERS
// ============================================================================

function hasReason(
    result,
    code,
) {
  return (
    Array.isArray(
        result.reasons,
    ) &&
    result.reasons.some(
        (reason) =>
          reason.code === code,
    )
  );
}


function printOk(
    message,
) {
  console.log(
      `âœ… ${message}`,
  );
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
      "F5.6-D3-G6.1 â€” PREPARE STORAGE DELETE",
  );

  console.log(
      "============================================================",
  );


  // ==========================================================================
  // 1. claimed Ã­ntegro + lease suficiente â†’ DELETE_STORAGE_ALLOWED
  // ==========================================================================

  {
    const {
      db,
      reads,
      writes,
      snapshotPath,
      operationPath,
    } = createFakeFirestore();


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
        result.storeId,
        STORE_ID,
    );

    assert.strictEqual(
        result.backupId,
        BACKUP_ID,
    );

    assert.strictEqual(
        result.storagePath,
        STORAGE_PATH,
    );

    assert.strictEqual(
        result.checksum,
        VALID_CHECKSUM,
    );

    assert.deepStrictEqual(
        reads,
        [
          operationPath,
          snapshotPath,
        ],
    );

    assert.strictEqual(
        writes.length,
        0,
    );


    printOk(
        "claimed Ã­ntegro â†’ DELETE_STORAGE_ALLOWED e zero writes",
    );
  }


  // ==========================================================================
  // 2. lease ativo de outro worker â†’ SKIP_LEASED
  // ==========================================================================

  {
    const {
      db,
      writes,
    } = createFakeFirestore({
      operation:
        createOperation({
          leaseOwner:
            OTHER_EXECUTION_ID,

          leaseExpiresAt:
            "2026-09-30T12:15:00.000Z",
        }),
    });


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
        ACTIONS.SKIP_LEASED,
    );

    assert.strictEqual(
        result.allowed,
        false,
    );

    assert.strictEqual(
        writes.length,
        0,
    );


    printOk(
        "lease ativo de outro worker â†’ SKIP_LEASED e zero writes",
    );
  }


  // ==========================================================================
  // 3. menos de 60s de lease restante â†’ BLOCKED
  // ==========================================================================

  {
    const {
      db,
      writes,
    } = createFakeFirestore({
      operation:
        createOperation({
          leaseExpiresAt:
            "2026-09-30T12:00:59.999Z",
        }),
    });


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
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        result.allowed,
        false,
    );

    assert(
        hasReason(
            result,
            "insufficient-lease-time-for-storage-delete",
        ),
    );

    assert.strictEqual(
        writes.length,
        0,
    );


    printOk(
        "lease abaixo de 60s â†’ BLOCKED e zero writes",
    );
  }


  // ==========================================================================
  // 4. exatamente 60s restantes â†’ DELETE_STORAGE_ALLOWED
  // ==========================================================================

  {
    const {
      db,
      writes,
    } = createFakeFirestore({
      operation:
        createOperation({
          leaseExpiresAt:
            "2026-09-30T12:01:00.000Z",
        }),
    });


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
        writes.length,
        0,
    );


    printOk(
        "lease com exatamente 60s â†’ DELETE_STORAGE_ALLOWED",
    );
  }


  // ==========================================================================
  // 5. operaÃ§Ã£o jÃ¡ storage_deleted â†’ ALREADY_STORAGE_DELETED
  // ==========================================================================

  {
    const {
      db,
      writes,
    } = createFakeFirestore({
      operation:
        createOperation({
          status:
            "storage_deleted",
        }),
    });


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
        ACTIONS.ALREADY_STORAGE_DELETED,
    );

    assert.strictEqual(
        result.allowed,
        false,
    );

    assert.strictEqual(
        writes.length,
        0,
    );


    printOk(
        "storage_deleted â†’ ALREADY_STORAGE_DELETED e zero writes",
    );
  }


  // ==========================================================================
  // 6. operaÃ§Ã£o completed + snapshot ausente â†’ ALREADY_COMPLETED
  // ==========================================================================

  {
    const {
      db,
      writes,
    } = createFakeFirestore({
      snapshot:
        null,

      operation:
        createOperation({
          status:
            "completed",
        }),
    });


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
        ACTIONS.ALREADY_COMPLETED,
    );

    assert.strictEqual(
        result.allowed,
        false,
    );

    assert.strictEqual(
        writes.length,
        0,
    );


    printOk(
        "completed sem snapshot â†’ ALREADY_COMPLETED e zero writes",
    );
  }


  // ==========================================================================
  // 7. operaÃ§Ã£o inexistente â†’ BLOCKED
  // ==========================================================================

  {
    const {
      db,
      writes,
    } = createFakeFirestore({
      operation:
        null,
    });


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
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        result.allowed,
        false,
    );

    assert.strictEqual(
        writes.length,
        0,
    );


    printOk(
        "operaÃ§Ã£o inexistente â†’ BLOCKED e zero writes",
    );
  }


  // ==========================================================================
  // 8. checksum atual divergiu apÃ³s claim â†’ BLOCKED
  // ==========================================================================

  {
    const {
      db,
      writes,
    } = createFakeFirestore({
      snapshot:
        createSnapshot({
          checksumSha256:
            OTHER_CHECKSUM,
        }),
    });


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
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        result.allowed,
        false,
    );

    assert(
        hasReason(
            result,
            "checksum-changed-after-claim",
        ),
    );

    assert.strictEqual(
        writes.length,
        0,
    );


    printOk(
        "checksum alterado apÃ³s claim â†’ BLOCKED e zero writes",
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
      "âœ… TODOS OS TESTES DO PREPARE STORAGE DELETE PASSARAM",
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