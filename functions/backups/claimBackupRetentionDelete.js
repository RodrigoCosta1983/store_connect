"use strict";


const admin =
    require("firebase-admin");

const {
  planRetentionDeleteClaim,
  ACTIONS,
} = require(
    "./backupRetentionClaimPlanner",
);


// ============================================================================
// STORE&CONNECT — CLAIM DE EXCLUSÃO POR RETENÇÃO
// ============================================================================
//
// F5.6-D3-E
//
// Primeira implementação com escrita da futura retenção.
//
// ESTE ARQUIVO:
//
// ✅ pode criar retentionDeletes/{backupId}
// ✅ pode mudar snapshot ready → deleting
//
// ESTE ARQUIVO NÃO:
//
// ❌ exclui Firestore
// ❌ exclui Storage
// ❌ finaliza retenção
// ❌ executa audit de exclusão
//
// ============================================================================


const LEASE_MINUTES =
    15;


// ============================================================================
// DATA VÁLIDA
// ============================================================================

function normalizeNow(
    value,
) {
  if (value instanceof Date) {
    return Number.isNaN(
        value.getTime(),
    )
      ? null
      : value;
  }


  const date =
      new Date(value);


  return Number.isNaN(
      date.getTime(),
  )
    ? null
    : date;
}


// ============================================================================
// CLAIM
// ============================================================================

