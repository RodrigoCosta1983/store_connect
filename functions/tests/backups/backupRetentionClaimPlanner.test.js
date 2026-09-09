"use strict";


const assert =
    require("assert");

const {
  planRetentionDeleteClaim,
  ACTIONS,
  RESUME_STAGES,
} = require(
    "../../backups/backupRetentionClaimPlanner",
);


// ============================================================================
// STORE&CONNECT â€” TESTES DO PURE CLAIM PLANNER
// ============================================================================
//
// F5.6-D3-D
//
// Testes 100% locais.
//
// âŒ sem Firebase
// âŒ sem Firestore
// âŒ sem Storage
// âŒ sem writes
// âŒ sem deletes
//
// ============================================================================


const STORE_ID =
    "store-test";

const EXECUTION_ID =
    "execution-A";

const OTHER_EXECUTION_ID =
    "execution-B";

const VALID_CHECKSUM =
    "a".repeat(64);

const OTHER_CHECKSUM =
    "b".repeat(64);

const NOW =
    new Date(
        "2026-09-30T12:00:00.000Z",
    );


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


function createReadyBackup(
    date,
) {
  const backupId =
      `backup-${date}-automatic-ready`;

  return {
    backupId,

    storeId:
      STORE_ID,

    type:
      "automatic",

    status:
      "ready",

    protected:
      false,

    createdAt:
      `${date}T12:00:00.000Z`,

    storagePath:
      storagePath(
          backupId,
      ),

    checksum:
      VALID_CHECKSUM,

    compressedBytes:
      123456,
  };
}


function createRetentionDataset() {
  const dates = [
    "2026-09-30",
    "2026-09-29",
    "2026-09-28",
    "2026-09-27",
    "2026-09-26",
    "2026-09-25",
    "2026-09-24",

    "2026-09-23",
    "2026-09-20",
    "2026-09-13",
    "2026-09-06",
    "2026-09-05",

    "2026-08-30",
    "2026-08-29",

    "2026-07-31",
    "2026-07-30",

    "2026-06-30",
    "2026-06-29",

    "2026-05-31",
    "2026-05-30",

    "2026-04-30",
    "2026-04-29",

    "2026-03-31",
    "2026-03-30",

    "2026-02-28",
  ];

  return dates.map(
      createReadyBackup,
  );
}


