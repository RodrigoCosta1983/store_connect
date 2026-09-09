"use strict";


const {
  ACTIONS:
    CLAIM_ACTIONS,

  RESUME_STAGES,

  planRetentionDeleteClaim,

  resolveSnapshotChecksum,
} = require(
    "./backupRetentionClaimPlanner",
);

const {
  ACTIONS:
    INSPECTION_ACTIONS,
} = require(
    "./inspectBackupRetentionStorageArtifact",
);


// ============================================================================
// F5.6-D3-G7.1
// PLANNER PURO DA FINALIZAÇÃO
// ============================================================================
//
// Decide se uma operação:
//
// storage_deleted
//      ↓
// completed
//
// pode ser finalizada.
//
// IMPORTANTE:
//
// ✅ puro;
// ✅ sem Firebase;
// ✅ sem Firestore;
// ✅ sem Storage;
// ✅ sem writes;
// ✅ exige nova confirmação de ausência física.
//
// ============================================================================


const ACTIONS = Object.freeze({
  FINALIZE_ALLOWED:
    "FINALIZE_ALLOWED",

  ALREADY_COMPLETED:
    "ALREADY_COMPLETED",

  SKIP_LEASED:
    "SKIP_LEASED",

  BLOCKED:
    "BLOCKED",
});


// ============================================================================
// HELPERS
// ============================================================================

function normalizeString(
    value,
) {
  return typeof value ===
    "string"
    ? value.trim()
    : "";
}


function normalizeDate(
    value,
) {
  if (!value) {
    return null;
  }


  if (
    value instanceof Date
  ) {
    return Number.isNaN(
        value.getTime(),
    )
      ? null
      : value;
  }


  if (
    typeof value.toDate ===
      "function"
  ) {
    const date =
        value.toDate();

    return (
      date instanceof Date &&
      !Number.isNaN(
          date.getTime(),
      )
    )
      ? date
      : null;
  }


  const date =
      new Date(
          value,
      );


  return Number.isNaN(
      date.getTime(),
  )
    ? null
    : date;
}


function blocked(
    code,
    message,
) {
  return {
    action:
      ACTIONS.BLOCKED,

    allowed:
      false,

    reasons: [
      {
        code,
        message,
      },
    ],
  };
}


function getAuditId(
    backupId,
) {
  return (
    `backup-retention-delete-` +
    `${backupId}`
  );
}


// ============================================================================
// PLANNER
// ============================================================================

