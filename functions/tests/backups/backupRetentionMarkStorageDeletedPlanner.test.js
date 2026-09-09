"use strict";


const assert =
    require("assert");

const {
  planMarkBackupRetentionStorageDeleted,
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
// F5.6-D3-G5.1 â€” TESTES DO PLANNER claimed â†’ storage_deleted
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

const EXECUTION_ID =
    "worker-a";

const OTHER_EXECUTION_ID =
    "worker-b";

const NOW =
    "2026-09-30T12:00:00.000Z";

const VALID_CHECKSUM =
    "a".repeat(64);


// ============================================================================
// HELPERS
// ============================================================================

function storagePath(
    backupId,
) {
  return (
    `store_backups/` +
    `${STORE_ID}/` +
    `${backupId}/` +
    `snapshot.json.gz`
  );
}


function createDeletingSnapshot({
  backupId =
    "backup-active",

  createdAt =
    "2026-01-01T12:00:00.000Z",

  checksum =
    VALID_CHECKSUM,

  path =
    null,

  storeId =
    STORE_ID,

  operationId =
    null,
} = {}) {
  return {
    backupId,

    storeId,

    type:
      "automatic",

    status:
      "deleting",

    createdAt,

    storagePath:
      path ||
      storagePath(
          backupId,
      ),

    checksum,

    retentionDeleteOperationId:
      operationId ||
      backupId,

    retentionDeleteReason:
      "retention_policy",
  };
}


function createOperation({
  backupId =
    "backup-active",

  status =
    "claimed",

  createdAt =
    "2026-01-01T12:00:00.000Z",

  checksum =
    VALID_CHECKSUM,

  path =
    null,

  storeId =
    STORE_ID,

  operationBackupId =
    null,

  leaseOwner =
    EXECUTION_ID,

  leaseExpiresAt =
    "2026-09-30T12:15:00.000Z",
} = {}) {
  return {
    version:
      1,

    storeId,

    backupId:
      operationBackupId ||
      backupId,

    status,

    reason:
      "retention_policy",

    snapshot: {
      type:
        "automatic",

      originalStatus:
        "ready",

      createdAt,

      storagePath:
        path ||
        storagePath(
            backupId,
        ),

      checksum,

      compressedBytes:
        123456,
    },

    leaseOwner,

    leaseAcquiredAt:
      "2026-09-30T11:55:00.000Z",

    leaseExpiresAt,
  };
}


function createDeleteResult({
  backupId =
    "backup-active",

  storeId =
    STORE_ID,

  path =
    null,

  allowed =
    true,

  action =
    DELETE_ACTIONS.STORAGE_ABSENCE_CONFIRMED,

  alreadyMissing =
    false,
} = {}) {
  return {
    action,

    allowed,

    storeId,

    backupId,

    storagePath:
      path ||
      storagePath(
          backupId,
      ),

    generation:
      alreadyMissing
        ? null
        : "1234567890123456",

    alreadyMissing,

    reasons: [],
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

console.log("");

console.log(
    "============================================================",
);

console.log(
    "F5.6-D3-G5.1 â€” PLANNER MARK STORAGE_DELETED",
);

console.log(
    "============================================================",
);


// ============================================================================
// 1. claimed Ã­ntegro + ausÃªncia confirmada â†’ MARK_STORAGE_DELETED
// ============================================================================

{
  const backupId =
      "backup-valid";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,
      });

  const deleteResult =
      createDeleteResult({
        backupId,
      });


  const result =
      planMarkBackupRetentionStorageDeleted({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        deleteResult,

        allBackups:
          [],

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
      result.storagePath,
      storagePath(
          backupId,
      ),
  );

  assert.strictEqual(
      result.alreadyMissing,
      false,
  );


  printOk(
      "claimed Ã­ntegro + ausÃªncia confirmada â†’ MARK_STORAGE_DELETED",
  );
}


// ============================================================================
// 2. arquivo jÃ¡ ausente apÃ³s retry â†’ MARK_STORAGE_DELETED
// ============================================================================

{
  const backupId =
      "backup-already-missing";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,
      });

  const deleteResult =
      createDeleteResult({
        backupId,

        alreadyMissing:
          true,
      });


  const result =
      planMarkBackupRetentionStorageDeleted({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        deleteResult,

        allBackups:
          [],

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
      result.alreadyMissing,
      true,
  );


  printOk(
      "arquivo jÃ¡ ausente apÃ³s retry â†’ MARK_STORAGE_DELETED",
  );
}


// ============================================================================
// 3. ausÃªncia fÃ­sica nÃ£o confirmada â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-no-confirmation";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,
      });

  const deleteResult =
      createDeleteResult({
        backupId,

        allowed:
          false,
      });


  const result =
      planMarkBackupRetentionStorageDeleted({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        deleteResult,

        allBackups:
          [],

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


  printOk(
      "ausÃªncia fÃ­sica nÃ£o confirmada â†’ BLOCKED",
  );
}


// ============================================================================
// 4. storeId do deleteResult divergente â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-delete-store-mismatch";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,
      });

  const deleteResult =
      createDeleteResult({
        backupId,

        storeId:
          "outra-store",
      });


  const result =
      planMarkBackupRetentionStorageDeleted({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        deleteResult,

        allBackups:
          [],

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
          "delete-result-store-id-mismatch",
      ),
  );


  printOk(
      "storeId do deleteResult divergente â†’ BLOCKED",
  );
}


