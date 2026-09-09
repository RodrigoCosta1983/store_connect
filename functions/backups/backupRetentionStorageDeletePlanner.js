"use strict";


const {
  planRetentionDeleteClaim,
  ACTIONS: CLAIM_ACTIONS,
  RESUME_STAGES,
} = require(
    "./backupRetentionClaimPlanner",
);


// ============================================================================
// STORE&CONNECT — STORAGE DELETE PLANNER
// ============================================================================
//
// F5.6-D3-G1
//
// Responsabilidade:
//
// decidir, de forma PURA, se uma operação de retenção
// está autorizada a executar a futura exclusão física
// do arquivo no Storage.
//
// ESTE ARQUIVO:
//
// ✅ valida estado;
// ✅ valida integridade através do Claim Planner;
// ✅ valida ownership do lease;
// ✅ valida validade temporal do lease;
// ✅ reconhece Storage já removido;
//
// NÃO:
//
// ❌ acessa Firestore;
// ❌ acessa Storage;
// ❌ executa delete();
// ❌ altera documentos.
//
// ============================================================================


// ============================================================================
// ACTIONS
// ============================================================================

const ACTIONS =
    Object.freeze({
      DELETE_STORAGE_ALLOWED:
        "DELETE_STORAGE_ALLOWED",

      ALREADY_STORAGE_DELETED:
        "ALREADY_STORAGE_DELETED",

      ALREADY_COMPLETED:
        "ALREADY_COMPLETED",

      SKIP_LEASED:
        "SKIP_LEASED",

      BLOCKED:
        "BLOCKED",
    });


// ============================================================================
// MARGEM MÍNIMA DO LEASE PARA INICIAR OPERAÇÃO EXTERNA
// ============================================================================
//
// Não iniciamos uma exclusão física se o lease estiver perto de expirar.
// Nesse caso o worker deve primeiro renovar o lease pela D3-F.
//
// ============================================================================

const MIN_LEASE_REMAINING_MS =
    60 * 1000;


// ============================================================================
// NORMALIZAÇÕES
// ============================================================================

function normalizeId(
    value,
) {
  if (
    typeof value !==
      "string"
  ) {
    return null;
  }


  const normalized =
      value.trim();


  return normalized
    ? normalized
    : null;
}


function toDate(
    value,
) {
  if (!value) {
    return null;
  }


  // --------------------------------------------------------------------------
  // Date nativo
  // --------------------------------------------------------------------------

  if (
    value instanceof Date
  ) {
    return Number.isNaN(
        value.getTime(),
    )
      ? null
      : value;
  }


  // --------------------------------------------------------------------------
  // Firestore Timestamp
  // --------------------------------------------------------------------------

  if (
    typeof value.toDate ===
      "function"
  ) {
    try {
      const converted =
          value.toDate();


      if (
        converted instanceof Date &&
        !Number.isNaN(
            converted.getTime(),
        )
      ) {
        return converted;
      }
    } catch (_) {
      return null;
    }
  }


  // --------------------------------------------------------------------------
  // string / number
  // --------------------------------------------------------------------------

  const converted =
      new Date(value);


  return Number.isNaN(
      converted.getTime(),
  )
    ? null
    : converted;
}


// ============================================================================
// RESULTADOS
// ============================================================================

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


function skipped(
    reasons = [],
) {
  return {
    action:
      ACTIONS.SKIP_LEASED,

    allowed:
      false,

    reasons,
  };
}


// ============================================================================
// PLANNER
// ============================================================================

