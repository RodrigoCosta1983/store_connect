"use strict";


const admin =
    require("firebase-admin");

const {
  planMarkBackupRetentionStorageDeleted,
  ACTIONS,
} = require(
    "./backupRetentionMarkStorageDeletedPlanner",
);


// ============================================================================
// STORE&CONNECT — MARCA RETENTION DELETE COMO storage_deleted
// ============================================================================
//
// F5.6-D3-G5.2
//
// Executa a transição persistente:
//
// claimed
//   ↓
// storage_deleted
//
// SOMENTE depois que:
//
// ✅ ausência física do Storage foi confirmada;
// ✅ operação foi relida dentro da transaction;
// ✅ snapshot foi relido dentro da transaction;
// ✅ planner confirmou integridade;
// ✅ worker ainda possui lease ativo.
//
// NÃO:
//
// ❌ deleta snapshot metadata;
// ❌ cria audit final;
// ❌ marca completed;
// ❌ toca no Storage.
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


// ============================================================================
// TRANSIÇÃO
// ============================================================================

async function markBackupRetentionStorageDeleted({
  db,
  storeId,
  backupId,
  deleteResult,
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


  // --------------------------------------------------------------------------
  // REFS
  // --------------------------------------------------------------------------

  const storeBackupsRef =
      db
          .collection(
              "storeBackups",
          )
          .doc(
              normalizedStoreId,
          );


  const snapshotRef =
      storeBackupsRef
          .collection(
              "snapshots",
          )
          .doc(
              normalizedBackupId,
          );


  const operationRef =
      storeBackupsRef
          .collection(
              "retentionDeletes",
          )
          .doc(
              normalizedBackupId,
          );


  // --------------------------------------------------------------------------
  // TRANSACTION
  // --------------------------------------------------------------------------

  return db.runTransaction(
      async (
          transaction,
      ) => {
        // --------------------------------------------------------------------
        // 1. RELÊ ESTADO ATUAL
        // --------------------------------------------------------------------

        const operationDoc =
            await transaction.get(
                operationRef,
            );


        const snapshotDoc =
            await transaction.get(
                snapshotRef,
            );


        const operation =
            operationDoc.exists
              ? (
                  operationDoc.data() ||
                  null
                )
              : null;


        const snapshot =
            snapshotDoc.exists
              ? (
                  snapshotDoc.data() ||
                  null
                )
              : null;


        // --------------------------------------------------------------------
        // 2. HORÁRIO DESTA TENTATIVA DA TRANSACTION
        // --------------------------------------------------------------------
        //
        // Quando "now" não é injetado por teste, usamos new Date()
        // DENTRO da transaction.
        //
        // Assim, se o Firestore repetir a transaction por concorrência,
        // o lease é validado novamente contra o horário da nova tentativa.
        //
        // --------------------------------------------------------------------

        const currentNow =
            now !== null &&
            now !== undefined
              ? now
              : new Date();


        // --------------------------------------------------------------------
        // 3. PLANNER PURO
        // --------------------------------------------------------------------

        const plan =
            planMarkBackupRetentionStorageDeleted({
              storeId:
                normalizedStoreId,

              backupId:
                normalizedBackupId,

              snapshot,

              operation,

              deleteResult,

              allBackups:
                [],

              executionId:
                normalizedExecutionId,

              now:
                currentNow,
            });


        // --------------------------------------------------------------------
        // 4. SOMENTE MARK_STORAGE_DELETED PODE ESCREVER
        // --------------------------------------------------------------------

        if (
          plan.action !==
            ACTIONS.MARK_STORAGE_DELETED
        ) {
          return {
            ...plan,

            wrote:
              false,
          };
        }


        // --------------------------------------------------------------------
        // 5. TRAVAS EXTRAS
        // --------------------------------------------------------------------

        if (!operationDoc.exists) {
          throw new Error(
              (
                "Planner autorizou MARK_STORAGE_DELETED " +
                "sem operação existente."
              ),
          );
        }


        if (!snapshotDoc.exists) {
          throw new Error(
              (
                "Planner autorizou MARK_STORAGE_DELETED " +
                "sem snapshot existente."
              ),
          );
        }


        if (
          operation.status !==
            "claimed"
        ) {
          throw new Error(
              (
                "Planner autorizou MARK_STORAGE_DELETED " +
                "para operação que não está claimed."
              ),
          );
        }


        // --------------------------------------------------------------------
        // 6. TIMESTAMP DO SERVIDOR
        // --------------------------------------------------------------------

        const serverTimestamp =
            admin.firestore
                .FieldValue
                .serverTimestamp();


        // --------------------------------------------------------------------
        // 7. claimed → storage_deleted
        // --------------------------------------------------------------------

        transaction.update(
            operationRef,
            {
              status:
                "storage_deleted",

              storageDeletedAt:
                serverTimestamp,

              updatedAt:
                serverTimestamp,

              lastAttemptAt:
                serverTimestamp,

              lastError:
                null,
            },
        );


        // --------------------------------------------------------------------
        // IMPORTANTE
        // --------------------------------------------------------------------
        //
        // O snapshot continua:
        //
        // status = deleting
        //
        // Ele somente será removido na FINALIZAÇÃO futura, junto com:
        //
        // - audit log;
        // - metadata snapshot delete;
        // - operation completed.
        //
        // --------------------------------------------------------------------


        // --------------------------------------------------------------------
        // 8. RESULTADO
        // --------------------------------------------------------------------

        return {
          ...plan,

          wrote:
            true,
        };
      },
  );
}


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  markBackupRetentionStorageDeleted,
};