function findBackup(
    backups,
    date,
) {
  return backups.find(
      (backup) =>
        backup.backupId ===
        `backup-${date}-automatic-ready`,
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

  operationId =
    null,

  storeId =
    STORE_ID,

  type =
    "automatic",

  status =
    "deleting",

  reason =
    "retention_policy",
} = {}) {
  return {
    backupId,

    storeId,

    type,

    status,

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
      reason,
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


function assertAction(
    result,
    expectedAction,
) {
  assert.strictEqual(
      result.action,
      expectedAction,
  );
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
// INÃCIO
// ============================================================================

console.log("");
console.log(
    "============================================================",
);
console.log(
    "F5.6-D3-D â€” TESTES DO PURE CLAIM PLANNER",
);
console.log(
    "============================================================",
);


// ============================================================================
// 1. NOVO CANDIDATO LEGÃTIMO â†’ CREATE_CLAIM
// ============================================================================

{
  const backups =
      createRetentionDataset();

  const snapshot =
      findBackup(
          backups,
          "2026-09-05",
      );

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId:
          snapshot.backupId,

        snapshot,

        operation:
          null,

        allBackups:
          backups,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.CREATE_CLAIM,
  );

  assert.strictEqual(
      result.allowed,
      true,
  );

  assert.strictEqual(
      result.frozenSnapshot.checksum,
      VALID_CHECKSUM,
  );

  assert.strictEqual(
      result.frozenSnapshot.storagePath,
      snapshot.storagePath,
  );

  printOk(
      "candidato legÃ­timo â†’ CREATE_CLAIM",
  );
}


// ============================================================================
// 2. CANDIDATO ANTIGO VIROU KEEP â†’ NOT_ALLOWED
// ============================================================================

{
  const backups =
      createRetentionDataset()
          .filter(
              (backup) =>
                backup.backupId !==
                "backup-2026-09-06-automatic-ready",
          );

  const snapshot =
      findBackup(
          backups,
          "2026-09-05",
      );

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId:
          snapshot.backupId,

        snapshot,

        operation:
          null,

        allBackups:
          backups,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.NOT_ALLOWED,
  );

  assert.strictEqual(
      result.allowed,
      false,
  );

  assert(
      hasReason(
          result,
          "retained-by-policy",
      ),
  );

  printOk(
      "candidato antigo que virou KEEP â†’ NOT_ALLOWED",
  );
}


// ============================================================================
// 3. NOVO CLAIM COM CHECKSUM INVÃLIDO â†’ BLOCKED
// ============================================================================

{
  const backups =
      createRetentionDataset();

  const original =
      findBackup(
          backups,
          "2026-09-05",
      );

  const snapshot = {
    ...original,

    checksum:
      "checksum-invalido",
  };

  const updatedBackups =
      backups.map(
          (backup) =>
            backup.backupId ===
              snapshot.backupId
              ? snapshot
              : backup,
      );

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId:
          snapshot.backupId,

        snapshot,

        operation:
          null,

        allBackups:
          updatedBackups,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert(
      hasReason(
          result,
          "invalid-snapshot-checksum",
      ),
  );

  printOk(
      "checksum invÃ¡lido antes do CLAIM â†’ BLOCKED",
  );
}


// ============================================================================
// 4. SNAPSHOT JÃ VINCULADO SEM OPERAÃ‡ÃƒO â†’ BLOCKED
// ============================================================================

{
  const backups =
      createRetentionDataset();

  const original =
      findBackup(
          backups,
          "2026-09-05",
      );

  const snapshot = {
    ...original,

    retentionDeleteOperationId:
      "operation-inexistente",
  };

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId:
          snapshot.backupId,

        snapshot,

        operation:
          null,

        allBackups:
          backups,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert(
      hasReason(
          result,
          "unexpected-existing-operation-link",
      ),
  );

  printOk(
      "snapshot vinculado sem operaÃ§Ã£o â†’ BLOCKED",
  );
}


// ============================================================================
// 5. COMPLETED SEM SNAPSHOT â†’ ALREADY_COMPLETED
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
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot:
          null,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.ALREADY_COMPLETED,
  );

  printOk(
      "completed sem snapshot â†’ ALREADY_COMPLETED",
  );
}


// ============================================================================
// 6. COMPLETED COM SNAPSHOT AINDA EXISTENTE â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-completed-invalid";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,

        status:
          "completed",
      });

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert(
      hasReason(
          result,
          "completed-snapshot-still-exists",
      ),
  );

  printOk(
      "completed com snapshot existente â†’ BLOCKED",
  );
}


// ============================================================================
// 7. OPERAÃ‡ÃƒO BLOCKED â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-blocked";

  const operation =
      createOperation({
        backupId,

        status:
          "blocked",
      });

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot:
          null,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert(
      hasReason(
          result,
          "operation-already-blocked",
      ),
  );

  printOk(
      "operaÃ§Ã£o blocked â†’ BLOCKED",
  );
}


// ============================================================================
// 8. CLAIMED + MESMO DONO DO LEASE â†’ RESUME STORAGE DELETE
// ============================================================================

{
  const backupId =
      "backup-claimed-owner";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,

        status:
          "claimed",

        leaseOwner:
          EXECUTION_ID,
      });

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.RESUME,
  );

  assert.strictEqual(
      result.resumeStage,
      RESUME_STAGES.STORAGE_DELETE,
  );

  assert.strictEqual(
      result.shouldTakeOverLease,
      false,
  );

  printOk(
      "claimed + mesmo leaseOwner â†’ RESUME storage_delete",
  );
}


// ============================================================================
// 9. CLAIMED + LEASE ATIVO DE OUTRO WORKER â†’ SKIP_LEASED
// ============================================================================

{
  const backupId =
      "backup-claimed-leased";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,

        status:
          "claimed",

        leaseOwner:
          OTHER_EXECUTION_ID,

        leaseExpiresAt:
          "2026-09-30T12:15:00.000Z",
      });

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.SKIP_LEASED,
  );

  assert.strictEqual(
      result.leaseOwner,
      OTHER_EXECUTION_ID,
  );

  printOk(
      "claimed + lease ativo de outro worker â†’ SKIP_LEASED",
  );
}


// ============================================================================
// 10. CLAIMED + LEASE EXPIRADO â†’ RESUME + TAKEOVER
// ============================================================================

