"use strict";


const {
  claimBackupRetentionDelete,
} = require(
    "./claimBackupRetentionDelete",
);

const {
  renewBackupRetentionDeleteLease,
} = require(
    "./renewBackupRetentionDeleteLease",
);

const {
  executeBackupRetentionStorageDelete,
} = require(
    "./executeBackupRetentionStorageDelete",
);

const {
  executeBackupRetentionFinalization,
} = require(
    "./executeBackupRetentionFinalization",
);

const {
  ACTIONS:
    CLAIM_ACTIONS,
} = require(
    "./backupRetentionClaimPlanner",
);

const {
  ACTIONS:
    STORAGE_ACTIONS,
} = require(
    "./backupRetentionStorageDeletePlanner",
);

const {
  ACTIONS:
    MARK_ACTIONS,
} = require(
    "./backupRetentionMarkStorageDeletedPlanner",
);

const {
  ACTIONS:
    FINALIZE_ACTIONS,
} = require(
    "./backupRetentionFinalizePlanner",
);


// ============================================================================
// F5.6-D3-G9.1
// EXECUTOR DE UM CANDIDATO / OPERAÇÃO DE RETENÇÃO
// ============================================================================
//
// Responsabilidade:
//
// backup ready
//      ↓
// claim
//      ↓
// delete Storage
//      ↓
// storage_deleted
//      ↓
// finalização
//      ↓
// completed
//
// Também suporta:
//
// claimed interrompido
//      ↓
// RESUME + renovação/takeover de lease
//
// storage_deleted interrompido
//      ↓
// RESUME + renovação/takeover
//      ↓
// finalização
//
// IMPORTANTE:
//
// ✅ interno;
// ✅ não é Scheduler;
// ✅ não escolhe backups;
// ✅ fresh delete continua dependendo do validator dentro do claim;
// ✅ resume usa a operação persistente;
// ✅ nenhuma liberação de produção é feita aqui.
//
// ============================================================================


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


function normalizeNow(
    value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return new Date();
  }


  const date =
      value instanceof Date
        ? new Date(
            value.getTime(),
        )
        : new Date(
            value,
        );


  if (
    Number.isNaN(
        date.getTime(),
    )
  ) {
    throw new Error(
        "now inválido.",
    );
  }


  return date;
}


function resultBase({
  storeId,
  backupId,
  executionId,
}) {
  return {
    storeId,
    backupId,
    executionId,
  };
}


// ============================================================================
// EXECUTOR
// ============================================================================

