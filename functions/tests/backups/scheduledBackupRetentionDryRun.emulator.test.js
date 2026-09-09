"use strict";


const assert =
    require("assert");

const admin =
    require("firebase-admin");


// ============================================================================
// F5.6-D3-G9.5-F
// SCHEDULER REAL â€” DRY RUN NOS EMULATORS
// ============================================================================
//
// PROVA:
//
// âœ… handler real do onSchedule;
// âœ… existe uma loja real no Firestore Emulator;
// âœ… existem candidatos reais de retenÃ§Ã£o;
// âœ… RETENTION_EXECUTION_ENABLED=false impede execuÃ§Ã£o destrutiva;
// âœ… snapshots ficam idÃªnticos;
// âœ… retentionDeletes continua vazio;
// âœ… auditoria de exclusÃ£o nÃ£o Ã© criada;
// âœ… Storage permanece intacto;
// âœ… dailyRuns permanece intacto.
//
// ============================================================================


// ============================================================================
// CONFIGURAÃ‡ÃƒO
// ============================================================================

const EXPECTED_FIRESTORE_HOST =
    "127.0.0.1:8080";

const EXPECTED_STORAGE_HOST =
    "127.0.0.1:9199";

const PROJECT_ID =
    "store-connect-app";

const BUCKET_NAME =
    "store-connect-app.firebasestorage.app";

const STORE_ID =
    "emulator-g9-scheduler-dryrun";

const TOTAL_SNAPSHOTS =
    12;

const TARGET_BACKUP_ID =
    "backup-g9-scheduler-00";

const VALID_CHECKSUM =
    "a".repeat(64);

const DAILY_RUN_ID =
    "2026-01-05";


// ============================================================================
// SEGURANÃ‡A
// ============================================================================

function assertEmulatorEnvironment() {
  const firestoreHost =
      String(
          process.env
              .FIRESTORE_EMULATOR_HOST ||
          "",
      ).trim();

  const storageHost =
      String(
          process.env
              .FIREBASE_STORAGE_EMULATOR_HOST ||
          "",
      ).trim();


  if (
    firestoreHost !==
      EXPECTED_FIRESTORE_HOST
  ) {
    throw new Error(
        (
          "SEGURANÃ‡A: FIRESTORE_EMULATOR_HOST deve ser " +
          `${EXPECTED_FIRESTORE_HOST}. Atual: "${firestoreHost}".`
        ),
    );
  }


  if (
    storageHost !==
      EXPECTED_STORAGE_HOST
  ) {
    throw new Error(
        (
          "SEGURANÃ‡A: FIREBASE_STORAGE_EMULATOR_HOST deve ser " +
          `${EXPECTED_STORAGE_HOST}. Atual: "${storageHost}".`
        ),
    );
  }
}


// ============================================================================
// FIREBASE
// ============================================================================

function initializeFirebase() {
  if (
    admin.apps.length ===
      0
  ) {
    admin.initializeApp({
      projectId:
        PROJECT_ID,

      storageBucket:
        BUCKET_NAME,
    });
  }


  return {
    db:
      admin.firestore(),

    bucket:
      admin
          .storage()
          .bucket(
              BUCKET_NAME,
          ),
  };
}


// ============================================================================
// HELPERS
// ============================================================================

function timestamp(
    value,
) {
  return admin.firestore
      .Timestamp
      .fromDate(
          new Date(
              value,
          ),
      );
}


function getBackupId(
    index,
) {
  return (
    `backup-g9-scheduler-${String(index)
        .padStart(2, "0")}`
  );
}


function getStoragePath(
    backupId,
) {
  return (
    `store_backups/` +
    `${STORE_ID}/` +
    `${backupId}/` +
    `snapshot.json.gz`
  );
}


function getAuditId(
    backupId,
) {
  return (
    `backup-retention-delete-${backupId}`
  );
}


function getCreatedAt(
    index,
) {
  return timestamp(
      (
        "2026-01-05T12:" +
        `${String(index).padStart(2, "0")}:00.000Z`
      ),
  );
}


function createReadySnapshot({
  backupId,
  index,
}) {
  return {
    storeId:
      STORE_ID,

    type:
      "automatic",

    status:
      "ready",

    createdAt:
      getCreatedAt(
          index,
      ),

    createdBy:
      "system",

    createdByRole:
      "system",

    reason:
      "Backup automÃ¡tico diÃ¡rio",

    snapshotVersion:
      1,

    storagePath:
      getStoragePath(
          backupId,
      ),

    counts: {
      products:
        1,

      customers:
        0,

      categories:
        1,

      sales:
        0,

      cashFlow:
        0,
    },

    originalSizeBytes:
      1000,

    compressedSizeBytes:
      500,

    checksumSha256:
      VALID_CHECKSUM,
  };
}


