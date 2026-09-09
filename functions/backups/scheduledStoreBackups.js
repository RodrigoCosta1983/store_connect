"use strict";

// ============================================================================
// STORE&CONNECT — BACKUP AUTOMÁTICO DIÁRIO DAS LOJAS
// ============================================================================
//
// Arquivo:
//   functions/backups/scheduledStoreBackups.js
//
// F5.5 — AUTOMAÇÃO DIÁRIA
//
// Responsabilidades:
// - executar automaticamente todos os dias;
// - localizar as lojas existentes;
// - reutilizar o mesmo motor seguro do backup manual;
// - impedir duplicidade de backup automático no mesmo dia;
// - identificar o executor como "system";
// - registrar metadata e auditoria como backup automático;
// - permitir retry seguro em caso de falha;
// - continuar processando as demais lojas caso uma delas falhe.
//
// Horário:
//   03:00 — America/Sao_Paulo
//
// ============================================================================

const {
  onSchedule,
} = require("firebase-functions/v2/scheduler");

const admin =
    require("firebase-admin");

const {
  createStoreSnapshotCore,
} = require("./createStoreSnapshot");


// ============================================================================
// DATA LOCAL — SÃO PAULO
// ============================================================================
//
// Gera a chave diária usada para garantir apenas um backup automático
// por loja por dia.
//
// Exemplo:
//   2026-09-04
//
// Não dependemos do timezone do servidor.
//
// ============================================================================

function getSaoPauloDateKey(date = new Date()) {
  const parts =
      new Intl.DateTimeFormat(
          "en-US",
          {
            timeZone:
              "America/Sao_Paulo",

            year:
              "numeric",

            month:
              "2-digit",

            day:
              "2-digit",
          },
      ).formatToParts(date);

  const values = {};

  for (const part of parts) {
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day"
    ) {
      values[part.type] =
          part.value;
    }
  }

  return `${values.year}-${values.month}-${values.day}`;
}


// ============================================================================
// RESERVA A EXECUÇÃO DIÁRIA DA LOJA
// ============================================================================
//
// Estrutura:
//
// storeBackups/{storeId}/dailyRuns/{dateKey}
//
// Exemplo:
//
// storeBackups
// └── LOJA123
//     └── dailyRuns
//         └── 2026-09-04
//
// A transaction garante que duas execuções simultâneas não consigam
// reservar o mesmo backup diário ao mesmo tempo.
//
// ============================================================================

 async function claimDailyBackupRun({
   db,
   storeId,
   dateKey,
 }) {
   const storeBackupRef = db
       .collection("storeBackups")
       .doc(storeId);

   const runRef = storeBackupRef
       .collection("dailyRuns")
       .doc(dateKey);

   // --------------------------------------------------------------------------
   // GERA UM ID CANDIDATO
   // --------------------------------------------------------------------------
   //
   // Ele só será usado caso esta seja a primeira tentativa do dia.
   //
   // Se o dailyRun já possuir um backupId reservado por uma tentativa
   // anterior, esse mesmo ID será reutilizado.
   //
   // --------------------------------------------------------------------------

   const candidateBackupId = storeBackupRef
       .collection("snapshots")
       .doc()
       .id;

   const now =
       admin.firestore.Timestamp.now();

   const leaseExpiresAt =
       admin.firestore.Timestamp.fromMillis(
           now.toMillis() +
           (15 * 60 * 1000),
       );

   const result =
       await db.runTransaction(
           async (transaction) => {
             const snapshot =
                 await transaction.get(runRef);

             let attemptCount = 0;

             let reservedBackupId =
                 candidateBackupId;

             if (snapshot.exists) {
               const data =
                   snapshot.data() || {};

               attemptCount =
                   typeof data.attemptCount === "number"
                     ? data.attemptCount
                     : 0;

               // --------------------------------------------------------------
               // REUTILIZA O MESMO BACKUP ID DE TENTATIVA ANTERIOR
               // --------------------------------------------------------------

               if (
                 typeof data.backupId === "string" &&
                 data.backupId.trim()
               ) {
                 reservedBackupId =
                     data.backupId.trim();
               }


               // --------------------------------------------------------------
               // BACKUP DO DIA JÁ FOI CONCLUÍDO
               // --------------------------------------------------------------

               if (data.status === "completed") {
                 return {
                   claimed: false,
                   backupId:
                     reservedBackupId,
                   status:
                     "completed",
                 };
               }


               // --------------------------------------------------------------
               // OUTRA EXECUÇÃO AINDA ESTÁ TRABALHANDO
               // --------------------------------------------------------------

               if (data.status === "running") {
                 const currentLease =
                     data.leaseExpiresAt;

                 if (
                   currentLease instanceof
                     admin.firestore.Timestamp &&
                   currentLease.toMillis() >
                     now.toMillis()
                 ) {
                   return {
                     claimed: false,
                     backupId:
                       reservedBackupId,
                     status:
                       "running",
                   };
                 }
               }
             }


             // --------------------------------------------------------------
             // RESERVA / RECUPERA A EXECUÇÃO
             // --------------------------------------------------------------

             transaction.set(
                 runRef,
                 {
                   storeId,
                   dateKey,

                   backupId:
                     reservedBackupId,

                   status:
                     "running",

                   attemptCount:
                     attemptCount + 1,

                   startedAt:
                     now,

                   lastAttemptAt:
                     now,

                   leaseExpiresAt,

                   completedAt:
                     null,

                   failedAt:
                     null,

                   error:
                     null,

                   updatedAt:
                     now,
                 },
                 {
                   merge: true,
                 },
             );

             return {
               claimed: true,

               backupId:
                 reservedBackupId,

               status:
                 "running",
             };
           },
       );

   return {
     ...result,
     runRef,
   };
 }


