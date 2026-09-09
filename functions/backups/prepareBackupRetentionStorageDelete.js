"use strict";


const {
  planBackupRetentionStorageDelete,
} = require(
    "./backupRetentionStorageDeletePlanner",
);


// ============================================================================
// STORE&CONNECT — PREPARA DELETE FÍSICO DE BACKUP
// ============================================================================
//
// F5.6-D3-G6.1
//
// Relê:
//
// - snapshot;
// - retentionDelete operation;
//
// dentro de uma transaction SOMENTE DE LEITURA.
//
// Depois executa o planner puro responsável por autorizar ou bloquear
// o delete físico do Storage.
//
// ESTE ARQUIVO:
//
// ✅ lê Firestore;
// ✅ usa transaction;
// ✅ executa Storage Delete Planner.
//
// ESTE ARQUIVO NÃO:
//
// ❌ renova lease;
// ❌ faz takeover;
// ❌ acessa Storage;
// ❌ executa delete();
// ❌ altera Firestore;
// ❌ marca storage_deleted.
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
// PREPARAÇÃO
// ============================================================================

async function prepareBackupRetentionStorageDelete({
  db,
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
  // REFERÊNCIAS
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


  // ==========================================================================
  // TRANSACTION SOMENTE DE LEITURA
  // ==========================================================================

  return db.runTransaction(
      async (
          transaction,
      ) => {
        // --------------------------------------------------------------------
        // 1. RELÊ OPERAÇÃO
        // --------------------------------------------------------------------

        const operationDoc =
            await transaction.get(
                operationRef,
            );


        // --------------------------------------------------------------------
        // 2. RELÊ SNAPSHOT
        // --------------------------------------------------------------------

        const snapshotDoc =
            await transaction.get(
                snapshotRef,
            );


        // --------------------------------------------------------------------
        // 3. ESTADO ATUAL
        // --------------------------------------------------------------------

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
        // 4. HORÁRIO DESTA TENTATIVA
        // --------------------------------------------------------------------
        //
        // Mesmo princípio usado na etapa anterior:
        //
        // quando não existe horário injetado pelo teste,
        // calculamos dentro da callback da transaction.
        //
        // Se o Firestore repetir a transaction, o lease será avaliado
        // novamente usando um horário atual.
        //
        // --------------------------------------------------------------------

        const currentNow =
            now !== null &&
            now !== undefined
              ? now
              : new Date();


        // --------------------------------------------------------------------
        // 5. PLANNER PURO
        // --------------------------------------------------------------------

        const plan =
            planBackupRetentionStorageDelete({
              storeId:
                normalizedStoreId,

              backupId:
                normalizedBackupId,

              snapshot,

              operation,

              executionId:
                normalizedExecutionId,

              now:
                currentNow,
            });


        // --------------------------------------------------------------------
        // 6. RESULTADO
        // --------------------------------------------------------------------
        //
        // NÃO transformamos BLOCKED em exception.
        //
        // O planner continua sendo a autoridade lógica e seu resultado
        // será tratado pelo futuro executor.
        //
        // --------------------------------------------------------------------

        return {
          ...plan,

          storeId:
            normalizedStoreId,

          backupId:
            normalizedBackupId,

          preparedFromFirestore:
            true,
        };
      },
  );
}


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  prepareBackupRetentionStorageDelete,
};