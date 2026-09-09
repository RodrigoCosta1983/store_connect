"use strict";


// ============================================================================
// STORE&CONNECT — RETENÇÃO AUTOMÁTICA DE BACKUPS
// ============================================================================
//
// Arquivo:
//   functions/backups/scheduledBackupRetention.js
//
// Etapa:
//   F5.6-D3-G9 — Integração controlada da retenção automática
//
// Objetivo:
//
// Executar automaticamente a política de retenção para todas as lojas,
// mantendo dois caminhos claramente separados:
//
//   1. DRY RUN
//      → calcula política;
//      → valida candidatos;
//      → gera logs;
//      → não altera Firestore;
//      → não altera Storage.
//
//   2. EXECUÇÃO CONTROLADA
//      → somente quando habilitada globalmente;
//      → somente para lojas explicitamente autorizadas;
//      → retoma operações interrompidas;
//      → recalcula política;
//      → revalida candidatos;
//      → executa exclusão pelo protocolo seguro;
//      → limita novas exclusões por loja.
//
// ============================================================================
//
// SEGURANÇA
//
// A execução destrutiva depende de DUAS condições simultâneas:
//
//   RETENTION_EXECUTION_ENABLED === true
//
//              E
//
//   RETENTION_EXECUTION_STORE_IDS.has(storeId)
//
// Se qualquer uma das condições for falsa:
//
//   → a loja obrigatoriamente permanece em DRY RUN.
//
// Atualmente:
//
//   RETENTION_EXECUTION_ENABLED = false
//   allow-list = vazia
//
// Portanto:
//
//   ✅ nenhuma exclusão destrutiva pode ser iniciada pelo Scheduler.
//
// ============================================================================
//
// HORÁRIO:
//
//   04:00
//   America/Sao_Paulo
//
// O backup automático da loja acontece às 03:00.
//
// A retenção roda posteriormente para evitar concorrência direta entre:
//
//   criação do snapshot
//          ↓
//   análise / execução de retenção
//
// ============================================================================
//
// FLUXO:
//
// 04:00
//   ↓
// busca todas as lojas
//   ↓
// para cada loja:
//   ↓
// verifica rollout
//   ↓
//
// ┌─────────────────────────────────────────────────────────────┐
// │ RETENTION_EXECUTION_ENABLED = false                        │
// │ ou loja fora da allow-list                                 │
// │                                                             │
// │ → processStoreRetentionDryRun()                             │
// │ → somente leitura                                          │
// └─────────────────────────────────────────────────────────────┘
//
// OU
//
// ┌─────────────────────────────────────────────────────────────┐
// │ RETENTION_EXECUTION_ENABLED = true                         │
// │ + loja presente na allow-list                              │
// │                                                             │
// │ → processStoreRetentionExecution()                          │
// │     ↓                                                       │
// │   retoma claimed / storage_deleted                          │
// │     ↓                                                       │
// │   recalcula política                                        │
// │     ↓                                                       │
// │   revalida candidatos                                       │
// │     ↓                                                       │
// │   executa no máximo N novos candidatos                      │
// └─────────────────────────────────────────────────────────────┘
//
// ============================================================================
//
// IMPORTANTE:
//
// Um DELETE CANDIDATE nunca é, por si só, autorização para exclusão.
//
// Antes de um novo claim:
//
// - a política é recalculada;
// - validateRetentionDeleteCandidate() é executado;
// - claimBackupRetentionDelete() relê os snapshots dentro da transaction;
// - o planner revalida novamente a política;
// - somente CREATE_CLAIM permite ready → deleting.
//
// ============================================================================


const admin =
    require("firebase-admin");


const {
  onSchedule,
} = require(
    "firebase-functions/v2/scheduler",
);


const {
  calculateBackupRetention,
  validateRetentionDeleteCandidate,
} = require(
    "./backupRetention",
);


const {
  processStoreScheduledRetentionExecution,
} = require(
    "./processStoreScheduledRetentionExecution",
);


const {
  getRetentionScheduleEventIdentity,
} = require(
    "./backupRetentionScheduleEvent",
);


const {
  randomUUID,
} = require(
    "node:crypto",
);


// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

const RETENTION_SCHEDULE =
    "0 4 * * *";


const TIME_ZONE =
    "America/Sao_Paulo";