async function claimBackupRetentionDelete({
  db,
  storeId,
  backupId,
  executionId,
  now = new Date(),
}) {
  // --------------------------------------------------------------------------
  // IDENTIFICADORES BÁSICOS
  // --------------------------------------------------------------------------

  if (
    !db ||
    typeof db.runTransaction !==
      "function"
  ) {
    throw new Error(
        "Firestore db inválido.",
    );
  }


  const normalizedStoreId =
      String(
          storeId || "",
      ).trim();

  const normalizedBackupId =
      String(
          backupId || "",
      ).trim();

  const normalizedExecutionId =
      String(
          executionId || "",
      ).trim();

  const currentDate =
      normalizeNow(
          now,
      );


  if (!normalizedStoreId) {
    throw new Error(
        "storeId obrigatório.",
    );
  }


  if (!normalizedBackupId) {
    throw new Error(
        "backupId obrigatório.",
    );
  }


  if (!normalizedExecutionId) {
    throw new Error(
        "executionId obrigatório.",
    );
  }


  if (!currentDate) {
    throw new Error(
        "Horário atual inválido.",
    );
  }


  // --------------------------------------------------------------------------
  // LEASE
  // --------------------------------------------------------------------------

  const leaseExpiresDate =
      new Date(
          currentDate.getTime() +
          LEASE_MINUTES *
          60 *
          1000,
      );


  // --------------------------------------------------------------------------
  // REFERÊNCIAS
  // --------------------------------------------------------------------------

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

  const snapshotRef =
      snapshotsRef
          .doc(
              normalizedBackupId,
          );

  const operationRef =
      storeBackupsRef
          .collection(
              "retentionDeletes",
          )
          .doc(
              normalizedBackupId,
          );


  // ==========================================================================
  // FIRESTORE TRANSACTION
  // ==========================================================================

  return db.runTransaction(
      async (transaction) => {
        // --------------------------------------------------------------------
        // 1. RELÊ OPERAÇÃO ATUAL
        // --------------------------------------------------------------------

        const operationDoc =
            await transaction.get(
                operationRef,
            );


        // --------------------------------------------------------------------
        // 2. RELÊ TODOS OS SNAPSHOTS ATUAIS
        // --------------------------------------------------------------------
        //
        // A política precisa ser recalculada com o estado atual
        // dentro da própria transaction.
        //
        // --------------------------------------------------------------------

        const snapshotsSnapshot =
            await transaction.get(
                snapshotsRef,
            );


        // --------------------------------------------------------------------
        // 3. METADATA ORIGINAL + VISÃO CANÔNICA
        // --------------------------------------------------------------------

        let rawSnapshot =
            null;

        const allBackups =
            snapshotsSnapshot.docs.map(
                (doc) => {
                  const raw =
                      doc.data() || {};


                  if (
                    doc.id ===
                      normalizedBackupId
                  ) {
                    rawSnapshot =
                        raw;
                  }


                  return {
                    ...raw,

                    backupId:
                      doc.id,
                  };
                },
            );


        // --------------------------------------------------------------------
        // 4. OPERAÇÃO EXISTENTE, SE HOUVER
        // --------------------------------------------------------------------

        const operation =
            operationDoc.exists
              ? (
                  operationDoc.data() ||
                  {}
                )
              : null;


        // --------------------------------------------------------------------
        // 5. PLANNER PURO
        // --------------------------------------------------------------------
        //
        // Nenhuma decisão de escrita é tomada diretamente aqui.
        //
        // O planner recebe o estado recém-lido da transaction.
        //
        // --------------------------------------------------------------------

        const plan =
            planRetentionDeleteClaim({
              storeId:
                normalizedStoreId,

              backupId:
                normalizedBackupId,

              snapshot:
                rawSnapshot,

              operation,

              allBackups,

              executionId:
                normalizedExecutionId,

              now:
                currentDate,
            });


        // --------------------------------------------------------------------
        // 6. SOMENTE CREATE_CLAIM PODE ESCREVER NESTA ETAPA
        // --------------------------------------------------------------------

        if (
          plan.action !==
            ACTIONS.CREATE_CLAIM
        ) {
          return {
            ...plan,

            wrote:
              false,
          };
        }


        // --------------------------------------------------------------------
        // TRAVA EXTRA
        // --------------------------------------------------------------------
        //
        // CREATE_CLAIM exige:
        //
        // - operação inexistente;
        // - snapshot ainda existente.
        //
        // --------------------------------------------------------------------

        if (operationDoc.exists) {
          throw new Error(
              (
                "Planner retornou CREATE_CLAIM " +
                "para uma operação já existente."
              ),
          );
        }


        if (!rawSnapshot) {
          throw new Error(
              (
                "Planner retornou CREATE_CLAIM " +
                "sem snapshot existente."
              ),
          );
        }


        // --------------------------------------------------------------------
        // 7. TIMESTAMPS
        // --------------------------------------------------------------------

        const serverTimestamp =
            admin.firestore
                .FieldValue
                .serverTimestamp();

        const leaseExpiresAt =
            admin.firestore
                .Timestamp
                .fromDate(
                    leaseExpiresDate,
                );


        // --------------------------------------------------------------------
        // 8. CRIA OPERAÇÃO CLAIMED
        // --------------------------------------------------------------------

        transaction.create(
            operationRef,
            {
              version:
                1,

              storeId:
                normalizedStoreId,

              backupId:
                normalizedBackupId,

              status:
                "claimed",

              reason:
                "retention_policy",

              snapshot: {
                type:
                  plan.frozenSnapshot
                      .type,

                originalStatus:
                  plan.frozenSnapshot
                      .originalStatus,

                createdAt:
                  plan.frozenSnapshot
                      .createdAt,

                storagePath:
                  plan.frozenSnapshot
                      .storagePath,

                checksum:
                  plan.frozenSnapshot
                      .checksum,

                compressedBytes:
                  plan.frozenSnapshot
                      .compressedBytes,
              },

              createdAt:
                serverTimestamp,

              updatedAt:
                serverTimestamp,

              claimedAt:
                serverTimestamp,

              storageDeletedAt:
                null,

              completedAt:
                null,

              blockedAt:
                null,

              attemptCount:
                1,

              lastAttemptAt:
                serverTimestamp,

              lastError:
                null,

              leaseOwner:
                normalizedExecutionId,

              leaseAcquiredAt:
                serverTimestamp,

              leaseExpiresAt,
            },
        );


        // --------------------------------------------------------------------
        // 9. SNAPSHOT ready → deleting
        // --------------------------------------------------------------------

        transaction.update(
            snapshotRef,
            {
              status:
                "deleting",

              retentionDeleteOperationId:
                normalizedBackupId,

              retentionDeleteStartedAt:
                serverTimestamp,

              retentionDeleteReason:
                "retention_policy",
            },
        );


        // --------------------------------------------------------------------
        // 10. RESULTADO
        // --------------------------------------------------------------------

        return {
          action:
            ACTIONS.CREATE_CLAIM,

          allowed:
            true,

          wrote:
            true,

          storeId:
            normalizedStoreId,

          backupId:
            normalizedBackupId,

          leaseOwner:
            normalizedExecutionId,

          leaseExpiresAt:
            leaseExpiresDate
                .toISOString(),

          reasons: [],
        };
      },
  );
}


// ============================================================================
// EXPORTS INTERNOS
// ============================================================================

module.exports = {
  claimBackupRetentionDelete,

  LEASE_MINUTES,
};