{
  const backupId =
      "backup-claimed-expired";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,

        status:
          "claimed",

        leaseOwner:
          OTHER_EXECUTION_ID,

        leaseExpiresAt:
          "2026-09-30T11:59:00.000Z",
      });

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.RESUME,
  );

  assert.strictEqual(
      result.resumeStage,
      RESUME_STAGES.STORAGE_DELETE,
  );

  assert.strictEqual(
      result.shouldTakeOverLease,
      true,
  );

  printOk(
      "claimed + lease expirado â†’ RESUME com takeover",
  );
}


// ============================================================================
// 11. STORAGE_DELETED â†’ RESUME FINALIZE
// ============================================================================

{
  const backupId =
      "backup-storage-deleted";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,

        status:
          "storage_deleted",

        leaseOwner:
          EXECUTION_ID,
      });

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.RESUME,
  );

  assert.strictEqual(
      result.resumeStage,
      RESUME_STAGES.FINALIZE,
  );

  printOk(
      "storage_deleted â†’ RESUME finalize",
  );
}


// ============================================================================
// 12. CLAIMED SEM SNAPSHOT â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-missing-snapshot";

  const operation =
      createOperation({
        backupId,

        status:
          "claimed",
      });

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot:
          null,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert(
      hasReason(
          result,
          "snapshot-missing-for-active-operation",
      ),
  );

  printOk(
      "claimed sem snapshot â†’ BLOCKED",
  );
}


// ============================================================================
// 13. SNAPSHOT NÃƒO ESTÃ DELETING â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-wrong-status";

  const snapshot =
      createDeletingSnapshot({
        backupId,

        status:
          "ready",
      });

  const operation =
      createOperation({
        backupId,
      });

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert(
      hasReason(
          result,
          "snapshot-not-deleting",
      ),
  );

  printOk(
      "operaÃ§Ã£o ativa com snapshot ready â†’ BLOCKED",
  );
}


// ============================================================================
// 14. OPERATION ID DIVERGENTE â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-operation-link";

  const snapshot =
      createDeletingSnapshot({
        backupId,

        operationId:
          "outra-operacao",
      });

  const operation =
      createOperation({
        backupId,
      });

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert(
      hasReason(
          result,
          "snapshot-operation-id-mismatch",
      ),
  );

  printOk(
      "retentionDeleteOperationId divergente â†’ BLOCKED",
  );
}


// ============================================================================
// 15. STORE ID DA OPERAÃ‡ÃƒO DIVERGENTE â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-store-operation";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,

        storeId:
          "outra-store",
      });

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert(
      hasReason(
          result,
          "operation-store-id-mismatch",
      ),
  );

  printOk(
      "storeId da operaÃ§Ã£o divergente â†’ BLOCKED",
  );
}


// ============================================================================
// 16. BACKUP ID DA OPERAÃ‡ÃƒO DIVERGENTE â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-id-operation";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,

        operationBackupId:
          "outro-backup",
      });

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert(
      hasReason(
          result,
          "operation-backup-id-mismatch",
      ),
  );

  printOk(
      "backupId da operaÃ§Ã£o divergente â†’ BLOCKED",
  );
}


// ============================================================================
// 17. STORAGE PATH ALTERADO APÃ“S CLAIM â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-path-changed";

  const snapshot =
      createDeletingSnapshot({
        backupId,

        path:
          "store_backups/store-test/outro/snapshot.json.gz",
      });

  const operation =
      createOperation({
        backupId,
      });

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert(
      hasReason(
          result,
          "snapshot-storage-path-mismatch",
      ),
  );

  assert(
      hasReason(
          result,
          "storage-path-changed-after-claim",
      ),
  );

  printOk(
      "storagePath alterado apÃ³s CLAIM â†’ BLOCKED",
  );
}


// ============================================================================
// 18. CHECKSUM ALTERADO APÃ“S CLAIM â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-checksum-changed";

  const snapshot =
      createDeletingSnapshot({
        backupId,

        checksum:
          OTHER_CHECKSUM,
      });

  const operation =
      createOperation({
        backupId,

        checksum:
          VALID_CHECKSUM,
      });

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert(
      hasReason(
          result,
          "checksum-changed-after-claim",
      ),
  );

  printOk(
      "checksum alterado apÃ³s CLAIM â†’ BLOCKED",
  );
}


