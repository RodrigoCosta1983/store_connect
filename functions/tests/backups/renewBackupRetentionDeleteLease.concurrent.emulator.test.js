"use strict";


// ============================================================================
// STORE&CONNECT â€” CONCORRÃŠNCIA NO TAKEOVER DO LEASE
// ============================================================================
//
// F5.6-D3-F4
//
// Dois workers encontram simultaneamente um lease expirado.
//
// Esperado:
//
// âœ… somente um RESUME + TAKEOVER
// âœ… outro SKIP_LEASED
// âœ… attemptCount incrementado apenas uma vez
// âœ… somente uma operaÃ§Ã£o permanece
// âœ… snapshot continua deleting
//
// âŒ sem Storage
// âŒ sem delete()
// âŒ sem produÃ§Ã£o
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
    "emulator-retention-lease-concurrency-test";

const BACKUP_ID =
    "backup-expired-concurrent-takeover";

const EXECUTION_OLD =
    "execution-old";

const EXECUTION_B =
    "execution-B";

const EXECUTION_C =
    "execution-C";

const VALID_CHECKSUM =
    "e".repeat(64);

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

function timestamp(value) {
  return admin.firestore
      .Timestamp
      .fromDate(
          new Date(value),
      );
}


function storagePath() {
  return (
    `store_backups/` +
    `${STORE_ID}/` +
    `${BACKUP_ID}/` +
    `snapshot.json.gz`
  );
}


// ============================================================================
// SEED
// ============================================================================

async function seed() {
  const storeRef =
      db
          .collection(
              "storeBackups",
          )
          .doc(
              STORE_ID,
          );


  const snapshotRef =
      storeRef
          .collection(
              "snapshots",
          )
          .doc(
              BACKUP_ID,
          );


  const operationRef =
      storeRef
          .collection(
              "retentionDeletes",
          )
          .doc(
              BACKUP_ID,
          );


  const batch =
      db.batch();


  batch.set(
      snapshotRef,
      {
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
          storagePath(),

        checksum:
          VALID_CHECKSUM,

        retentionDeleteOperationId:
          BACKUP_ID,

        retentionDeleteReason:
          "retention_policy",
      },
  );


  batch.set(
      operationRef,
      {
        version:
          1,

        storeId:
          STORE_ID,

        backupId:
          BACKUP_ID,

        status:
          "claimed",

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
            storagePath(),

          checksum:
            VALID_CHECKSUM,

          compressedBytes:
            123456,
        },

        createdAt:
          timestamp(
              "2026-09-30T11:30:00.000Z",
          ),

        updatedAt:
          timestamp(
              "2026-09-30T11:40:00.000Z",
          ),

        claimedAt:
          timestamp(
              "2026-09-30T11:40:00.000Z",
          ),

        storageDeletedAt:
          null,

        completedAt:
          null,

        blockedAt:
          null,

        attemptCount:
          1,

        lastAttemptAt:
          timestamp(
              "2026-09-30T11:40:00.000Z",
          ),

        lastError:
          null,

        leaseOwner:
          EXECUTION_OLD,

        leaseAcquiredAt:
          timestamp(
              "2026-09-30T11:40:00.000Z",
          ),

        leaseExpiresAt:
          timestamp(
              "2026-09-30T11:55:00.000Z",
          ),
      },
  );


  await batch.commit();
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
      "F5.6-D3-F4 â€” CONCORRÃŠNCIA NO TAKEOVER DO LEASE",
  );

  console.log(
      "============================================================",
  );


  await seed();


  console.log(
      "âœ… lease expirado criado no Emulator",
  );


  // --------------------------------------------------------------------------
  // DOIS WORKERS TENTAM TAKEOVER SIMULTANEAMENTE
  // --------------------------------------------------------------------------

  const [
    resultB,
    resultC,
  ] = await Promise.all([
    renewBackupRetentionDeleteLease({
      db,

      storeId:
        STORE_ID,

      backupId:
        BACKUP_ID,

      executionId:
        EXECUTION_B,

      now:
        NOW,
    }),

    renewBackupRetentionDeleteLease({
      db,

      storeId:
        STORE_ID,

      backupId:
        BACKUP_ID,

      executionId:
        EXECUTION_C,

      now:
        NOW,
    }),
  ]);


  console.log(
      "Resultado B:",
      resultB.action,
      "takeover:",
      resultB.tookOverLease,
  );

  console.log(
      "Resultado C:",
      resultC.action,
      "takeover:",
      resultC.tookOverLease,
  );


  const results =
      [
        resultB,
        resultC,
      ];


  const resumed =
      results.filter(
          (result) =>
            result.action ===
            ACTIONS.RESUME &&
            result.wrote === true &&
            result.tookOverLease === true,
      );


  const skipped =
      results.filter(
          (result) =>
            result.action ===
            ACTIONS.SKIP_LEASED &&
            result.wrote === false,
      );


  assert.strictEqual(
      resumed.length,
      1,
  );


  assert.strictEqual(
      skipped.length,
      1,
  );


  assert.strictEqual(
      resumed[0].resumeStage,
      RESUME_STAGES.STORAGE_DELETE,
  );


  console.log(
      "âœ… exatamente 1 worker realizou TAKEOVER",
  );

  console.log(
      "âœ… exatamente 1 worker recebeu SKIP_LEASED",
  );


  // --------------------------------------------------------------------------
  // ESTADO FINAL
  // --------------------------------------------------------------------------

  const storeRef =
      db
          .collection(
              "storeBackups",
          )
          .doc(
              STORE_ID,
          );


  const operationRef =
      storeRef
          .collection(
              "retentionDeletes",
          )
          .doc(
              BACKUP_ID,
          );


  const snapshotRef =
      storeRef
          .collection(
              "snapshots",
          )
          .doc(
              BACKUP_ID,
          );


  const [
    operationDoc,
    snapshotDoc,
  ] = await Promise.all([
    operationRef.get(),
    snapshotRef.get(),
  ]);


  assert.strictEqual(
      operationDoc.exists,
      true,
  );


  assert.strictEqual(
      snapshotDoc.exists,
      true,
  );


  const operation =
      operationDoc.data();

  const snapshot =
      snapshotDoc.data();


  assert.strictEqual(
      operation.status,
      "claimed",
  );


  assert.strictEqual(
      operation.attemptCount,
      2,
  );


  assert.strictEqual(
      snapshot.status,
      "deleting",
  );


  assert.ok(
      [
        EXECUTION_B,
        EXECUTION_C,
      ].includes(
          operation.leaseOwner,
      ),
  );


  assert.strictEqual(
      operation.leaseOwner,
      resumed[0].leaseOwner,
  );


  assert.strictEqual(
      operation.leaseExpiresAt
          .toDate()
          .toISOString(),
      "2026-09-30T12:15:00.000Z",
  );


  console.log(
      `âœ… lease final pertence a ${operation.leaseOwner}`,
  );

  console.log(
      "âœ… attemptCount = 2",
  );

  console.log(
      "âœ… snapshot continua deleting",
  );


  // --------------------------------------------------------------------------
  // SOMENTE UMA OPERAÃ‡ÃƒO
  // --------------------------------------------------------------------------

  const operations =
      await storeRef
          .collection(
              "retentionDeletes",
          )
          .get();


  assert.strictEqual(
      operations.size,
      1,
  );


  console.log(
      "âœ… somente 1 retentionDelete existe",
  );


  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… TESTE DE CONCORRÃŠNCIA DO TAKEOVER PASSOU",
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