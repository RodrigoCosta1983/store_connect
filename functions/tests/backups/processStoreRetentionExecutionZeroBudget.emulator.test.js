"use strict";


const assert =
    require("assert");

const admin =
    require("firebase-admin");

const {
  processStoreRetentionExecution,
} = require(
    "../../backups/processStoreRetentionExecution",
);

const {
  claimBackupRetentionDelete,
} = require(
    "../../backups/claimBackupRetentionDelete",
);

const {
  ACTIONS:
    CLAIM_ACTIONS,
} = require(
    "../../backups/backupRetentionClaimPlanner",
);

const {
  getAuditId,
} = require(
    "../../backups/backupRetentionFinalizePlanner",
);


// ============================================================================
// F5.6-D3-G9.6-D4
// ZERO FRESH BUDGET â€” FIRESTORE + STORAGE EMULATOR
// ============================================================================
//
// Prova:
//
// âœ… uma operaÃ§Ã£o claimed existente pode ser retomada;
// âœ… takeover de lease expirado;
// âœ… operaÃ§Ã£o retomada chega a completed;
// âœ… maxFreshDeletes=0 inicia ZERO novas exclusÃµes;
// âœ… candidatos fresh continuam deferred;
// âœ… snapshots fresh continuam ready;
// âœ… Storage fresh continua intacto;
// âœ… nenhuma segunda retentionDelete;
// âœ… dailyRuns continua intacto.
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
    "emulator-g9-zero-budget";

const TOTAL_SNAPSHOTS =
    13;

const TARGET_BACKUP_ID =
    "backup-g9-zero-target";

const WORKER_OLD =
    "worker-g9-zero-old";

const WORKER_NEW =
    "worker-g9-zero-new";

const VALID_CHECKSUM =
    "a".repeat(64);

const DAILY_RUN_ID =
    "2026-01-05";

const OLD_NOW =
    new Date(
        "2026-09-30T11:30:00.000Z",
    );

