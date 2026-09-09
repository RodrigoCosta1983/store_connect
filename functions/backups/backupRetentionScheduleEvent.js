"use strict";


const {
  createHash,
} = require(
    "node:crypto",
);


// ============================================================================
// F5.6-D3-G9.6-D1
// IDENTIDADE DETERMINÍSTICA DO EVENTO DO SCHEDULER
// ============================================================================
//
// Objetivo:
//
// Transformar:
//
//   jobName
//   +
//   scheduleTime
//
// em uma identidade persistente e determinística.
//
// IMPORTANTE:
//
// runId:
//   identifica A OCORRÊNCIA agendada.
//
// executionId:
//   identifica UMA TENTATIVA / WORKER.
//
// Portanto:
//
// mesmo evento + retry
//   → mesmo runId
//   → executionId diferente
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


function normalizeScheduleTime(
    value,
) {
  const raw =
      normalizeString(
          value,
      );


  if (!raw) {
    throw new Error(
        "scheduleTime obrigatório.",
    );
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
    throw new Error(
        "scheduleTime inválido.",
    );
  }


  return date.toISOString();
}


// ============================================================================
// IDENTIDADE
// ============================================================================

function getRetentionScheduleEventIdentity({
  scheduleTime,
  jobName =
    null,
} = {}) {
  const normalizedScheduleTime =
      normalizeScheduleTime(
          scheduleTime,
      );


  const normalizedJobName =
      normalizeString(
          jobName,
      );


  // --------------------------------------------------------------------------
  // JOB MANUAL
  // --------------------------------------------------------------------------
  //
  // A própria definição do Firebase informa que jobName pode ser undefined
  // quando a função é acionada manualmente.
  //
  // Usamos um marcador determinístico nesse caso.
  //
  // --------------------------------------------------------------------------

  const jobIdentity =
      normalizedJobName ||
      "manual";


  // --------------------------------------------------------------------------
  // MATERIAL DA IDENTIDADE
  // --------------------------------------------------------------------------

  const identitySource =
      [
        "store-connect",
        "backup-retention",
        jobIdentity,
        normalizedScheduleTime,
      ].join(
          "\n",
      );


  const identityHashSha256 =
      createHash(
          "sha256",
      )
          .update(
              identitySource,
              "utf8",
          )
          .digest(
              "hex",
          );


  // --------------------------------------------------------------------------
  // RUN ID
  // --------------------------------------------------------------------------

  const runId =
      (
        "retention-schedule-" +
        identityHashSha256
      );


  return {
    runId,

    scheduleTime:
      normalizedScheduleTime,

    jobName:
      normalizedJobName ||
      null,

    identityHashSha256,
  };
}


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  getRetentionScheduleEventIdentity,
};