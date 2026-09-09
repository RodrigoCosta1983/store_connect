"use strict";


const assert =
    require("assert");

const {
  getRetentionScheduleEventIdentity,
} = require(
    "../../backups/backupRetentionScheduleEvent",
);


// ============================================================================
// F5.6-D3-G9.6-D2
// IDENTIDADE DETERMINÃSTICA DO EVENTO DO SCHEDULER
// ============================================================================

function run() {
  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "F5.6-D3-G9.6-D2 â€” IDENTIDADE DO EVENTO DO SCHEDULER",
  );

  console.log(
      "============================================================",
  );


  const eventA = {
    jobName:
      "firebase-schedule-scheduledBackupRetention-us-central1",

    scheduleTime:
      "2026-09-09T07:00:00.000Z",
  };


  // --------------------------------------------------------------------------
  // MESMO EVENTO â†’ MESMO RUN ID
  // --------------------------------------------------------------------------

  const first =
      getRetentionScheduleEventIdentity(
          eventA,
      );


  const retry =
      getRetentionScheduleEventIdentity({
        jobName:
          eventA.jobName,

        scheduleTime:
          eventA.scheduleTime,
      });


  assert.strictEqual(
      first.runId,
      retry.runId,
  );


  assert.strictEqual(
      first.identityHashSha256,
      retry.identityHashSha256,
  );


  assert.strictEqual(
      first.scheduleTime,
      "2026-09-09T07:00:00.000Z",
  );


  console.log(
      "âœ… mesmo evento/retry â†’ mesmo runId",
  );


  // --------------------------------------------------------------------------
  // FORMATO EQUIVALENTE DE DATA â†’ MESMO RUN ID
  // --------------------------------------------------------------------------

  const equivalentTime =
      getRetentionScheduleEventIdentity({
        jobName:
          eventA.jobName,

        scheduleTime:
          "2026-09-09T04:00:00-03:00",
      });


  assert.strictEqual(
      equivalentTime.runId,
      first.runId,
  );


  console.log(
      "âœ… mesmo instante em outro fuso â†’ mesmo runId",
  );


  // --------------------------------------------------------------------------
  // OUTRA OCORRÃŠNCIA â†’ OUTRO RUN ID
  // --------------------------------------------------------------------------

  const nextDay =
      getRetentionScheduleEventIdentity({
        jobName:
          eventA.jobName,

        scheduleTime:
          "2026-09-10T07:00:00.000Z",
      });


  assert.notStrictEqual(
      nextDay.runId,
      first.runId,
  );


  console.log(
      "âœ… outro scheduleTime â†’ outro runId",
  );


  // --------------------------------------------------------------------------
  // OUTRO JOB â†’ OUTRO RUN ID
  // --------------------------------------------------------------------------

  const anotherJob =
      getRetentionScheduleEventIdentity({
        jobName:
          "outro-job",

        scheduleTime:
          eventA.scheduleTime,
      });


  assert.notStrictEqual(
      anotherJob.runId,
      first.runId,
  );


  console.log(
      "âœ… outro jobName â†’ outro runId",
  );


  // --------------------------------------------------------------------------
  // ACIONAMENTO MANUAL SEM jobName
  // --------------------------------------------------------------------------

  const manualA =
      getRetentionScheduleEventIdentity({
        scheduleTime:
          "2026-09-09T08:15:00.000Z",
      });


  const manualB =
      getRetentionScheduleEventIdentity({
        scheduleTime:
          "2026-09-09T08:15:00Z",
      });


  assert.strictEqual(
      manualA.jobName,
      null,
  );


  assert.strictEqual(
      manualA.runId,
      manualB.runId,
  );


  console.log(
      "âœ… acionamento manual â†’ identidade determinÃ­stica",
  );


  // --------------------------------------------------------------------------
  // HASH
  // --------------------------------------------------------------------------

  assert.match(
      first.identityHashSha256,
      /^[a-f0-9]{64}$/,
  );


  assert.strictEqual(
      first.runId,
      (
        "retention-schedule-" +
        first.identityHashSha256
      ),
  );


  console.log(
      "âœ… SHA-256 e formato do runId vÃ¡lidos",
  );


  // --------------------------------------------------------------------------
  // FAIL CLOSED
  // --------------------------------------------------------------------------

  assert.throws(
      () =>
        getRetentionScheduleEventIdentity({
          scheduleTime:
            "",
        }),

      /scheduleTime obrigatÃ³rio/,
  );


  assert.throws(
      () =>
        getRetentionScheduleEventIdentity({
          scheduleTime:
            "data-invalida",
        }),

      /scheduleTime invÃ¡lido/,
  );


  console.log(
      "âœ… scheduleTime ausente/invÃ¡lido â†’ bloqueado",
  );


  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… IDENTIDADE DETERMINÃSTICA DO SCHEDULER PASSOU",
  );

  console.log(
      "============================================================",
  );

  console.log("");
}


run();