// ============================================================================
// EXECUÇÃO DESTRUTIVA — TRAVA DE ROLLOUT
// ============================================================================
//
// IMPORTANTE:
//
// false = nenhuma loja pode entrar em execução destrutiva.
//
// A exclusão real somente poderá acontecer quando:
//
// 1. RETENTION_EXECUTION_ENABLED === true;
// 2. a loja estiver explicitamente na allow-list.
//
// Neste momento:
//
// ✅ false
// ✅ allow-list vazia
//
// Portanto nenhuma exclusão real pode ocorrer pelo Scheduler.
//
// ============================================================================

const RETENTION_EXECUTION_ENABLED =
    false;


const RETENTION_EXECUTION_STORE_IDS =
    new Set([
      // Nenhuma loja habilitada nesta fase.
    ]);


const RETENTION_MAX_FRESH_DELETES_PER_STORE =
    1;


// ============================================================================
// EXECUÇÃO CONTROLADA — SOMENTE TESTE NOS EMULATORS
// ============================================================================
//
// Esta segunda porta existe exclusivamente para permitir o teste integrado
// do Scheduler sem alterar a trava de produção.
//
// Só pode ser habilitada quando:
//
// 1. RETENTION_EMULATOR_EXECUTION_ENABLED === "true";
// 2. Firestore aponta exatamente para o Emulator;
// 3. Storage aponta exatamente para o Emulator;
// 4. a loja está explicitamente na allow-list de teste.
//
// Se FIRESTORE_EMULATOR_HOST estiver definido, o Admin SDK não aponta para
// o Firestore de produção.
//
// ============================================================================

const RETENTION_EMULATOR_EXECUTION_ENABLED =
    (
      process.env
          .RETENTION_EMULATOR_EXECUTION_ENABLED ===
        "true" &&
      process.env
          .FIRESTORE_EMULATOR_HOST ===
        "127.0.0.1:8080" &&
      process.env
          .FIREBASE_STORAGE_EMULATOR_HOST ===
        "127.0.0.1:9199"
    );


const RETENTION_EMULATOR_EXECUTION_STORE_IDS =
    new Set(
        String(
            process.env
                .RETENTION_EMULATOR_EXECUTION_STORE_IDS ||
            "",
        )
            .split(",")
            .map(
                (value) =>
                  value.trim(),
            )
            .filter(
                Boolean,
            ),
    );

// ============================================================================
// VERIFICA ROLLOUT DA LOJA
// ============================================================================

function isRetentionExecutionEnabledForStore(
    storeId,
) {
  const productionExecutionEnabled =
      (
        RETENTION_EXECUTION_ENABLED ===
          true &&
        RETENTION_EXECUTION_STORE_IDS
            .has(
                storeId,
            )
      );


  const emulatorExecutionEnabled =
      (
        RETENTION_EMULATOR_EXECUTION_ENABLED ===
          true &&
        RETENTION_EMULATOR_EXECUTION_STORE_IDS
            .has(
                storeId,
            )
      );


  return (
    productionExecutionEnabled ||
    emulatorExecutionEnabled
  );
}


// ============================================================================
// SERIALIZA BACKUP PARA LOG
// ============================================================================

function backupForLog(
    backup,
) {
  return {
    backupId:
      backup.backupId,

    createdAt:
      backup.createdAtDate
        ? backup
            .createdAtDate
            .toISOString()
        : null,

    type:
      backup.type ||
      null,

    status:
      backup.status ||
      null,

    storagePath:
      backup.storagePath ||
      null,
  };
}


// ============================================================================
// PROCESSA UMA LOJA — DRY RUN
// ============================================================================
//
// Esta função:
//
// ✅ lê snapshots;
// ✅ calcula política;
// ✅ revalida deleteCandidates;
// ✅ gera logs;
//
// Esta função NÃO:
//
// ❌ cria retentionDeletes;
// ❌ altera snapshot;
// ❌ exclui Storage;
// ❌ cria auditoria;
// ❌ altera dailyRuns.
//
// ============================================================================

