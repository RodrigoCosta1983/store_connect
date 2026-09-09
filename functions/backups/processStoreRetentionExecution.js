"use strict";


const {
  calculateBackupRetention,
  validateRetentionDeleteCandidate,
} = require(
    "./backupRetention",
);

const {
  executeBackupRetentionCandidate,
} = require(
    "./executeBackupRetentionCandidate",
);

const {
  ACTIONS:
    CLAIM_ACTIONS,
} = require(
    "./backupRetentionClaimPlanner",
);


// ============================================================================
// F5.6-D3-G9.3
// EXECUÇÃO DE RETENÇÃO DE UMA LOJA
// ============================================================================
//
// Ordem:
//
// 1. retoma operações persistentes interrompidas;
// 2. relê os snapshots;
// 3. recalcula a política;
// 4. valida novamente os deleteCandidates;
// 5. executa somente candidatos ALLOWED;
// 6. limita novas exclusões por execução.
//
// IMPORTANTE:
//
// ✅ não é Scheduler;
// ✅ não decide se produção está habilitada;
// ✅ não altera dailyRuns;
// ✅ não ignora operações interrompidas;
// ✅ cada candidato ainda passa pelo claim e pelas travas internas;
//
// ============================================================================


// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

const DEFAULT_MAX_FRESH_DELETES =
    20;

const ACTIVE_OPERATION_STATUSES =
    new Set([
      "claimed",
      "storage_deleted",
    ]);


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


function normalizeNow(
    value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }


  const date =
      value instanceof Date
        ? new Date(
            value.getTime(),
        )
        : new Date(
            value,
        );


  if (
    Number.isNaN(
        date.getTime(),
    )
  ) {
    throw new Error(
        "now inválido.",
    );
  }


  return date;
}


function getExecutionNow(
    fixedNow,
) {
  return fixedNow
    ? new Date(
        fixedNow.getTime(),
    )
    : new Date();
}


function getErrorMessage(
    error,
) {
  return String(
      error?.message ||
      error ||
      "Erro desconhecido",
  ).slice(
      0,
      1000,
  );
}


function classifyExecution(
    result,
) {
  if (
    result?.completed ===
      true
  ) {
    return "completed";
  }


  if (
    result?.claim?.action ===
      CLAIM_ACTIONS.SKIP_LEASED
  ) {
    return "skip_leased";
  }


  if (
    result?.claim?.action ===
      CLAIM_ACTIONS.BLOCKED
  ) {
    return "blocked";
  }


  return "pending";
}


// ============================================================================
// EXECUTOR DA LOJA
// ============================================================================

