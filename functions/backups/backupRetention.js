"use strict";


// ============================================================================
// STORE&CONNECT — POLÍTICA DE RETENÇÃO DE BACKUPS
// ============================================================================
//
// F5.6 — RETENÇÃO AUTOMÁTICA
//
// Este arquivo NÃO exclui nenhum backup.
//
// Responsabilidade:
// - receber metadata de snapshots;
// - calcular quais backups devem ser mantidos;
// - calcular quais seriam candidatos à exclusão;
// - respeitar a política:
//
//   7 diários
//   4 semanais
//   6 mensais
//
// Timezone oficial:
//   America/Sao_Paulo
//
// ============================================================================


const TIME_ZONE =
    "America/Sao_Paulo";

const DAILY_KEEP_COUNT =
    7;

const WEEKLY_KEEP_COUNT =
    4;

const MONTHLY_KEEP_COUNT =
    6;


// ============================================================================
// NORMALIZA DATA
// ============================================================================

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  // Firestore Timestamp
  if (
    typeof value.toDate === "function"
  ) {
    const date =
        value.toDate();

    return Number.isNaN(
        date.getTime(),
    )
      ? null
      : date;
  }

  // Date nativo
  if (value instanceof Date) {
    return Number.isNaN(
        value.getTime(),
    )
      ? null
      : value;
  }

  // String / número
  const date =
      new Date(value);

  return Number.isNaN(
      date.getTime(),
  )
    ? null
    : date;
}


// ============================================================================
// PARTES DA DATA NO TIMEZONE DE SÃO PAULO
// ============================================================================

function getSaoPauloDateParts(date) {
  const parts =
      new Intl.DateTimeFormat(
          "en-US",
          {
            timeZone:
              TIME_ZONE,

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
          Number(part.value);
    }
  }

  return {
    year:
      values.year,

    month:
      values.month,

    day:
      values.day,
  };
}


// ============================================================================
// CHAVE DO MÊS
// ============================================================================
//
// Exemplo:
//   2026-09
//
// ============================================================================

function getMonthKey(date) {
  const {
    year,
    month,
  } = getSaoPauloDateParts(date);

  return (
    `${year}-` +
    String(month).padStart(2, "0")
  );
}


// ============================================================================
// CHAVE ISO DA SEMANA
// ============================================================================
//
// Semana começa na segunda-feira.
//
// Exemplo:
//   2026-W36
//
// Primeiro convertemos a DATA LOCAL de São Paulo para uma data UTC
// apenas para calcular corretamente o número ISO da semana.
//
// ============================================================================

function getIsoWeekKey(date) {
  const {
    year,
    month,
    day,
  } = getSaoPauloDateParts(date);

  const utcDate =
      new Date(
          Date.UTC(
              year,
              month - 1,
              day,
          ),
      );

  const dayNumber =
      utcDate.getUTCDay() || 7;

  utcDate.setUTCDate(
      utcDate.getUTCDate() +
      4 -
      dayNumber,
  );

  const isoYear =
      utcDate.getUTCFullYear();

  const yearStart =
      new Date(
          Date.UTC(
              isoYear,
              0,
              1,
          ),
      );

  const weekNumber =
      Math.ceil(
          (
            (
              utcDate -
              yearStart
            ) /
            86400000 +
            1
          ) /
          7,
      );

  return (
    `${isoYear}-W` +
    String(
        weekNumber,
    ).padStart(2, "0")
  );
}


// ============================================================================
// NORMALIZA UM BACKUP PARA O MOTOR DE RETENÇÃO
// ============================================================================

function normalizeBackup(backup) {
  const createdAt =
      normalizeDate(
          backup.createdAt,
      );

  return {
    ...backup,

    createdAtDate:
      createdAt,
  };
}


// ============================================================================
// MOTOR DE RETENÇÃO
// ============================================================================
//
// IMPORTANTE:
//
// Esta função apenas CALCULA.
//
// Não existe:
// - delete() no Firestore;
// - delete() no Storage.
//
// ============================================================================

