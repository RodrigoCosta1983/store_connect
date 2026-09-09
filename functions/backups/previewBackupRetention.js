"use strict";


// ============================================================================
// STORE&CONNECT — PREVIEW DA POLÍTICA DE RETENÇÃO DE BACKUPS
// ============================================================================
//
// Arquivo:
//   functions/backups/previewBackupRetention.js
//
// Etapa:
//   F5.6-B3 — Leitura segura dos snapshots reais
//
// Objetivo:
//
// Esta Cloud Function permite que o administrador visualize,
// em modo de simulação, como a política de retenção seria aplicada
// aos backups reais da sua loja.
//
// Ela reutiliza o motor puro:
//
//   backupRetention.js
//
// responsável por calcular:
//
//   - 7 backups diários;
//   - 4 backups semanais;
//   - 6 backups mensais;
//   - candidatos à exclusão.
//
// ============================================================================
//
// SEGURANÇA
//
// A função:
//
// ✅ exige Firebase Auth;
// ✅ busca o usuário diretamente no Firestore;
// ✅ bloqueia usuários com accessStatus == "revoked";
// ✅ exige role == "admin";
// ✅ confirma que o usuário pertence à loja solicitada;
// ✅ lê somente os snapshots da loja autorizada.
//
// O storeId enviado pelo cliente é apenas o identificador solicitado.
// A autorização real é validada novamente no backend.
//
// ============================================================================
//
// MODO DRY RUN
//
// Esta etapa é SOMENTE DE LEITURA.
//
// A função:
//
// ✅ lê metadata real do Firestore;
// ✅ executa a política de retenção;
// ✅ retorna quais backups seriam mantidos;
// ✅ retorna quais seriam candidatos à exclusão;
// ✅ registra um resumo nos logs.
//
// Ela NÃO:
//
// ❌ exclui documentos do Firestore;
// ❌ exclui arquivos do Firebase Storage;
// ❌ altera snapshots;
// ❌ altera dailyRuns;
// ❌ altera auditLogs;
// ❌ modifica qualquer dado da loja.
//
// ============================================================================
//
// FLUXO
//
// Firebase Auth
//      ↓
// valida usuário
//      ↓
// valida admin + loja
//      ↓
// lê:
//
// storeBackups/{storeId}/snapshots
//
//      ↓
//
// backupRetention.js
//
//      ↓
//
// KEEP
// ├── 7 DAILY
// ├── 4 WEEKLY
// └── 6 MONTHLY
//
// DELETE CANDIDATES
//
//      ↓
//
// retorna apenas PREVIEW
//
// ============================================================================
//
// TIMEZONE OFICIAL:
//
//   America/Sao_Paulo
//
// A definição de dia, semana e mês é centralizada no motor
// backupRetention.js.
//
// ============================================================================
//
// IMPORTANTE:
//
// A existência do campo:
//
//   deleteCandidates
//
// NÃO significa que o backup será apagado.
//
// Nesta etapa ele representa somente:
//
//   "este backup seria elegível para exclusão segundo a política atual"
//
// A exclusão real somente será implementada após:
//
//   - validação do dry run;
//   - testes com dados reais;
//   - validações adicionais de segurança;
//   - confirmação da política de retenção.
//
// ============================================================================


const admin =
    require("firebase-admin");

const {
  onCall,
  HttpsError,
} = require(
    "firebase-functions/v2/https",
);

const {
  calculateBackupRetention,
  getIsoWeekKey,
  getMonthKey,
} = require("./backupRetention");



// ============================================================================
// NORMALIZA STRING
// ============================================================================

function normalizeString(value) {
  return String(
      value || "",
  ).trim();
}


// ============================================================================
// FORMATA BACKUP PARA O PREVIEW
// ============================================================================
//
// Não devolvemos o documento Firestore inteiro.
//
// Retornamos somente informações necessárias para conferência.
//
// ============================================================================

function serializeBackupForPreview(
    backup,
) {
  const date =
      backup.createdAtDate;

  return {
    backupId:
      backup.backupId,

    createdAt:
      date
        ? date.toISOString()
        : null,

    type:
      backup.type || null,

    status:
      backup.status || null,

    storagePath:
      backup.storagePath || null,

    weekKey:
      date
        ? getIsoWeekKey(date)
        : null,

    monthKey:
      date
        ? getMonthKey(date)
        : null,
  };
}


// ============================================================================
// PREVIEW DA RETENÇÃO
// ============================================================================