// ============================================================================
// VERIFICA SE O BACKUP RESERVADO JÁ FOI CRIADO
// ============================================================================
//
// Pode acontecer de:
//
// 1. o Core concluir o backup;
// 2. metadata + auditLog serem gravados;
// 3. a atualização do dailyRun falhar.
//
// Em um retry, reutilizamos o mesmo backupId.
//
// Se a metadata desse backup já estiver "ready", NÃO criamos outro.
// Apenas recuperamos o resultado existente e finalizamos o dailyRun.
//
// ============================================================================

async function getExistingReservedBackup({
  db,
  storeId,
  backupId,
}) {
  const backupRef = db
      .collection("storeBackups")
      .doc(storeId)
      .collection("snapshots")
      .doc(backupId);

  const snapshot =
      await backupRef.get();

  if (!snapshot.exists) {
    return null;
  }

  const data =
      snapshot.data() || {};

  if (
    data.status !== "ready" ||
    data.type !== "automatic"
  ) {
    return null;
  }

  return {
    backupId,
    checksumSha256:
      data.checksumSha256 || null,
  };
}

// ============================================================================
// MARCA EXECUÇÃO COMO CONCLUÍDA
// ============================================================================

async function markDailyBackupCompleted({
  runRef,
  result,
}) {
  const now =
      admin.firestore.Timestamp.now();

  await runRef.set(
      {
        status:
          "completed",

        backupId:
          result.backupId,

        checksumSha256:
          result.checksumSha256,

        completedAt:
          now,

        leaseExpiresAt:
          null,

        error:
          null,

        updatedAt:
          now,
      },
      {
        merge: true,
      },
  );
}


// ============================================================================
// MARCA EXECUÇÃO COMO FALHA
// ============================================================================

 async function markDailyBackupFailed({
   db,
   runRef,
   error,
 }) {
   const now =
       admin.firestore.Timestamp.now();

   const errorMessage =
       String(
           error?.message ||
           error ||
           "Erro desconhecido",
       ).slice(0, 1000);

   await db.runTransaction(
       async (transaction) => {
         const snapshot =
             await transaction.get(runRef);

         if (!snapshot.exists) {
           return;
         }

         const data =
             snapshot.data() || {};


         // --------------------------------------------------------------------
         // NUNCA REBAIXA UM BACKUP JÁ CONCLUÍDO
         // --------------------------------------------------------------------

         if (data.status === "completed") {
           console.warn(
               "⚠️ dailyRun já estava concluído; status failed ignorado.",
               {
                 storeId:
                   data.storeId || null,

                 dateKey:
                   data.dateKey || null,

                 backupId:
                   data.backupId || null,
               },
           );

           return;
         }


         // --------------------------------------------------------------------
         // REGISTRA A FALHA
         // --------------------------------------------------------------------

         transaction.set(
             runRef,
             {
               status:
                 "failed",

               failedAt:
                 now,

               leaseExpiresAt:
                 null,

               error:
                 errorMessage,

               updatedAt:
                 now,
             },
             {
               merge: true,
             },
         );
       },
   );
 }


