"use strict";


const assert =
    require("assert");

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
// F5.6-D3-G7.2 â€” TRANSACTION FINAL COM FIRESTORE FAKE
// ============================================================================
//
// âœ… planner real
// âœ… transaction helper real
// âœ… Firestore fake
//
// âŒ sem Emulator
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

const AUDIT_ID =
    getAuditId(
        BACKUP_ID,
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
      "storage_deleted",

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
      "2026-09-30T11:40:00.000Z",

    updatedAt:
      "2026-09-30T11:55:00.000Z",

    claimedAt:
      "2026-09-30T11:45:00.000Z",

    storageDeletedAt:
      "2026-09-30T11:55:00.000Z",

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
      "2026-09-30T11:45:00.000Z",

    leaseExpiresAt:
      "2026-09-30T12:15:00.000Z",

    ...overrides,
  };
}


function createMissingInspection(
    overrides = {},
) {
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

  audit =
    null,
} = {}) {
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

  const auditPath =
      (
        `stores/${STORE_ID}/` +
        `auditLogs/${AUDIT_ID}`
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


  if (audit !== null) {
    state.set(
        auditPath,
        audit,
    );
  }


  const writes = [];


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
      const pendingWrites =
          [];


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


        create(
            ref,
            data,
        ) {
          pendingWrites.push({
            type:
              "create",

            path:
              ref.path,

            data,
          });
        },


        delete(
            ref,
        ) {
          pendingWrites.push({
            type:
              "delete",

            path:
              ref.path,
          });
        },


        update(
            ref,
            data,
        ) {
          pendingWrites.push({
            type:
              "update",

            path:
              ref.path,

            data,
          });
        },
      };


      const result =
          await callback(
              transaction,
          );


      // ----------------------------------------------------------------------
      // SIMULA COMMIT ATÃ”MICO
      // ----------------------------------------------------------------------

      for (
        const write
        of pendingWrites
      ) {
        if (
          write.type ===
            "create"
        ) {
          if (
            state.has(
                write.path,
            )
          ) {
            throw new Error(
                `Documento jÃ¡ existe: ${write.path}`,
            );
          }


          state.set(
              write.path,
              write.data,
          );
        }


        if (
          write.type ===
            "delete"
        ) {
          state.delete(
              write.path,
          );
        }


        if (
          write.type ===
            "update"
        ) {
          if (
            !state.has(
                write.path,
            )
          ) {
            throw new Error(
                `Documento inexistente: ${write.path}`,
            );
          }


          state.set(
              write.path,
              {
                ...state.get(
                    write.path,
                ),

                ...write.data,
              },
          );
        }
      }


      writes.push(
          ...pendingWrites,
      );


      return result;
    },
  };


  return {
    db,
    state,
    writes,

    snapshotPath,
    operationPath,
    auditPath,
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


// ============================================================================
// TESTES
// ============================================================================

async function run() {
  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "F5.6-D3-G7.2 â€” TRANSACTION FINAL",
  );

  console.log(
      "============================================================",
  );


  // ==========================================================================
  // 1. HAPPY PATH
  // ==========================================================================

  {
    const firestore =
        createFakeFirestore();


    const result =
        await finalizeBackupRetentionDelete({
          db:
            firestore.db,

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
        result.wrote,
        true,
    );

    assert.strictEqual(
        firestore.writes.length,
        3,
    );


    assert.strictEqual(
        firestore.writes[0].type,
        "create",
    );

    assert.strictEqual(
        firestore.writes[0].path,
        firestore.auditPath,
    );


    assert.strictEqual(
        firestore.writes[1].type,
        "delete",
    );

    assert.strictEqual(
        firestore.writes[1].path,
        firestore.snapshotPath,
    );


    assert.strictEqual(
        firestore.writes[2].type,
        "update",
    );

    assert.strictEqual(
        firestore.writes[2].path,
        firestore.operationPath,
    );


    assert.strictEqual(
        firestore.state.has(
            firestore.snapshotPath,
        ),
        false,
    );


    assert.strictEqual(
        firestore.state.has(
            firestore.auditPath,
        ),
        true,
    );


    const operationAfter =
        firestore.state.get(
            firestore.operationPath,
        );


    assert.strictEqual(
        operationAfter.status,
        "completed",
    );


    const auditAfter =
        firestore.state.get(
            firestore.auditPath,
        );


    assert.strictEqual(
        auditAfter.action,
        "store_backup_retention_deleted",
    );

    assert.strictEqual(
        auditAfter.entityType,
        "backup",
    );

    assert.strictEqual(
        auditAfter.entityId,
        BACKUP_ID,
    );

    assert.strictEqual(
        auditAfter.storeId,
        STORE_ID,
    );

    assert.strictEqual(
        auditAfter.backupId,
        BACKUP_ID,
    );

    assert.strictEqual(
        auditAfter.operationId,
        BACKUP_ID,
    );

    assert.strictEqual(
        auditAfter.performedBy.uid,
        "system",
    );

    assert.strictEqual(
        auditAfter.performedBy.role,
        "system",
    );

    assert.strictEqual(
        auditAfter.reason,
        "retention_policy",
    );

    assert.strictEqual(
        auditAfter.before.storagePath,
        STORAGE_PATH,
    );

    assert.strictEqual(
        auditAfter.before.checksumSha256,
        VALID_CHECKSUM,
    );


    console.log(
        "âœ… FINALIZE_ALLOWED â†’ audit + delete snapshot + completed",
    );
  }


  // ==========================================================================
  // 2. STORAGE NÃƒO CONFIRMOU AUSÃŠNCIA
  // ==========================================================================

  {
    const firestore =
        createFakeFirestore();


    const result =
        await finalizeBackupRetentionDelete({
          db:
            firestore.db,

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
        result.action,
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        result.wrote,
        false,
    );

    assert.strictEqual(
        firestore.writes.length,
        0,
    );

    assert.strictEqual(
        firestore.state.has(
            firestore.snapshotPath,
        ),
        true,
    );

    assert.strictEqual(
        firestore.state.get(
            firestore.operationPath,
        ).status,
        "storage_deleted",
    );


    console.log(
        "âœ… ausÃªncia fÃ­sica nÃ£o confirmada â†’ zero writes",
    );
  }


  // ==========================================================================
  // 3. ARTEFATO REAPARECEU
  // ==========================================================================

  {
    const firestore =
        createFakeFirestore();


    const result =
        await finalizeBackupRetentionDelete({
          db:
            firestore.db,

          storeId:
            STORE_ID,

          backupId:
            BACKUP_ID,

          storageInspection: {
            action:
              INSPECTION_ACTIONS
                  .ARTIFACT_VALID,

            allowed:
              true,

            storeId:
              STORE_ID,

            backupId:
              BACKUP_ID,

            storagePath:
              STORAGE_PATH,
          },

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
        hasReason(
            result,
            "storage-artifact-still-exists",
        ),
        true,
    );

    assert.strictEqual(
        firestore.writes.length,
        0,
    );


    console.log(
        "âœ… artefato reapareceu â†’ finalizaÃ§Ã£o bloqueada e zero writes",
    );
  }


  // ==========================================================================
  // 4. OUTRO WORKER COM LEASE
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


    const result =
        await finalizeBackupRetentionDelete({
          db:
            firestore.db,

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
        ACTIONS.SKIP_LEASED,
    );

    assert.strictEqual(
        result.wrote,
        false,
    );

    assert.strictEqual(
        firestore.writes.length,
        0,
    );


    console.log(
        "âœ… outro worker com lease ativo â†’ SKIP_LEASED e zero writes",
    );
  }


  // ==========================================================================
  // 5. AUDITORIA PREMATURA
  // ==========================================================================

  {
    const firestore =
        createFakeFirestore({
          audit: {
            action:
              "store_backup_retention_deleted",
          },
        });


    const result =
        await finalizeBackupRetentionDelete({
          db:
            firestore.db,

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
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        result.wrote,
        false,
    );

    assert.strictEqual(
        firestore.writes.length,
        0,
    );

    assert.strictEqual(
        firestore.state.has(
            firestore.snapshotPath,
        ),
        true,
    );


    console.log(
        "âœ… audit prematuro + operation storage_deleted â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 6. SNAPSHOT AUSENTE PREMATURAMENTE
  // ==========================================================================

  {
    const firestore =
        createFakeFirestore({
          snapshot:
            null,
        });


    const result =
        await finalizeBackupRetentionDelete({
          db:
            firestore.db,

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
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        result.wrote,
        false,
    );

    assert.strictEqual(
        firestore.writes.length,
        0,
    );


    console.log(
        "âœ… snapshot ausente antes de completed â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 7. RETRY APÃ“S COMPLETED
  // ==========================================================================

  {
    const firestore =
        createFakeFirestore({
          snapshot:
            null,

          operation:
            createOperation({
              status:
                "completed",

              completedAt:
                "2026-09-30T12:01:00.000Z",
            }),

          audit: {
            action:
              "store_backup_retention_deleted",

            entityType:
              "backup",

            entityId:
              BACKUP_ID,

            storeId:
              STORE_ID,
          },
        });


    const result =
        await finalizeBackupRetentionDelete({
          db:
            firestore.db,

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
        result.action,
        ACTIONS.ALREADY_COMPLETED,
    );

    assert.strictEqual(
        result.wrote,
        false,
    );

    assert.strictEqual(
        firestore.writes.length,
        0,
    );


    console.log(
        "âœ… retry completed + audit â†’ ALREADY_COMPLETED e zero writes",
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
      "âœ… TODOS OS TESTES DA TRANSACTION FINAL PASSARAM",
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