const NOW =
    new Date(
        "2026-09-30T12:00:00.000Z",
    );


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
  if (
    index ===
      0
  ) {
    return TARGET_BACKUP_ID;
  }


  return (
    `backup-g9-zero-${String(index)
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


function isNotFoundError(
    error,
) {
  const code =
      String(
          error?.code ??
          "",
      ).toLowerCase();

  const message =
      String(
          error?.message ??
          "",
      ).toLowerCase();


  return (
    code === "404" ||
    code === "not-found" ||
    code === "storage/object-not-found" ||
    message.includes(
        "not found",
    )
  );
}


async function assertStorageMissing(
    file,
) {
  try {
    await file.getMetadata();
  } catch (error) {
    if (
      isNotFoundError(
          error,
      )
    ) {
      return;
    }

    throw error;
  }


  throw new Error(
      "O artefato deveria estar ausente.",
  );
}


async function assertStorageExists(
    file,
) {
  const [
    metadata,
  ] =
      await file.getMetadata();


  assert(
      metadata &&
      typeof metadata.generation ===
        "string",
  );
}


async function deleteCollectionDocs(
    collectionRef,
) {
  const snapshot =
      await collectionRef.get();


  if (
    snapshot.empty
  ) {
    return;
  }


  const batch =
      collectionRef
          .firestore
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


// ============================================================================
// TESTE
// ============================================================================

async function run() {
  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "F5.6-D3-G9.6-D4 â€” ZERO FRESH BUDGET",
  );

  console.log(
      "============================================================",
  );


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
  // REFERÃŠNCIAS
  // ==========================================================================

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
      dailyRunsRef
          .doc(
              DAILY_RUN_ID,
          );


  const auditLogsRef =
      db
          .collection(
              "stores",
          )
          .doc(
              STORE_ID,
          )
          .collection(
              "auditLogs",
          );


  // ==========================================================================
  // LIMPEZA
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
  ]);


  for (
    let index = 0;
    index < TOTAL_SNAPSHOTS;
    index++
  ) {
    const backupId =
        getBackupId(
            index,
        );


    await bucket
        .file(
            getStoragePath(
                backupId,
            ),
        )
        .delete({
          ignoreNotFound:
            true,
        });
  }


  // ==========================================================================
  // CRIA SNAPSHOTS + STORAGE
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


    await bucket
        .file(
            getStoragePath(
                backupId,
            ),
        )
        .save(
            Buffer.from(
                `G9 ZERO BUDGET ${backupId}`,
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

                  backupId,

                  snapshotVersion:
                    "1",

                  checksumSha256:
                    VALID_CHECKSUM,
                },
              },
            },
        );
  }


  console.log(
      `âœ… ${TOTAL_SNAPSHOTS} snapshots ready + artefatos criados`,
  );


  // ==========================================================================
  // DAILY RUN SENTINELA
  // ==========================================================================

  const dailyRunFixture = {
    status:
      "completed",

    backupId:
      "backup-nao-alterar",

    marker:
      "zero-budget-daily-run",

    success:
      true,
  };


  await dailyRunRef.set(
      dailyRunFixture,
  );


  // ==========================================================================
  // CRIA CLAIM INTERROMPIDO
  // ==========================================================================

  const initialClaim =
      await claimBackupRetentionDelete({
        db,

        storeId:
          STORE_ID,

        backupId:
          TARGET_BACKUP_ID,

        executionId:
          WORKER_OLD,

        now:
          OLD_NOW,
      });


  assert.strictEqual(
      initialClaim.action,
      CLAIM_ACTIONS.CREATE_CLAIM,
  );


  const operationBefore =
      await operationsRef
          .doc(
              TARGET_BACKUP_ID,
          )
          .get();


  assert.strictEqual(
      operationBefore.data().status,
      "claimed",
  );


  console.log(
      "âœ… operaÃ§Ã£o claimed interrompida preparada",
  );


  // ==========================================================================
  // EXECUTA COM ZERO FRESH BUDGET
  // ==========================================================================

  const result =
      await processStoreRetentionExecution({
        db,

        bucket,

        storeId:
          STORE_ID,

        executionId:
          WORKER_NEW,

        now:
          NOW,

        maxFreshDeletes:
          0,
      });


  // ==========================================================================
  // RETOMADA PRECISA FUNCIONAR
  // ==========================================================================

  assert.strictEqual(
      result.activeOperations,
      1,
  );


  assert.strictEqual(
      result.resumedCompleted,
      1,
  );


  assert.strictEqual(
      result.resumedSkippedLeased,
      0,
  );


  assert.strictEqual(
      result.resumedBlocked,
      0,
  );


  assert.strictEqual(
      result.errorCount,
      0,
  );


  const targetSnapshotAfter =
      await snapshotsRef
          .doc(
              TARGET_BACKUP_ID,
          )
          .get();


  const targetOperationAfter =
      await operationsRef
          .doc(
              TARGET_BACKUP_ID,
          )
          .get();


  const targetAuditAfter =
      await auditLogsRef
          .doc(
              getAuditId(
                  TARGET_BACKUP_ID,
              ),
          )
          .get();


  assert.strictEqual(
      targetSnapshotAfter.exists,
      false,
  );


  assert.strictEqual(
      targetOperationAfter.data().status,
      "completed",
  );


  assert.strictEqual(
      targetAuditAfter.exists,
      true,
  );


  await assertStorageMissing(
      bucket.file(
          getStoragePath(
              TARGET_BACKUP_ID,
          ),
      ),
  );


  console.log(
      "âœ… operaÃ§Ã£o antiga foi retomada e concluÃ­da",
  );


  // ==========================================================================
  // ZERO NOVOS DELETES
  // ==========================================================================

  assert.strictEqual(
      result.freshSelected,
      0,
  );


  assert.strictEqual(
      result.freshCompleted,
      0,
  );


  assert.strictEqual(
      result.freshResults.length,
      0,
  );


  assert(
      result.freshDeferred >
        0,
      "Deveriam existir candidatos fresh deferred.",
  );


  console.log(
      "âœ… maxFreshDeletes=0 iniciou ZERO novos deletes",
  );


  // ==========================================================================
  // NENHUMA SEGUNDA OPERAÃ‡ÃƒO
  // ==========================================================================

  const operationsAfter =
      await operationsRef.get();


  assert.strictEqual(
      operationsAfter.size,
      1,
  );


  assert.strictEqual(
      operationsAfter.docs[0].id,
      TARGET_BACKUP_ID,
  );


  console.log(
      "âœ… existe somente a operaÃ§Ã£o retomada",
  );


  // ==========================================================================
  // DEFERRED CONTINUA READY + STORAGE INTACTO
  // ==========================================================================

  const deferred =
      result.deferredCandidates[0];


  assert(
      deferred,
      "EsperÃ¡vamos ao menos um candidato deferred.",
  );


  const deferredSnapshot =
      await snapshotsRef
          .doc(
              deferred.backupId,
          )
          .get();


  const deferredOperation =
      await operationsRef
          .doc(
              deferred.backupId,
          )
          .get();


  assert.strictEqual(
      deferredSnapshot.exists,
      true,
  );


  assert.strictEqual(
      deferredSnapshot.data().status,
      "ready",
  );


  assert.strictEqual(
      deferredSnapshot.data().retentionDeleteOperationId,
      undefined,
  );


  assert.strictEqual(
      deferredOperation.exists,
      false,
  );


  await assertStorageExists(
      bucket.file(
          getStoragePath(
              deferred.backupId,
          ),
      ),
  );


  console.log(
      "âœ… candidato deferred permaneceu ready + Storage intacto",
  );


  // ==========================================================================
  // DAILY RUN
  // ==========================================================================

  const dailyRunAfter =
      await dailyRunRef.get();


  assert.deepStrictEqual(
      dailyRunAfter.data(),
      dailyRunFixture,
  );


  console.log(
      "âœ… dailyRuns permaneceu absolutamente inalterado",
  );


  // ==========================================================================
  // CONTAGEM FINAL
  // ==========================================================================

  const snapshotsAfter =
      await snapshotsRef.get();


  assert.strictEqual(
      snapshotsAfter.size,
      TOTAL_SNAPSHOTS - 1,
  );


  console.log(
      (
        `âœ… snapshots finais: ${snapshotsAfter.size} ` +
        "(somente o resumed foi removido)"
      ),
  );


  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… ZERO FRESH BUDGET PASSOU",
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