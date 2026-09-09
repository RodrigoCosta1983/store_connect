"use strict";


const assert =
    require("assert");

const {
  renewBackupRetentionDeleteLease,
} = require(
    "../../backups/renewBackupRetentionDeleteLease",
);

const {
  ACTIONS,
  RESUME_STAGES,
} = require(
    "../../backups/backupRetentionClaimPlanner",
);


// ============================================================================
// STORE&CONNECT â€” TESTES LOCAIS DO LEASE DE RETENÃ‡ÃƒO
// ============================================================================
//
// F5.6-D3-F2
//
// âŒ sem Firebase real
// âŒ sem Firestore real
// âŒ sem Storage
// âŒ sem delete()
// âŒ sem deploy
//
// ============================================================================


const STORE_ID =
    "store-test";

const BACKUP_ID =
    "backup-active";

const EXECUTION_A =
    "execution-A";

const EXECUTION_B =
    "execution-B";

const VALID_CHECKSUM =
    "a".repeat(64);

const NOW =
    new Date(
        "2026-09-30T12:00:00.000Z",
    );


// ============================================================================
// HELPERS
// ============================================================================

function storagePath() {
  return (
    `store_backups/` +
    `${STORE_ID}/` +
    `${BACKUP_ID}/` +
    `snapshot.json.gz`
  );
}


function createSnapshot({
  status =
    "deleting",
} = {}) {
  return {
    storeId:
      STORE_ID,

    type:
      "automatic",

    status,

    createdAt:
      "2026-01-01T12:00:00.000Z",

    storagePath:
      storagePath(),

    checksum:
      VALID_CHECKSUM,

    retentionDeleteOperationId:
      BACKUP_ID,

    retentionDeleteReason:
      "retention_policy",
  };
}


function createOperation({
  status =
    "claimed",

  leaseOwner =
    EXECUTION_A,

  leaseExpiresAt =
    "2026-09-30T12:15:00.000Z",
} = {}) {
  return {
    version:
      1,

    storeId:
      STORE_ID,

    backupId:
      BACKUP_ID,

    status,

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
        storagePath(),

      checksum:
        VALID_CHECKSUM,

      compressedBytes:
        123456,
    },

    attemptCount:
      1,

    leaseOwner,

    leaseAcquiredAt:
      "2026-09-30T11:55:00.000Z",

    leaseExpiresAt,
  };
}


// ============================================================================
// FIRESTORE FAKE
// ============================================================================

function createFakeFirestore({
  operation,
  snapshot,
}) {
  const calls = [];


  function makeRef(
      path,
  ) {
    return {
      path,

      collection(name) {
        return makeRef(
            `${path}/${name}`,
        );
      },

      doc(id) {
        return makeRef(
            `${path}/${id}`,
        );
      },
    };
  }


  const operationPath =
      (
        `storeBackups/${STORE_ID}/` +
        `retentionDeletes/${BACKUP_ID}`
      );

  const snapshotPath =
      (
        `storeBackups/${STORE_ID}/` +
        `snapshots/${BACKUP_ID}`
      );


  const db = {
    collection(name) {
      return makeRef(
          name,
      );
    },


    async runTransaction(
        callback,
    ) {
      calls.push({
        type:
          "transaction",
      });


      const transaction = {
        async get(ref) {
          calls.push({
            type:
              "get",

            path:
              ref.path,
          });


          if (
            ref.path ===
            operationPath
          ) {
            return {
              exists:
                operation !== null,

              data() {
                return operation;
              },
            };
          }


          if (
            ref.path ===
            snapshotPath
          ) {
            return {
              exists:
                snapshot !== null,

              data() {
                return snapshot;
              },
            };
          }


          throw new Error(
              `GET inesperado: ${ref.path}`,
          );
        },


        update(
            ref,
            data,
        ) {
          calls.push({
            type:
              "update",

            path:
              ref.path,

            data,
          });
        },
      };


      return callback(
          transaction,
      );
    },
  };


  return {
    db,
    calls,
  };
}


