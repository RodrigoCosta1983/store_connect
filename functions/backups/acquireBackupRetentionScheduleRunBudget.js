"use strict";


const admin =
    require("firebase-admin");

const {
  planBackupRetentionScheduleRun,
  ACTIONS,
} = require(
    "./backupRetentionScheduleRunPlanner",
);


// ============================================================================
// F5.6-D3-G9.6-D7
// RESERVA PERSISTENTE DO FRESH BUDGET DO SCHEDULER
// ============================================================================
//
// Objetivo:
//
// Para:
//
//   storeId + runId
//
// garantir atomicamente:
//
// PRIMEIRO WORKER:
//   → ledger inexistente
//   → GRANT_FRESH_BUDGET
//   → cria ledger
//   → maxFreshDeletes > 0
//
// RETRY / WORKER CONCORRENTE:
//   → ledger já existe
//   → RESUME_ONLY
//   → maxFreshDeletes = 0
//
// IMPORTANTE:
//
// O ledger é criado ANTES da execução destrutiva.
//
// Isso faz o sistema falhar para o lado seguro:
//
// se o worker cair após criar o ledger,
// o retry NÃO ganha um segundo fresh budget.
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

async function acquireBackupRetentionScheduleRunBudget({
  db,
  storeId,
  scheduleIdentity,
  maxFreshDeletes =
    1,
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
          scheduleIdentity
              .runId,
      );


  if (!runId) {
    throw new Error(
        "scheduleIdentity.runId obrigatório.",
    );
  }


  // ==========================================================================
  // 2. REFERÊNCIA DO LEDGER
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
        // RELÊ LEDGER ATUAL
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
            planBackupRetentionScheduleRun({
              storeId:
                normalizedStoreId,

              runId,

              scheduleIdentity,

              existingRun,

              maxFreshDeletes,
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
        // RETRY / LEDGER JÁ EXISTENTE
        // --------------------------------------------------------------------

        if (
          plan.action ===
            ACTIONS.RESUME_ONLY
        ) {
          return {
            ...plan,

            wrote:
              false,
          };
        }


        // --------------------------------------------------------------------
        // SOMENTE GRANT PODE CRIAR LEDGER
        // --------------------------------------------------------------------

        if (
          plan.action !==
            ACTIONS.GRANT_FRESH_BUDGET
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
          runDoc.exists
        ) {
          throw new Error(
              (
                "Planner retornou GRANT_FRESH_BUDGET " +
                "para ledger já existente."
              ),
          );
        }


        // --------------------------------------------------------------------
        // TIMESTAMPS
        // --------------------------------------------------------------------

        const serverTimestamp =
            admin
                .firestore
                .FieldValue
                .serverTimestamp();


        // --------------------------------------------------------------------
        // CRIA LEDGER ANTES DA EXECUÇÃO DESTRUTIVA
        // --------------------------------------------------------------------

        transaction.create(
            runRef,
            {
              version:
                1,

              storeId:
                normalizedStoreId,

              runId,

              status:
                "started",

              scheduleTime:
                plan.scheduleTime,

              jobName:
                plan.jobName,

              identityHashSha256:
                plan
                    .identityHashSha256,

              freshBudgetGranted:
                true,

              freshBudgetMax:
                plan
                    .maxFreshDeletes,

              createdAt:
                serverTimestamp,

              updatedAt:
                serverTimestamp,

              completedAt:
                null,

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
  acquireBackupRetentionScheduleRunBudget,
};