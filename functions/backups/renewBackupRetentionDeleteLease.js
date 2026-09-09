"use strict";


const admin =
    require("firebase-admin");

const {
  planRetentionDeleteClaim,
  ACTIONS,
} = require(
    "./backupRetentionClaimPlanner",
);

const {
  LEASE_MINUTES,
} = require(
    "./claimBackupRetentionDelete",
);


// ============================================================================
// STORE&CONNECT — RENOVA / ASSUME LEASE DA RETENÇÃO
// ============================================================================
//
// F5.6-D3-F
//
// Responsabilidade:
//
// ✅ retomar operação claimed;
// ✅ retomar operação storage_deleted;
// ✅ renovar lease do mesmo worker;
// ✅ assumir lease expirado de outro worker;
//
// NÃO:
//
// ❌ altera status da operação;
// ❌ altera snapshot;
// ❌ acessa Storage;
// ❌ executa delete();
// ❌ finaliza retenção.
//
// ============================================================================


// ============================================================================
// NORMALIZA DATA
// ============================================================================

function normalizeNow(value) {
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
// RENOVA / ASSUME LEASE
// ============================================================================

async function renewBackupRetentionDeleteLease({
  db,
  storeId,
  backupId,
  executionId,
  now = new Date(),
}) {
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

  const snapshotRef =
      storeBackupsRef
          .collection(
              "snapshots",
          )
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
  // TRANSACTION
  // ==========================================================================

  return db.runTransaction(
      async (transaction) => {
        // --------------------------------------------------------------------
        // 1. RELÊ OPERAÇÃO E SNAPSHOT
        // --------------------------------------------------------------------

        const operationDoc =
            await transaction.get(
                operationRef,
            );

        const snapshotDoc =
            await transaction.get(
                snapshotRef,
            );


        // --------------------------------------------------------------------
        // 2. NÃO EXISTE OPERAÇÃO PARA RETOMAR
        // --------------------------------------------------------------------

        if (!operationDoc.exists) {
          return {
            action:
              ACTIONS.BLOCKED,

            allowed:
              false,

            wrote:
              false,

            reasons: [
              {
                code:
                  "operation-not-found-for-resume",

                message:
                  (
                    "Não existe operação de retenção " +
                    "para renovar ou assumir lease."
                  ),
              },
            ],
          };
        }


        const operation =
            operationDoc.data() ||
            {};

        const snapshot =
            snapshotDoc.exists
              ? (
                  snapshotDoc.data() ||
                  {}
                )
              : null;


        // --------------------------------------------------------------------
        // 3. PLANNER PURO
        // --------------------------------------------------------------------

        const plan =
            planRetentionDeleteClaim({
              storeId:
                normalizedStoreId,

              backupId:
                normalizedBackupId,

              snapshot,

              operation,

              // Para operação já existente, o planner valida
              // integridade + estado + lease.
              // Ele não recalcula política de novo CLAIM.
              allBackups:
                [],

              executionId:
                normalizedExecutionId,

              now:
                currentDate,
            });


        // --------------------------------------------------------------------
        // 4. SOMENTE RESUME PODE ALTERAR O LEASE
        // --------------------------------------------------------------------

        if (
          plan.action !==
            ACTIONS.RESUME
        ) {
          return {
            ...plan,

            wrote:
              false,
          };
        }


        // --------------------------------------------------------------------
        // 5. TIMESTAMPS
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
        // 6. PAYLOAD DE RENOVAÇÃO
        // --------------------------------------------------------------------

        const updateData = {
          updatedAt:
            serverTimestamp,

          lastAttemptAt:
            serverTimestamp,

          attemptCount:
            admin.firestore
                .FieldValue
                .increment(1),

          leaseOwner:
            normalizedExecutionId,

          leaseExpiresAt,
        };


        // --------------------------------------------------------------------
        // TAKEOVER
        // --------------------------------------------------------------------
        //
        // Se o lease expirou e pertence a outro worker,
        // registra uma nova aquisição.
        //
        // Se o worker já era o dono, preservamos leaseAcquiredAt original.
        //
        // --------------------------------------------------------------------

        if (
          plan.shouldTakeOverLease ===
            true
        ) {
          updateData.leaseAcquiredAt =
              serverTimestamp;
        }


        // --------------------------------------------------------------------
        // 7. ÚNICA ESCRITA DA D3-F
        // --------------------------------------------------------------------

        transaction.update(
            operationRef,
            updateData,
        );


        // --------------------------------------------------------------------
        // 8. RESULTADO
        // --------------------------------------------------------------------

        return {
          action:
            ACTIONS.RESUME,

          allowed:
            true,

          wrote:
            true,

          storeId:
            normalizedStoreId,

          backupId:
            normalizedBackupId,

          resumeStage:
            plan.resumeStage,

          leaseOwner:
            normalizedExecutionId,

          leaseExpiresAt:
            leaseExpiresDate
                .toISOString(),

          tookOverLease:
            plan.shouldTakeOverLease ===
            true,

          reasons: [],
        };
      },
  );
}


// ============================================================================
// EXPORTS INTERNOS
// ============================================================================

module.exports = {
  renewBackupRetentionDeleteLease,
};