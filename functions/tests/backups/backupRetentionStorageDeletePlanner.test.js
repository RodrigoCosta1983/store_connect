"use strict";


const assert =
    require("assert");

const {
  planBackupRetentionStorageDelete,
  ACTIONS,
} = require(
    "../../backups/backupRetentionStorageDeletePlanner",
);

const {
  RESUME_STAGES,
} = require(
    "../../backups/backupRetentionClaimPlanner",
);


// ============================================================================
// STORE&CONNECT â€” TESTES DO STORAGE DELETE PLANNER
// ============================================================================
//
// F5.6-D3-G2
//
// Testa SOMENTE autorizaÃ§Ã£o lÃ³gica.
//
// âŒ sem Firebase
// âŒ sem Firestore
// âŒ sem Storage
// âŒ sem delete()
//
// ============================================================================


const STORE_ID =
    "store-test";

const BACKUP_ID =
    "backup-test";

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
      storagePath(),

    checksum:
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
        storagePath(),

      checksum:
        VALID_CHECKSUM,

      compressedBytes:
        123456,
    },

    attemptCount:
      1,

    leaseOwner:
      EXECUTION_A,

    leaseAcquiredAt:
      "2026-09-30T11:55:00.000Z",

    leaseExpiresAt:
      "2026-09-30T12:15:00.000Z",

    ...overrides,
  };
}


function plan({
  snapshot =
    createSnapshot(),

  operation =
    createOperation(),

  executionId =
    EXECUTION_A,

  now =
    NOW,
} = {}) {
  return planBackupRetentionStorageDelete({
    storeId:
      STORE_ID,

    backupId:
      BACKUP_ID,

    snapshot,

    operation,

    executionId,

    now,
  });
}