async function processStoreRetentionDryRun({
  db,
  storeId,
}) {
  const snapshotsRef =
      db
          .collection(
              "storeBackups",
          )
          .doc(
              storeId,
          )
          .collection(
              "snapshots",
          );


  const snapshots =
      await snapshotsRef
          .get();


  // --------------------------------------------------------------------------
  // METADATA ORIGINAL DOS DOCUMENTOS
  // --------------------------------------------------------------------------
  //
  // Mantemos uma cópia da metadata exatamente como veio do Firestore.
  //
  // Isso é importante porque:
  //
  // - backupId canônico = doc.id;
  // - metadata pode conter campo backupId divergente;
  // - o validator precisa detectar essa inconsistência.
  //
  // --------------------------------------------------------------------------

  const rawMetadataByBackupId =
      new Map(
          snapshots.docs.map(
              (doc) => [
                doc.id,

                doc.data() ||
                  {},
              ],
          ),
      );


  // --------------------------------------------------------------------------
  // VISÃO CANÔNICA
  // --------------------------------------------------------------------------

  const backups =
      snapshots.docs.map(
          (doc) => ({
            ...(
              doc.data() ||
                {}
            ),

            backupId:
              doc.id,
          }),
      );


  // --------------------------------------------------------------------------
  // EXECUTA MOTOR DE RETENÇÃO
  // --------------------------------------------------------------------------

  const result =
      calculateBackupRetention(
          backups,
      );


  // --------------------------------------------------------------------------
  // REVALIDA CADA DELETE CANDIDATE
  // --------------------------------------------------------------------------
  //
  // DELETE CANDIDATE não significa autorização.
  //
  // Cada candidato calculado passa novamente por:
  //
  //   validateRetentionDeleteCandidate()
  //
  // A validação recebe:
  //
  // - metadata ORIGINAL do Firestore;
  // - backupId canônico = doc.id;
  // - lista ATUAL de todos os backups.
  //
  // A própria função recalcula a política novamente.
  //
  // --------------------------------------------------------------------------

  const validatedDeleteCandidates =
      result
          .deleteCandidates
          .map(
              (candidate) => {
                const backupId =
                    candidate
                        .backupId;


                const rawMetadata =
                    rawMetadataByBackupId
                        .get(
                            backupId,
                        ) ||
                    null;


                const validation =
                    validateRetentionDeleteCandidate({
                      storeId,

                      backupId,

                      backupData:
                        rawMetadata,

                      allBackups:
                        backups,
                    });


                return {
                  backupId,

                  allowed:
                    validation
                        .allowed,

                  storagePath:
                    candidate
                        .storagePath ||
                    null,

                  createdAt:
                    candidate
                        .createdAtDate
                      ? candidate
                          .createdAtDate
                          .toISOString()
                      : null,

                  reasons:
                    validation
                        .reasons ||
                    [],
                };
              },
          );


  const allowedDeleteCandidates =
      validatedDeleteCandidates
          .filter(
              (candidate) =>
                candidate.allowed ===
                  true,
          );


  const blockedDeleteCandidates =
      validatedDeleteCandidates
          .filter(
              (candidate) =>
                candidate.allowed !==
                  true,
          );


  // --------------------------------------------------------------------------
  // LOG RESUMIDO DA LOJA
  // --------------------------------------------------------------------------

  console.log(
      "🧪 Retenção automática — DRY RUN.",
      {
        storeId,

        dryRun:
          true,

        totalSnapshots:
          snapshots.size,

        eligible:
          result
              .counts
              .eligible,

        keepDaily:
          result
              .counts
              .keepDaily,

        keepWeekly:
          result
              .counts
              .keepWeekly,

        keepMonthly:
          result
              .counts
              .keepMonthly,

        keepTotal:
          result
              .counts
              .keepTotal,

        deleteCandidates:
          result
              .counts
              .deleteCandidates,

        allowedDeleteCandidates:
          allowedDeleteCandidates
              .length,

        blockedDeleteCandidates:
          blockedDeleteCandidates
              .length,
      },
  );


  // --------------------------------------------------------------------------
  // CANDIDATOS AUTORIZADOS PELAS TRAVAS
  // --------------------------------------------------------------------------
  //
  // Mesmo ALLOWED continua sendo SOMENTE DRY RUN nesta função.
  //
  // --------------------------------------------------------------------------

  if (
    allowedDeleteCandidates
        .length >
    0
  ) {
    console.log(
        "✅ Candidatos autorizados pelas travas — SOMENTE DRY RUN.",
        {
          storeId,

          count:
            allowedDeleteCandidates
                .length,

          backups:
            allowedDeleteCandidates,
        },
    );
  }


  // --------------------------------------------------------------------------
  // CANDIDATOS BLOQUEADOS
  // --------------------------------------------------------------------------

  if (
    blockedDeleteCandidates
        .length >
    0
  ) {
    console.warn(
        "🛡️ Candidatos BLOQUEADOS pelas travas de retenção.",
        {
          storeId,

          count:
            blockedDeleteCandidates
                .length,

          backups:
            blockedDeleteCandidates,
        },
    );
  }


  // --------------------------------------------------------------------------
  // RESULTADO
  // --------------------------------------------------------------------------

  return {
    totalSnapshots:
      snapshots.size,

    eligible:
      result
          .counts
          .eligible,

    keepTotal:
      result
          .counts
          .keepTotal,

    deleteCandidates:
      result
          .counts
          .deleteCandidates,

    allowedDeleteCandidates:
      allowedDeleteCandidates
          .length,

    blockedDeleteCandidates:
      blockedDeleteCandidates
          .length,
  };
}