// ============================================================================
// 5. backupId do deleteResult divergente â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-delete-id-mismatch";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,
      });

  const deleteResult =
      createDeleteResult({
        backupId:
          "outro-backup",
      });


  const result =
      planMarkBackupRetentionStorageDeleted({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        deleteResult,

        allBackups:
          [],

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
          "delete-result-backup-id-mismatch",
      ),
  );


  printOk(
      "backupId do deleteResult divergente â†’ BLOCKED",
  );
}


// ============================================================================
// 6. storagePath fÃ­sico divergente â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-path-mismatch";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,
      });

  const deleteResult =
      createDeleteResult({
        backupId,

        path:
          (
            `store_backups/` +
            `${STORE_ID}/outro-backup/` +
            `snapshot.json.gz`
          ),
      });


  const result =
      planMarkBackupRetentionStorageDeleted({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        deleteResult,

        allBackups:
          [],

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
          "delete-result-storage-path-mismatch",
      ),
  );


  printOk(
      "storagePath fÃ­sico divergente â†’ BLOCKED",
  );
}


// ============================================================================
// 7. lease ativo de outro worker â†’ SKIP_LEASED
// ============================================================================

{
  const backupId =
      "backup-leased-other";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,

        leaseOwner:
          OTHER_EXECUTION_ID,

        leaseExpiresAt:
          "2026-09-30T12:15:00.000Z",
      });

  const deleteResult =
      createDeleteResult({
        backupId,
      });


  const result =
      planMarkBackupRetentionStorageDeleted({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        deleteResult,

        allBackups:
          [],

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


  printOk(
      "lease ativo de outro worker â†’ SKIP_LEASED",
  );
}


// ============================================================================
// 8. lease expirado de outro worker â†’ exige takeover antes
// ============================================================================

{
  const backupId =
      "backup-takeover-required";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,

        leaseOwner:
          OTHER_EXECUTION_ID,

        leaseExpiresAt:
          "2026-09-30T11:59:00.000Z",
      });

  const deleteResult =
      createDeleteResult({
        backupId,
      });


  const result =
      planMarkBackupRetentionStorageDeleted({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        deleteResult,

        allBackups:
          [],

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
          "lease-takeover-required-before-storage-deleted",
      ),
  );


  printOk(
      "lease expirado de outro worker â†’ BLOCKED atÃ© takeover",
  );
}


// ============================================================================
// 9. mesmo worker, mas lease expirado â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-own-expired-lease";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,

        leaseOwner:
          EXECUTION_ID,

        leaseExpiresAt:
          "2026-09-30T11:59:00.000Z",
      });

  const deleteResult =
      createDeleteResult({
        backupId,
      });


  const result =
      planMarkBackupRetentionStorageDeleted({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        deleteResult,

        allBackups:
          [],

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


  printOk(
      "mesmo worker com lease expirado â†’ BLOCKED",
  );
}


// ============================================================================
// 10. operaÃ§Ã£o jÃ¡ storage_deleted â†’ ALREADY_STORAGE_DELETED
// ============================================================================

{
  const backupId =
      "backup-already-storage-deleted";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,

        status:
          "storage_deleted",
      });


  const result =
      planMarkBackupRetentionStorageDeleted({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        deleteResult:
          null,

        allBackups:
          [],

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
      true,
  );


  printOk(
      "operaÃ§Ã£o jÃ¡ storage_deleted â†’ ALREADY_STORAGE_DELETED",
  );
}


// ============================================================================
// 11. operaÃ§Ã£o completed sem snapshot â†’ ALREADY_COMPLETED
// ============================================================================

{
  const backupId =
      "backup-completed";

  const operation =
      createOperation({
        backupId,

        status:
          "completed",
      });


  const result =
      planMarkBackupRetentionStorageDeleted({
        storeId:
          STORE_ID,

        backupId,

        snapshot:
          null,

        operation,

        deleteResult:
          null,

        allBackups:
          [],

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
      true,
  );


  printOk(
      "operaÃ§Ã£o completed sem snapshot â†’ ALREADY_COMPLETED",
  );
}


// ============================================================================
// 12. operaÃ§Ã£o inexistente â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-operation-missing";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const deleteResult =
      createDeleteResult({
        backupId,
      });


  const result =
      planMarkBackupRetentionStorageDeleted({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation:
          null,

        deleteResult,

        allBackups:
          [],

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


  printOk(
      "operaÃ§Ã£o inexistente â†’ BLOCKED",
  );
}


// ============================================================================
// FINAL
// ============================================================================

console.log("");

console.log(
    "============================================================",
);

console.log(
    "âœ… TODOS OS TESTES DO MARK STORAGE_DELETED PASSARAM",
);

console.log(
    "============================================================",
);

console.log("");