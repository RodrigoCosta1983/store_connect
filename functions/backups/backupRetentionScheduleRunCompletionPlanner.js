"use strict";


const {
  planBackupRetentionScheduleRun,
  ACTIONS:
    RUN_ACTIONS,
} = require(
    "./backupRetentionScheduleRunPlanner",
);


// ============================================================================
// F5.6-D3-G9.6-D9
// PLANNER DE CONCLUSÃO DO LEDGER DO SCHEDULER
// ============================================================================
//
// Objetivo:
//
// Após a execução segura da retenção da loja:
//
// started
//   → COMPLETE
//
// completed
//   → ALREADY_COMPLETED
//
// ledger ausente / inconsistente
//   → BLOCKED
//
// Este planner NÃO escreve no Firestore.
//
// ============================================================================


// ============================================================================
// ACTIONS
// ============================================================================

const ACTIONS =
    Object.freeze({
      COMPLETE:
        "COMPLETE",

      ALREADY_COMPLETED:
        "ALREADY_COMPLETED",

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


function blockedResult(
    reasons,
) {
  return {
    action:
      ACTIONS.BLOCKED,

    allowed:
      false,

    shouldWrite:
      false,

    reasons,
  };
}


// ============================================================================
// PLANNER
// ============================================================================

function planBackupRetentionScheduleRunCompletion({
  storeId,
  runId,
  scheduleIdentity,
  existingRun,
  executionId,
} = {}) {
  // ==========================================================================
  // 1. EXECUTION ID
  // ==========================================================================

  const normalizedExecutionId =
      normalizeString(
          executionId,
      );


  if (!normalizedExecutionId) {
    return blockedResult([
      {
        code:
          "missing-execution-id",

        message:
          "executionId obrigatório.",
      },
    ]);
  }


  // ==========================================================================
  // 2. LEDGER PRECISA EXISTIR
  // ==========================================================================

  if (
    existingRun ===
      null ||
    existingRun ===
      undefined
  ) {
    return blockedResult([
      {
        code:
          "missing-ledger",

        message:
          "Ledger do Scheduler não encontrado.",
      },
    ]);
  }


  // ==========================================================================
  // 3. REUTILIZA A VALIDAÇÃO OFICIAL DO LEDGER
  // ==========================================================================
  //
  // O planner principal já valida:
  //
  // - storeId
  // - runId
  // - scheduleTime
  // - jobName
  // - identityHashSha256
  // - version
  // - status
  // - freshBudgetGranted
  // - freshBudgetMax
  //
  // Para um ledger existente íntegro, ele deve retornar RESUME_ONLY.
  //
  // ==========================================================================

  const validation =
      planBackupRetentionScheduleRun({
        storeId,

        runId,

        scheduleIdentity,

        existingRun,

        maxFreshDeletes:
          1,
      });


  if (
    validation.action ===
      RUN_ACTIONS.BLOCKED
  ) {
    return blockedResult(
        validation.reasons,
    );
  }


  if (
    validation.action !==
      RUN_ACTIONS.RESUME_ONLY
  ) {
    return blockedResult([
      {
        code:
          "unexpected-ledger-validation-action",

        message:
          (
            "Ledger existente não produziu " +
            "RESUME_ONLY durante validação."
          ),
      },
    ]);
  }


  // ==========================================================================
  // 4. STATUS
  // ==========================================================================

  const status =
      normalizeString(
          existingRun.status,
      );


  // --------------------------------------------------------------------------
  // JÁ COMPLETADO
  // --------------------------------------------------------------------------

  if (
    status ===
      "completed"
  ) {
    return {
      action:
        ACTIONS.ALREADY_COMPLETED,

      allowed:
        true,

      shouldWrite:
        false,

      storeId:
        validation.storeId,

      runId:
        validation.runId,

      executionId:
        normalizedExecutionId,

      reasons:
        [],
    };
  }


  // --------------------------------------------------------------------------
  // STARTED → COMPLETE
  // --------------------------------------------------------------------------

  if (
    status ===
      "started"
  ) {
    return {
      action:
        ACTIONS.COMPLETE,

      allowed:
        true,

      shouldWrite:
        true,

      storeId:
        validation.storeId,

      runId:
        validation.runId,

      executionId:
        normalizedExecutionId,

      scheduleTime:
        validation.scheduleTime,

      jobName:
        validation.jobName,

      identityHashSha256:
        validation.identityHashSha256,

      reasons:
        [],
    };
  }


  // ==========================================================================
  // 5. FAIL CLOSED
  // ==========================================================================

  return blockedResult([
    {
      code:
        "unsupported-ledger-status",

      message:
        "Status do ledger não suportado para conclusão.",
    },
  ]);
}


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  planBackupRetentionScheduleRunCompletion,

  ACTIONS,
};