// ============================================================================
// SCHEDULER
// ============================================================================

const scheduledBackupRetention =
    onSchedule(
        {
          schedule:
            RETENTION_SCHEDULE,

          timeZone:
            TIME_ZONE,

          timeoutSeconds:
            540,

          memory:
            "512MiB",

          retryCount:
            5,

          minBackoffSeconds:
            60,

          maxBackoffSeconds:
            300,

          maxRetrySeconds:
            1800,
        },

        async (event) => {
          const db =
              admin
                  .firestore();


          const bucket =
              admin
                  .storage()
                  .bucket();


          const executionId =
              `scheduled-retention-${randomUUID()}`;
              let scheduleIdentity =
                  null;


          // --------------------------------------------------------------------
          // 1. BUSCA TODAS AS LOJAS
          // --------------------------------------------------------------------

          const storesSnapshot =
              await db
                  .collection(
                      "stores",
                  )
                  .get();


          // --------------------------------------------------------------------
          // CONTADORES GERAIS
          // --------------------------------------------------------------------

          let successCount =
              0;


          let failureCount =
              0;


          let totalEligible =
              0;


          let totalDeleteCandidates =
              0;


          let totalAllowedDeleteCandidates =
              0;


          let totalBlockedDeleteCandidates =
              0;


          // --------------------------------------------------------------------
          // CONTADORES POR MODO
          // --------------------------------------------------------------------

          let dryRunStoreCount =
              0;


          let executionStoreCount =
              0;


          // --------------------------------------------------------------------
          // CONTADORES DA EXECUÇÃO CONTROLADA
          // --------------------------------------------------------------------

          let totalResumedCompleted =
              0;


          let totalFreshCompleted =
              0;


          let totalFreshDeferred =
              0;


          let totalExecutionErrors =
              0;


          // --------------------------------------------------------------------
          // LOG INICIAL
          // --------------------------------------------------------------------

          console.log(
              "🛡️ Iniciando retenção automática.",
              {
                destructiveExecutionEnabled:
                  RETENTION_EXECUTION_ENABLED,

                allowListedStores:
                  RETENTION_EXECUTION_STORE_IDS
                      .size,

                maxFreshDeletesPerStore:
                  RETENTION_MAX_FRESH_DELETES_PER_STORE,

                totalStores:
                  storesSnapshot
                      .size,

                schedule:
                  RETENTION_SCHEDULE,

                timeZone:
                  TIME_ZONE,

                executionId,
              },
          );


          // --------------------------------------------------------------------
          // 2. PROCESSA LOJA POR LOJA
          // --------------------------------------------------------------------

          for (
            const storeDoc
            of storesSnapshot.docs
          ) {
            const storeId =
                storeDoc.id;


            const executionEnabledForStore =
                isRetentionExecutionEnabledForStore(
                    storeId,
                );


            if (
              executionEnabledForStore
            ) {
              executionStoreCount +=
                  1;
            } else {
              dryRunStoreCount +=
                  1;
            }


            try {
              let result;


              // ================================================================
              // EXECUÇÃO CONTROLADA
              // ================================================================

             if (
               executionEnabledForStore
             ) {
               if (
                 scheduleIdentity ===
                   null
               ) {
                 scheduleIdentity =
                     getRetentionScheduleEventIdentity({
                       scheduleTime:
                         event?.scheduleTime,

                       jobName:
                         event?.jobName,
                     });
               }
                console.warn(
                    "⚠️ Retenção em modo EXECUÇÃO CONTROLADA.",
                    {
                      storeId,

                      executionId,

                      maxFreshDeletes:
                        RETENTION_MAX_FRESH_DELETES_PER_STORE,
                    },
                );


                result =
                    await processStoreScheduledRetentionExecution({
                      db,

                      bucket,

                      storeId,

                      scheduleIdentity,

                      executionId,

                      maxFreshDeletes:
                        RETENTION_MAX_FRESH_DELETES_PER_STORE,
                    });


                console.log(
                    "✅ Execução controlada da retenção concluída para a loja.",
                    {
                      storeId,

                      executionId,

                      activeOperations:
                        result
                            .activeOperations,

                      resumedCompleted:
                        result
                            .resumedCompleted,

                      resumedSkippedLeased:
                        result
                            .resumedSkippedLeased,

                      resumedBlocked:
                        result
                            .resumedBlocked,

                      freshSelected:
                        result
                            .freshSelected,

                      freshCompleted:
                        result
                            .freshCompleted,

                      freshDeferred:
                        result
                            .freshDeferred,

                      freshSkippedLeased:
                        result
                            .freshSkippedLeased,

                      freshBlocked:
                        result
                            .freshBlocked,

                      errorCount:
                        result
                            .errorCount,
                    },
                );


                totalResumedCompleted +=
                    result
                        .resumedCompleted;


                totalFreshCompleted +=
                    result
                        .freshCompleted;


                totalFreshDeferred +=
                    result
                        .freshDeferred;


                totalExecutionErrors +=
                    result
                        .errorCount;


                // --------------------------------------------------------------
                // ERROS INTERNOS NÃO PODEM SER TRATADOS COMO SUCESSO DA LOJA
                // --------------------------------------------------------------
                //
                // processStoreRetentionExecution() isola erros de candidatos
                // individuais para continuar processando a loja.
                //
                // O Scheduler precisa propagar essa informação para que a
                // execução seja considerada falha e possa sofrer retry.
                //
                // --------------------------------------------------------------

                if (
                  result.errorCount >
                    0
                ) {
                  throw new Error(
                      (
                        "Execução controlada da retenção terminou " +
                        `com ${result.errorCount} erro(s) interno(s).`
                      ),
                  );
                }
              } else {
                // ==============================================================
                // DRY RUN
                // ==============================================================

                result =
                    await processStoreRetentionDryRun({
                      db,

                      storeId,
                    });
              }


              // ----------------------------------------------------------------
              // CONTADORES COMUNS
              // ----------------------------------------------------------------

              successCount +=
                  1;


              totalEligible +=
                  result
                      .eligible;


              totalDeleteCandidates +=
                  result
                      .deleteCandidates;


              totalAllowedDeleteCandidates +=
                  result
                      .allowedDeleteCandidates;


              totalBlockedDeleteCandidates +=
                  result
                      .blockedDeleteCandidates;
            } catch (error) {
              failureCount +=
                  1;


              console.error(
                  "❌ Erro na retenção automática.",
                  {
                    storeId,

                    mode:
                      executionEnabledForStore
                        ? "CONTROLLED_EXECUTION"
                        : "DRY_RUN",

                    executionId,

                    error:
                      error instanceof Error
                        ? error.message
                        : String(
                            error,
                        ),
                  },
              );
            }
          }


          // --------------------------------------------------------------------
          // 3. RESUMO FINAL
          // --------------------------------------------------------------------

          console.log(
              "✅ Retenção automática finalizada.",
              {
                destructiveExecutionEnabled:
                  RETENTION_EXECUTION_ENABLED,

                executionId,

                totalStores:
                  storesSnapshot
                      .size,

                dryRunStoreCount,

                executionStoreCount,

                successCount,

                failureCount,

                totalEligible,

                totalDeleteCandidates,

                totalAllowedDeleteCandidates,

                totalBlockedDeleteCandidates,

                totalResumedCompleted,

                totalFreshCompleted,

                totalFreshDeferred,

                totalExecutionErrors,
              },
          );


          // --------------------------------------------------------------------
          // 4. FORÇA RETRY SE ALGUMA LOJA FALHOU
          // --------------------------------------------------------------------
          //
          // DRY RUN é somente leitura.
          //
          // Na execução controlada, retries continuam seguros porque
          // o protocolo usa operações persistentes, lease e etapas
          // idempotentes para retomar uma exclusão interrompida.
          //
          // --------------------------------------------------------------------

          if (
            failureCount >
              0
          ) {
            throw new Error(
                (
                  "Falha na retenção automática de " +
                  `${failureCount} loja(s).`
                ),
            );
          }
        },
    );


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  scheduledBackupRetention,

  processStoreRetentionDryRun,
};