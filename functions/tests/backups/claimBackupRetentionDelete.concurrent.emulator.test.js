"use strict";


// ============================================================================
// STORE&CONNECT â€” TESTE DE CONCORRÃŠNCIA DO CLAIM
// ============================================================================
//
// F5.6-D3-E4
//
// Firestore Emulator:
//   127.0.0.1:8080
//
// Objetivo:
//
// duas execuÃ§Ãµes diferentes tentam criar o CLAIM
// do MESMO backup simultaneamente.
//
// Esperado:
//
// âœ… somente uma CREATE_CLAIM
// âœ… outra SKIP_LEASED
// âœ… uma Ãºnica operaÃ§Ã£o
// âœ… snapshot deleting
// âœ… nenhum delete()
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
  claimBackupRetentionDelete,
} = require(
    "../../backups/claimBackupRetentionDelete",
);

const {
  ACTIONS,
} = require(
    "../../backups/backupRetentionClaimPlanner",
);


// ============================================================================
// CONFIGURAÃ‡ÃƒO
// ============================================================================

const PROJECT_ID =
    "store-connect-app";

const STORE_ID =
    "emulator-retention-concurrency-test";

const EXECUTION_A =
    "execution-concurrency-A";

const EXECUTION_B =
    "execution-concurrency-B";

const VALID_CHECKSUM =
    "c".repeat(64);

const NOW =
    new Date(
        "2026-09-30T12:00:00.000Z",
    );

const TARGET_BACKUP_ID =
    "backup-2026-09-05-automatic-ready";


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


function timestampFor(
    date,
) {
  return admin.firestore
      .Timestamp
      .fromDate(
          new Date(
              `${date}T12:00:00.000Z`,
          ),
      );
}


function snapshotData(
    date,
) {
  const backupId =
      `backup-${date}-automatic-ready`;

  return {
    storeId:
      STORE_ID,

    type:
      "automatic",

    status:
      "ready",

    protected:
      false,

    createdAt:
      timestampFor(
          date,
      ),

    storagePath:
      storagePath(
          backupId,
      ),

    checksum:
      VALID_CHECKSUM,

    compressedBytes:
      123456,
  };
}


const DATES = [
  "2026-09-30",
  "2026-09-29",
  "2026-09-28",
  "2026-09-27",
  "2026-09-26",
  "2026-09-25",
  "2026-09-24",

  "2026-09-23",
  "2026-09-20",
  "2026-09-13",
  "2026-09-06",
  "2026-09-05",

  "2026-08-30",
  "2026-08-29",

  "2026-07-31",
  "2026-07-30",

  "2026-06-30",
  "2026-06-29",

  "2026-05-31",
  "2026-05-30",

  "2026-04-30",
  "2026-04-29",

  "2026-03-31",
  "2026-03-30",

  "2026-02-28",
];


// ============================================================================
// SEED
// ============================================================================

async function seed() {
  const snapshotsRef =
      db
          .collection(
              "storeBackups",
          )
          .doc(
              STORE_ID,
          )
          .collection(
              "snapshots",
          );


  const batch =
      db.batch();


  for (const date of DATES) {
    const backupId =
        `backup-${date}-automatic-ready`;

    batch.set(
        snapshotsRef.doc(
            backupId,
        ),
        snapshotData(
            date,
        ),
    );
  }


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
      "F5.6-D3-E4 â€” CONCORRÃŠNCIA NO FIRESTORE EMULATOR",
  );

  console.log(
      "============================================================",
  );


  await seed();

  console.log(
      "âœ… histÃ³rico criado",
  );


  // --------------------------------------------------------------------------
  // DISPARA DUAS TRANSACTIONS AO MESMO TEMPO
  // --------------------------------------------------------------------------

  const [
    resultA,
    resultB,
  ] = await Promise.all([
    claimBackupRetentionDelete({
      db,

      storeId:
        STORE_ID,

      backupId:
        TARGET_BACKUP_ID,

      executionId:
        EXECUTION_A,

      now:
        NOW,
    }),

    claimBackupRetentionDelete({
      db,

      storeId:
        STORE_ID,

      backupId:
        TARGET_BACKUP_ID,

      executionId:
        EXECUTION_B,

      now:
        NOW,
    }),
  ]);


  console.log(
      "Resultado A:",
      resultA.action,
  );

  console.log(
      "Resultado B:",
      resultB.action,
  );


  const results =
      [
        resultA,
        resultB,
      ];


  const createClaims =
      results.filter(
          (result) =>
            result.action ===
            ACTIONS.CREATE_CLAIM,
      );


  const skipped =
      results.filter(
          (result) =>
            result.action ===
            ACTIONS.SKIP_LEASED,
      );


  assert.strictEqual(
      createClaims.length,
      1,
  );


  assert.strictEqual(
      skipped.length,
      1,
  );


  console.log(
      "âœ… exatamente 1 CREATE_CLAIM",
  );

  console.log(
      "âœ… exatamente 1 SKIP_LEASED",
  );


  // --------------------------------------------------------------------------
  // CONFIRMA ESTADO FINAL
  // --------------------------------------------------------------------------

  const storeBackupsRef =
      db
          .collection(
              "storeBackups",
          )
          .doc(
              STORE_ID,
          );


  const operationRef =
      storeBackupsRef
          .collection(
              "retentionDeletes",
          )
          .doc(
              TARGET_BACKUP_ID,
          );


  const snapshotRef =
      storeBackupsRef
          .collection(
              "snapshots",
          )
          .doc(
              TARGET_BACKUP_ID,
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


  assert.strictEqual(
      operationDoc.data().status,
      "claimed",
  );


  assert.strictEqual(
      snapshotDoc.data().status,
      "deleting",
  );


  // --------------------------------------------------------------------------
  // SOMENTE UMA OPERAÃ‡ÃƒO
  // --------------------------------------------------------------------------

  const operationsSnapshot =
      await storeBackupsRef
          .collection(
              "retentionDeletes",
          )
          .get();


  assert.strictEqual(
      operationsSnapshot.size,
      1,
  );


  console.log(
      "âœ… somente 1 retentionDelete foi criado",
  );

  console.log(
      "âœ… snapshot permaneceu Ãºnico e deleting",
  );


  // --------------------------------------------------------------------------
  // FINAL
  // --------------------------------------------------------------------------

  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… TESTE DE CONCORRÃŠNCIA PASSOU",
  );

  console.log(
      "============================================================",
  );

  console.log("");

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