async function executeBackupRetentionCandidate({
  db,
  bucket,
  storeId,
  backupId,
  executionId,
  now =
    null,
}) {
  // ==========================================================================
  // 1. INPUTS
  // ==========================================================================

  if (
    !db ||
    typeof db.runTransaction !==
      "function"
  ) {
    throw new Error(
        "Firestore db inválido.",
    );
  }


  if (
    !bucket ||
    typeof bucket.file !==
      "function"
  ) {
    throw new Error(
        "Storage bucket inválido.",
    );
  }


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


  if (!normalizedStoreId) {
    throw new Error(
        "storeId obrigatório.",
    );
  }


  if (!normalizedBackupId) {
    throw new Error(
        "backupId obrigatório.",
    );
  }


  if (!normalizedExecutionId) {
    throw new Error(
        "executionId obrigatório.",
    );
  }


  const effectiveNow =
      normalizeNow(
          now,
      );


  const base =
      resultBase({
        storeId:
          normalizedStoreId,

        backupId:
          normalizedBackupId,

        executionId:
          normalizedExecutionId,
      });


  // ==========================================================================
  // 2. CLAIM / RESUME
  // ==========================================================================

  const claim =
      await claimBackupRetentionDelete({
        db,

        storeId:
          normalizedStoreId,

        backupId:
          normalizedBackupId,

        executionId:
          normalizedExecutionId,

        now:
          effectiveNow,
      });


  // --------------------------------------------------------------------------
  // JÁ COMPLETO
  // --------------------------------------------------------------------------

  if (
    claim.action ===
      CLAIM_ACTIONS.ALREADY_COMPLETED
  ) {
    return {
      ...base,

      stage:
        "claim",

      completed:
        true,

      claim,

      renewal:
        null,

      storageDelete:
        null,

      finalization:
        null,
    };
  }


  // --------------------------------------------------------------------------
  // LEASE DE OUTRO WORKER / BLOQUEADO / NÃO AUTORIZADO
  // --------------------------------------------------------------------------

  if (
    claim.action !==
      CLAIM_ACTIONS.CREATE_CLAIM &&
    claim.action !==
      CLAIM_ACTIONS.RESUME
  ) {
    return {
      ...base,

      stage:
        "claim",

      completed:
        false,

      claim,

      renewal:
        null,

      storageDelete:
        null,

      finalization:
        null,
    };
  }


  // ==========================================================================
  // 3. RESUME EXIGE RENOVAÇÃO / TAKEOVER DO LEASE
  // ==========================================================================

  let renewal =
      null;


  if (
    claim.action ===
      CLAIM_ACTIONS.RESUME
  ) {
    renewal =
        await renewBackupRetentionDeleteLease({
          db,

          storeId:
            normalizedStoreId,

          backupId:
            normalizedBackupId,

          executionId:
            normalizedExecutionId,

          now:
            effectiveNow,
        });


    if (
      renewal.action !==
        CLAIM_ACTIONS.RESUME ||
      renewal.allowed !==
        true
    ) {
      return {
        ...base,

        stage:
          "renew",

        completed:
          false,

        claim,

        renewal,

        storageDelete:
          null,

        finalization:
          null,
      };
    }
  }


  // ==========================================================================
  // 4. STORAGE
  // ==========================================================================

  const storageDelete =
      await executeBackupRetentionStorageDelete({
        db,

        bucket,

        storeId:
          normalizedStoreId,

        backupId:
          normalizedBackupId,

        executionId:
          normalizedExecutionId,

        now:
          effectiveNow,
      });


  // --------------------------------------------------------------------------
  // COMPLETED ENCONTRADO PELO PREPARE
  // --------------------------------------------------------------------------

  if (
    storageDelete.action ===
      STORAGE_ACTIONS.ALREADY_COMPLETED
  ) {
    return {
      ...base,

      stage:
        "storage-delete",

      completed:
        true,

      claim,

      renewal,

      storageDelete,

      finalization:
        null,
    };
  }


  // --------------------------------------------------------------------------
  // PARA SEGUIR À FINALIZAÇÃO:
  //
  // 1. acabamos de marcar storage_deleted;
  // ou
  // 2. já estava storage_deleted em uma retomada.
  // --------------------------------------------------------------------------

  const storageReadyForFinalization =
      (
        storageDelete.action ===
          MARK_ACTIONS.MARK_STORAGE_DELETED
      ) ||
      (
        storageDelete.action ===
          STORAGE_ACTIONS.ALREADY_STORAGE_DELETED
      );


  if (
    !storageReadyForFinalization
  ) {
    return {
      ...base,

      stage:
        "storage-delete",

      completed:
        false,

      claim,

      renewal,

      storageDelete,

      finalization:
        null,
    };
  }


  // ==========================================================================
  // 5. FINALIZAÇÃO
  // ==========================================================================

  const finalization =
      await executeBackupRetentionFinalization({
        db,

        bucket,

        storeId:
          normalizedStoreId,

        backupId:
          normalizedBackupId,

        executionId:
          normalizedExecutionId,

        now:
          effectiveNow,
      });


  const completed =
      (
        finalization.action ===
          FINALIZE_ACTIONS.FINALIZE_ALLOWED
      ) ||
      (
        finalization.action ===
          FINALIZE_ACTIONS.ALREADY_COMPLETED
      );


  // ==========================================================================
  // RESULTADO
  // ==========================================================================

  return {
    ...base,

    stage:
      "finalize",

    completed,

    claim,

    renewal,

    storageDelete,

    finalization,
  };
}


// ============================================================================
// EXPORT
// ============================================================================

module.exports = {
  executeBackupRetentionCandidate,
};