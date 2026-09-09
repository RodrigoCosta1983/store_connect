"use strict";


// ============================================================================
// F5.6-D3-G9.6-D5
// PLANNER DO LEDGER DO SCHEDULER
// ============================================================================
//
// Objetivo:
//
// Garantir que uma mesma ocorrência do Scheduler:
//
//   runId + storeId
//
// possa receber orçamento para NOVOS deletes somente UMA vez.
//
// Exemplo:
//
// tentativa 1
//   → ledger não existe
//   → GRANT_FRESH_BUDGET
//   → maxFreshDeletes = 1
//
// retry do mesmo evento
//   → ledger já existe
//   → RESUME_ONLY
//   → maxFreshDeletes = 0
//
// Assim:
//
// ✅ operações claimed/storage_deleted ainda podem ser retomadas;
// ❌ um retry não pode iniciar outro ready → deleting.
//
// ============================================================================


// ============================================================================
// ACTIONS
// ============================================================================

const ACTIONS =
    Object.freeze({
      GRANT_FRESH_BUDGET:
        "GRANT_FRESH_BUDGET",

      RESUME_ONLY:
        "RESUME_ONLY",

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

    maxFreshDeletes:
      0,

    shouldCreateLedger:
      false,

    reasons,
  };
}


function isValidSha256(
    value,
) {
  return (
    typeof value ===
      "string" &&
    /^[a-f0-9]{64}$/.test(
        value,
    )
  );
}


function isValidRunId(
    value,
) {
  return (
    typeof value ===
      "string" &&
    /^retention-schedule-[a-f0-9]{64}$/.test(
        value,
    )
  );
}


function normalizeScheduleTime(
    value,
) {
  const raw =
      normalizeString(
          value,
      );


  if (!raw) {
    return null;
  }


  const date =
      new Date(
          raw,
      );


  if (
    Number.isNaN(
        date.getTime(),
    )
  ) {
    return null;
  }


  return date.toISOString();
}


// ============================================================================
// PLANNER
// ============================================================================

