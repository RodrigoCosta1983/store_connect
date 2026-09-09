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
// F5.6-D3-G9.4
// EXECUÃ‡ÃƒO COMPLETA DE UMA LOJA â€” FIRESTORE + STORAGE EMULATOR
// ============================================================================
//
// Prova:
//
// âœ… retoma operaÃ§Ã£o claimed interrompida;
// âœ… takeover de lease expirado;
// âœ… conclui operaÃ§Ã£o retomada;
// âœ… relÃª snapshots depois da retomada;
// âœ… recalcula polÃ­tica;
// âœ… executa somente candidatos ALLOWED;
// âœ… respeita maxFreshDeletes;
// âœ… deixa excedentes deferred;
// âœ… dailyRuns permanece inalterado;
// âœ… nÃ£o toca produÃ§Ã£o;
// âœ… nÃ£o usa Scheduler.
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
    "emulator-g9-store-execution";

const WORKER_OLD =
    "worker-g9-store-old";

const WORKER_NEW =
    "worker-g9-store-new";

const TARGET_BACKUP_ID =
    "backup-g9-store-target";

const TOTAL_SNAPSHOTS =
    13;

const MAX_FRESH_DELETES =
    1;

const VALID_CHECKSUM =
    "a".repeat(64);

const OLD_NOW =
    new Date(
        "2026-09-30T11:30:00.000Z",
    );

