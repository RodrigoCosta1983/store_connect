"use strict";


const {
  inspectBackupRetentionStorageArtifact,
} = require(
    "./inspectBackupRetentionStorageArtifact",
);

const {
  finalizeBackupRetentionDelete,
} = require(
    "./finalizeBackupRetentionDelete",
);

const {
  resolveSnapshotChecksum,
  getExpectedStoragePath,
} = require(
    "./backupRetentionClaimPlanner",
);


// ============================================================================
// F5.6-D3-G7.4
// EXECUTOR INTERNO DA FINALIZAÇÃO
// ============================================================================
//
// Fluxo:
//
// retentionDelete = storage_deleted
//          ↓
// lê identidade congelada da operação
//          ↓
// inspector REAL do Storage
//          ↓
// confirma ARTIFACT_ALREADY_MISSING
//          ↓
// finalizeBackupRetentionDelete()
//          ↓
// audit + delete metadata + completed
//
// IMPORTANTE:
//
// ✅ função interna;
// ✅ não aceita prova de ausência externa;
// ✅ a prova vem diretamente do inspector;
// ✅ a transaction final relê todo o estado novamente;
// ✅ nenhuma escrita acontece antes da transaction final.
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


function blocked(
    code,
    message,
) {
  return {
    stage:
      "prepare-finalization",

    action:
      "BLOCKED",

    allowed:
      false,

    wrote:
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
// EXECUTOR
// ============================================================================

async function executeBackupRetentionFinalization({
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
  // 1. LÊ OPERAÇÃO PERSISTENTE
  // ==========================================================================

  const operationRef =
      db
          .collection(
              "storeBackups",
          )
          .doc(
              normalizedStoreId,
          )
          .collection(
              "retentionDeletes",
          )
          .doc(
              normalizedBackupId,
          );


  const operationDoc =
      await operationRef.get();


  const operation =
      operationDoc.exists
        ? (
            operationDoc.data() ||
            null
          )
        : null;


  // ==========================================================================
  // 2. COMPLETED — NÃO TOCA NO STORAGE
  // ==========================================================================
  //
  // A própria transaction final confirmará:
  // - operation completed;
  // - snapshot ausente;
  // - auditoria existente.
  //
  // ==========================================================================

  if (
    operation &&
    operation.status ===
      "completed"
  ) {
    const result =
        await finalizeBackupRetentionDelete({
          db,

          storeId:
            normalizedStoreId,

          backupId:
            normalizedBackupId,

          storageInspection:
            null,

          executionId:
            normalizedExecutionId,

          now,
        });


    return {
      stage:
        "finalize",

      ...result,
    };
  }


  // ==========================================================================
  // 3. SOMENTE storage_deleted PODE NECESSITAR INSPEÇÃO DO STORAGE
  // ==========================================================================

  if (
    !operation ||
    operation.status !==
      "storage_deleted"
  ) {
    // ------------------------------------------------------------------------
    // Não tocamos no Storage.
    //
    // Delegamos ao planner dentro da transaction para produzir:
    // BLOCKED / SKIP_LEASED / etc.
    // ------------------------------------------------------------------------

    const result =
        await finalizeBackupRetentionDelete({
          db,

          storeId:
            normalizedStoreId,

          backupId:
            normalizedBackupId,

          storageInspection:
            null,

          executionId:
            normalizedExecutionId,

          now,
        });


    return {
      stage:
        "finalize",

      ...result,
    };
  }


  // ==========================================================================
  // 4. IDENTIDADE CONGELADA
  // ==========================================================================

  const frozenSnapshot =
      operation.snapshot;


  if (
    !frozenSnapshot ||
    typeof frozenSnapshot !==
      "object" ||
    Array.isArray(
        frozenSnapshot,
    )
  ) {
    return blocked(
        "invalid-frozen-snapshot-before-finalization",
        (
          "A identidade congelada do snapshot " +
          "é inválida."
        ),
    );
  }


  const storagePath =
      normalizeString(
          frozenSnapshot.storagePath,
      );


  const expectedStoragePath =
      getExpectedStoragePath({
        storeId:
          normalizedStoreId,

        backupId:
          normalizedBackupId,
      });


  if (
    !storagePath ||
    storagePath !==
      expectedStoragePath
  ) {
    return blocked(
        "invalid-frozen-storage-path-before-finalization",
        (
          "O storagePath congelado não corresponde " +
          "ao caminho canônico do backup."
        ),
    );
  }


  const checksumResult =
      resolveSnapshotChecksum(
          frozenSnapshot,
      );


  if (
    !checksumResult.valid ||
    checksumResult.conflict
  ) {
    return blocked(
        "invalid-frozen-checksum-before-storage-inspection",
        (
          "O checksum congelado da operação " +
          "é inválido."
        ),
    );
  }


  // ==========================================================================
  // 5. INSPEÇÃO REAL DO STORAGE
  // ==========================================================================

  const inspection =
      await inspectBackupRetentionStorageArtifact({
        bucket,

        storeId:
          normalizedStoreId,

        backupId:
          normalizedBackupId,

        storagePath,

        checksum:
          checksumResult.checksum,
      });


  // ==========================================================================
  // 6. TRANSACTION FINAL
  // ==========================================================================
  //
  // IMPORTANTE:
  //
  // Não decidimos aqui se a inspeção autoriza a finalização.
  //
  // O planner dentro da transaction recebe o resultado REAL do inspector
  // e decide fail-closed:
  //
  // ARTIFACT_ALREADY_MISSING → pode finalizar
  // ARTIFACT_VALID           → BLOCKED
  // BLOCKED                  → BLOCKED
  //
  // ==========================================================================

  const result =
      await finalizeBackupRetentionDelete({
        db,

        storeId:
          normalizedStoreId,

        backupId:
          normalizedBackupId,

        storageInspection:
          inspection,

        executionId:
          normalizedExecutionId,

        now,
      });


  // ==========================================================================
  // RESULTADO
  // ==========================================================================

  return {
    stage:
      "finalize",

    storeId:
      normalizedStoreId,

    backupId:
      normalizedBackupId,

    storageInspection: {
      action:
        inspection.action,

      allowed:
        inspection.allowed,

      storagePath:
        inspection.storagePath ||
        storagePath,

      generation:
        inspection.generation ??
        null,
    },

    ...result,
  };
}


// ============================================================================
// EXPORT
// ============================================================================

module.exports = {
  executeBackupRetentionFinalization,
};