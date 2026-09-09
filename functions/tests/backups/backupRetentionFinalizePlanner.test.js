"use strict";


const assert =
    require("assert");

const {
  ACTIONS,
  getAuditId,
  planBackupRetentionFinalization,
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
// F5.6-D3-G7.1 â€” TESTES DO PLANNER DE FINALIZAÃ‡ÃƒO
// ============================================================================
//
// âœ… planner puro
// âœ… sem Firebase
// âœ… sem Firestore
// âœ… sem Storage
// âœ… sem writes
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


function plan({
  snapshot =
    createSnapshot(),

  operation =
    createOperation(),

  storageInspection =
    createMissingInspection(),

  auditExists =
    false,

  executionId =
    EXECUTION_ID,

  now =
    NOW,
} = {}) {
  return planBackupRetentionFinalization({
    storeId:
      STORE_ID,

    backupId:
      BACKUP_ID,

    snapshot,

    operation,

    storageInspection,

    auditExists,

    executionId,

    now,
  });
}


// ============================================================================
// TESTES
// ============================================================================

function run() {
  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "F5.6-D3-G7.1 â€” PLANNER DE FINALIZAÃ‡ÃƒO",
  );

  console.log(
      "============================================================",
  );


  // ==========================================================================
  // 1. HAPPY PATH
  // ==========================================================================

  {
    const result =
        plan();


    assert.strictEqual(
        result.action,
        ACTIONS.FINALIZE_ALLOWED,
    );

    assert.strictEqual(
        result.allowed,
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

    assert.strictEqual(
        result.auditId,
        getAuditId(
            BACKUP_ID,
        ),
    );


    console.log(
        "âœ… storage_deleted + ausÃªncia confirmada â†’ FINALIZE_ALLOWED",
    );
  }


  // ==========================================================================
  // 2. ARTEFATO REAPARECEU
  // ==========================================================================

  {
    const result =
        plan({
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


    console.log(
        "âœ… artefato reapareceu no Storage â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 3. AUSÃŠNCIA NÃƒO CONFIRMADA
  // ==========================================================================

  {
    const result =
        plan({
          storageInspection:
            null,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        hasReason(
            result,
            "storage-absence-not-confirmed",
        ),
        true,
    );


    console.log(
        "âœ… sem prova de ausÃªncia â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 4. OUTRO WORKER COM LEASE ATIVO
  // ==========================================================================

  {
    const result =
        plan({
          executionId:
            OTHER_EXECUTION_ID,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.SKIP_LEASED,
    );

    assert.strictEqual(
        result.allowed,
        false,
    );


    console.log(
        "âœ… outro worker + lease ativo â†’ SKIP_LEASED",
    );
  }


  // ==========================================================================
  // 5. MESMO WORKER COM LEASE EXPIRADO
  // ==========================================================================

  {
    const result =
        plan({
          operation:
            createOperation({
              leaseExpiresAt:
                "2026-09-30T11:59:59.000Z",
            }),
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        hasReason(
            result,
            "expired-lease-before-finalization",
        ),
        true,
    );


    console.log(
        "âœ… mesmo worker + lease expirado â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 6. TAKEOVER NECESSÃRIO
  // ==========================================================================

  {
    const result =
        plan({
          operation:
            createOperation({
              leaseOwner:
                OTHER_EXECUTION_ID,

              leaseExpiresAt:
                "2026-09-30T11:59:59.000Z",
            }),

          executionId:
            EXECUTION_ID,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        hasReason(
            result,
            "lease-takeover-required-before-finalization",
        ),
        true,
    );


    console.log(
        "âœ… lease expirado de outro worker â†’ exige takeover",
    );
  }


  // ==========================================================================
  // 7. AUDITORIA EXISTE ANTES DE COMPLETED
  // ==========================================================================

  {
    const result =
        plan({
          auditExists:
            true,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        hasReason(
            result,
            "audit-exists-before-finalization",
        ),
        true,
    );


    console.log(
        "âœ… auditoria prematura â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 8. PROVA DE AUSÃŠNCIA COM BACKUP ERRADO
  // ==========================================================================

  {
    const result =
        plan({
          storageInspection:
            createMissingInspection({
              backupId:
                "backup-errado",
            }),
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        hasReason(
            result,
            "storage-proof-backup-id-mismatch",
        ),
        true,
    );


    console.log(
        "âœ… prova de ausÃªncia de outro backup â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 9. PROVA DE AUSÃŠNCIA COM PATH ERRADO
  // ==========================================================================

  {
    const result =
        plan({
          storageInspection:
            createMissingInspection({
              storagePath:
                "store_backups/outro/path.json.gz",
            }),
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        hasReason(
            result,
            "storage-proof-path-mismatch",
        ),
        true,
    );


    console.log(
        "âœ… prova de ausÃªncia com path divergente â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 10. OPERAÃ‡ÃƒO AINDA CLAIMED
  // ==========================================================================

  {
    const result =
        plan({
          operation:
            createOperation({
              status:
                "claimed",

              storageDeletedAt:
                null,
            }),
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        hasReason(
            result,
            "operation-not-resumable-for-finalization",
        ),
        true,
    );


    console.log(
        "âœ… operation ainda claimed â†’ nÃ£o pode finalizar",
    );
  }


  // ==========================================================================
  // 11. COMPLETED + AUDITORIA EXISTENTE
  // ==========================================================================

  {
    const result =
        plan({
          snapshot:
            null,

          operation:
            createOperation({
              status:
                "completed",

              completedAt:
                "2026-09-30T12:01:00.000Z",
            }),

          storageInspection:
            null,

          auditExists:
            true,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.ALREADY_COMPLETED,
    );

    assert.strictEqual(
        result.allowed,
        false,
    );


    console.log(
        "âœ… completed + auditoria existente â†’ ALREADY_COMPLETED",
    );
  }


  // ==========================================================================
  // 12. COMPLETED SEM AUDITORIA
  // ==========================================================================

  {
    const result =
        plan({
          snapshot:
            null,

          operation:
            createOperation({
              status:
                "completed",

              completedAt:
                "2026-09-30T12:01:00.000Z",
            }),

          storageInspection:
            null,

          auditExists:
            false,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        hasReason(
            result,
            "completed-audit-missing",
        ),
        true,
    );


    console.log(
        "âœ… completed sem auditoria â†’ BLOCKED",
    );
  }


  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… TODOS OS TESTES DO PLANNER DE FINALIZAÃ‡ÃƒO PASSARAM",
  );

  console.log(
      "============================================================",
  );

  console.log("");
}


// ============================================================================
// EXECUÃ‡ÃƒO
// ============================================================================

try {
  run();
} catch (error) {
  console.error(
      "âŒ TESTE FALHOU:",
      error,
  );

  process.exitCode =
      1;
}