// ============================================================================
// 19. CREATED AT ALTERADO APÃ“S CLAIM â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-created-at-changed";

  const snapshot =
      createDeletingSnapshot({
        backupId,

        createdAt:
          "2026-01-02T12:00:00.000Z",
      });

  const operation =
      createOperation({
        backupId,

        createdAt:
          "2026-01-01T12:00:00.000Z",
      });

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert(
      hasReason(
          result,
          "created-at-changed-after-claim",
      ),
  );

  printOk(
      "createdAt alterado apÃ³s CLAIM â†’ BLOCKED",
  );
}


// ============================================================================
// 20. LEASE INVÃLIDO â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-invalid-lease";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,

        leaseOwner:
          "",
      });

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert(
      hasReason(
          result,
          "invalid-operation-lease",
      ),
  );

  printOk(
      "lease invÃ¡lido â†’ BLOCKED",
  );
}


// ============================================================================
// 21. EXECUTION ID AUSENTE â†’ BLOCKED
// ============================================================================

{
  const backupId =
      "backup-missing-execution";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });

  const operation =
      createOperation({
        backupId,
      });

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        allBackups:
          [],

        executionId:
          "",

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert(
      hasReason(
          result,
          "missing-execution-id",
      ),
  );

  printOk(
      "executionId ausente â†’ BLOCKED",
  );
}


// ============================================================================
// 22. NOVO CLAIM SEM EXECUTION ID â†’ BLOCKED
// ============================================================================

{
  const backups =
      createRetentionDataset();

  const snapshot =
      findBackup(
          backups,
          "2026-09-05",
      );

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId:
          snapshot.backupId,

        snapshot,

        operation:
          null,

        allBackups:
          backups,

        executionId:
          "",

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert(
      hasReason(
          result,
          "missing-execution-id",
      ),
  );

  printOk(
      "novo CLAIM sem executionId â†’ BLOCKED",
  );
}


// ============================================================================
// 23. NOVO CLAIM COM HORÃRIO INVÃLIDO â†’ BLOCKED
// ============================================================================

{
  const backups =
      createRetentionDataset();

  const snapshot =
      findBackup(
          backups,
          "2026-09-05",
      );

  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId:
          snapshot.backupId,

        snapshot,

        operation:
          null,

        allBackups:
          backups,

        executionId:
          EXECUTION_ID,

        now:
          "data-invalida",
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert(
      hasReason(
          result,
          "invalid-current-time",
      ),
  );

  printOk(
      "novo CLAIM com horÃ¡rio invÃ¡lido â†’ BLOCKED",
  );
}


// ============================================================================
// 24. NOVO CLAIM COM checksumSha256 OFICIAL â†’ CREATE_CLAIM
// ============================================================================

{
  const backups =
      createRetentionDataset();

  const original =
      findBackup(
          backups,
          "2026-09-05",
      );

  const snapshot = {
    ...original,

    checksumSha256:
      VALID_CHECKSUM,
  };

  delete snapshot.checksum;


  const updatedBackups =
      backups.map(
          (backup) =>
            backup.backupId ===
              snapshot.backupId
              ? snapshot
              : backup,
      );


  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId:
          snapshot.backupId,

        snapshot,

        operation:
          null,

        allBackups:
          updatedBackups,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.CREATE_CLAIM,
  );

  assert.strictEqual(
      result.allowed,
      true,
  );

  assert.strictEqual(
      result.frozenSnapshot.checksum,
      VALID_CHECKSUM,
  );


  printOk(
      "checksumSha256 oficial â†’ CREATE_CLAIM",
  );
}


// ============================================================================
// 25. NOVO CLAIM COM checksum INTERNO â†’ CREATE_CLAIM
// ============================================================================

{
  const backups =
      createRetentionDataset();

  const snapshot =
      findBackup(
          backups,
          "2026-09-05",
      );


  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId:
          snapshot.backupId,

        snapshot,

        operation:
          null,

        allBackups:
          backups,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.CREATE_CLAIM,
  );

  assert.strictEqual(
      result.allowed,
      true,
  );

  assert.strictEqual(
      result.frozenSnapshot.checksum,
      VALID_CHECKSUM,
  );


  printOk(
      "checksum interno â†’ CREATE_CLAIM",
  );
}