function writesFrom(
    calls,
) {
  return calls.filter(
      (call) =>
        call.type ===
        "update",
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
      "F5.6-D3-F2 â€” TESTES LOCAIS DO LEASE",
  );

  console.log(
      "============================================================",
  );


  // ==========================================================================
  // 1. MESMO WORKER RENOVA CLAIMED
  // ==========================================================================

  {
    const {
      db,
      calls,
    } = createFakeFirestore({
      operation:
        createOperation({
          status:
            "claimed",

          leaseOwner:
            EXECUTION_A,
        }),

      snapshot:
        createSnapshot(),
    });


    const result =
        await renewBackupRetentionDeleteLease({
          db,

          storeId:
            STORE_ID,

          backupId:
            BACKUP_ID,

          executionId:
            EXECUTION_A,

          now:
            NOW,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.RESUME,
    );

    assert.strictEqual(
        result.wrote,
        true,
    );

    assert.strictEqual(
        result.resumeStage,
        RESUME_STAGES.STORAGE_DELETE,
    );

    assert.strictEqual(
        result.tookOverLease,
        false,
    );

    assert.strictEqual(
        result.leaseOwner,
        EXECUTION_A,
    );

    assert.strictEqual(
        result.leaseExpiresAt,
        "2026-09-30T12:15:00.000Z",
    );


    const writes =
        writesFrom(
            calls,
        );


    assert.strictEqual(
        writes.length,
        1,
    );


    assert.strictEqual(
        writes[0].data.leaseOwner,
        EXECUTION_A,
    );


    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(
            writes[0].data,
            "leaseAcquiredAt",
        ),
        false,
    );


    console.log(
        "âœ… mesmo worker â†’ renova lease sem novo leaseAcquiredAt",
    );
  }


  // ==========================================================================
  // 2. LEASE EXPIRADO DE OUTRO WORKER â†’ TAKEOVER
  // ==========================================================================

  {
    const {
      db,
      calls,
    } = createFakeFirestore({
      operation:
        createOperation({
          status:
            "claimed",

          leaseOwner:
            EXECUTION_A,

          leaseExpiresAt:
            "2026-09-30T11:59:00.000Z",
        }),

      snapshot:
        createSnapshot(),
    });


    const result =
        await renewBackupRetentionDeleteLease({
          db,

          storeId:
            STORE_ID,

          backupId:
            BACKUP_ID,

          executionId:
            EXECUTION_B,

          now:
            NOW,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.RESUME,
    );

    assert.strictEqual(
        result.wrote,
        true,
    );

    assert.strictEqual(
        result.tookOverLease,
        true,
    );

    assert.strictEqual(
        result.leaseOwner,
        EXECUTION_B,
    );


    const writes =
        writesFrom(
            calls,
        );


    assert.strictEqual(
        writes.length,
        1,
    );

    assert.strictEqual(
        writes[0].data.leaseOwner,
        EXECUTION_B,
    );

    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(
            writes[0].data,
            "leaseAcquiredAt",
        ),
        true,
    );


    console.log(
        "âœ… lease expirado â†’ takeover por outro worker",
    );
  }


  // ==========================================================================
  // 3. LEASE ATIVO DE OUTRO WORKER â†’ SKIP + ZERO WRITES
  // ==========================================================================

  {
    const {
      db,
      calls,
    } = createFakeFirestore({
      operation:
        createOperation({
          leaseOwner:
            EXECUTION_A,

          leaseExpiresAt:
            "2026-09-30T12:15:00.000Z",
        }),

      snapshot:
        createSnapshot(),
    });


    const result =
        await renewBackupRetentionDeleteLease({
          db,

          storeId:
            STORE_ID,

          backupId:
            BACKUP_ID,

          executionId:
            EXECUTION_B,

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
        writesFrom(
            calls,
        ).length,
        0,
    );


    console.log(
        "âœ… lease ativo de outro worker â†’ SKIP_LEASED + zero writes",
    );
  }


  // ==========================================================================
  // 4. STORAGE_DELETED â†’ RESUME FINALIZE
  // ==========================================================================

  {
    const {
      db,
      calls,
    } = createFakeFirestore({
      operation:
        createOperation({
          status:
            "storage_deleted",

          leaseOwner:
            EXECUTION_A,
        }),

      snapshot:
        createSnapshot(),
    });


    const result =
        await renewBackupRetentionDeleteLease({
          db,

          storeId:
            STORE_ID,

          backupId:
            BACKUP_ID,

          executionId:
            EXECUTION_A,

          now:
            NOW,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.RESUME,
    );

    assert.strictEqual(
        result.resumeStage,
        RESUME_STAGES.FINALIZE,
    );

    assert.strictEqual(
        result.wrote,
        true,
    );

    assert.strictEqual(
        writesFrom(
            calls,
        ).length,
        1,
    );


    console.log(
        "âœ… storage_deleted â†’ renova lease para RESUME finalize",
    );
  }


  // ==========================================================================
  // 5. COMPLETED â†’ ZERO WRITES
  // ==========================================================================

  {
    const {
      db,
      calls,
    } = createFakeFirestore({
      operation:
        createOperation({
          status:
            "completed",
        }),

      snapshot:
        null,
    });


    const result =
        await renewBackupRetentionDeleteLease({
          db,

          storeId:
            STORE_ID,

          backupId:
            BACKUP_ID,

          executionId:
            EXECUTION_A,

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
        writesFrom(
            calls,
        ).length,
        0,
    );


    console.log(
        "âœ… completed â†’ ALREADY_COMPLETED + zero writes",
    );
  }


  // ==========================================================================
  // 6. BLOCKED â†’ ZERO WRITES
  // ==========================================================================

  {
    const {
      db,
      calls,
    } = createFakeFirestore({
      operation:
        createOperation({
          status:
            "blocked",
        }),

      snapshot:
        null,
    });


    const result =
        await renewBackupRetentionDeleteLease({
          db,

          storeId:
            STORE_ID,

          backupId:
            BACKUP_ID,

          executionId:
            EXECUTION_A,

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
        writesFrom(
            calls,
        ).length,
        0,
    );


    console.log(
        "âœ… blocked â†’ zero writes",
    );
  }


  // ==========================================================================
  // 7. OPERAÃ‡ÃƒO INEXISTENTE â†’ BLOCKED + ZERO WRITES
  // ==========================================================================

  {
    const {
      db,
      calls,
    } = createFakeFirestore({
      operation:
        null,

      snapshot:
        createSnapshot(),
    });


    const result =
        await renewBackupRetentionDeleteLease({
          db,

          storeId:
            STORE_ID,

          backupId:
            BACKUP_ID,

          executionId:
            EXECUTION_A,

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
        writesFrom(
            calls,
        ).length,
        0,
    );


    console.log(
        "âœ… operaÃ§Ã£o inexistente â†’ BLOCKED + zero writes",
    );
  }


  // ==========================================================================
  // 8. OPERAÃ‡ÃƒO ATIVA SEM SNAPSHOT â†’ BLOCKED + ZERO WRITES
  // ==========================================================================

  {
    const {
      db,
      calls,
    } = createFakeFirestore({
      operation:
        createOperation({
          status:
            "claimed",
        }),

      snapshot:
        null,
    });


    const result =
        await renewBackupRetentionDeleteLease({
          db,

          storeId:
            STORE_ID,

          backupId:
            BACKUP_ID,

          executionId:
            EXECUTION_A,

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
        writesFrom(
            calls,
        ).length,
        0,
    );


    console.log(
        "âœ… claimed sem snapshot â†’ BLOCKED + zero writes",
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
      "âœ… TODOS OS TESTES LOCAIS DO LEASE PASSARAM",
  );

  console.log(
      "============================================================",
  );

  console.log("");
}


// ============================================================================
// EXECUTA
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