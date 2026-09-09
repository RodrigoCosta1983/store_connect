"use strict";


// ============================================================================
// STORE&CONNECT â€” TESTE DE INTEGRAÃ‡ÃƒO DO CLAIM NO FIRESTORE EMULATOR
// ============================================================================
//
// F5.6-D3-E3
//
// IMPORTANTE:
//
// Este teste aponta EXCLUSIVAMENTE para:
//
//   127.0.0.1:8080
//
// âŒ nÃ£o usa Firestore de produÃ§Ã£o
// âŒ nÃ£o usa Storage
// âŒ nÃ£o possui delete()
// âŒ nÃ£o exige deploy
//
// ============================================================================


// ============================================================================
// EMULATOR â€” PRECISA SER DEFINIDO ANTES DE CRIAR O FIRESTORE
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
    "emulator-retention-claim-test";

const EXECUTION_ID =
    "emulator-execution-001";

const VALID_CHECKSUM =
    "a".repeat(64);

const NOW =
    new Date(
        "2026-09-30T12:00:00.000Z",
    );

const TARGET_BACKUP_ID =
    "backup-2026-09-05-automatic-ready";


// ============================================================================
// ADMIN SDK
// ============================================================================

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


function toTimestamp(
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


function createSnapshotData(
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
      toTimestamp(
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

async function seedSnapshots() {
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
        createSnapshotData(
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
      "F5.6-D3-E3 â€” FIRESTORE EMULATOR",
  );

  console.log(
      "============================================================",
  );

  console.log(
      `Emulator: ${process.env.FIRESTORE_EMULATOR_HOST}`,
  );

  console.log(
      `Store de teste: ${STORE_ID}`,
  );


  // --------------------------------------------------------------------------
  // 1. CRIA HISTÃ“RICO DE TESTE NO EMULATOR
  // --------------------------------------------------------------------------

  await seedSnapshots();

  console.log(
      `âœ… ${DATES.length} snapshots criados no Emulator`,
  );


  const storeBackupsRef =
      db
          .collection(
              "storeBackups",
          )
          .doc(
              STORE_ID,
          );

  const snapshotRef =
      storeBackupsRef
          .collection(
              "snapshots",
          )
          .doc(
              TARGET_BACKUP_ID,
          );

  const operationRef =
      storeBackupsRef
          .collection(
              "retentionDeletes",
          )
          .doc(
              TARGET_BACKUP_ID,
          );


  // --------------------------------------------------------------------------
  // 2. CONFIRMA ESTADO INICIAL
  // --------------------------------------------------------------------------

  const beforeSnapshot =
      await snapshotRef.get();

  const beforeOperation =
      await operationRef.get();


  assert.strictEqual(
      beforeSnapshot.exists,
      true,
  );

  assert.strictEqual(
      beforeSnapshot.data().status,
      "ready",
  );

  assert.strictEqual(
      beforeOperation.exists,
      false,
  );


  console.log(
      "âœ… estado inicial: snapshot=ready / operation inexistente",
  );


  // --------------------------------------------------------------------------
  // 3. EXECUTA A TRANSACTION REAL NO FIRESTORE EMULATOR
  // --------------------------------------------------------------------------

  const firstResult =
      await claimBackupRetentionDelete({
        db,

        storeId:
          STORE_ID,

        backupId:
          TARGET_BACKUP_ID,

        executionId:
          EXECUTION_ID,

        now:
          NOW,
      });


  assert.strictEqual(
      firstResult.action,
      ACTIONS.CREATE_CLAIM,
  );

  assert.strictEqual(
      firstResult.allowed,
      true,
  );

  assert.strictEqual(
      firstResult.wrote,
      true,
  );


  console.log(
      "âœ… transaction retornou CREATE_CLAIM",
  );


  // --------------------------------------------------------------------------
  // 4. CONFIRMA OPERAÃ‡ÃƒO CLAIMED
  // --------------------------------------------------------------------------

  const operationAfter =
      await operationRef.get();


  assert.strictEqual(
      operationAfter.exists,
      true,
  );


  const operation =
      operationAfter.data();


  assert.strictEqual(
      operation.status,
      "claimed",
  );

  assert.strictEqual(
      operation.storeId,
      STORE_ID,
  );

  assert.strictEqual(
      operation.backupId,
      TARGET_BACKUP_ID,
  );

  assert.strictEqual(
      operation.reason,
      "retention_policy",
  );

  assert.strictEqual(
      operation.leaseOwner,
      EXECUTION_ID,
  );

  assert.strictEqual(
      operation.snapshot.type,
      "automatic",
  );

  assert.strictEqual(
      operation.snapshot.originalStatus,
      "ready",
  );

  assert.strictEqual(
      operation.snapshot.storagePath,
      storagePath(
          TARGET_BACKUP_ID,
      ),
  );

  assert.strictEqual(
      operation.snapshot.checksum,
      VALID_CHECKSUM,
  );


  console.log(
      "âœ… retentionDeletes criado com status=claimed",
  );


  // --------------------------------------------------------------------------
  // 5. CONFIRMA SNAPSHOT ready â†’ deleting
  // --------------------------------------------------------------------------

  const snapshotAfter =
      await snapshotRef.get();


  assert.strictEqual(
      snapshotAfter.exists,
      true,
  );


  const snapshot =
      snapshotAfter.data();


  assert.strictEqual(
      snapshot.status,
      "deleting",
  );

  assert.strictEqual(
      snapshot.retentionDeleteOperationId,
      TARGET_BACKUP_ID,
  );

  assert.strictEqual(
      snapshot.retentionDeleteReason,
      "retention_policy",
  );


  console.log(
      "âœ… snapshot passou atomicamente de ready â†’ deleting",
  );


  // --------------------------------------------------------------------------
  // 6. CONFIRMA QUE NADA FOI EXCLUÃDO
  // --------------------------------------------------------------------------

  const snapshotsAfter =
      await storeBackupsRef
          .collection(
              "snapshots",
          )
          .get();


  assert.strictEqual(
      snapshotsAfter.size,
      DATES.length,
  );


  console.log(
      "âœ… nenhum snapshot foi excluÃ­do",
  );


  // --------------------------------------------------------------------------
  // 7. SEGUNDA EXECUÃ‡ÃƒO â€” IDEMPOTÃŠNCIA
  // --------------------------------------------------------------------------

  const secondResult =
      await claimBackupRetentionDelete({
        db,

        storeId:
          STORE_ID,

        backupId:
          TARGET_BACKUP_ID,

        executionId:
          EXECUTION_ID,

        now:
          new Date(
              "2026-09-30T12:01:00.000Z",
          ),
      });


  assert.strictEqual(
      secondResult.action,
      ACTIONS.RESUME,
  );

  assert.strictEqual(
      secondResult.resumeStage,
      RESUME_STAGES.STORAGE_DELETE,
  );

  assert.strictEqual(
      secondResult.wrote,
      false,
  );


  console.log(
      "âœ… segunda execuÃ§Ã£o â†’ RESUME + zero writes",
  );


  // --------------------------------------------------------------------------
  // FINAL
  // --------------------------------------------------------------------------

  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… TESTE REAL DA TRANSACTION NO EMULATOR PASSOU",
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
            // ignora apenas encerramento do app de teste
          }

          process.exitCode =
              1;
        },
    );