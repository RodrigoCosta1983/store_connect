// ============================================================================
// STORE CONNECT - EXPIRAÇÃO SERVER-SIDE DE TRIALS
// ============================================================================
//
// Arquivo:
//   functions/financeiro/expireTrials.js
//
// OBJETIVO:
//
// Remover do Flutter a autoridade de persistir mudanças em subscriptionStatus.
// Esta função agendada identifica trials vencidos usando o relógio do servidor e
// muda o estado da loja para `inactive` de forma transacional e auditável.
//
// EXECUÇÃO:
//
// Cloud Scheduler
//      ↓
// expireTrials (a cada hora)
//      ↓
// lê lojas com status trial/active
//      ↓
// ignora planos pagos ativos
//      ↓
// valida trialEndDate com horário do servidor
//      ↓
// trial vencido
//      ↓
// stores/{storeId}.subscriptionStatus = inactive
//      +
// stores/{storeId}/auditLogs/{logId}
//
// COMPATIBILIDADE:
//
// trialEndDate pode ser:
//   - String ISO-8601 (formato legado/currente do aplicativo);
//   - Firestore Timestamp;
//   - Date;
//   - número em milissegundos, caso exista dado legado.
//
// REGRAS:
//
// 1. status == trial
//      → expira quando trialEndDate <= horário do servidor.
//
// 2. status == active + subscriptionType NÃO pago
//      → tratado como trial legado e expira da mesma forma.
//
// 3. status == active + pro/business
//      → nunca é inativado por esta rotina.
//
// 4. pending / overdue / inactive
//      → não são tratados aqui.
//
// 5. trialEndDate ausente ou inválido
//      → não alteramos automaticamente o banco; registramos warning no log.
//
// IDEMPOTÊNCIA:
//
// Cada loja é revalidada dentro de uma transação. Se outra execução já tiver
// alterado o status, a transação não repete a atualização nem a auditoria.
//
// AUDITORIA:
//
// Toda expiração realmente aplicada gera:
//   action: trial_expired
//   entityType: store
//   performedBy.role: system
//
// SEGURANÇA:
//
// A função usa Admin SDK e não depende de permissões do cliente. A proibição
// definitiva de writes do Flutter em subscriptionStatus será aplicada nas
// Firestore Rules durante o P7.
//
// CUIDADOS DE MANUTENÇÃO:
//
// • Não cancelar assinatura Asaas nesta rotina; ela trata apenas trials.
// • Não alterar lojas pro/business ativas.
// • Não inferir expiração quando trialEndDate estiver ausente/corrompido.
// • Manter update + auditLog na mesma transação.
//
// ============================================================================

"use strict";

const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

const SCHEDULE = "0 * * * *";
const TIME_ZONE = "America/Sao_Paulo";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStatus(value) {
  return normalizeString(value).toLowerCase();
}

function isPaidPlanType(value) {
  const type = normalizeStatus(value);
  return type === "pro" || type === "business";
}

function timestampMillisOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (value && typeof value.toMillis === "function") {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }

  if (value && typeof value.toDate === "function") {
    const millis = value.toDate().getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const text = value.trim();

    if (!text) {
      return null;
    }

    const parsed = new Date(text).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function evaluateTrialExpiration(data, nowMillis) {
  const status = normalizeStatus(data.subscriptionStatus || "trial");
  const type = normalizeStatus(data.subscriptionType || "free");

  const isTrialStatus = status === "trial";
  const isLegacyActiveTrial = status === "active" && !isPaidPlanType(type);

  if (!isTrialStatus && !isLegacyActiveTrial) {
    return {
      shouldExpire: false,
      reason: "status_not_eligible",
      status,
      type,
      trialEndMillis: null,
    };
  }

  const trialEndMillis = timestampMillisOrNull(data.trialEndDate);

  if (trialEndMillis === null) {
    return {
      shouldExpire: false,
      reason: "invalid_trial_end_date",
      status,
      type,
      trialEndMillis: null,
    };
  }

  return {
    shouldExpire: trialEndMillis <= nowMillis,
    reason: trialEndMillis <= nowMillis ? "expired" : "trial_still_valid",
    status,
    type,
    trialEndMillis,
  };
}

async function expireStoreIfNeeded({
  db,
  storeRef,
  nowMillis,
}) {
  return db.runTransaction(async (transaction) => {
    const freshSnapshot = await transaction.get(storeRef);

    if (!freshSnapshot.exists) {
      return {
        expired: false,
        reason: "store_not_found",
      };
    }

    const data = freshSnapshot.data() || {};
    const evaluation = evaluateTrialExpiration(data, nowMillis);

    if (!evaluation.shouldExpire) {
      return {
        expired: false,
        reason: evaluation.reason,
      };
    }

    const auditRef = storeRef
        .collection("auditLogs")
        .doc();

    const serverTimestamp =
      admin.firestore.FieldValue.serverTimestamp();

    transaction.update(storeRef, {
      subscriptionStatus: "inactive",
      trialExpiredAt: serverTimestamp,
      subscriptionStatusUpdatedAt: serverTimestamp,
      subscriptionStatusUpdatedBy: "system:expireTrials",
    });

    transaction.set(auditRef, {
      action: "trial_expired",
      entityType: "store",
      entityId: storeRef.id,
      storeId: storeRef.id,
      performedBy: {
        uid: "system",
        role: "system",
      },
      reason: "trial_end_date_reached",
      before: {
        subscriptionStatus: evaluation.status,
        subscriptionType: evaluation.type,
        trialEndDate: data.trialEndDate || null,
      },
      after: {
        subscriptionStatus: "inactive",
        subscriptionType: evaluation.type,
        trialEndDate: data.trialEndDate || null,
      },
      createdAt: serverTimestamp,
    });

    return {
      expired: true,
      reason: "expired",
    };
  });
}

const expireTrials = onSchedule(
    {
      schedule: SCHEDULE,
      timeZone: TIME_ZONE,
      timeoutSeconds: 540,
      memory: "256MiB",
    },
    async () => {
      const db = admin.firestore();
      const nowMillis = Date.now();

      console.log("[expireTrials] Iniciando varredura de trials.", {
        now: new Date(nowMillis).toISOString(),
      });

      // Buscamos trial + active por compatibilidade com lojas legadas em que o
      // período gratuito podia estar marcado como active/free.
      const candidateSnapshot = await db
          .collection("stores")
          .where("subscriptionStatus", "in", ["trial", "active"])
          .get();

      if (candidateSnapshot.empty) {
        console.log("[expireTrials] Nenhuma loja candidata encontrada.");
        return;
      }

      let expiredCount = 0;
      let validCount = 0;
      let invalidDateCount = 0;
      let ignoredCount = 0;
      let errorCount = 0;

      for (const storeDocument of candidateSnapshot.docs) {
        const previewData = storeDocument.data() || {};
        const preview = evaluateTrialExpiration(previewData, nowMillis);

        // Evita abrir transação para planos pagos ativos e trials ainda válidos.
        if (!preview.shouldExpire) {
          if (preview.reason === "trial_still_valid") {
            validCount += 1;
            continue;
          }

          if (preview.reason === "invalid_trial_end_date") {
            invalidDateCount += 1;

            console.warn(
                "[expireTrials] Loja candidata com trialEndDate inválido.",
                {
                  storeId: storeDocument.id,
                  subscriptionStatus: preview.status,
                  subscriptionType: preview.type,
                },
            );

            continue;
          }

          ignoredCount += 1;
          continue;
        }

        try {
          const result = await expireStoreIfNeeded({
            db,
            storeRef: storeDocument.ref,
            nowMillis,
          });

          if (result.expired) {
            expiredCount += 1;

            console.log("[expireTrials] Trial expirado.", {
              storeId: storeDocument.id,
            });
          } else {
            ignoredCount += 1;
          }
        } catch (error) {
          errorCount += 1;

          console.error("[expireTrials] Erro ao processar loja.", {
            storeId: storeDocument.id,
            error: error?.message || error,
          });
        }
      }

      console.log("[expireTrials] Varredura concluída.", {
        candidates: candidateSnapshot.size,
        expired: expiredCount,
        stillValid: validCount,
        invalidTrialEndDate: invalidDateCount,
        ignored: ignoredCount,
        errors: errorCount,
      });
    },
);

module.exports = {
  expireTrials,
};
