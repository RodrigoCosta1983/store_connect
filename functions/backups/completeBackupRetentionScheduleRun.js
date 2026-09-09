"use strict";


const admin =
    require("firebase-admin");

const {
  planBackupRetentionScheduleRunCompletion,
  ACTIONS,
} = require(
    "./backupRetentionScheduleRunCompletionPlanner",
);


// ============================================================================
// F5.6-D3-G9.6-D11
// CONCLUSÃO PERSISTENTE DO LEDGER DO SCHEDULER
// ============================================================================
//
// Objetivo:
//
// started
//   → completed
//
// completed
//   → ALREADY_COMPLETED / zero write
//
// inconsistência
//   → BLOCKED / zero write
//
// Tudo dentro de transaction.
//
// Isso também protege concorrência:
//
// Worker A → COMPLETE
// Worker B → transaction retry → ALREADY_COMPLETED
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
// TRANSACTION
// ============================================================================

async function completeBackupRetentionScheduleRun({
  db,
  storeId,
  scheduleIdentity,
  executionId,
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


  const normalizedStoreId =
      normalizeString(
          storeId,
      );


  if (!normalizedStoreId) {
    throw new Error(
        "storeId obrigatório.",
    );
  }


  if (
    !scheduleIdentity ||
    typeof scheduleIdentity !==
      "object" ||
    Array.isArray(
        scheduleIdentity,
    )
  ) {
    throw new Error(
        "scheduleIdentity obrigatório.",
    );
  }


  const runId =
      normalizeString(
          scheduleIdentity.runId,
      );


  if (!runId) {
    throw new Error(
        "scheduleIdentity.runId obrigatório.",
    );
  }


  const normalizedExecutionId =
      normalizeString(
          executionId,
      );


  if (!normalizedExecutionId) {
    throw new Error(
        "executionId obrigatório.",
    );
  }


  // ==========================================================================
  // 2. REFERÊNCIA
  // ==========================================================================

  const runRef =
      db
          .collection(
              "storeBackups",
          )
          .doc(
              normalizedStoreId,
          )
          .collection(
              "retentionScheduleRuns",
          )
          .doc(
              runId,
          );


  // ==========================================================================
  // 3. TRANSACTION
  // ==========================================================================

  return db.runTransaction(
      async (
          transaction,
      ) => {
        // --------------------------------------------------------------------
        // RELÊ LEDGER
        // --------------------------------------------------------------------

        const runDoc =
            await transaction.get(
                runRef,
            );


        const existingRun =
            runDoc.exists
              ? (
                  runDoc.data() ||
                  {}
                )
              : null;


        // --------------------------------------------------------------------
        // PLANNER PURO
        // --------------------------------------------------------------------

        const plan =
            planBackupRetentionScheduleRunCompletion({
              storeId:
                normalizedStoreId,

              runId,

              scheduleIdentity,

              existingRun,

              executionId:
                normalizedExecutionId,
            });


        // --------------------------------------------------------------------
        // BLOCKED
        // --------------------------------------------------------------------

        if (
          plan.action ===
            ACTIONS.BLOCKED
        ) {
          return {
            ...plan,

            wrote:
              false,
          };
        }


        // --------------------------------------------------------------------
        // JÁ COMPLETADO
        // --------------------------------------------------------------------

        if (
          plan.action ===
            ACTIONS.ALREADY_COMPLETED
        ) {
          return {
            ...plan,

            wrote:
              false,
          };
        }


        // --------------------------------------------------------------------
        // SOMENTE COMPLETE PODE ESCREVER
        // --------------------------------------------------------------------

        if (
          plan.action !==
            ACTIONS.COMPLETE
        ) {
          throw new Error(
              (
                "Planner retornou ação desconhecida: " +
                String(
                    plan.action,
                )
              ),
          );
        }


        // --------------------------------------------------------------------
        // TRAVA EXTRA
        // --------------------------------------------------------------------

        if (
          !runDoc.exists
        ) {
          throw new Error(
              (
                "Planner retornou COMPLETE " +
                "sem ledger persistido."
              ),
          );
        }


        // --------------------------------------------------------------------
        // TIMESTAMP
        // --------------------------------------------------------------------

        const serverTimestamp =
            admin
                .firestore
                .FieldValue
                .serverTimestamp();


        // --------------------------------------------------------------------
        // COMPLETE
        // --------------------------------------------------------------------

        transaction.update(
            runRef,
            {
              status:
                "completed",

              completedAt:
                serverTimestamp,

              updatedAt:
                serverTimestamp,

              completedByExecutionId:
                normalizedExecutionId,

              lastError:
                null,
            },
        );


        // --------------------------------------------------------------------
        // RESULTADO
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
  completeBackupRetentionScheduleRun,
};