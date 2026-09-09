"use strict";


const {
  acquireBackupRetentionScheduleRunBudget,
} = require(
    "./acquireBackupRetentionScheduleRunBudget",
);

const {
  completeBackupRetentionScheduleRun,
} = require(
    "./completeBackupRetentionScheduleRun",
);

const {
  processStoreRetentionExecution,
} = require(
    "./processStoreRetentionExecution",
);

const {
  ACTIONS:
    RUN_ACTIONS,
} = require(
    "./backupRetentionScheduleRunPlanner",
);

const {
  ACTIONS:
    COMPLETION_ACTIONS,
} = require(
    "./backupRetentionScheduleRunCompletionPlanner",
);


// ============================================================================
// F5.6-D3-G9.6-D13
// EXECUÇÃO DA LOJA PROTEGIDA PELO LEDGER DO SCHEDULER
// ============================================================================
//
// Fluxo:
//
// 1. Reserva fresh budget no ledger.
//
// PRIMEIRA TENTATIVA:
//   GRANT_FRESH_BUDGET
//   → maxFreshDeletes configurado pelo Scheduler.
//
// RETRY DO MESMO EVENTO:
//   RESUME_ONLY
//   → maxFreshDeletes = 0.
//
// 2. Executa processStoreRetentionExecution.
//
// 3. Se houver erro:
//   NÃO completa o ledger.
//   Retry poderá retomar operações persistentes,
//   porém continuará com fresh budget = 0.
//
// 4. Se tudo terminar sem erro:
//   started → completed.
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


function formatReasons(
    reasons,
) {
  if (
    !Array.isArray(
        reasons,
    ) ||
    reasons.length ===
      0
  ) {
    return "motivo não informado";
  }


  return reasons
      .map(
          (reason) => {
            const code =
                normalizeString(
                    reason?.code,
                );

            const message =
                normalizeString(
                    reason?.message,
                );


            if (
              code &&
              message
            ) {
              return `${code}: ${message}`;
            }


            return (
              message ||
              code ||
              "motivo inválido"
            );
          },
      )
      .join(
          "; ",
      );
}


// ============================================================================
// EXECUTOR
// ============================================================================

async function processStoreScheduledRetentionExecution({
  db,
  bucket,
  storeId,
  scheduleIdentity,
  executionId,
  maxFreshDeletes =
    1,
  now,
}) {
  // ==========================================================================
  // 1. INPUTS BÁSICOS
  // ==========================================================================

  const normalizedStoreId =
      normalizeString(
          storeId,
      );


  if (!normalizedStoreId) {
    throw new Error(
        "storeId obrigatório.",
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
  // 2. RESERVA PERSISTENTE DO FRESH BUDGET
  // ==========================================================================

  const budget =
      await acquireBackupRetentionScheduleRunBudget({
        db,

        storeId:
          normalizedStoreId,

        scheduleIdentity,

        maxFreshDeletes,
      });


  // --------------------------------------------------------------------------
  // FAIL CLOSED
  // --------------------------------------------------------------------------

  if (
    !budget.allowed ||
    budget.action ===
      RUN_ACTIONS.BLOCKED
  ) {
    throw new Error(
        (
          "Ledger do Scheduler bloqueou a execução da loja " +
          `${normalizedStoreId}. ` +
          formatReasons(
              budget.reasons,
          )
        ),
    );
  }


  if (
    budget.action !==
      RUN_ACTIONS.GRANT_FRESH_BUDGET &&
    budget.action !==
      RUN_ACTIONS.RESUME_ONLY
  ) {
    throw new Error(
        (
          "Ação inesperada ao reservar fresh budget: " +
          String(
              budget.action,
          )
        ),
    );
  }


  // ==========================================================================
  // 3. EXECUÇÃO REAL DA RETENÇÃO
  // ==========================================================================

  const executionArgs = {
    db,

    bucket,

    storeId:
      normalizedStoreId,

    executionId:
      normalizedExecutionId,

    maxFreshDeletes:
      budget.maxFreshDeletes,
  };


  // --------------------------------------------------------------------------
  // Permite testes determinísticos sem alterar o comportamento de produção.
  // --------------------------------------------------------------------------

  if (
    now !==
      undefined
  ) {
    executionArgs.now =
        now;
  }


  const result =
      await processStoreRetentionExecution(
          executionArgs,
      );


  // ==========================================================================
  // 4. ERROS → NÃO COMPLETA LEDGER
  // ==========================================================================
  //
  // O Scheduler continuará tratando errorCount > 0 como falha.
  //
  // O ledger permanece started.
  //
  // Em retry:
  //
  // acquire → RESUME_ONLY
  // maxFreshDeletes → 0
  //
  // permitindo apenas retomar operações persistentes.
  //
  // ==========================================================================

  if (
    result.errorCount >
      0
  ) {
    return {
      ...result,

      scheduleRunId:
        scheduleIdentity.runId,

      scheduleRunBudgetAction:
        budget.action,

      scheduleRunFreshBudget:
        budget.maxFreshDeletes,

      scheduleRunLedgerCreated:
        budget.wrote ===
          true,

      scheduleRunCompleted:
        false,

      scheduleRunCompletionAction:
        null,
    };
  }


  // ==========================================================================
  // 5. CONCLUSÃO DO LEDGER
  // ==========================================================================

  const completion =
      await completeBackupRetentionScheduleRun({
        db,

        storeId:
          normalizedStoreId,

        scheduleIdentity,

        executionId:
          normalizedExecutionId,
      });


  // --------------------------------------------------------------------------
  // FAIL CLOSED
  // --------------------------------------------------------------------------

  if (
    !completion.allowed ||
    completion.action ===
      COMPLETION_ACTIONS.BLOCKED
  ) {
    throw new Error(
        (
          "Conclusão do ledger do Scheduler foi bloqueada " +
          `para a loja ${normalizedStoreId}. ` +
          formatReasons(
              completion.reasons,
          )
        ),
    );
  }


  if (
    completion.action !==
      COMPLETION_ACTIONS.COMPLETE &&
    completion.action !==
      COMPLETION_ACTIONS.ALREADY_COMPLETED
  ) {
    throw new Error(
        (
          "Ação inesperada ao concluir ledger: " +
          String(
              completion.action,
          )
        ),
    );
  }


  // ==========================================================================
  // 6. RESULTADO
  // ==========================================================================

  return {
    ...result,

    scheduleRunId:
      scheduleIdentity.runId,

    scheduleRunBudgetAction:
      budget.action,

    scheduleRunFreshBudget:
      budget.maxFreshDeletes,

    scheduleRunLedgerCreated:
      budget.wrote ===
        true,

    scheduleRunCompleted:
      true,

    scheduleRunCompletionAction:
      completion.action,
  };
}


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  processStoreScheduledRetentionExecution,
};