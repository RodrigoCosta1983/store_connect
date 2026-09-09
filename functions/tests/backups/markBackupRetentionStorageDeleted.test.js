"use strict";


const assert =
    require("assert");

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
// F5.6-D3-G5.2 â€” TESTES DA TRANSAÃ‡ÃƒO storage_deleted
// ============================================================================
//
// âœ… Firestore fake
// âœ… transaction real simulada
// âœ… valida zero writes nos bloqueios
// âœ… valida somente operation update no sucesso
//
// âŒ sem Firestore Emulator
// âŒ sem Storage
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

    // Contrato oficial do snapshot real.
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

      // Contrato interno congelado da operation.
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


function createDeleteResult(
    overrides = {},
) {
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


          if (
            state.has(
                ref.path,
            )
          ) {
            state.set(
                ref.path,
                {
                  ...state.get(
                      ref.path,
                  ),

                  ...data,
                },
            );
          }
        },
      };


      return callback(
          transaction,
      );
    },
  };


  return {
    db,
    writes,
    state,
    snapshotPath,
    operationPath,
  };
}


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
      "F5.6-D3-G5.2 â€” TRANSAÃ‡ÃƒO MARK STORAGE_DELETED",
  );

  console.log(
      "============================================================",
  );


  // ==========================================================================
  // 1. FLUXO LEGÃTIMO â†’ UM UPDATE NA OPERAÃ‡ÃƒO
  // ==========================================================================

  {
    const {
      db,
      writes,
      operationPath,
      snapshotPath,
    } = createFakeFirestore();


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

    assert.strictEqual(
        writes.length,
        1,
    );

    assert.strictEqual(
        writes[0].type,
        "update",
    );

    assert.strictEqual(
        writes[0].path,
        operationPath,
    );

    assert.notStrictEqual(
        writes[0].path,
        snapshotPath,
    );

    assert.strictEqual(
        writes[0].data.status,
        "storage_deleted",
    );

    assert.notStrictEqual(
        writes[0].data.storageDeletedAt,
        null,
    );

    assert.notStrictEqual(
        writes[0].data.updatedAt,
        null,
    );

    assert.notStrictEqual(
        writes[0].data.lastAttemptAt,
        null,
    );

    assert.strictEqual(
        writes[0].data.lastError,
        null,
    );


    printOk(
        "claimed Ã­ntegro â†’ exatamente 1 update em retentionDeletes",
    );
  }


  // ==========================================================================
  // 2. SNAPSHOT PERMANECE INTACTO
  // ==========================================================================

  {
    const {
      db,
      writes,
      snapshotPath,
    } = createFakeFirestore();


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


    const snapshotWrites =
        writes.filter(
            (write) =>
              write.path ===
              snapshotPath,
        );


    assert.strictEqual(
        snapshotWrites.length,
        0,
    );


    printOk(
        "snapshot deleting nÃ£o recebe write nesta etapa",
    );
  }


  // ==========================================================================
  // 3. storage_deleted â†’ ZERO WRITES
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
        result.action,
        ACTIONS.ALREADY_STORAGE_DELETED,
    );

    assert.strictEqual(
        result.wrote,
        false,
    );

    assert.strictEqual(
        writes.length,
        0,
    );


    printOk(
        "operaÃ§Ã£o jÃ¡ storage_deleted â†’ zero writes",
    );
  }


  // ==========================================================================
  // 4. completed SEM SNAPSHOT â†’ ZERO WRITES
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
        result.action,
        ACTIONS.ALREADY_COMPLETED,
    );

    assert.strictEqual(
        result.wrote,
        false,
    );

    assert.strictEqual(
        writes.length,
        0,
    );


    printOk(
        "completed sem snapshot â†’ idempotente e zero writes",
    );
  }


  // ==========================================================================
  // 5. LEASE ATIVO DE OUTRO WORKER â†’ ZERO WRITES
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
        }),
    });


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
        ACTIONS.SKIP_LEASED,
    );

    assert.strictEqual(
        result.wrote,
        false,
    );

    assert.strictEqual(
        writes.length,
        0,
    );


    printOk(
        "lease ativo de outro worker â†’ zero writes",
    );
  }


  // ==========================================================================
  // 6. MESMO WORKER COM LEASE EXPIRADO â†’ ZERO WRITES
  // ==========================================================================

  {
    const {
      db,
      writes,
    } = createFakeFirestore({
      operation:
        createOperation({
          leaseExpiresAt:
            "2026-09-30T11:59:00.000Z",
        }),
    });


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
        ACTIONS.BLOCKED,
    );

    assert(
        hasReason(
            result,
            "expired-lease-before-storage-deleted",
        ),
    );

    assert.strictEqual(
        result.wrote,
        false,
    );

    assert.strictEqual(
        writes.length,
        0,
    );


    printOk(
        "lease expirado â†’ BLOCKED e zero writes",
    );
  }


  // ==========================================================================
  // 7. DELETE RESULT NÃƒO CONFIRMA AUSÃŠNCIA â†’ ZERO WRITES
  // ==========================================================================

  {
    const {
      db,
      writes,
    } = createFakeFirestore();


    const result =
        await markBackupRetentionStorageDeleted({
          db,

          storeId:
            STORE_ID,

          backupId:
            BACKUP_ID,

          deleteResult:
            createDeleteResult({
              allowed:
                false,
            }),

          executionId:
            EXECUTION_ID,

          now:
            NOW,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert(
        hasReason(
            result,
            "storage-absence-not-confirmed",
        ),
    );

    assert.strictEqual(
        result.wrote,
        false,
    );

    assert.strictEqual(
        writes.length,
        0,
    );


    printOk(
        "ausÃªncia fÃ­sica nÃ£o confirmada â†’ zero writes",
    );
  }


  // ==========================================================================
  // 8. OPERAÃ‡ÃƒO INEXISTENTE â†’ ZERO WRITES
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
        ACTIONS.BLOCKED,
    );

    assert(
        hasReason(
            result,
            "operation-missing",
        ),
    );

    assert.strictEqual(
        result.wrote,
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
  // 9. SNAPSHOT AUSENTE COM OPERAÃ‡ÃƒO claimed â†’ ZERO WRITES
  // ==========================================================================

  {
    const {
      db,
      writes,
    } = createFakeFirestore({
      snapshot:
        null,
    });


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
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        result.wrote,
        false,
    );

    assert.strictEqual(
        writes.length,
        0,
    );


    printOk(
        "claimed sem snapshot â†’ BLOCKED e zero writes",
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
      "âœ… TODOS OS TESTES DA TRANSAÃ‡ÃƒO STORAGE_DELETED PASSARAM",
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