const previewBackupRetention =
    onCall(
        {
          timeoutSeconds:
            120,

          memory:
            "256MiB",
        },

        async (request) => {
          // ------------------------------------------------------------------
          // 1. AUTENTICAÇÃO
          // ------------------------------------------------------------------

          if (!request.auth) {
            throw new HttpsError(
                "unauthenticated",
                "É necessário estar autenticado.",
            );
          }

          const uid =
              request.auth.uid;


          // ------------------------------------------------------------------
          // 2. STORE ID
          // ------------------------------------------------------------------

          const storeId =
              normalizeString(
                  request.data?.storeId,
              );

          if (!storeId) {
            throw new HttpsError(
                "invalid-argument",
                "storeId é obrigatório.",
            );
          }


          // ------------------------------------------------------------------
          // 3. REFERÊNCIAS
          // ------------------------------------------------------------------

          const db =
              admin.firestore();

          const userRef =
              db
                  .collection("users")
                  .doc(uid);

          const storeRef =
              db
                  .collection("stores")
                  .doc(storeId);


          // ------------------------------------------------------------------
          // 4. SEGURANÇA
          // ------------------------------------------------------------------

          const [
            userSnapshot,
            storeSnapshot,
          ] = await Promise.all([
            userRef.get(),
            storeRef.get(),
          ]);

          if (!userSnapshot.exists) {
            throw new HttpsError(
                "permission-denied",
                "Perfil do usuário não encontrado.",
            );
          }

          if (!storeSnapshot.exists) {
            throw new HttpsError(
                "not-found",
                "Loja não encontrada.",
            );
          }

          const userData =
              userSnapshot.data() || {};

          const userRole =
              normalizeString(
                  userData.role,
              ).toLowerCase();

          const userStoreId =
              normalizeString(
                  userData.storeId,
              );

          const accessStatus =
              normalizeString(
                  userData.accessStatus ||
                  "active",
              ).toLowerCase();


          // ------------------------------------------------------------------
          // USUÁRIO REVOGADO NÃO PODE CONSULTAR BACKUPS
          // ------------------------------------------------------------------

          if (
            accessStatus === "revoked"
          ) {
            throw new HttpsError(
                "permission-denied",
                "Seu acesso a esta loja foi revogado.",
            );
          }


          // ------------------------------------------------------------------
          // SOMENTE ADMIN
          // ------------------------------------------------------------------

          if (
            userRole !== "admin"
          ) {
            throw new HttpsError(
                "permission-denied",
                "Somente um administrador pode consultar a retenção de backups.",
            );
          }


          // ------------------------------------------------------------------
          // CONFIRMA VÍNCULO COM A LOJA
          // ------------------------------------------------------------------

          if (
            !userStoreId ||
            userStoreId !== storeId
          ) {
            throw new HttpsError(
                "permission-denied",
                "O usuário não pertence a esta loja.",
            );
          }


          // ------------------------------------------------------------------
          // 5. LÊ METADATA REAL DOS SNAPSHOTS
          // ------------------------------------------------------------------

          const snapshotsRef =
              db
                  .collection(
                      "storeBackups",
                  )
                  .doc(storeId)
                  .collection(
                      "snapshots",
                  );

          const snapshots =
              await snapshotsRef.get();


          // ------------------------------------------------------------------
          // CONVERTE DOCUMENTOS PARA O MOTOR
          // ------------------------------------------------------------------

          const backups =
              snapshots.docs.map(
                  (doc) => ({
                    ...(
                      doc.data() ||
                      {}
                    ),

                    // O ID canônico do backup é sempre o ID
                    // real do documento no Firestore.
                    backupId:
                      doc.id,
                  }),
              );


          // ------------------------------------------------------------------
          // 6. EXECUTA MOTOR DE RETENÇÃO
          // ------------------------------------------------------------------

          const result =
              calculateBackupRetention(
                  backups,
              );


          // ------------------------------------------------------------------
          // 7. PREPARA RESPOSTA SEGURA
          // ------------------------------------------------------------------

          const keepDaily =
              result.keep.daily.map(
                  serializeBackupForPreview,
              );

          const keepWeekly =
              result.keep.weekly.map(
                  serializeBackupForPreview,
              );

          const keepMonthly =
              result.keep.monthly.map(
                  serializeBackupForPreview,
              );

          const deleteCandidates =
              result.deleteCandidates.map(
                  serializeBackupForPreview,
              );


          // ------------------------------------------------------------------
          // 8. LOG DO DRY RUN
          // ------------------------------------------------------------------

          console.log(
              "🧪 Preview da retenção de backups.",
              {
                storeId,

                dryRun:
                  true,

                totalSnapshots:
                  snapshots.size,

                eligible:
                  result.counts.eligible,

                keepDaily:
                  result.counts.keepDaily,

                keepWeekly:
                  result.counts.keepWeekly,

                keepMonthly:
                  result.counts.keepMonthly,

                keepTotal:
                  result.counts.keepTotal,

                deleteCandidates:
                  result.counts
                      .deleteCandidates,
              },
          );


          // ------------------------------------------------------------------
          // 9. RETORNO
          // ------------------------------------------------------------------

          return {
            success:
              true,

            dryRun:
              true,

            storeId,

            totalSnapshots:
              snapshots.size,

            policy:
              result.policy,

            counts:
              result.counts,

            keep: {
              daily:
                keepDaily,

              weekly:
                keepWeekly,

              monthly:
                keepMonthly,
            },

            deleteCandidates,
          };
        },
    );


// ============================================================================
// EXPORT
// ============================================================================

module.exports = {
  previewBackupRetention,
};