function planBackupRetentionStorageDelete({
  storeId,
  backupId,
  snapshot,
  operation,
  executionId,
  now = new Date(),
}) {
  // ==========================================================================
  // 1. INPUTS BÁSICOS
  // ==========================================================================

  const normalizedStoreId =
      normalizeId(
          storeId,
      );

  const normalizedBackupId =
      normalizeId(
          backupId,
      );

  const normalizedExecutionId =
      normalizeId(
          executionId,
      );

  const currentDate =
      toDate(
          now,
      );


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


  if (!currentDate) {
    return blocked(
        "invalid-current-time",
        "Horário atual inválido.",
    );
  }


  if (
    !operation ||
    typeof operation !==
      "object"
  ) {
    return blocked(
        "operation-not-found",
        "Operação de retenção inexistente.",
    );
  }


  // ==========================================================================
  // 2. USA O CLAIM PLANNER COMO BARREIRA DE INTEGRIDADE
  // ==========================================================================
  //
  // Para uma operação já existente, o Claim Planner valida:
  //
  // - storeId;
  // - backupId;
  // - reason;
  // - estado;
  // - snapshot deleting;
  // - retentionDeleteOperationId;
  // - storagePath;
  // - checksum;
  // - createdAt;
  // - frozen snapshot;
  // - consistência da operação;
  // - lease.
  //
  // Não criamos novo CLAIM aqui.
  //
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

        now:
          currentDate,
      });


  // ==========================================================================
  // 3. INTEGRIDADE BLOQUEADA
  // ==========================================================================

  if (
    claimPlan.action ===
      CLAIM_ACTIONS.BLOCKED
  ) {
    return {
      action:
        ACTIONS.BLOCKED,

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
  // 4. OPERAÇÃO JÁ FINALIZADA
  // ==========================================================================

  if (
    claimPlan.action ===
      CLAIM_ACTIONS.ALREADY_COMPLETED
  ) {
    return {
      action:
        ACTIONS.ALREADY_COMPLETED,

      allowed:
        false,

      reasons: [],
    };
  }


  // ==========================================================================
  // 5. STORAGE JÁ FOI REMOVIDO
  // ==========================================================================
  //
  // Independente de quem executará a etapa seguinte:
  // esta função nunca deve autorizar um segundo delete físico
  // quando a máquina de estados já registra storage_deleted.
  //
  // ==========================================================================

  if (
    operation.status ===
      "storage_deleted"
  ) {
    return {
      action:
        ACTIONS.ALREADY_STORAGE_DELETED,

      allowed:
        false,

      resumeStage:
        RESUME_STAGES.FINALIZE,

      reasons: [],
    };
  }


  // ==========================================================================
  // 6. SOMENTE CLAIMED PODE CHEGAR AO DELETE FÍSICO
  // ==========================================================================

  if (
    operation.status !==
      "claimed"
  ) {
    return blocked(
        "invalid-operation-status-for-storage-delete",
        (
          "Somente operação claimed pode " +
          "executar exclusão física do Storage."
        ),
    );
  }


  // ==========================================================================
  // 7. OUTRO WORKER POSSUI LEASE ATIVO
  // ==========================================================================

  if (
    claimPlan.action ===
      CLAIM_ACTIONS.SKIP_LEASED
  ) {
    return skipped(
        Array.isArray(
            claimPlan.reasons,
        )
          ? claimPlan.reasons
          : [],
    );
  }


  // ==========================================================================
  // 8. CLAIM PLANNER PRECISA ESTAR EM RESUME/STORAGE_DELETE
  // ==========================================================================

  if (
    claimPlan.action !==
      CLAIM_ACTIONS.RESUME ||
    claimPlan.resumeStage !==
      RESUME_STAGES.STORAGE_DELETE
  ) {
    return blocked(
        "storage-delete-stage-not-authorized",
        (
          "A operação não está autorizada " +
          "para a etapa de exclusão do Storage."
        ),
    );
  }


  // ==========================================================================
  // 9. O WORKER ATUAL PRECISA SER O DONO EXATO DO LEASE
  // ==========================================================================

  const leaseOwner =
      normalizeId(
          operation.leaseOwner,
      );


  if (
    leaseOwner !==
      normalizedExecutionId
  ) {
    return blocked(
        "lease-owner-mismatch",
        (
          "O worker atual não é o proprietário " +
          "do lease da operação."
        ),
    );
  }


  // ==========================================================================
  // 10. LEASE PRECISA TER DATA VÁLIDA
  // ==========================================================================

  const leaseExpiresAt =
      toDate(
          operation.leaseExpiresAt,
      );


  if (!leaseExpiresAt) {
    return blocked(
        "invalid-lease-expiration",
        "leaseExpiresAt inválido.",
    );
  }


  // ==========================================================================
  // 11. LEASE PRECISA ESTAR ATIVO
  // ==========================================================================
  //
  // Igual também é considerado expirado:
  //
  // leaseExpiresAt <= now
  //
  // Nenhuma exclusão física pode começar com lease vencido.
  //
  // ==========================================================================

  const remainingLeaseMs =
      leaseExpiresAt.getTime() -
      currentDate.getTime();


  if (
    remainingLeaseMs <
      MIN_LEASE_REMAINING_MS
  ) {
    return blocked(
        "insufficient-lease-time-for-storage-delete",
        (
          "O lease não possui tempo restante suficiente " +
          "para iniciar a exclusão física do Storage."
        ),
    );
  }


  // ==========================================================================
  // 12. AUTORIZAÇÃO FINAL
  // ==========================================================================

  return {
    action:
      ACTIONS.DELETE_STORAGE_ALLOWED,

    allowed:
      true,

    storeId:
      normalizedStoreId,

    backupId:
      normalizedBackupId,

    executionId:
      normalizedExecutionId,

    storagePath:
      operation.snapshot
          .storagePath,

    checksum:
      operation.snapshot
          .checksum,

    leaseExpiresAt:
      leaseExpiresAt
          .toISOString(),

    reasons: [],
  };
}


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  planBackupRetentionStorageDelete,
  ACTIONS,
  toDate,
};