"use strict";


const {
  ACTIONS:
    CLAIM_ACTIONS,
  RESUME_STAGES,
  planRetentionDeleteClaim,
} = require(
    "./backupRetentionClaimPlanner",
);

const {
  ACTIONS:
    DELETE_ACTIONS,
} = require(
    "./deleteBackupRetentionStorageArtifact",
);


// ============================================================================
// STORE&CONNECT — PLANNER DE TRANSIÇÃO PARA storage_deleted
// ============================================================================
//
// F5.6-D3-G5.1
//
// Decide se uma operação de retenção pode avançar:
//
// claimed
//   ↓
// storage_deleted
//
// ESTE ARQUIVO:
//
// ✅ é puro;
// ✅ não usa Firebase;
// ✅ não altera Firestore;
// ✅ não altera Storage;
//
// ============================================================================


// ============================================================================
// ACTIONS
// ============================================================================

const ACTIONS =
    Object.freeze({
      MARK_STORAGE_DELETED:
        "MARK_STORAGE_DELETED",

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
  if (
    value instanceof Date &&
    !Number.isNaN(
        value.getTime(),
    )
  ) {
    return value;
  }


  if (
    value &&
    typeof value.toDate ===
      "function"
  ) {
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
  }


  const parsed =
      new Date(
          value,
      );


  return Number.isNaN(
      parsed.getTime(),
  )
    ? null
    : parsed;
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


// ============================================================================
// PLANNER
// ============================================================================

function planMarkBackupRetentionStorageDeleted({
  storeId,
  backupId,
  snapshot,
  operation,
  deleteResult,
  allBackups = [],
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


  if (
    !normalizedStoreId ||
    !normalizedBackupId ||
    !normalizedExecutionId
  ) {
    return blocked(
        "invalid-input",
        (
          "storeId, backupId e executionId " +
          "são obrigatórios."
        ),
    );
  }


  if (
    !operation ||
    typeof operation !==
      "object" ||
    Array.isArray(
        operation,
    )
  ) {
    return blocked(
        "operation-missing",
        "A operação de retenção não existe.",
    );
  }


    // --------------------------------------------------------------------------
    // BARREIRA DE INTEGRIDADE DA OPERAÇÃO EXISTENTE
    // --------------------------------------------------------------------------

    const claimPlan =
        planRetentionDeleteClaim({
          storeId:
            normalizedStoreId,

          backupId:
            normalizedBackupId,

          snapshot,

          operation,

          allBackups,

          executionId:
            normalizedExecutionId,

          now,
        });


    if (
      claimPlan.action ===
        CLAIM_ACTIONS.ALREADY_COMPLETED
    ) {
      return {
        action:
          ACTIONS.ALREADY_COMPLETED,

        allowed:
          true,

        reasons: [],
      };
    }


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
          claimPlan.reasons || [],
      };
    }


    if (
      claimPlan.action ===
        CLAIM_ACTIONS.RESUME &&
      claimPlan.resumeStage ===
        RESUME_STAGES.FINALIZE
    ) {
      return {
        action:
          ACTIONS.ALREADY_STORAGE_DELETED,

        allowed:
          true,

        reasons: [],
      };
    }


    if (
      claimPlan.action !==
        CLAIM_ACTIONS.RESUME ||
      claimPlan.resumeStage !==
        RESUME_STAGES.STORAGE_DELETE
    ) {
      return blocked(
          "operation-not-resumable-for-storage-delete",
          (
            "A operação não está em estado íntegro " +
            "para confirmar storage_deleted."
          ),
      );
    }

  // --------------------------------------------------------------------------
  // DELETE RESULT
  // --------------------------------------------------------------------------

  if (
    !deleteResult ||
    typeof deleteResult !==
      "object" ||
    Array.isArray(
        deleteResult,
    )
  ) {
    return blocked(
        "invalid-delete-result",
        (
          "O resultado da exclusão física " +
          "é obrigatório."
        ),
    );
  }


  if (
    deleteResult.action !==
      DELETE_ACTIONS.STORAGE_ABSENCE_CONFIRMED ||
    deleteResult.allowed !==
      true
  ) {
    return blocked(
        "storage-absence-not-confirmed",
        (
          "A ausência física do artefato " +
          "ainda não foi confirmada."
        ),
    );
  }


  if (
    normalizeString(
        deleteResult.storeId,
    ) !==
      normalizedStoreId
  ) {
    return blocked(
        "delete-result-store-id-mismatch",
        (
          "O storeId do resultado físico " +
          "não corresponde à operação."
        ),
    );
  }


  if (
    normalizeString(
        deleteResult.backupId,
    ) !==
      normalizedBackupId
  ) {
    return blocked(
        "delete-result-backup-id-mismatch",
        (
          "O backupId do resultado físico " +
          "não corresponde à operação."
        ),
    );
  }


  // --------------------------------------------------------------------------
  // REUTILIZA BARREIRA DE INTEGRIDADE DA OPERAÇÃO EXISTENTE
  // --------------------------------------------------------------------------




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
        claimPlan.reasons || [],
    };
  }


  if (
    claimPlan.action !==
      CLAIM_ACTIONS.RESUME ||
    claimPlan.resumeStage !==
      RESUME_STAGES.STORAGE_DELETE
  ) {
    return blocked(
        "operation-not-resumable-for-storage-delete",
        (
          "A operação não está em estado íntegro " +
          "para confirmar storage_deleted."
        ),
    );
  }


    // --------------------------------------------------------------------------
    // LEASE PRECISA PERTENCER AO WORKER ATUAL
    // --------------------------------------------------------------------------
    //
    // RESUME com shouldTakeOverLease=true significa:
    //
    // - o lease anterior expirou;
    // - mas este worker ainda NÃO realizou o takeover.
    //
    // Portanto não pode confirmar storage_deleted antes de renovar/tomar o lease.
    //
    // --------------------------------------------------------------------------

    if (
      claimPlan.shouldTakeOverLease ===
        true
    ) {
      return blocked(
          "lease-takeover-required-before-storage-deleted",
          (
            "O lease precisa ser assumido pelo worker atual " +
            "antes de confirmar storage_deleted."
          ),
      );
    }


    if (
      normalizeString(
          operation.leaseOwner,
      ) !==
        normalizedExecutionId
    ) {
      return blocked(
          "lease-owner-mismatch-before-storage-deleted",
          (
            "O worker atual não é o proprietário do lease " +
            "da operação."
          ),
      );
    }


   // --------------------------------------------------------------------------
   // LEASE PRECISA ESTAR ATIVO
   // --------------------------------------------------------------------------

   const currentDate =
       normalizeDate(
           now,
       );

   const leaseExpiresAt =
       normalizeDate(
           operation.leaseExpiresAt,
       );


   if (
     !currentDate ||
     !leaseExpiresAt
   ) {
     return blocked(
         "invalid-lease-time-before-storage-deleted",
         (
           "Não foi possível validar o tempo do lease " +
           "antes de confirmar storage_deleted."
         ),
     );
   }


   if (
     leaseExpiresAt.getTime() <=
       currentDate.getTime()
   ) {
     return blocked(
         "expired-lease-before-storage-deleted",
         (
           "O lease expirou antes da confirmação " +
           "de storage_deleted."
         ),
     );
   }


  // --------------------------------------------------------------------------
  // STORAGE PATH
  // --------------------------------------------------------------------------

  const frozenSnapshot =
      operation.snapshot;


  if (
    !frozenSnapshot ||
    typeof frozenSnapshot !==
      "object"
  ) {
    return blocked(
        "operation-snapshot-missing",
        (
          "A identidade congelada da operação " +
          "não está disponível."
        ),
    );
  }


  const expectedStoragePath =
      normalizeString(
          frozenSnapshot.storagePath,
      );

  const deleteStoragePath =
      normalizeString(
          deleteResult.storagePath,
      );


  if (
    !expectedStoragePath ||
    deleteStoragePath !==
      expectedStoragePath
  ) {
    return blocked(
        "delete-result-storage-path-mismatch",
        (
          "O storagePath confirmado fisicamente " +
          "não corresponde ao artefato congelado."
        ),
    );
  }


  // --------------------------------------------------------------------------
  // OK
  // --------------------------------------------------------------------------

  return {
    action:
      ACTIONS.MARK_STORAGE_DELETED,

    allowed:
      true,

    storeId:
      normalizedStoreId,

    backupId:
      normalizedBackupId,

    storagePath:
      expectedStoragePath,

    alreadyMissing:
      deleteResult.alreadyMissing ===
        true,

    reasons: [],
  };
}


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  planMarkBackupRetentionStorageDeleted,
  ACTIONS,
};