// ============================================================================
// 26. checksum + checksumSha256 IGUAIS â†’ CREATE_CLAIM
// ============================================================================

{
  const backups =
      createRetentionDataset();

  const original =
      findBackup(
          backups,
          "2026-09-05",
      );

  const snapshot = {
    ...original,

    checksum:
      VALID_CHECKSUM,

    checksumSha256:
      VALID_CHECKSUM,
  };


  const updatedBackups =
      backups.map(
          (backup) =>
            backup.backupId ===
              snapshot.backupId
              ? snapshot
              : backup,
      );


  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId:
          snapshot.backupId,

        snapshot,

        operation:
          null,

        allBackups:
          updatedBackups,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.CREATE_CLAIM,
  );

  assert.strictEqual(
      result.allowed,
      true,
  );

  assert.strictEqual(
      result.frozenSnapshot.checksum,
      VALID_CHECKSUM,
  );


  printOk(
      "checksum + checksumSha256 iguais â†’ CREATE_CLAIM",
  );
}


// ============================================================================
// 27. checksum + checksumSha256 DIVERGENTES â†’ BLOCKED
// ============================================================================

{
  const backups =
      createRetentionDataset();

  const original =
      findBackup(
          backups,
          "2026-09-05",
      );

  const snapshot = {
    ...original,

    checksum:
      VALID_CHECKSUM,

    checksumSha256:
      OTHER_CHECKSUM,
  };


  const updatedBackups =
      backups.map(
          (backup) =>
            backup.backupId ===
              snapshot.backupId
              ? snapshot
              : backup,
      );


  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId:
          snapshot.backupId,

        snapshot,

        operation:
          null,

        allBackups:
          updatedBackups,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert.strictEqual(
      result.allowed,
      false,
  );

  assert(
      hasReason(
          result,
          "snapshot-checksum-fields-conflict",
      ),
  );


  printOk(
      "checksum + checksumSha256 divergentes â†’ BLOCKED",
  );
}


// ============================================================================
// 28. checksumSha256 OFICIAL INVÃLIDO â†’ BLOCKED
// ============================================================================

{
  const backups =
      createRetentionDataset();

  const original =
      findBackup(
          backups,
          "2026-09-05",
      );

  const snapshot = {
    ...original,

    checksumSha256:
      "checksum-oficial-invalido",
  };

  delete snapshot.checksum;


  const updatedBackups =
      backups.map(
          (backup) =>
            backup.backupId ===
              snapshot.backupId
              ? snapshot
              : backup,
      );


  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId:
          snapshot.backupId,

        snapshot,

        operation:
          null,

        allBackups:
          updatedBackups,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.BLOCKED,
  );

  assert.strictEqual(
      result.allowed,
      false,
  );

  assert(
      hasReason(
          result,
          "invalid-snapshot-checksum",
      ),
  );


  printOk(
      "checksumSha256 oficial invÃ¡lido â†’ BLOCKED",
  );
}


// ============================================================================
// 29. OPERAÃ‡ÃƒO EXISTENTE: checksumSha256 ATUAL + checksum CONGELADO â†’ RESUME
// ============================================================================

{
  const backupId =
      "backup-resume-official-checksum";

  const snapshot =
      createDeletingSnapshot({
        backupId,
      });


  snapshot.checksumSha256 =
      VALID_CHECKSUM;

  delete snapshot.checksum;


  const operation =
      createOperation({
        backupId,

        status:
          "claimed",

        checksum:
          VALID_CHECKSUM,

        leaseOwner:
          EXECUTION_ID,
      });


  const result =
      planRetentionDeleteClaim({
        storeId:
          STORE_ID,

        backupId,

        snapshot,

        operation,

        allBackups:
          [],

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assertAction(
      result,
      ACTIONS.RESUME,
  );

  assert.strictEqual(
      result.allowed,
      true,
  );

  assert.strictEqual(
      result.resumeStage,
      RESUME_STAGES.STORAGE_DELETE,
  );

  assert.strictEqual(
      result.shouldTakeOverLease,
      false,
  );


  printOk(
      "checksumSha256 atual + checksum congelado â†’ RESUME",
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
    "âœ… TODOS OS TESTES DO CLAIM PLANNER PASSARAM",
);
console.log(
    "============================================================",
);
console.log("");