function planBackupRetentionFinalization({
  storeId,
  backupId,
  snapshot,
  operation,
  storageInspection,
  auditExists =
    false,
  executionId,
  now,
}) {
  const normalizedStoreId =
      normalizeString(
          storeId,
      );

  const normalizedBackupId =
      normalizeString(
          backupId,
      );

  const normalizedExecutionId =
      normalizeString(
          executionId,
      );


  // ==========================================================================
  // 1. INPUTS
  // ==========================================================================

  if (!normalizedStoreId) {
    return blocked(
        "missing-store-id",
        "storeId é obrigatório.",
    );
  }


  if (!normalizedBackupId) {
    return blocked(
        "missing-backup-id",
        "backupId é obrigatório.",
    );
  }


  if (!normalizedExecutionId) {
    return blocked(
        "missing-execution-id",
        "executionId é obrigatório.",
    );
  }


  if (
    typeof auditExists !==
      "boolean"
  ) {
    return blocked(
        "invalid-audit-exists",
        "auditExists deve ser boolean.",
    );
  }


  // ==========================================================================
  // 2. BARREIRA DE INTEGRIDADE DA OPERAÇÃO
  // ==========================================================================

  const claimPlan =
      planRetentionDeleteClaim({
        storeId:
          normalizedStoreId,

        backupId:
          normalizedBackupId,

        snapshot,

        operation,

        allBackups:
          [],

        executionId:
          normalizedExecutionId,

        now,
      });


  // ==========================================================================
  // 3. COMPLETED — IDEMPOTÊNCIA
  // ==========================================================================

  if (
    claimPlan.action ===
      CLAIM_ACTIONS.ALREADY_COMPLETED
  ) {
    if (
      auditExists !==
        true
    ) {
      return blocked(
          "completed-audit-missing",
          (
            "A operação está completed, mas a auditoria " +
            "determinística não foi encontrada."
          ),
      );
    }


    return {
      action:
        ACTIONS.ALREADY_COMPLETED,

      allowed:
        false,

      storeId:
        normalizedStoreId,

      backupId:
        normalizedBackupId,

      auditId:
        getAuditId(
            normalizedBackupId,
        ),

      reasons: [],
    };
  }


  // ==========================================================================
  // 4. LEASE DE OUTRO WORKER
  // ==========================================================================

  if (
    claimPlan.action ===
      CLAIM_ACTIONS.SKIP_LEASED
  ) {
    return {
      action:
        ACTIONS.SKIP_LEASED,

      allowed:
        false,

      reasons:
        Array.isArray(
            claimPlan.reasons,
        )
          ? claimPlan.reasons
          : [],
    };
  }


  // ==========================================================================
  // 5. PRECISA ESTAR EM RESUME / FINALIZE
  // ==========================================================================

  if (
    claimPlan.action !==
      CLAIM_ACTIONS.RESUME ||
    claimPlan.resumeStage !==
      RESUME_STAGES.FINALIZE
  ) {
    return blocked(
        "operation-not-resumable-for-finalization",
        (
          "A operação não está em estado válido " +
          "para finalização."
        ),
    );
  }


  // ==========================================================================
  // 6. TAKEOVER PRIMEIRO
  // ==========================================================================

  if (
    claimPlan.shouldTakeOverLease ===
      true
  ) {
    return blocked(
        "lease-takeover-required-before-finalization",
        (
          "O worker atual precisa assumir o lease " +
          "antes da finalização."
        ),
    );
  }


  // ==========================================================================
  // 7. WORKER DEVE SER O DONO
  // ==========================================================================

  if (
    normalizeString(
        operation?.leaseOwner,
    ) !==
      normalizedExecutionId
  ) {
    return blocked(
        "lease-owner-mismatch-before-finalization",
        (
          "O worker atual não é o proprietário " +
          "do lease da operação."
        ),
    );
  }


  // ==========================================================================
  // 8. LEASE PRECISA ESTAR ATIVO
  // ==========================================================================

  const currentDate =
      normalizeDate(
          now,
      );

  const leaseExpiresAt =
      normalizeDate(
          operation?.leaseExpiresAt,
      );


  if (
    !currentDate ||
    !leaseExpiresAt
  ) {
    return blocked(
        "invalid-lease-time-before-finalization",
        (
          "Não foi possível validar o tempo do lease " +
          "antes da finalização."
        ),
    );
  }


  if (
    leaseExpiresAt.getTime() <=
      currentDate.getTime()
  ) {
    return blocked(
        "expired-lease-before-finalization",
        (
          "O lease expirou antes da finalização."
        ),
    );
  }


  // ==========================================================================
  // 9. AUDITORIA NÃO PODE EXISTIR ANTES DA TRANSACTION FINAL
  // ==========================================================================

  if (
    auditExists ===
      true
  ) {
    return blocked(
        "audit-exists-before-finalization",
        (
          "A auditoria final já existe enquanto a operação " +
          "ainda não está completed."
        ),
    );
  }


  // ==========================================================================
  // 10. CONFIRMA NOVAMENTE AUSÊNCIA FÍSICA
  // ==========================================================================

  if (
    !storageInspection ||
    typeof storageInspection !==
      "object" ||
    Array.isArray(
        storageInspection,
    )
  ) {
    return blocked(
        "storage-absence-not-confirmed",
        (
          "A ausência física do backup não foi " +
          "confirmada antes da finalização."
        ),
    );
  }


  // --------------------------------------------------------------------------
  // SE O ARTEFATO EXISTE NOVAMENTE, NÃO FINALIZA
  // --------------------------------------------------------------------------

  if (
    storageInspection.action ===
      INSPECTION_ACTIONS.ARTIFACT_VALID
  ) {
    return blocked(
        "storage-artifact-still-exists",
        (
          "O artefato físico ainda existe no Storage. " +
          "A metadata não pode ser removida."
        ),
    );
  }


  if (
    storageInspection.action !==
      INSPECTION_ACTIONS.ARTIFACT_ALREADY_MISSING ||
    storageInspection.allowed !==
      true
  ) {
    return blocked(
        "storage-absence-not-confirmed",
        (
          "O Storage não confirmou a ausência física " +
          "do artefato."
        ),
    );
  }


  // ==========================================================================
  // 11. IDENTIDADE DA PROVA DE AUSÊNCIA
  // ==========================================================================

  if (
    normalizeString(
        storageInspection.storeId,
    ) !==
      normalizedStoreId
  ) {
    return blocked(
        "storage-proof-store-id-mismatch",
        (
          "O storeId da confirmação de ausência " +
          "não corresponde à operação."
        ),
    );
  }


  if (
    normalizeString(
        storageInspection.backupId,
    ) !==
      normalizedBackupId
  ) {
    return blocked(
        "storage-proof-backup-id-mismatch",
        (
          "O backupId da confirmação de ausência " +
          "não corresponde à operação."
        ),
    );
  }


  const frozenStoragePath =
      normalizeString(
          operation?.snapshot?.storagePath,
      );


  if (
    normalizeString(
        storageInspection.storagePath,
    ) !==
      frozenStoragePath
  ) {
    return blocked(
        "storage-proof-path-mismatch",
        (
          "O caminho confirmado como ausente " +
          "não corresponde ao snapshot congelado."
        ),
    );
  }


  // ==========================================================================
  // 12. CHECKSUM CONGELADO
  // ==========================================================================

  const checksumResult =
      resolveSnapshotChecksum(
          operation?.snapshot,
      );


  if (
    !checksumResult.valid ||
    checksumResult.conflict
  ) {
    return blocked(
        "invalid-frozen-checksum-before-finalization",
        (
          "O checksum congelado da operação é inválido."
        ),
    );
  }


  // ==========================================================================
  // 13. FINALIZAÇÃO AUTORIZADA
  // ==========================================================================

  return {
    action:
      ACTIONS.FINALIZE_ALLOWED,

    allowed:
      true,

    storeId:
      normalizedStoreId,

    backupId:
      normalizedBackupId,

    operationId:
      normalizedBackupId,

    storagePath:
      frozenStoragePath,

    checksum:
      checksumResult.checksum,

    originalCreatedAt:
      operation.snapshot.createdAt,

    auditId:
      getAuditId(
          normalizedBackupId,
      ),

    reasons: [],
  };
}


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  ACTIONS,
  getAuditId,
  planBackupRetentionFinalization,
};