function hasReason(
    result,
    code,
) {
  return Array.isArray(
      result.reasons,
  ) &&
    result.reasons.some(
        (reason) =>
          reason.code === code,
    );
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
      "F5.6-D3-G2 â€” STORAGE DELETE PLANNER",
  );

  console.log(
      "============================================================",
  );


  // ==========================================================================
  // 1. CLAIMED + MESMO WORKER + LEASE ATIVO
  // ==========================================================================

  {
    const result =
        plan();


    assert.strictEqual(
        result.action,
        ACTIONS.DELETE_STORAGE_ALLOWED,
    );

    assert.strictEqual(
        result.allowed,
        true,
    );

    assert.strictEqual(
        result.executionId,
        EXECUTION_A,
    );

    assert.strictEqual(
        result.storagePath,
        storagePath(),
    );

    assert.strictEqual(
        result.checksum,
        VALID_CHECKSUM,
    );


    console.log(
        "âœ… claimed + dono do lease + lease ativo â†’ DELETE_STORAGE_ALLOWED",
    );
  }


  // ==========================================================================
  // 2. OUTRO WORKER + LEASE ATIVO
  // ==========================================================================

  {
    const result =
        plan({
          executionId:
            EXECUTION_B,
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
  // 3. MESMO WORKER + LEASE EXPIRADO
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
        result.allowed,
        false,
    );

    assert.strictEqual(
        hasReason(
            result,
            "insufficient-lease-time-for-storage-delete",
        ),
        true,
    );


    console.log(
        "âœ… mesmo worker + lease expirado â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 4. OUTRO WORKER + LEASE EXPIRADO
  // ==========================================================================
  //
  // O Claim Planner pode reconhecer que takeover Ã© possÃ­vel,
  // mas esta camada NÃƒO realiza takeover.
  //
  // Primeiro o worker deve assumir o lease pela D3-F.
  //
  // ==========================================================================

  {
    const result =
        plan({
          operation:
            createOperation({
              leaseOwner:
                EXECUTION_A,

              leaseExpiresAt:
                "2026-09-30T11:59:59.000Z",
            }),

          executionId:
            EXECUTION_B,
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
        hasReason(
            result,
            "lease-owner-mismatch",
        ),
        true,
    );


    console.log(
        "âœ… lease expirado de outro worker â†’ exige takeover antes do delete",
    );
  }


  // ==========================================================================
  // 5. LEASE EXPIRA EXATAMENTE AGORA
  // ==========================================================================

  {
    const result =
        plan({
          operation:
            createOperation({
              leaseExpiresAt:
                "2026-09-30T12:00:00.000Z",
            }),
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
        hasReason(
            result,
            "insufficient-lease-time-for-storage-delete",
        ),
        true,
    );


    console.log(
        "âœ… leaseExpiresAt == now â†’ considerado expirado",
    );
  }


  // ==========================================================================
  // 6. STORAGE JÃ REMOVIDO
  // ==========================================================================

  {
    const result =
        plan({
          operation:
            createOperation({
              status:
                "storage_deleted",
            }),
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
        result.resumeStage,
        RESUME_STAGES.FINALIZE,
    );


    console.log(
        "âœ… storage_deleted â†’ nunca autoriza segundo delete fÃ­sico",
    );
  }


  // ==========================================================================
  // 7. COMPLETED
  // ==========================================================================

  {
    const result =
        plan({
          operation:
            createOperation({
              status:
                "completed",
            }),

          snapshot:
            null,
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
        "âœ… completed â†’ ALREADY_COMPLETED",
    );
  }


  // ==========================================================================
  // 8. OPERAÃ‡ÃƒO AUSENTE
  // ==========================================================================

  {
    const result =
        plan({
          operation:
            null,
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
        hasReason(
            result,
            "operation-not-found",
        ),
        true,
    );


    console.log(
        "âœ… operaÃ§Ã£o ausente â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 9. SNAPSHOT AUSENTE
  // ==========================================================================

  {
    const result =
        plan({
          snapshot:
            null,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        result.allowed,
        false,
    );


    console.log(
        "âœ… claimed sem snapshot â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 10. SNAPSHOT NÃƒO ESTÃ DELETING
  // ==========================================================================

  {
    const result =
        plan({
          snapshot:
            createSnapshot({
              status:
                "ready",
            }),
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        result.allowed,
        false,
    );


    console.log(
        "âœ… snapshot fora de deleting â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 11. STORAGE PATH ALTERADO
  // ==========================================================================

  {
    const result =
        plan({
          snapshot:
            createSnapshot({
              storagePath:
                "store_backups/path-adulterado/snapshot.json.gz",
            }),
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        result.allowed,
        false,
    );


    console.log(
        "âœ… storagePath divergente â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 12. CHECKSUM ALTERADO
  // ==========================================================================

  {
    const result =
        plan({
          snapshot:
            createSnapshot({
              checksum:
                "b".repeat(64),
            }),
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        result.allowed,
        false,
    );


    console.log(
        "âœ… checksum divergente â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 13. EXECUTION ID AUSENTE
  // ==========================================================================

  {
    const result =
        plan({
          executionId:
            "",
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
        hasReason(
            result,
            "missing-execution-id",
        ),
        true,
    );


    console.log(
        "âœ… executionId ausente â†’ BLOCKED",
    );
  }



    // ==========================================================================
    // 14. LEASE COM MENOS DE 60 SEGUNDOS RESTANTES
    // ==========================================================================

    {
      const result =
          plan({
            operation:
              createOperation({
                leaseExpiresAt:
                  "2026-09-30T12:00:59.999Z",
              }),
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
          hasReason(
              result,
              "insufficient-lease-time-for-storage-delete",
          ),
          true,
      );


      console.log(
          "âœ… lease com menos de 60s restantes â†’ BLOCKED",
      );
    }


    // ==========================================================================
    // 15. LEASE COM EXATAMENTE 60 SEGUNDOS RESTANTES
    // ==========================================================================

    {
      const result =
          plan({
            operation:
              createOperation({
                leaseExpiresAt:
                  "2026-09-30T12:01:00.000Z",
              }),
          });


      assert.strictEqual(
          result.action,
          ACTIONS.DELETE_STORAGE_ALLOWED,
      );

      assert.strictEqual(
          result.allowed,
          true,
      );


      console.log(
          "âœ… lease com exatamente 60s restantes â†’ DELETE_STORAGE_ALLOWED",
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
        "âœ… TODOS OS TESTES DO STORAGE DELETE PLANNER PASSARAM",
    );

    console.log(
        "============================================================",
    );

    console.log("");
  }

  // ==========================================================================
  // FINAL
  // ==========================================================================






// ============================================================================
// EXECUTA
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