async function processStoreRetentionExecution({
  db,
  bucket,
  storeId,
  executionId,
  now =
    null,
  maxFreshDeletes =
    DEFAULT_MAX_FRESH_DELETES,
}) {
  // ==========================================================================
  // 1. INPUTS
  // ==========================================================================

  if (
    !db ||
    typeof db.runTransaction !==
      "function"
  ) {
    throw new Error(
        "Firestore db inválido.",
    );
  }


  if (
    !bucket ||
    typeof bucket.file !==
      "function"
  ) {
    throw new Error(
        "Storage bucket inválido.",
    );
  }


  const normalizedStoreId =
      normalizeString(
          storeId,
      );

  const normalizedExecutionId =
      normalizeString(
          executionId,
      );


  if (!normalizedStoreId) {
    throw new Error(
        "storeId obrigatório.",
    );
  }


  if (!normalizedExecutionId) {
    throw new Error(
        "executionId obrigatório.",
    );
  }


  if (
    !Number.isInteger(
        maxFreshDeletes,
    ) ||
    maxFreshDeletes < 0 ||
    maxFreshDeletes > 100
  ) {
    throw new Error(
        (
          "maxFreshDeletes deve ser um inteiro " +
          "entre 0 e 100."
        ),
    );
  }


  const fixedNow =
      normalizeNow(
          now,
      );


  // ==========================================================================
  // 2. REFERÊNCIAS
  // ==========================================================================

  const storeBackupsRef =
      db
          .collection(
              "storeBackups",
          )
          .doc(
              normalizedStoreId,
          );


  const snapshotsRef =
      storeBackupsRef
          .collection(
              "snapshots",
          );


  const operationsRef =
      storeBackupsRef
          .collection(
              "retentionDeletes",
          );


  // ==========================================================================
  // 3. RETOMA OPERAÇÕES INTERROMPIDAS
  // ==========================================================================

  const operationsSnapshot =
      await operationsRef.get();


  const activeOperations =
      operationsSnapshot.docs
          .filter(
              (doc) => {
                const data =
                    doc.data() || {};

                return (
                  ACTIVE_OPERATION_STATUSES
                      .has(
                          data.status,
                      )
                );
              },
          );


  const resumedResults =
      [];

  const errors =
      [];


  for (
    const operationDoc
    of activeOperations
  ) {
    const backupId =
        operationDoc.id;


    try {
      const result =
          await executeBackupRetentionCandidate({
            db,

            bucket,

            storeId:
              normalizedStoreId,

            backupId,

            executionId:
              normalizedExecutionId,

            now:
              getExecutionNow(
                  fixedNow,
              ),
          });


      resumedResults.push({
        backupId,

        classification:
          classifyExecution(
              result,
          ),

        result,
      });
    } catch (error) {
      errors.push({
        stage:
          "resume",

        backupId,

        error:
          getErrorMessage(
              error,
          ),
      });
    }
  }


  // ==========================================================================
  // 4. RELÊ SNAPSHOTS DEPOIS DAS RETOMADAS
  // ==========================================================================

  const snapshots =
      await snapshotsRef.get();


  const rawMetadataByBackupId =
      new Map(
          snapshots.docs.map(
              (doc) => [
                doc.id,
                doc.data() || {},
              ],
          ),
      );


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


  // ==========================================================================
  // 5. RECALCULA POLÍTICA
  // ==========================================================================

  const retentionResult =
      calculateBackupRetention(
          backups,
      );


  // ==========================================================================
  // 6. REVALIDA TODOS OS DELETE CANDIDATES
  // ==========================================================================

  const validatedDeleteCandidates =
      retentionResult
          .deleteCandidates
          .map(
              (candidate) => {
                const backupId =
                    candidate.backupId;

                const rawMetadata =
                    rawMetadataByBackupId
                        .get(
                            backupId,
                        ) ||
                    null;


                const validation =
                    validateRetentionDeleteCandidate({
                      storeId:
                        normalizedStoreId,

                      backupId,

                      backupData:
                        rawMetadata,

                      allBackups:
                        backups,
                    });


                return {
                  backupId,

                  allowed:
                    validation.allowed ===
                      true,

                  reasons:
                    validation.reasons ||
                    [],

                  storagePath:
                    candidate.storagePath ||
                    null,

                  createdAt:
                    candidate.createdAtDate
                      ? candidate
                          .createdAtDate
                          .toISOString()
                      : null,

                  createdAtMillis:
                    candidate.createdAtDate
                      ? candidate
                          .createdAtDate
                          .getTime()
                      : Number
                          .MAX_SAFE_INTEGER,
                };
              },
          );


  const allowedDeleteCandidates =
      validatedDeleteCandidates
          .filter(
              (candidate) =>
                candidate.allowed ===
                  true,
          )
          .sort(
              (a, b) =>
                a.createdAtMillis -
                b.createdAtMillis,
          );


  const blockedDeleteCandidates =
      validatedDeleteCandidates
          .filter(
              (candidate) =>
                candidate.allowed !==
                  true,
          );


  // ==========================================================================
  // 7. LIMITE DE NOVAS EXCLUSÕES
  // ==========================================================================

  const selectedFreshCandidates =
      allowedDeleteCandidates
          .slice(
              0,
              maxFreshDeletes,
          );


  const deferredFreshCandidates =
      allowedDeleteCandidates
          .slice(
              maxFreshDeletes,
          );


  // ==========================================================================
  // 8. EXECUTA NOVOS CANDIDATOS
  // ==========================================================================

  const freshResults =
      [];


  for (
    const candidate
    of selectedFreshCandidates
  ) {
    try {
      // ----------------------------------------------------------------------
      // O EXECUTOR NÃO CONFIA NA VALIDAÇÃO FEITA ACIMA.
      //
      // claimBackupRetentionDelete() fará novamente a validação atual antes de
      // transformar ready → deleting.
      // ----------------------------------------------------------------------

      const result =
          await executeBackupRetentionCandidate({
            db,

            bucket,

            storeId:
              normalizedStoreId,

            backupId:
              candidate.backupId,

            executionId:
              normalizedExecutionId,

            now:
              getExecutionNow(
                  fixedNow,
              ),
          });


      freshResults.push({
        backupId:
          candidate.backupId,

        classification:
          classifyExecution(
              result,
          ),

        result,
      });
    } catch (error) {
      errors.push({
        stage:
          "fresh",

        backupId:
          candidate.backupId,

        error:
          getErrorMessage(
              error,
          ),
      });
    }
  }


  // ==========================================================================
  // 9. CONTADORES
  // ==========================================================================

  const resumedCompleted =
      resumedResults.filter(
          (item) =>
            item.classification ===
              "completed",
      ).length;


  const resumedSkippedLeased =
      resumedResults.filter(
          (item) =>
            item.classification ===
              "skip_leased",
      ).length;


  const resumedBlocked =
      resumedResults.filter(
          (item) =>
            item.classification ===
              "blocked",
      ).length;


  const freshCompleted =
      freshResults.filter(
          (item) =>
            item.classification ===
              "completed",
      ).length;


  const freshSkippedLeased =
      freshResults.filter(
          (item) =>
            item.classification ===
              "skip_leased",
      ).length;


  const freshBlocked =
      freshResults.filter(
          (item) =>
            item.classification ===
              "blocked",
      ).length;


  // ==========================================================================
  // 10. RETORNO
  // ==========================================================================

  return {
    storeId:
      normalizedStoreId,

    executionId:
      normalizedExecutionId,

    totalSnapshots:
      snapshots.size,

    eligible:
      retentionResult.counts
          .eligible,

    keepTotal:
      retentionResult.counts
          .keepTotal,

    deleteCandidates:
      retentionResult.counts
          .deleteCandidates,

    allowedDeleteCandidates:
      allowedDeleteCandidates.length,

    blockedDeleteCandidates:
      blockedDeleteCandidates.length,

    activeOperations:
      activeOperations.length,

    resumedCompleted,

    resumedSkippedLeased,

    resumedBlocked,

    freshSelected:
      selectedFreshCandidates.length,

    freshDeferred:
      deferredFreshCandidates.length,

    freshCompleted,

    freshSkippedLeased,

    freshBlocked,

    errorCount:
      errors.length,

    blockedCandidates:
      blockedDeleteCandidates,

    deferredCandidates:
      deferredFreshCandidates.map(
          (candidate) => ({
            backupId:
              candidate.backupId,

            createdAt:
              candidate.createdAt,
          }),
      ),

    resumedResults,

    freshResults,

    errors,
  };
}


// ============================================================================
// EXPORT
// ============================================================================

module.exports = {
  processStoreRetentionExecution,

  DEFAULT_MAX_FRESH_DELETES,
};