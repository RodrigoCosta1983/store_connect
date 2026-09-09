"use strict";


const admin =
    require("firebase-admin");

const {
  ACTIONS,
  getAuditId,
  planBackupRetentionFinalization,
} = require(
    "./backupRetentionFinalizePlanner",
);


// ============================================================================
// F5.6-D3-G7.2
// TRANSACTION FINAL DA RETENÇÃO
// ============================================================================
//
// storage_deleted
//       ↓
// confirmação física de ausência já recebida de helper interno
//       ↓
// transaction Firestore:
//
// 1. cria auditLog determinístico
// 2. remove metadata do snapshot
// 3. operation → completed
//
// Tudo grava junto ou nada grava.
//
// IMPORTANTE:
//
// ✅ função INTERNA;
// ✅ storageInspection deve vir do inspector interno;
// ✅ planner é reexecutado dentro da transaction;
// ✅ operação, snapshot e auditoria são relidos;
// ✅ não toca no Storage;
// ✅ não altera dailyRuns.
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
// FINALIZAÇÃO
// ============================================================================

async function finalizeBackupRetentionDelete({
  db,
  storeId,
  backupId,
  storageInspection,
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


  // ==========================================================================
  // REFERÊNCIAS
  // ==========================================================================

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
  // AUDITORIA FICA NO PADRÃO OFICIAL DA LOJA
  // --------------------------------------------------------------------------

  const storeRef =
      db
          .collection(
              "stores",
          )
          .doc(
              normalizedStoreId,
          );


  const auditId =
      getAuditId(
          normalizedBackupId,
      );


  const auditRef =
      storeRef
          .collection(
              "auditLogs",
          )
          .doc(
              auditId,
          );


  // ==========================================================================
  // TRANSACTION
  // ==========================================================================

  return db.runTransaction(
      async transaction => {
        // ----------------------------------------------------------------------
        // 1. RELÊ ESTADO ATUAL
        // ----------------------------------------------------------------------

        const [
          operationDoc,
          snapshotDoc,
          auditDoc,
        ] =
            await Promise.all([
              transaction.get(
                  operationRef,
              ),

              transaction.get(
                  snapshotRef,
              ),

              transaction.get(
                  auditRef,
              ),
            ]);


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


        const currentNow =
            now !== null &&
            now !== undefined
              ? now
              : new Date();


        // ----------------------------------------------------------------------
        // 2. REEXECUTA PLANNER DENTRO DA TRANSACTION
        // ----------------------------------------------------------------------

        const plan =
            planBackupRetentionFinalization({
              storeId:
                normalizedStoreId,

              backupId:
                normalizedBackupId,

              snapshot,

              operation,

              storageInspection,

              auditExists:
                auditDoc.exists,

              executionId:
                normalizedExecutionId,

              now:
                currentNow,
            });


        // ----------------------------------------------------------------------
        // 3. SOMENTE FINALIZE_ALLOWED PODE ESCREVER
        // ----------------------------------------------------------------------

        if (
          plan.action !==
            ACTIONS.FINALIZE_ALLOWED
        ) {
          return {
            ...plan,

            wrote:
              false,
          };
        }


        // ----------------------------------------------------------------------
        // 4. GUARDS EXTRAS
        // ----------------------------------------------------------------------

        if (
          !operationDoc.exists ||
          !operation
        ) {
          return {
            action:
              ACTIONS.BLOCKED,

            allowed:
              false,

            wrote:
              false,

            reasons: [
              {
                code:
                  "operation-missing-inside-finalization",

                message:
                  (
                    "A operação desapareceu antes " +
                    "da finalização."
                  ),
              },
            ],
          };
        }


        if (
          !snapshotDoc.exists ||
          !snapshot
        ) {
          return {
            action:
              ACTIONS.BLOCKED,

            allowed:
              false,

            wrote:
              false,

            reasons: [
              {
                code:
                  "snapshot-missing-inside-finalization",

                message:
                  (
                    "A metadata do snapshot desapareceu " +
                    "antes da finalização."
                  ),
              },
            ],
          };
        }


        if (
          operation.status !==
            "storage_deleted"
        ) {
          return {
            action:
              ACTIONS.BLOCKED,

            allowed:
              false,

            wrote:
              false,

            reasons: [
              {
                code:
                  "operation-not-storage-deleted",

                message:
                  (
                    "A operação não está em " +
                    "storage_deleted."
                  ),
              },
            ],
          };
        }


        if (
          snapshot.status !==
            "deleting"
        ) {
          return {
            action:
              ACTIONS.BLOCKED,

            allowed:
              false,

            wrote:
              false,

            reasons: [
              {
                code:
                  "snapshot-not-deleting",

                message:
                  (
                    "O snapshot não está em deleting."
                  ),
              },
            ],
          };
        }


        if (
          auditDoc.exists
        ) {
          return {
            action:
              ACTIONS.BLOCKED,

            allowed:
              false,

            wrote:
              false,

            reasons: [
              {
                code:
                  "audit-already-exists",

                message:
                  (
                    "A auditoria determinística já existe."
                  ),
              },
            ],
          };
        }


        // ======================================================================
        // 5. TIMESTAMP ÚNICO DA FINALIZAÇÃO
        // ======================================================================

        const serverTimestamp =
            admin.firestore
                .FieldValue
                .serverTimestamp();


        // ======================================================================
        // 6. AUDITORIA DETERMINÍSTICA
        // ======================================================================

        const auditLog = {
          action:
            "store_backup_retention_deleted",

          entityType:
            "backup",

          entityId:
            normalizedBackupId,

          storeId:
            normalizedStoreId,

          backupId:
            normalizedBackupId,

          operationId:
            normalizedBackupId,

          performedBy: {
            uid:
              "system",

            role:
              "system",
          },

          reason:
            "retention_policy",

          before: {
            status:
              "deleting",

            type:
              operation.snapshot.type,

            createdAt:
              plan.originalCreatedAt,

            storagePath:
              plan.storagePath,

            checksumSha256:
              plan.checksum,
          },

          after: {
            status:
              "deleted",

            storageDeleted:
              true,

            metadataDeleted:
              true,
          },

          createdAt:
            serverTimestamp,
        };


        // ======================================================================
        // 7. CRIA AUDITORIA
        // ======================================================================

        transaction.create(
            auditRef,
            auditLog,
        );


        // ======================================================================
        // 8. REMOVE METADATA DO SNAPSHOT
        // ======================================================================

        transaction.delete(
            snapshotRef,
        );


        // ======================================================================
        // 9. MARCA OPERAÇÃO COMPLETED
        // ======================================================================

        transaction.update(
            operationRef,
            {
              status:
                "completed",

              completedAt:
                serverTimestamp,

              updatedAt:
                serverTimestamp,

              lastAttemptAt:
                serverTimestamp,

              lastError:
                null,
            },
        );


        // ======================================================================
        // RESULTADO
        // ======================================================================

        return {
          ...plan,

          wrote:
            true,

          auditId,
        };
      },
  );
}


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  finalizeBackupRetentionDelete,
};