// ============================================================================
// BACKUP AUTOMÁTICO DIÁRIO
// ============================================================================

const scheduledStoreBackups = onSchedule(
    {
      schedule:
        "0 3 * * *",

      timeZone:
        "America/Sao_Paulo",

      timeoutSeconds:
        540,

      memory:
        "512MiB",

      // ----------------------------------------------------------------------
      // RETRY SE ALGUMA LOJA FALHAR
      // ----------------------------------------------------------------------

      retryCount:
        5,

      minBackoffSeconds:
        60,

      maxBackoffSeconds:
        300,

      maxRetrySeconds:
        1800,
    },

    async () => {
      const db =
          admin.firestore();

      const dateKey =
          getSaoPauloDateKey();

      console.log(
          "💾 Iniciando backup automático diário...",
          {
            dateKey,
          },
      );


      // ----------------------------------------------------------------------
      // 1. BUSCA TODAS AS LOJAS
      // ----------------------------------------------------------------------

      const storesSnapshot =
          await db
              .collection("stores")
              .get();

      console.log(
          `🏪 Lojas encontradas: ${storesSnapshot.size}`,
      );


      // ----------------------------------------------------------------------
      // 2. CONTADORES
      // ----------------------------------------------------------------------

      let successCount = 0;
      let failureCount = 0;
      let skippedCount = 0;


      // ----------------------------------------------------------------------
      // 3. PROCESSA CADA LOJA
      // ----------------------------------------------------------------------

      for (const storeDoc of storesSnapshot.docs) {
        const storeId =
            storeDoc.id;

        const storeRef =
            storeDoc.ref;

        let runRef;
        let ownsClaim = false;

        try {
          // ------------------------------------------------------------------
          // TENTA RESERVAR O BACKUP DESTA LOJA NESTE DIA
          // ------------------------------------------------------------------

          const claim =
              await claimDailyBackupRun({
                db,
                storeId,
                dateKey,
              });

          runRef =
              claim.runRef;

          ownsClaim =
              claim.claimed;


          // ------------------------------------------------------------------
          // JÁ FOI CONCLUÍDO OU OUTRA EXECUÇÃO ESTÁ TRABALHANDO
          // ------------------------------------------------------------------

         if (!claim.claimed) {


           // ------------------------------------------------------------------
           // BACKUP DO DIA JÁ FOI CONCLUÍDO
           // ------------------------------------------------------------------

           if (claim.status === "completed") {
             skippedCount++;

             console.log(
                 "⏭️ Backup automático já concluído anteriormente.",
                 {
                   storeId,
                   dateKey,
                   backupId:
                     claim.backupId,
                 },
             );

             continue;
           }


           // ------------------------------------------------------------------
           // OUTRA EXECUÇÃO AINDA ESTÁ COM O LEASE
           // ------------------------------------------------------------------

           if (claim.status === "running") {
             // --------------------------------------------------------------
             // Mesmo com o lease ativo, pode acontecer de a tentativa
             // anterior já ter terminado o snapshot e ter falhado somente
             // antes de finalizar o dailyRun.
             // --------------------------------------------------------------

             const existingBackup =
                 await getExistingReservedBackup({
                   db,
                   storeId,

                   backupId:
                     claim.backupId,
                 });

             if (existingBackup) {
               await markDailyBackupCompleted({
                 runRef,

                 result:
                   existingBackup,
               });

               successCount++;

               console.log(
                   "✅ Backup automático já existia; dailyRun recuperado.",
                   {
                     storeId,
                     dateKey,

                     backupId:
                       claim.backupId,
                   },
               );

               continue;
             }


             // --------------------------------------------------------------
             // O lease continua ativo e o snapshot ainda não existe.
             //
             // Não criamos outro backup.
             // Marcamos a execução atual como não concluída para que,
             // ao final, o Scheduler faça uma nova tentativa.
             // --------------------------------------------------------------

             failureCount++;

             console.warn(
                 "⏳ Backup automático ainda está em execução.",
                 {
                   storeId,
                   dateKey,

                   backupId:
                     claim.backupId,

                   action:
                     "Aguardar retry do Scheduler.",
                 },
             );

             continue;
           }


           // ------------------------------------------------------------------
           // ESTADO INESPERADO
           // ------------------------------------------------------------------

           failureCount++;

           console.error(
               "❌ Estado inesperado na reserva do backup automático.",
               {
                 storeId,
                 dateKey,
                 status:
                   claim.status,
               },
           );

           continue;
         }


          // ------------------------------------------------------------------
          // CRIA O BACKUP
          // ------------------------------------------------------------------

          console.log(
              "💾 Criando backup automático...",
              {
                storeId,
                dateKey,
              },
          );

          // ------------------------------------------------------------------
          // VERIFICA SE UMA TENTATIVA ANTERIOR JÁ CRIOU ESTE BACKUP
          // ------------------------------------------------------------------

          const existingBackup =
              await getExistingReservedBackup({
                db,
                storeId,
                backupId:
                  claim.backupId,
              });

          if (existingBackup) {
            await markDailyBackupCompleted({
              runRef,
              result:
                existingBackup,
            });

            successCount++;

            console.log(
                "✅ Backup automático já existia; dailyRun recuperado.",
                {
                  storeId,
                  dateKey,
                  backupId:
                    claim.backupId,
                },
            );

            continue;
          }

          const result =
              await createStoreSnapshotCore({
                db,

                storeRef,

                storeSnapshot:
                  storeDoc,

                storeId,

                createdBy:
                  "system",

                createdByRole:
                  "system",

                backupType:
                  "automatic",

                reason:
                  "Backup automático diário",

                   reservedBackupId:
                          claim.backupId,
              });


          // ------------------------------------------------------------------
          // MARCA O DIA COMO CONCLUÍDO
          // ------------------------------------------------------------------

          await markDailyBackupCompleted({
            runRef,
            result,
          });

          successCount++;

          console.log(
              "✅ Backup automático concluído.",
              {
                storeId,

                dateKey,

                backupId:
                  result.backupId,

                counts:
                  result.counts,
              },
          );
        } catch (error) {
          failureCount++;

          console.error(
              `❌ Falha no backup automático da loja ${storeId}:`,
              error,
          );


          // ------------------------------------------------------------------
          // LIBERA PARA UMA FUTURA TENTATIVA
          // ------------------------------------------------------------------

          if (runRef && ownsClaim) {
            try {
              await markDailyBackupFailed({
                   db,
                   runRef,
                   error,
                 });
            } catch (markError) {
              console.error(
                  `❌ Não foi possível registrar a falha da loja ${storeId}:`,
                  markError,
              );
            }
          }
        }
      }


      // ----------------------------------------------------------------------
      // 4. RESUMO DA EXECUÇÃO
      // ----------------------------------------------------------------------

      console.log(
          "💾 Execução do backup automático finalizada.",
          {
            dateKey,

            totalStores:
              storesSnapshot.size,

            successCount,

            failureCount,

            skippedCount,
          },
      );


      // ----------------------------------------------------------------------
      // 5. INFORMA AO SCHEDULER QUE HOUVE FALHA
      // ----------------------------------------------------------------------
      //
      // Isso permite que o retry configurado acima seja utilizado.
      //
      // Em uma nova tentativa:
      //
      // - lojas "completed" serão ignoradas;
      // - lojas que falharam poderão tentar novamente.
      //
      // ----------------------------------------------------------------------

      if (failureCount > 0) {
        throw new Error(
            `Falha no backup automático de ${failureCount} loja(s).`,
        );
      }
    },
);


// ============================================================================
// EXPORT
// ============================================================================

module.exports = {
  scheduledStoreBackups,
};