function planBackupRetentionScheduleRun({
  storeId,
  runId,
  scheduleIdentity,
  existingRun =
    null,
  maxFreshDeletes =
    1,
} = {}) {
  const normalizedStoreId =
      normalizeString(
          storeId,
      );


  const normalizedRunId =
      normalizeString(
          runId,
      );


  // ==========================================================================
  // 1. IDENTIFICADORES
  // ==========================================================================

  if (!normalizedStoreId) {
    return blockedResult([
      {
        code:
          "missing-store-id",

        message:
          "storeId obrigatório.",
      },
    ]);
  }


  if (
    !isValidRunId(
        normalizedRunId,
    )
  ) {
    return blockedResult([
      {
        code:
          "invalid-run-id",

        message:
          "runId inválido.",
      },
    ]);
  }


  // ==========================================================================
  // 2. IDENTIDADE DO EVENTO
  // ==========================================================================

  if (
    !scheduleIdentity ||
    typeof scheduleIdentity !==
      "object" ||
    Array.isArray(
        scheduleIdentity,
    )
  ) {
    return blockedResult([
      {
        code:
          "missing-schedule-identity",

        message:
          "Identidade do evento do Scheduler obrigatória.",
      },
    ]);
  }


  const identityRunId =
      normalizeString(
          scheduleIdentity
              .runId,
      );


  const identityHashSha256 =
      normalizeString(
          scheduleIdentity
              .identityHashSha256,
      );


  const identityScheduleTime =
      normalizeScheduleTime(
          scheduleIdentity
              .scheduleTime,
      );


  const identityJobName =
      normalizeString(
          scheduleIdentity
              .jobName,
      ) ||
      null;


  if (
    identityRunId !==
      normalizedRunId
  ) {
    return blockedResult([
      {
        code:
          "schedule-run-id-mismatch",

        message:
          (
            "runId informado diverge da identidade " +
            "do evento do Scheduler."
          ),
      },
    ]);
  }


  if (
    !isValidSha256(
        identityHashSha256,
    )
  ) {
    return blockedResult([
      {
        code:
          "invalid-schedule-identity-hash",

        message:
          "Hash SHA-256 da identidade do Scheduler inválido.",
      },
    ]);
  }


  if (!identityScheduleTime) {
    return blockedResult([
      {
        code:
          "invalid-schedule-time",

        message:
          "scheduleTime da identidade do Scheduler inválido.",
      },
    ]);
  }


  // ==========================================================================
  // 3. ORÇAMENTO CONFIGURADO
  // ==========================================================================

  if (
    !Number.isInteger(
        maxFreshDeletes,
    ) ||
    maxFreshDeletes < 1 ||
    maxFreshDeletes > 100
  ) {
    return blockedResult([
      {
        code:
          "invalid-fresh-budget",

        message:
          (
            "maxFreshDeletes deve ser um inteiro " +
            "entre 1 e 100."
          ),
      },
    ]);
  }


  // ==========================================================================
  // 4. LEDGER NÃO EXISTE
  // ==========================================================================
  //
  // Somente esta situação concede orçamento para iniciar novos deletes.
  //
  // O ledger será criado ANTES da execução destrutiva.
  //
  // Isso é propositalmente fail-closed:
  //
  // se o processo morrer depois de consumir o orçamento, mas antes de iniciar
  // um novo claim, o retry receberá maxFreshDeletes=0.
  //
  // Nesse caso o candidato ficará para a próxima ocorrência diária.
  //
  // É preferível adiar uma exclusão a permitir duas exclusões no mesmo evento.
  //
  // ==========================================================================

  if (
    existingRun ===
      null ||
    existingRun ===
      undefined
  ) {
    return {
      action:
        ACTIONS.GRANT_FRESH_BUDGET,

      allowed:
        true,

      storeId:
        normalizedStoreId,

      runId:
        normalizedRunId,

      scheduleTime:
        identityScheduleTime,

      jobName:
        identityJobName,

      identityHashSha256,

      maxFreshDeletes,

      shouldCreateLedger:
        true,

      reasons:
        [],
    };
  }


  // ==========================================================================
  // 5. LEDGER EXISTENTE — FORMATO
  // ==========================================================================

  if (
    typeof existingRun !==
      "object" ||
    Array.isArray(
        existingRun,
    )
  ) {
    return blockedResult([
      {
        code:
          "invalid-existing-ledger",

        message:
          "Ledger existente possui formato inválido.",
      },
    ]);
  }


  // ==========================================================================
  // 6. INTEGRIDADE DO LEDGER
  // ==========================================================================

  if (
    normalizeString(
        existingRun.storeId,
    ) !==
      normalizedStoreId
  ) {
    return blockedResult([
      {
        code:
          "ledger-store-id-mismatch",

        message:
          "storeId do ledger diverge da loja atual.",
      },
    ]);
  }


  if (
    normalizeString(
        existingRun.runId,
    ) !==
      normalizedRunId
  ) {
    return blockedResult([
      {
        code:
          "ledger-run-id-mismatch",

        message:
          "runId persistido diverge do documento atual.",
      },
    ]);
  }


  const existingScheduleTime =
      normalizeScheduleTime(
          existingRun
              .scheduleTime,
      );


  if (
    existingScheduleTime !==
      identityScheduleTime
  ) {
    return blockedResult([
      {
        code:
          "ledger-schedule-time-mismatch",

        message:
          "scheduleTime do ledger diverge do evento atual.",
      },
    ]);
  }


  const existingJobName =
      normalizeString(
          existingRun.jobName,
      ) ||
      null;


  if (
    existingJobName !==
      identityJobName
  ) {
    return blockedResult([
      {
        code:
          "ledger-job-name-mismatch",

        message:
          "jobName do ledger diverge do evento atual.",
      },
    ]);
  }


  const existingHash =
      normalizeString(
          existingRun
              .identityHashSha256,
      );


  if (
    existingHash !==
      identityHashSha256 ||
    !isValidSha256(
        existingHash,
    )
  ) {
    return blockedResult([
      {
        code:
          "ledger-identity-hash-mismatch",

        message:
          "Hash da identidade persistida diverge do evento atual.",
      },
    ]);
  }


  // ==========================================================================
  // 7. VERSÃO
  // ==========================================================================

  if (
    existingRun.version !==
      1
  ) {
    return blockedResult([
      {
        code:
          "unsupported-ledger-version",

        message:
          "Versão do ledger não suportada.",
      },
    ]);
  }


  // ==========================================================================
  // 8. STATUS
  // ==========================================================================

  const status =
      normalizeString(
          existingRun.status,
      );


  if (
    status !==
      "started" &&
    status !==
      "completed"
  ) {
    return blockedResult([
      {
        code:
          "invalid-ledger-status",

        message:
          "Status do ledger inválido.",
      },
    ]);
  }


  // ==========================================================================
  // 9. PROVA DE QUE O FRESH BUDGET JÁ FOI CONSUMIDO
  // ==========================================================================

  if (
    existingRun
        .freshBudgetGranted !==
      true
  ) {
    return blockedResult([
      {
        code:
          "ledger-fresh-budget-not-granted",

        message:
          (
            "Ledger existente não confirma que " +
            "o fresh budget foi consumido."
          ),
      },
    ]);
  }


  if (
    !Number.isInteger(
        existingRun
            .freshBudgetMax,
    ) ||
    existingRun
        .freshBudgetMax <
      1 ||
    existingRun
        .freshBudgetMax >
      100
  ) {
    return blockedResult([
      {
        code:
          "invalid-ledger-fresh-budget",

        message:
          "Fresh budget persistido no ledger é inválido.",
      },
    ]);
  }


  // ==========================================================================
  // 10. RETRY DO MESMO EVENTO
  // ==========================================================================
  //
  // O orçamento fresh já foi concedido anteriormente.
  //
  // Portanto:
  //
  // ✅ pode retomar operações persistentes;
  // ❌ não pode iniciar novos claims.
  //
  // maxFreshDeletes = 0
  //
  // ==========================================================================

  return {
    action:
      ACTIONS.RESUME_ONLY,

    allowed:
      true,

    storeId:
      normalizedStoreId,

    runId:
      normalizedRunId,

    scheduleTime:
      identityScheduleTime,

    jobName:
      identityJobName,

    identityHashSha256,

    originalFreshBudget:
      existingRun
          .freshBudgetMax,

    maxFreshDeletes:
      0,

    ledgerStatus:
      status,

    shouldCreateLedger:
      false,

    reasons:
      [],
  };
}


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  planBackupRetentionScheduleRun,

  ACTIONS,

  isValidRunId,
};