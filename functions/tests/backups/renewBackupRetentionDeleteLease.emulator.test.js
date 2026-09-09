"use strict";


// ============================================================================
// STORE&CONNECT â€” TESTE REAL DO LEASE NO FIRESTORE EMULATOR
// ============================================================================
//
// F5.6-D3-F3
//
// Emulator:
//   127.0.0.1:8080
//
// Valida:
//
// âœ… renovaÃ§Ã£o pelo mesmo worker
// âœ… SKIP com lease ativo de outro worker
// âœ… takeover de lease expirado
// âœ… retomada de storage_deleted
//
// âŒ produÃ§Ã£o
// âŒ Storage
// âŒ delete()
//
// ============================================================================


process.env.FIRESTORE_EMULATOR_HOST =
    "127.0.0.1:8080";

process.env.GCLOUD_PROJECT =
    "store-connect-app";


const assert =
    require("assert");

const admin =
    require("firebase-admin");

const {
  renewBackupRetentionDeleteLease,
} = require(
    "../../backups/renewBackupRetentionDeleteLease",
);

const {
  ACTIONS,
  RESUME_STAGES,
} = require(
    "../../backups/backupRetentionClaimPlanner",
);


// ============================================================================
// CONFIGURAÃ‡ÃƒO
// ============================================================================

const PROJECT_ID =
    "store-connect-app";

const STORE_ID =
    "emulator-retention-lease-test";

const EXECUTION_A =
    "execution-A";

const EXECUTION_B =
    "execution-B";

const VALID_CHECKSUM =
    "d".repeat(64);

const NOW =
    new Date(
        "2026-09-30T12:00:00.000Z",
    );


if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId:
      PROJECT_ID,
  });
}


const db =
    admin.firestore();


// ============================================================================
// HELPERS
// ============================================================================

function storagePath(
    backupId,
) {
  return (
    `store_backups/` +
    `${STORE_ID}/` +
    `${backupId}/` +
    `snapshot.json.gz`
  );
}


function timestamp(
    value,
) {
  return admin.firestore
      .Timestamp
      .fromDate(
          new Date(value),
      );
}


function snapshotData(
    backupId,
) {
  return {
    storeId:
      STORE_ID,

    type:
      "automatic",

    status:
      "deleting",

    createdAt:
      timestamp(
          "2026-01-01T12:00:00.000Z",
      ),

    storagePath:
      storagePath(
          backupId,
      ),

    checksum:
      VALID_CHECKSUM,

    retentionDeleteOperationId:
      backupId,

    retentionDeleteReason:
      "retention_policy",
  };
}


function operationData({
  backupId,
  status = "claimed",
  leaseOwner = EXECUTION_A,
  leaseExpiresAt =
    "2026-09-30T12:15:00.000Z",
}) {
  return {
    version:
      1,

    storeId:
      STORE_ID,

    backupId,

    status,

    reason:
      "retention_policy",

    snapshot: {
      type:
        "automatic",

      originalStatus:
        "ready",

      createdAt:
        timestamp(
            "2026-01-01T12:00:00.000Z",
        ),

      storagePath:
        storagePath(
            backupId,
        ),

      checksum:
        VALID_CHECKSUM,

      compressedBytes:
        123456,
    },

    createdAt:
      timestamp(
          "2026-09-30T11:50:00.000Z",
      ),

    updatedAt:
      timestamp(
          "2026-09-30T11:55:00.000Z",
      ),

    claimedAt:
      timestamp(
          "2026-09-30T11:55:00.000Z",
      ),

    storageDeletedAt:
      status === "storage_deleted"
        ? timestamp(
            "2026-09-30T11:58:00.000Z",
        )
        : null,

    completedAt:
      null,

    blockedAt:
      null,

    attemptCount:
      1,

    lastAttemptAt:
      timestamp(
          "2026-09-30T11:55:00.000Z",
      ),

    lastError:
      null,

    leaseOwner,

    leaseAcquiredAt:
      timestamp(
          "2026-09-30T11:55:00.000Z",
      ),

    leaseExpiresAt:
      timestamp(
          leaseExpiresAt,
      ),
  };
}