function calculateBackupRetention(
    backups,
) {
  if (!Array.isArray(backups)) {
    throw new Error(
        "backups precisa ser um array.",
    );
  }


  // --------------------------------------------------------------------------
  // 1. CONSIDERA SOMENTE BACKUPS AUTOMÁTICOS PRONTOS
  // --------------------------------------------------------------------------

  const eligible = backups
      .filter(
          (backup) =>
            backup &&
            backup.type === "automatic" &&
            backup.status === "ready" &&
            backup.protected !== true,
      )
      .map(
          normalizeBackup,
      )
      .filter(
          (backup) =>
            backup.createdAtDate,
      );


  // --------------------------------------------------------------------------
  // 2. MAIS NOVO → MAIS ANTIGO
  // --------------------------------------------------------------------------

  eligible.sort(
      (a, b) =>
        b.createdAtDate.getTime() -
        a.createdAtDate.getTime(),
  );


  const keepDaily = [];
  const keepWeekly = [];
  const keepMonthly = [];


  // --------------------------------------------------------------------------
  // 3. 7 BACKUPS DIÁRIOS MAIS RECENTES
  // --------------------------------------------------------------------------

  const dailyBackups =
      eligible.slice(
          0,
          DAILY_KEEP_COUNT,
      );

  keepDaily.push(
      ...dailyBackups,
  );


  // --------------------------------------------------------------------------
  // RESTANTE APÓS A FAIXA DIÁRIA
  // --------------------------------------------------------------------------

  let remaining =
      eligible.slice(
          DAILY_KEEP_COUNT,
      );


  // --------------------------------------------------------------------------
  // 4. 4 BACKUPS SEMANAIS
  // --------------------------------------------------------------------------
  //
  // Como remaining já está ordenado do mais recente para o mais antigo,
  // o primeiro backup encontrado em cada semana é automaticamente
  // o mais recente daquela semana.
  //
  // --------------------------------------------------------------------------

  const usedWeeks =
      new Set();

  const weeklySelectedIds =
      new Set();

  for (const backup of remaining) {
    if (
      keepWeekly.length >=
      WEEKLY_KEEP_COUNT
    ) {
      break;
    }

    const weekKey =
        getIsoWeekKey(
            backup.createdAtDate,
        );

    if (
      usedWeeks.has(
          weekKey,
      )
    ) {
      continue;
    }

    usedWeeks.add(
        weekKey,
    );

    keepWeekly.push(
        backup,
    );

    weeklySelectedIds.add(
        backup.backupId,
    );
  }


  // --------------------------------------------------------------------------
  // REMOVE TODAS AS SEMANAS JÁ COBERTAS PELA FAIXA SEMANAL
  // --------------------------------------------------------------------------
  //
  // Não basta remover apenas os 4 backups escolhidos.
  //
  // Se uma semana já possui um representante semanal,
  // nenhum outro backup daquela mesma semana pode posteriormente
  // ser escolhido como mensal.
  //
  // Exemplo:
  //
  // 06/09 → semanal da W36
  // 05/09 → também pertence à W36
  //
  // Portanto 05/09 também deve sair da fila antes da seleção mensal.
  //
  // --------------------------------------------------------------------------

  remaining =
      remaining.filter(
          (backup) => {
            const weekKey =
                getIsoWeekKey(
                    backup.createdAtDate,
                );

            return !usedWeeks.has(
                weekKey,
            );
          },
      );


  // --------------------------------------------------------------------------
  // 5. 6 BACKUPS MENSAIS
  // --------------------------------------------------------------------------
  //
  // Novamente:
  // o primeiro backup encontrado dentro de cada mês é o mais recente
  // disponível naquele mês.
  //
  // --------------------------------------------------------------------------

  const usedMonths =
      new Set();

  const monthlySelectedIds =
      new Set();

  for (const backup of remaining) {
    if (
      keepMonthly.length >=
      MONTHLY_KEEP_COUNT
    ) {
      break;
    }

    const monthKey =
        getMonthKey(
            backup.createdAtDate,
        );

    if (
      usedMonths.has(
          monthKey,
      )
    ) {
      continue;
    }

    usedMonths.add(
        monthKey,
    );

    keepMonthly.push(
        backup,
    );

    monthlySelectedIds.add(
        backup.backupId,
    );
  }


  // --------------------------------------------------------------------------
  // 6. TODOS OS IDs QUE DEVEM SER MANTIDOS
  // --------------------------------------------------------------------------

  const keepIds =
      new Set([
        ...keepDaily.map(
            (backup) =>
              backup.backupId,
        ),

        ...keepWeekly.map(
            (backup) =>
              backup.backupId,
        ),

        ...keepMonthly.map(
            (backup) =>
              backup.backupId,
        ),
      ]);


  // --------------------------------------------------------------------------
  // 7. CANDIDATOS À EXCLUSÃO
  // --------------------------------------------------------------------------

  const deleteCandidates =
      eligible.filter(
          (backup) =>
            !keepIds.has(
                backup.backupId,
            ),
      );


  // --------------------------------------------------------------------------
  // 8. RESULTADO DO DRY RUN
  // --------------------------------------------------------------------------

  return {
    policy: {
      daily:
        DAILY_KEEP_COUNT,

      weekly:
        WEEKLY_KEEP_COUNT,

      monthly:
        MONTHLY_KEEP_COUNT,

      timeZone:
        TIME_ZONE,
    },

    counts: {
      eligible:
        eligible.length,

      keepDaily:
        keepDaily.length,

      keepWeekly:
        keepWeekly.length,

      keepMonthly:
        keepMonthly.length,

      keepTotal:
        keepIds.size,

      deleteCandidates:
        deleteCandidates.length,
    },

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
}


// ============================================================================
// VALIDA CANDIDATO À EXCLUSÃO PELA RETENÇÃO
// ============================================================================
//
// F5.6-D1
//
// Esta função NÃO exclui absolutamente nada.
//
// Responsabilidade:
//
// Receber um backup que futuramente poderia ser removido e validar
// novamente todas as condições de segurança antes de autorizá-lo como
// candidato legítimo.
//
// A estratégia é FAIL CLOSED:
//
//   qualquer inconsistência
//          ↓
//       BLOQUEIA
//
// ============================================================================
//
// PARÂMETROS:
//
// storeId
//   Loja que está sendo processada.
//
// backupId
//   ID CANÔNICO do documento Firestore.
//
// backupData
//   Metadata atual lida diretamente do documento do snapshot.
//
// allBackups
//   Lista atual de snapshots utilizada para RECALCULAR a política.
//
// ============================================================================
//
// IMPORTANTE:
//
// allowed == true
//
// significa apenas:
//
//   "o backup passou pelas validações para uma futura exclusão"
//
// NÃO significa:
//
//   "o backup foi excluído"
//
// Esta função possui:
//
// ❌ zero Firestore delete()
// ❌ zero Storage delete()
// ❌ zero escrita
//
// ============================================================================

function validateRetentionDeleteCandidate({
  storeId,
  backupId,
  backupData,
  allBackups,
}) {
  const reasons = [];


  // --------------------------------------------------------------------------
  // 1. IDENTIFICADORES OBRIGATÓRIOS
  // --------------------------------------------------------------------------

  const normalizedStoreId =
      String(
          storeId || "",
      ).trim();

  const normalizedBackupId =
      String(
          backupId || "",
      ).trim();


  if (!normalizedStoreId) {
    reasons.push({
      code:
        "missing-store-id",

      message:
        "storeId não informado.",
    });
  }


  if (!normalizedBackupId) {
    reasons.push({
      code:
        "missing-backup-id",

      message:
        "backupId não informado.",
    });
  }


  // --------------------------------------------------------------------------
  // 2. METADATA OBRIGATÓRIA
  // --------------------------------------------------------------------------

  if (
    !backupData ||
    typeof backupData !== "object" ||
    Array.isArray(backupData)
  ) {
    reasons.push({
      code:
        "invalid-backup-data",

      message:
        "Metadata do backup inválida.",
    });
  }


  if (!Array.isArray(allBackups)) {
    reasons.push({
      code:
        "invalid-backup-list",

      message:
        "Lista atual de backups inválida.",
    });
  }


  // --------------------------------------------------------------------------
  // SE A ESTRUTURA BÁSICA JÁ ESTÁ INVÁLIDA, ENCERRA.
  // --------------------------------------------------------------------------

  if (reasons.length > 0) {
    return {
      allowed:
        false,

      storeId:
        normalizedStoreId || null,

      backupId:
        normalizedBackupId || null,

      reasons,
    };
  }


  // --------------------------------------------------------------------------
  // 3. CONFIRMA STORE ID DA METADATA
  // --------------------------------------------------------------------------

  const metadataStoreId =
      String(
          backupData.storeId || "",
      ).trim();


  if (
    metadataStoreId !==
    normalizedStoreId
  ) {
    reasons.push({
      code:
        "store-id-mismatch",

      message:
        "O storeId da metadata não corresponde à loja processada.",
    });
  }


  // --------------------------------------------------------------------------
  // 4. CONFIRMA BACKUP ID, QUANDO EXISTIR NA METADATA
  // --------------------------------------------------------------------------
  //
  // O ID canônico continua sendo SEMPRE doc.id.
  //
  // Alguns snapshots podem não possuir backupId dentro dos dados.
  // Isso é permitido.
  //
  // Mas, se o campo existir, ele deve obrigatoriamente coincidir com doc.id.
  //
  // --------------------------------------------------------------------------

  if (
    backupData.backupId !== undefined &&
    backupData.backupId !== null
  ) {
    const metadataBackupId =
        String(
            backupData.backupId,
        ).trim();

    if (
      metadataBackupId !==
      normalizedBackupId
    ) {
      reasons.push({
        code:
          "backup-id-mismatch",

        message:
          "O backupId da metadata não corresponde ao ID canônico do documento.",
      });
    }
  }


  // --------------------------------------------------------------------------
  // 5. SOMENTE BACKUP AUTOMÁTICO
  // --------------------------------------------------------------------------

  if (
    backupData.type !==
    "automatic"
  ) {
    reasons.push({
      code:
        "not-automatic",

      message:
        "Somente backups automáticos podem ser removidos pela retenção.",
    });
  }


  // --------------------------------------------------------------------------
  // 6. SOMENTE STATUS READY
  // --------------------------------------------------------------------------

  if (
    backupData.status !==
    "ready"
  ) {
    reasons.push({
      code:
        "not-ready",

      message:
        "Somente backups com status ready podem ser removidos pela retenção.",
    });
  }


  // --------------------------------------------------------------------------
  // 7. PROTEÇÃO EXPLÍCITA
  // --------------------------------------------------------------------------
  //
  // Campo ausente:
  //
  //   protected = false
  //
  // Campo boolean true:
  //
  //   BLOQUEADO
  //
  // Valor inesperado:
  //
  //   BLOQUEADO POR SEGURANÇA
  //
  // --------------------------------------------------------------------------

  if (
    backupData.protected !== undefined &&
    typeof backupData.protected !==
      "boolean"
  ) {
    reasons.push({
      code:
        "invalid-protected-field",

      message:
        "O campo protected possui valor inválido.",
    });
  } else if (
    backupData.protected === true
  ) {
    reasons.push({
      code:
        "backup-protected",

      message:
        "O backup está protegido contra exclusão automática.",
    });
  }


  // --------------------------------------------------------------------------
  // 8. CREATED AT PRECISA SER VÁLIDO
  // --------------------------------------------------------------------------

  const createdAt =
      normalizeDate(
          backupData.createdAt,
      );


  if (!createdAt) {
    reasons.push({
      code:
        "invalid-created-at",

      message:
        "O backup não possui createdAt válido.",
    });
  }


  // --------------------------------------------------------------------------
  // 9. STORAGE PATH PRECISA SER EXATAMENTE O ESPERADO
  // --------------------------------------------------------------------------
  //
  // Isso evita que um bug faça a retenção apontar para:
  //
  // - outra loja;
  // - outro backup;
  // - outro arquivo do Storage.
  //
  // --------------------------------------------------------------------------

  const expectedStoragePath =
      (
        `store_backups/` +
        `${normalizedStoreId}/` +
        `${normalizedBackupId}/` +
        `snapshot.json.gz`
      );

  const actualStoragePath =
      String(
          backupData.storagePath || "",
      ).trim();


  if (
    actualStoragePath !==
    expectedStoragePath
  ) {
    reasons.push({
      code:
        "invalid-storage-path",

      message:
        "O storagePath não corresponde ao caminho canônico esperado.",
    });
  }


  // --------------------------------------------------------------------------
  // 10. O BACKUP PRECISA EXISTIR EXATAMENTE UMA VEZ NA LISTA ATUAL
  // --------------------------------------------------------------------------

  const matchingBackups =
      allBackups.filter(
          (backup) =>
            backup &&
            backup.backupId ===
              normalizedBackupId,
      );


  if (
    matchingBackups.length !== 1
  ) {
    reasons.push({
      code:
        "backup-list-mismatch",

      message:
        (
          "O backup precisa existir exatamente uma vez " +
          "na lista utilizada para recalcular a retenção."
        ),
    });
  }


  // --------------------------------------------------------------------------
  // SE ALGUMA VALIDAÇÃO DE METADATA FALHOU, NÃO PROSSEGUE.
  // --------------------------------------------------------------------------

  if (reasons.length > 0) {
    return {
      allowed:
        false,

      storeId:
        normalizedStoreId,

      backupId:
        normalizedBackupId,

      reasons,
    };
  }


  // --------------------------------------------------------------------------
  // 11. RECALCULA A POLÍTICA COM O ESTADO ATUAL
  // --------------------------------------------------------------------------
  //
  // Esta é uma das travas mais importantes.
  //
  // Mesmo que o backup tenha sido classificado anteriormente como candidato,
  // a política é recalculada NOVAMENTE antes de qualquer futura exclusão.
  //
  // --------------------------------------------------------------------------

  const retention =
      calculateBackupRetention(
          allBackups,
      );


  // --------------------------------------------------------------------------
  // 12. CONFIRMA QUE NÃO ESTÁ EM NENHUMA FAIXA KEEP
  // --------------------------------------------------------------------------

  const keepIds =
      new Set([
        ...retention.keep.daily.map(
            (backup) =>
              backup.backupId,
        ),

        ...retention.keep.weekly.map(
            (backup) =>
              backup.backupId,
        ),

        ...retention.keep.monthly.map(
            (backup) =>
              backup.backupId,
        ),
      ]);


  if (
    keepIds.has(
        normalizedBackupId,
    )
  ) {
    reasons.push({
      code:
        "retained-by-policy",

      message:
        "O backup pertence atualmente a uma faixa KEEP da política de retenção.",
    });
  }


  // --------------------------------------------------------------------------
  // 13. PRECISA CONTINUAR PRESENTE EM DELETE CANDIDATES
  // --------------------------------------------------------------------------

  const currentDeleteCandidate =
      retention.deleteCandidates.find(
          (backup) =>
            backup.backupId ===
            normalizedBackupId,
      );


  if (!currentDeleteCandidate) {
    reasons.push({
      code:
        "not-delete-candidate",

      message:
        "O backup não é mais candidato à exclusão segundo o estado atual.",
    });
  }


  // --------------------------------------------------------------------------
  // 14. RESULTADO FINAL
  // --------------------------------------------------------------------------

  if (reasons.length > 0) {
    return {
      allowed:
        false,

      storeId:
        normalizedStoreId,

      backupId:
        normalizedBackupId,

      reasons,
    };
  }


  return {
    allowed:
      true,

    storeId:
      normalizedStoreId,

    backupId:
      normalizedBackupId,

    storagePath:
      expectedStoragePath,

    createdAt:
      createdAt.toISOString(),

    reasons: [],
  };
}


// ============================================================================
// EXPORTS INTERNOS
// ============================================================================

module.exports = {
  calculateBackupRetention,
  validateRetentionDeleteCandidate,

  getIsoWeekKey,
  getMonthKey,

  TIME_ZONE,
  DAILY_KEEP_COUNT,
  WEEKLY_KEEP_COUNT,
  MONTHLY_KEEP_COUNT,
};