async function deleteCollectionDocs(
    collectionRef,
) {
  const snapshot =
      await collectionRef.get();


  if (snapshot.empty) {
    return;
  }


  const batch =
      collectionRef.firestore
          .batch();


  for (
    const doc
    of snapshot.docs
  ) {
    batch.delete(
        doc.ref,
    );
  }


  await batch.commit();
}


function normalizeValue(
    value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }


  if (
    typeof value.toMillis ===
      "function"
  ) {
    return {
      __timestampMillis:
        value.toMillis(),
    };
  }


  if (
    Array.isArray(
        value,
    )
  ) {
    return value.map(
        normalizeValue,
    );
  }


  if (
    typeof value ===
      "object"
  ) {
    const result =
        {};


    for (
      const key
      of Object.keys(
          value,
      ).sort()
    ) {
      result[key] =
          normalizeValue(
              value[key],
          );
    }


    return result;
  }


  return value;
}


function snapshotFingerprint(
    querySnapshot,
) {
  return querySnapshot.docs
      .map(
          (doc) => ({
            id:
              doc.id,

            data:
              normalizeValue(
                  doc.data(),
              ),
          }),
      )
      .sort(
          (a, b) =>
            a.id.localeCompare(
                b.id,
            ),
      );
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
      "F5.6-D3-G9.5-F â€” SCHEDULER REAL EM DRY RUN",
  );

  console.log(
      "============================================================",
  );


  // ==========================================================================
  // 1. TRAVAS
  // ==========================================================================

  assertEmulatorEnvironment();


  console.log(
      "âœ… travas confirmaram Firestore + Storage Emulator",
  );


  const {
    db,
    bucket,
  } =
      initializeFirebase();


  // ==========================================================================
  // 2. REFERÃŠNCIAS
  // ==========================================================================

  const storeRef =
      db
          .collection(
              "stores",
          )
          .doc(
              STORE_ID,
          );


  const storeBackupsRef =
      db
          .collection(
              "storeBackups",
          )
          .doc(
              STORE_ID,
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


  const dailyRunsRef =
      storeBackupsRef
          .collection(
              "dailyRuns",
          );


  const dailyRunRef =
      dailyRunsRef.doc(
          DAILY_RUN_ID,
      );


  const auditLogsRef =
      storeRef.collection(
          "auditLogs",
      );


  const targetFile =
      bucket.file(
          getStoragePath(
              TARGET_BACKUP_ID,
          ),
      );


  // ==========================================================================
  // 3. LIMPEZA DO CENÃRIO
  // ==========================================================================

  await Promise.all([
    deleteCollectionDocs(
        snapshotsRef,
    ),

    deleteCollectionDocs(
        operationsRef,
    ),

    deleteCollectionDocs(
        dailyRunsRef,
    ),

    deleteCollectionDocs(
        auditLogsRef,
    ),

    targetFile.delete({
      ignoreNotFound:
        true,
    }),
  ]);


  await storeRef.delete();


  // ==========================================================================
  // 4. CRIA A LOJA
  // ==========================================================================

  await storeRef.set({
    name:
      "G9 Scheduler Dry Run Emulator",

    marker:
      "g9-scheduler-dry-run",
  });


  console.log(
      "âœ… loja de teste criada no Firestore Emulator",
  );


  // ==========================================================================
  // 5. CRIA 12 SNAPSHOTS READY
  // ==========================================================================

  for (
    let index = 0;
    index < TOTAL_SNAPSHOTS;
    index++
  ) {
    const backupId =
        getBackupId(
            index,
        );


    await snapshotsRef
        .doc(
            backupId,
        )
        .set(
            createReadySnapshot({
              backupId,
              index,
            }),
        );
  }


  console.log(
      `âœ… ${TOTAL_SNAPSHOTS} snapshots automÃ¡ticos ready criados`,
  );


  // ==========================================================================
  // 6. STORAGE SENTINELA
  // ==========================================================================

  await targetFile.save(
      Buffer.from(
          "G9 SCHEDULER DRY RUN SENTINEL",
          "utf8",
      ),
      {
        resumable:
          false,

        metadata: {
          contentType:
            "application/gzip",

          metadata: {
            storeId:
              STORE_ID,

            backupId:
              TARGET_BACKUP_ID,

            snapshotVersion:
              "1",

            checksumSha256:
              VALID_CHECKSUM,
          },
        },
      },
  );


  const [
    targetMetadataBefore,
  ] =
      await targetFile
          .getMetadata();


  const generationBefore =
      targetMetadataBefore
          .generation;


  assert(
      typeof generationBefore ===
        "string",
  );


  console.log(
      "âœ… artefato sentinela criado no Storage Emulator",
  );


  // ==========================================================================
  // 7. DAILY RUN SENTINELA
  // ==========================================================================

  const dailyRunFixture = {
    status:
      "completed",

    backupId:
      "backup-nao-alterar",

    marker:
      "daily-run-must-remain-unchanged",

    success:
      true,
  };


  await dailyRunRef.set(
      dailyRunFixture,
  );


  // ==========================================================================
  // 8. ESTADO ANTES
  // ==========================================================================

  const snapshotsBefore =
      await snapshotsRef.get();


  const fingerprintBefore =
      snapshotFingerprint(
          snapshotsBefore,
      );


  assert.strictEqual(
      snapshotsBefore.size,
      TOTAL_SNAPSHOTS,
  );


  // ==========================================================================
  // 9. EXECUTA O HANDLER REAL DO SCHEDULER
  // ==========================================================================

  const {
    scheduledBackupRetention,
  } = require(
      "../../backups/scheduledBackupRetention",
  );


  await scheduledBackupRetention
      .run({});


  console.log(
      "âœ… handler real do Scheduler finalizou",
  );


  // ==========================================================================
  // 10. SNAPSHOTS DEVEM ESTAR ABSOLUTAMENTE IGUAIS
  // ==========================================================================

  const snapshotsAfter =
      await snapshotsRef.get();


  const fingerprintAfter =
      snapshotFingerprint(
          snapshotsAfter,
      );


  assert.deepStrictEqual(
      fingerprintAfter,
      fingerprintBefore,
  );


  assert.strictEqual(
      snapshotsAfter.size,
      TOTAL_SNAPSHOTS,
  );


  for (
    const doc
    of snapshotsAfter.docs
  ) {
    const data =
        doc.data();


    assert.strictEqual(
        data.status,
        "ready",
    );


    assert.strictEqual(
        data.retentionDeleteOperationId,
        undefined,
    );
  }


  console.log(
      "âœ… snapshots permaneceram absolutamente inalterados",
  );


  // ==========================================================================
  // 11. NENHUMA OPERAÃ‡ÃƒO DE DELETE
  // ==========================================================================

  const operationsAfter =
      await operationsRef.get();


  assert.strictEqual(
      operationsAfter.size,
      0,
  );


  console.log(
      "âœ… nenhuma retentionDelete foi criada",
  );


  // ==========================================================================
  // 12. NENHUMA AUDITORIA DE EXCLUSÃƒO
  // ==========================================================================

  for (
    let index = 0;
    index < TOTAL_SNAPSHOTS;
    index++
  ) {
    const backupId =
        getBackupId(
            index,
        );


    const auditDoc =
        await auditLogsRef
            .doc(
                getAuditId(
                    backupId,
                ),
            )
            .get();


    assert.strictEqual(
        auditDoc.exists,
        false,
    );
  }


  console.log(
      "âœ… nenhuma auditoria de exclusÃ£o foi criada",
  );


  // ==========================================================================
  // 13. STORAGE DEVE CONTINUAR EXATAMENTE O MESMO
  // ==========================================================================

  const [
    targetMetadataAfter,
  ] =
      await targetFile
          .getMetadata();


  assert.strictEqual(
      targetMetadataAfter
          .generation,
      generationBefore,
  );


  assert.strictEqual(
      targetMetadataAfter
          .metadata
          .storeId,
      STORE_ID,
  );


  assert.strictEqual(
      targetMetadataAfter
          .metadata
          .backupId,
      TARGET_BACKUP_ID,
  );


  assert.strictEqual(
      targetMetadataAfter
          .metadata
          .checksumSha256,
      VALID_CHECKSUM,
  );


  console.log(
      "âœ… Storage permaneceu absolutamente intacto",
  );


  // ==========================================================================
  // 14. DAILY RUN DEVE CONTINUAR IGUAL
  // ==========================================================================

  const dailyRunAfter =
      await dailyRunRef.get();


  assert.strictEqual(
      dailyRunAfter.exists,
      true,
  );


  assert.deepStrictEqual(
      dailyRunAfter.data(),
      dailyRunFixture,
  );


  console.log(
      "âœ… dailyRuns permaneceu absolutamente inalterado",
  );


  // ==========================================================================
  // 15. CONFIRMA LOJA
  // ==========================================================================

  const storeAfter =
      await storeRef.get();


  assert.strictEqual(
      storeAfter.exists,
      true,
  );


  assert.strictEqual(
      storeAfter.data().marker,
      "g9-scheduler-dry-run",
  );


  console.log(
      "âœ… loja permaneceu intacta",
  );


  // ==========================================================================
  // FINAL
  // ==========================================================================

  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… SCHEDULER REAL EM DRY RUN PASSOU",
  );

  console.log(
      "============================================================",
  );

  console.log("");
}


// ============================================================================
// EXECUÃ‡ÃƒO
// ============================================================================

run().catch(
    (error) => {
      console.error(
          "âŒ TESTE FALHOU:",
          error,
      );

      process.exitCode =
          1;
    },
);