async function seedPair({
  backupId,
  operation,
}) {
  const storeRef =
      db
          .collection(
              "storeBackups",
          )
          .doc(
              STORE_ID,
          );

  const batch =
      db.batch();


  batch.set(
      storeRef
          .collection(
              "snapshots",
          )
          .doc(
              backupId,
          ),
      snapshotData(
          backupId,
      ),
  );


  batch.set(
      storeRef
          .collection(
              "retentionDeletes",
          )
          .doc(
              backupId,
          ),
      operation,
  );


  await batch.commit();
}


async function readOperation(
    backupId,
) {
  return db
      .collection(
          "storeBackups",
      )
      .doc(
          STORE_ID,
      )
      .collection(
          "retentionDeletes",
      )
      .doc(
          backupId,
      )
      .get();
}


// ============================================================================
// TESTE
// ============================================================================

async function run() {
  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "F5.6-D3-F3 â€” LEASE NO FIRESTORE EMULATOR",
  );

  console.log(
      "============================================================",
  );


  // ==========================================================================
  // 1. MESMO WORKER RENOVA O LEASE
  // ==========================================================================

  {
    const backupId =
        "backup-renew-same-worker";

    const initialLeaseAcquiredAt =
        timestamp(
            "2026-09-30T11:55:00.000Z",
        );


    const operation =
        operationData({
          backupId,

          leaseOwner:
            EXECUTION_A,
        });


    operation.leaseAcquiredAt =
        initialLeaseAcquiredAt;


    await seedPair({
      backupId,
      operation,
    });


    const result =
        await renewBackupRetentionDeleteLease({
          db,

          storeId:
            STORE_ID,

          backupId,

          executionId:
            EXECUTION_A,

          now:
            NOW,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.RESUME,
    );

    assert.strictEqual(
        result.wrote,
        true,
    );

    assert.strictEqual(
        result.resumeStage,
        RESUME_STAGES.STORAGE_DELETE,
    );

    assert.strictEqual(
        result.tookOverLease,
        false,
    );


    const after =
        await readOperation(
            backupId,
        );

    const data =
        after.data();


    assert.strictEqual(
        data.status,
        "claimed",
    );

    assert.strictEqual(
        data.leaseOwner,
        EXECUTION_A,
    );

    assert.strictEqual(
        data.attemptCount,
        2,
    );

    assert.strictEqual(
        data.leaseAcquiredAt
            .toMillis(),
        initialLeaseAcquiredAt
            .toMillis(),
    );

    assert.strictEqual(
        data.leaseExpiresAt
            .toDate()
            .toISOString(),
        "2026-09-30T12:15:00.000Z",
    );


    console.log(
        "âœ… mesmo worker â†’ lease renovado",
    );

    console.log(
        "âœ… leaseAcquiredAt original preservado",
    );
  }


  // ==========================================================================
  // 2. LEASE ATIVO DE OUTRO WORKER â†’ SKIP
  // ==========================================================================

  {
    const backupId =
        "backup-active-other-worker";


    await seedPair({
      backupId,

      operation:
        operationData({
          backupId,

          leaseOwner:
            EXECUTION_A,

          leaseExpiresAt:
            "2026-09-30T12:15:00.000Z",
        }),
    });


    const result =
        await renewBackupRetentionDeleteLease({
          db,

          storeId:
            STORE_ID,

          backupId,

          executionId:
            EXECUTION_B,

          now:
            NOW,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.SKIP_LEASED,
    );

    assert.strictEqual(
        result.wrote,
        false,
    );


    const after =
        await readOperation(
            backupId,
        );

    const data =
        after.data();


    assert.strictEqual(
        data.leaseOwner,
        EXECUTION_A,
    );

    assert.strictEqual(
        data.attemptCount,
        1,
    );


    console.log(
        "âœ… outro worker + lease ativo â†’ SKIP_LEASED",
    );

    console.log(
        "âœ… operaÃ§Ã£o permaneceu sem alteraÃ§Ã£o",
    );
  }


  // ==========================================================================
  // 3. LEASE EXPIRADO â†’ TAKEOVER
  // ==========================================================================

  {
    const backupId =
        "backup-expired-takeover";


    const oldAcquiredAt =
        timestamp(
            "2026-09-30T11:40:00.000Z",
        );


    const operation =
        operationData({
          backupId,

          leaseOwner:
            EXECUTION_A,

          leaseExpiresAt:
            "2026-09-30T11:59:00.000Z",
        });


    operation.leaseAcquiredAt =
        oldAcquiredAt;


    await seedPair({
      backupId,
      operation,
    });


    const result =
        await renewBackupRetentionDeleteLease({
          db,

          storeId:
            STORE_ID,

          backupId,

          executionId:
            EXECUTION_B,

          now:
            NOW,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.RESUME,
    );

    assert.strictEqual(
        result.wrote,
        true,
    );

    assert.strictEqual(
        result.tookOverLease,
        true,
    );


    const after =
        await readOperation(
            backupId,
        );

    const data =
        after.data();


    assert.strictEqual(
        data.status,
        "claimed",
    );

    assert.strictEqual(
        data.leaseOwner,
        EXECUTION_B,
    );

    assert.strictEqual(
        data.attemptCount,
        2,
    );

    assert.notStrictEqual(
        data.leaseAcquiredAt
            .toMillis(),
        oldAcquiredAt
            .toMillis(),
    );

    assert.strictEqual(
        data.leaseExpiresAt
            .toDate()
            .toISOString(),
        "2026-09-30T12:15:00.000Z",
    );


    console.log(
        "âœ… lease expirado â†’ takeover realizado",
    );

    console.log(
        "âœ… leaseOwner transferido para execution-B",
    );
  }


  // ==========================================================================
  // 4. STORAGE_DELETED â†’ RENOVA E RETOMA FINALIZAÃ‡ÃƒO
  // ==========================================================================

  {
    const backupId =
        "backup-storage-deleted";


    await seedPair({
      backupId,

      operation:
        operationData({
          backupId,

          status:
            "storage_deleted",

          leaseOwner:
            EXECUTION_A,
        }),
    });


    const result =
        await renewBackupRetentionDeleteLease({
          db,

          storeId:
            STORE_ID,

          backupId,

          executionId:
            EXECUTION_A,

          now:
            NOW,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.RESUME,
    );

    assert.strictEqual(
        result.resumeStage,
        RESUME_STAGES.FINALIZE,
    );

    assert.strictEqual(
        result.wrote,
        true,
    );


    const after =
        await readOperation(
            backupId,
        );

    const data =
        after.data();


    assert.strictEqual(
        data.status,
        "storage_deleted",
    );

    assert.strictEqual(
        data.attemptCount,
        2,
    );


    console.log(
        "âœ… storage_deleted â†’ RESUME finalize",
    );

    console.log(
        "âœ… status storage_deleted preservado",
    );
  }


  // ==========================================================================
  // FINAL
  // ==========================================================================

  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… TESTES REAIS DO LEASE NO EMULATOR PASSARAM",
  );

  console.log(
      "============================================================",
  );

  console.log("");

  console.log(
      "ProduÃ§Ã£o nÃ£o foi utilizada.",
  );

  console.log(
      "Nenhum delete() foi executado.",
  );
}


// ============================================================================
// EXECUTA
// ============================================================================

run()
    .then(
        async () => {
          await admin.app().delete();
        },
    )
    .catch(
        async (error) => {
          console.error(
              "âŒ TESTE FALHOU:",
              error,
          );

          try {
            await admin.app().delete();
          } catch (_) {
            // ignora somente encerramento
          }

          process.exitCode =
              1;
        },
    );