"use strict";


const {
  prepareBackupRetentionStorageDelete,
} = require(
    "./prepareBackupRetentionStorageDelete",
);

const {
  inspectBackupRetentionStorageArtifact,
  ACTIONS:
    INSPECTION_ACTIONS,
} = require(
    "./inspectBackupRetentionStorageArtifact",
);

const {
  deleteBackupRetentionStorageArtifact,
  ACTIONS:
    DELETE_ACTIONS,
} = require(
    "./deleteBackupRetentionStorageArtifact",
);

const {
  markBackupRetentionStorageDeleted,
} = require(
    "./markBackupRetentionStorageDeleted",
);

const {
  ACTIONS:
    PREPARE_ACTIONS,
} = require(
    "./backupRetentionStorageDeletePlanner",
);


// ============================================================================
// STORE&CONNECT — EXECUTOR DO DELETE FÍSICO POR RETENÇÃO
// ============================================================================
//
// F5.6-D3-G6.3
//
// Fluxo:
//
// Firestore
//   ↓
// prepare
//   ↓
// Storage inspector
//   ↓
// delete físico
//   ↓
// Firestore claimed → storage_deleted
//
// IMPORTANTE:
//
// ✅ função interna de backend;
// ✅ não é callable;
// ✅ não aceita "prova de ausência" de cliente;
// ✅ usa somente resultados produzidos pelos helpers internos;
// ✅ respeita todas as barreiras já validadas.
//
// AINDA NÃO:
//
// ❌ finaliza operation como completed;
// ❌ remove metadata do snapshot;
// ❌ cria auditoria final;
// ❌ está ligada ao Scheduler.
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


function resultWithStage({
  stage,
  result,
}) {
  return {
    stage,

    ...(result || {}),
  };
}


// ============================================================================
// EXECUTOR
// ============================================================================

async function executeBackupRetentionStorageDelete({
  db,
  bucket,
  storeId,
  backupId,
  executionId,
  now =
    null,
}) {
  // --------------------------------------------------------------------------
  // INPUTS
  // --------------------------------------------------------------------------

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


  // ==========================================================================
  // 1. PREPARE
  // ==========================================================================

  const prepareResult =
      await prepareBackupRetentionStorageDelete({
        db,

        storeId:
          normalizedStoreId,

        backupId:
          normalizedBackupId,

        executionId:
          normalizedExecutionId,

        now,
      });


  // --------------------------------------------------------------------------
  // NÃO AUTORIZADO A TOCAR NO STORAGE
  // --------------------------------------------------------------------------

  if (
    prepareResult.action !==
      PREPARE_ACTIONS.DELETE_STORAGE_ALLOWED ||
    prepareResult.allowed !==
      true
  ) {
    return resultWithStage({
      stage:
        "prepare",

      result:
        prepareResult,
    });
  }


  // ==========================================================================
  // 2. INSPEÇÃO DO ARTEFATO
  // ==========================================================================

  const inspection =
      await inspectBackupRetentionStorageArtifact({
        bucket,

        storeId:
          normalizedStoreId,

        backupId:
          normalizedBackupId,

        storagePath:
          prepareResult.storagePath,

        checksum:
          prepareResult.checksum,
      });


  // --------------------------------------------------------------------------
  // INSPEÇÃO BLOCKED
  // --------------------------------------------------------------------------

  if (
    inspection.action !==
      INSPECTION_ACTIONS.ARTIFACT_VALID &&
    inspection.action !==
      INSPECTION_ACTIONS.ARTIFACT_ALREADY_MISSING
  ) {
    return resultWithStage({
      stage:
        "inspection",

      result:
        inspection,
    });
  }


  if (
    inspection.allowed !==
      true
  ) {
    return resultWithStage({
      stage:
        "inspection",

      result:
        inspection,
    });
  }


  // ==========================================================================
  // 3. DELETE FÍSICO / CONFIRMAÇÃO DE AUSÊNCIA
  // ==========================================================================

  const deleteResult =
      await deleteBackupRetentionStorageArtifact({
        inspection,
      });


  if (
    deleteResult.action !==
      DELETE_ACTIONS.STORAGE_ABSENCE_CONFIRMED ||
    deleteResult.allowed !==
      true
  ) {
    return resultWithStage({
      stage:
        "storage-delete",

      result:
        deleteResult,
    });
  }


  // ==========================================================================
  // 4. FIRESTORE claimed → storage_deleted
  // ==========================================================================

  const markResult =
      await markBackupRetentionStorageDeleted({
        db,

        storeId:
          normalizedStoreId,

        backupId:
          normalizedBackupId,

        deleteResult,

        executionId:
          normalizedExecutionId,

        now,
      });


  // ==========================================================================
  // RESULTADO
  // ==========================================================================

  return {
    stage:
      "mark-storage-deleted",

    storeId:
      normalizedStoreId,

    backupId:
      normalizedBackupId,

    storagePath:
      prepareResult.storagePath,

    prepare:
      {
        action:
          prepareResult.action,

        allowed:
          prepareResult.allowed,
      },

    inspection:
      {
        action:
          inspection.action,

        allowed:
          inspection.allowed,

        generation:
          inspection.generation ??
          null,
      },

    storageDelete:
      {
        action:
          deleteResult.action,

        allowed:
          deleteResult.allowed,

        generation:
          deleteResult.generation ??
          null,

        alreadyMissing:
          deleteResult.alreadyMissing ===
          true,
      },

    mark:
      markResult,

    action:
      markResult.action,

    allowed:
      markResult.allowed,

    wrote:
      markResult.wrote ===
      true,
  };
}


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  executeBackupRetentionStorageDelete,
};