const NOW =
    new Date(
        "2026-09-30T12:00:00.000Z",
    );

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
  if (
    index ===
      0
  ) {
    return TARGET_BACKUP_ID;
  }


  return (
    `backup-g9-store-${String(index)
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


// ============================================================================
// TESTE
// ============================================================================

async function run() {
  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "F5.6-D3-G9.4 â€” EXECUÃ‡ÃƒO COMPLETA DE UMA LOJA",
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


  const dailyRunRef =
      storeBackupsRef
          .collection(
              "dailyRuns",
          )
          .doc(
              DAILY_RUN_ID,
          );


  // ==========================================================================
  // 3. LIMPEZA
  // ==========================================================================

  const cleanup =
      [];


  for (
    let index = 0;
    index < TOTAL_SNAPSHOTS;
    index++
  ) {
    const backupId =
        getBackupId(
            index,
        );


    cleanup.push(
        snapshotsRef
            .doc(
                backupId,
            )
            .delete(),
    );


    cleanup.push(
        operationsRef
            .doc(
                backupId,
            )
            .delete(),
    );


    cleanup.push(
        db
            .collection(
                "stores",
            )
            .doc(
                STORE_ID,
            )
            .collection(
                "auditLogs",
            )
            .doc(
                getAuditId(
                    backupId,
                ),
            )
            .delete(),
    );


    cleanup.push(
        bucket
            .file(
                getStoragePath(
                    backupId,
                ),
            )
            .delete({
              ignoreNotFound:
                true,
            }),
    );
  }


  cleanup.push(
      dailyRunRef.delete(),
  );


  await Promise.all(
      cleanup,
  );


  // ==========================================================================
  // 4. CRIA 13 SNAPSHOTS READY + ARTEFATOS
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


    const file =
        bucket.file(
            getStoragePath(
                backupId,
            ),
        );


    await file.save(
        Buffer.from(
            `G9 STORE EXECUTION ${backupId}`,
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
  // 5. DAILY RUN SENTINELA
  // ==========================================================================

  const dailyRunFixture = {
    status:
      "completed",

    backupId:
      "backup-historico-nao-alterar",

    marker:
      "daily-run-must-remain-unchanged",

    success:
      true,
  };


  await dailyRunRef.set(
      dailyRunFixture,
  );


  // ==========================================================================
  // 6. CRIA OPERAÃ‡ÃƒO INTERROMPIDA
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


  const targetSnapshotBefore =
      await snapshotsRef
          .doc(
              TARGET_BACKUP_ID,
          )
          .get();


  const targetOperationBefore =
      await operationsRef
          .doc(
              TARGET_BACKUP_ID,
          )
          .get();


  assert.strictEqual(
      targetSnapshotBefore.data().status,
      "deleting",
  );


  assert.strictEqual(
      targetOperationBefore.data().status,
      "claimed",
  );


  assert.strictEqual(
      targetOperationBefore.data().leaseOwner,
      WORKER_OLD,
  );


  await assertStorageExists(
      bucket.file(
          getStoragePath(
              TARGET_BACKUP_ID,
          ),
      ),
  );


  console.log(
      "âœ… operaÃ§Ã£o interrompida preparada: claimed + lease antigo",
  );


  // ==========================================================================
  // 7. EXECUTA RETENÃ‡ÃƒO DA LOJA
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
          MAX_FRESH_DELETES,
      });


  // ==========================================================================
  // 8. PROVA RETOMADA
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
      result.resumedResults.length,
      1,
  );


  assert.strictEqual(
      result.resumedResults[0].backupId,
      TARGET_BACKUP_ID,
  );


  assert.strictEqual(
      result.resumedResults[0].classification,
      "completed",
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
      await db
          .collection(
              "stores",
          )
          .doc(
              STORE_ID,
          )
          .collection(
              "auditLogs",
          )
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
      targetOperationAfter.exists,
      true,
  );


  assert.strictEqual(
      targetOperationAfter.data().status,
      "completed",
  );


  assert.strictEqual(
      targetOperationAfter.data().leaseOwner,
      WORKER_NEW,
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
      "âœ… claimed interrompido foi retomado e concluÃ­do primeiro",
  );


  // ==========================================================================
  // 9. PROVA LIMITE DE NOVOS DELETES
  // ==========================================================================

  assert.strictEqual(
      result.freshSelected,
      1,
  );


  assert.strictEqual(
      result.freshCompleted,
      1,
  );


  assert.strictEqual(
      result.freshSkippedLeased,
      0,
  );


  assert.strictEqual(
      result.freshBlocked,
      0,
  );


  assert.strictEqual(
      result.freshResults.length,
      1,
  );


  assert(
      result.freshDeferred >
        0,
      (
        "EsperÃ¡vamos candidatos deferred " +
        "por causa de maxFreshDeletes=1."
      ),
  );


  const freshResult =
      result.freshResults[0];


  assert.strictEqual(
      freshResult.classification,
      "completed",
  );


  assert.notStrictEqual(
      freshResult.backupId,
      TARGET_BACKUP_ID,
  );


  const freshBackupId =
      freshResult.backupId;


  const freshSnapshotAfter =
      await snapshotsRef
          .doc(
              freshBackupId,
          )
          .get();


  const freshOperationAfter =
      await operationsRef
          .doc(
              freshBackupId,
          )
          .get();


  const freshAuditAfter =
      await db
          .collection(
              "stores",
          )
          .doc(
              STORE_ID,
          )
          .collection(
              "auditLogs",
          )
          .doc(
              getAuditId(
                  freshBackupId,
              ),
          )
          .get();


  assert.strictEqual(
      freshSnapshotAfter.exists,
      false,
  );


  assert.strictEqual(
      freshOperationAfter.exists,
      true,
  );


  assert.strictEqual(
      freshOperationAfter.data().status,
      "completed",
  );


  assert.strictEqual(
      freshAuditAfter.exists,
      true,
  );


  await assertStorageMissing(
      bucket.file(
          getStoragePath(
              freshBackupId,
          ),
      ),
  );


  console.log(
      `âœ… apenas 1 novo candidato foi executado: ${freshBackupId}`,
  );


  console.log(
      `âœ… ${result.freshDeferred} candidato(s) ficaram deferred`,
  );


  // ==========================================================================
  // 10. PROVA QUE UM DEFERRED CONTINUA INTACTO
  // ==========================================================================

  const deferred =
      result.deferredCandidates[0];


  assert(
      deferred,
      "Deveria existir ao menos um candidato deferred.",
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
      "âœ… candidato deferred permaneceu ready e com Storage intacto",
  );


  // ==========================================================================
  // 11. NENHUM ERRO
  // ==========================================================================

  assert.strictEqual(
      result.errorCount,
      0,
  );


  assert.deepStrictEqual(
      result.errors,
      [],
  );


  console.log(
      "âœ… execuÃ§Ã£o da loja terminou sem erros",
  );


  // ==========================================================================
  // 12. DAILY RUN INTACTO
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
  // 13. CONTAGEM FINAL
  // ==========================================================================

  const snapshotsAfter =
      await snapshotsRef.get();


  assert.strictEqual(
      snapshotsAfter.size,
      TOTAL_SNAPSHOTS - 2,
  );


  console.log(
      (
        `âœ… snapshots finais: ${snapshotsAfter.size} ` +
        `(13 iniciais - 1 retomado - 1 fresh)`
      ),
  );


  // ==========================================================================
  // FINAL
  // ==========================================================================

  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… EXECUÃ‡ÃƒO COMPLETA DE UMA LOJA PASSOU",
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