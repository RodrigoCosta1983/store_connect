"use strict";


const assert =
    require("assert");

const admin =
    require("firebase-admin");


// ============================================================================
// F5.6-D3-G9.6-C
// SCHEDULER REAL â€” EXECUÃ‡ÃƒO CONTROLADA NOS EMULATORS
// ============================================================================
//
// PROVA:
//
// âœ… handler real do onSchedule;
// âœ… porta de produÃ§Ã£o continua desativada;
// âœ… execuÃ§Ã£o destrutiva sÃ³ Ã© habilitada pela porta do Emulator;
// âœ… storeId precisa estar explicitamente autorizado;
// âœ… existem candidatos reais de retenÃ§Ã£o;
// âœ… somente 1 fresh delete Ã© executado;
// âœ… Storage Ã© removido fisicamente;
// âœ… snapshot metadata Ã© removida;
// âœ… retentionDelete termina completed;
// âœ… auditoria determinÃ­stica Ã© criada;
// âœ… demais snapshots permanecem ready;
// âœ… demais artefatos permanecem intactos;
// âœ… dailyRuns permanece absolutamente inalterado.
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
    "emulator-g9-scheduler-execution";

const TOTAL_SNAPSHOTS =
    12;

const TARGET_BACKUP_ID =
    "backup-g9-execution-00";

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
    `backup-g9-execution-${String(index)
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
      "F5.6-D3-G9.6-C â€” SCHEDULER EM EXECUÃ‡ÃƒO CONTROLADA",
  );

  console.log(
      "============================================================",
  );


  // ==========================================================================
  // 1. TRAVAS DOS EMULATORS
  // ==========================================================================

  assertEmulatorEnvironment();


  console.log(
      "âœ… travas confirmaram Firestore + Storage Emulator",
  );


  // ==========================================================================
  // 2. HABILITA SOMENTE A PORTA DE TESTE
  // ==========================================================================
  //
  // IMPORTANTE:
  //
  // Estas variÃ¡veis precisam existir ANTES do require do Scheduler,
  // porque as constantes de rollout sÃ£o avaliadas no carregamento do mÃ³dulo.
  //
  // ==========================================================================

  process.env
      .RETENTION_EMULATOR_EXECUTION_ENABLED =
        "true";


  process.env
      .RETENTION_EMULATOR_EXECUTION_STORE_IDS =
        STORE_ID;


  console.log(
      "âœ… porta exclusiva do Emulator habilitada para uma Ãºnica loja",
  );


  const {
    db,
    bucket,
  } =
      initializeFirebase();


  // ==========================================================================
  // 3. REFERÃŠNCIAS
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

  const scheduleRunsRef =
      storeBackupsRef
          .collection(
              "retentionScheduleRuns",
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

          const SCHEDULE_EVENT = {
            jobName:
              "firebase-schedule-scheduledBackupRetention-us-central1",

            scheduleTime:
              "2026-09-09T07:00:00.000Z",
          };


  const auditLogsRef =
      storeRef
          .collection(
              "auditLogs",
          );


  // ==========================================================================
  // 4. LIMPEZA DO CENÃRIO
  // ==========================================================================

  await Promise.all([
    deleteCollectionDocs(
        snapshotsRef,
    ),

    deleteCollectionDocs(
        operationsRef,
    ),

    deleteCollectionDocs(
        scheduleRunsRef,
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


  await storeRef.delete();


  // ==========================================================================
  // 5. CRIA LOJA
  // ==========================================================================

  await storeRef.set({
    name:
      "G9 Scheduler Execution Emulator",

    marker:
      "g9-scheduler-controlled-execution",
  });


  console.log(
      "âœ… loja explicitamente autorizada criada",
  );


  // ==========================================================================
  // 6. CRIA 12 SNAPSHOTS READY + 12 ARTEFATOS REAIS
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
            `G9 SCHEDULER EXECUTION ${backupId}`,
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


    await assertStorageExists(
        file,
    );
  }


  console.log(
      `âœ… ${TOTAL_SNAPSHOTS} snapshots ready + artefatos reais criados`,
  );


  // ==========================================================================
  // 7. DAILY RUN SENTINELA
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
  // 8. ESTADO ANTES
  // ==========================================================================

  const snapshotsBefore =
      await snapshotsRef.get();


  const operationsBefore =
      await operationsRef.get();

  const scheduleRunsBefore =
      await scheduleRunsRef.get();


  assert.strictEqual(
      snapshotsBefore.size,
      TOTAL_SNAPSHOTS,
  );


  assert.strictEqual(
      operationsBefore.size,
      0,
  );

  assert.strictEqual(
      scheduleRunsBefore.size,
      0,
  );


  for (
    const doc
    of snapshotsBefore.docs
  ) {
    assert.strictEqual(
        doc.data().status,
        "ready",
    );
  }


  console.log(
      "âœ… estado inicial confirmado: 12 ready + zero operaÃ§Ãµes",
  );


  // ==========================================================================
  // 9. CARREGA O SCHEDULER SOMENTE DEPOIS DAS ENVS
  // ==========================================================================

  const {
    scheduledBackupRetention,
  } = require(
      "../../backups/scheduledBackupRetention",
  );


  // ==========================================================================
  // 10. EXECUTA HANDLER REAL
  // ==========================================================================

  await scheduledBackupRetention
      .run(
          SCHEDULE_EVENT,
      );

  console.log(
      "âœ… handler real do Scheduler finalizou",
  );


  const scheduleRunsAfter =
      await scheduleRunsRef.get();


  assert.strictEqual(
      scheduleRunsAfter.size,
      1,
  );


  const scheduleRunDoc =
      scheduleRunsAfter.docs[0];


  const scheduleRunData =
      scheduleRunDoc.data();


  assert.strictEqual(
      scheduleRunData.status,
      "completed",
  );


  assert.strictEqual(
      scheduleRunData.storeId,
      STORE_ID,
  );


  assert.strictEqual(
      scheduleRunData.freshBudgetGranted,
      true,
  );


  assert.strictEqual(
      scheduleRunData.freshBudgetMax,
      1,
  );


  assert(
      scheduleRunData.runId.startsWith(
          "retention-schedule-",
      ),
  );


  assert(
      scheduleRunData.completedAt,
  );


  assert(
      scheduleRunData.completedByExecutionId,
  );


  console.log(
      "âœ… ledger do Scheduler criado e concluÃ­do como completed",
  );


  // ==========================================================================
  // 11. EXATAMENTE 1 SNAPSHOT DEVE TER SIDO REMOVIDO
  // ==========================================================================

  const snapshotsAfter =
      await snapshotsRef.get();


  assert.strictEqual(
      snapshotsAfter.size,
      TOTAL_SNAPSHOTS - 1,
  );


  console.log(
      "âœ… exatamente 1 snapshot metadata foi removido",
  );


  // ==========================================================================
  // 12. TARGET MAIS ANTIGO DEVE TER SIDO O EXECUTADO
  // ==========================================================================

  const targetSnapshotAfter =
      await snapshotsRef
          .doc(
              TARGET_BACKUP_ID,
          )
          .get();


  assert.strictEqual(
      targetSnapshotAfter.exists,
      false,
  );


  console.log(
      `âœ… candidato executado: ${TARGET_BACKUP_ID}`,
  );


  // ==========================================================================
  // 13. OPERAÃ‡ÃƒO DEVE ESTAR COMPLETED
  // ==========================================================================

  const operationsAfter =
      await operationsRef.get();


  assert.strictEqual(
      operationsAfter.size,
      1,
  );


  const targetOperation =
      await operationsRef
          .doc(
              TARGET_BACKUP_ID,
          )
          .get();


  assert.strictEqual(
      targetOperation.exists,
      true,
  );


  assert.strictEqual(
      targetOperation.data().status,
      "completed",
  );


  assert.strictEqual(
      targetOperation.data().backupId,
      TARGET_BACKUP_ID,
  );


  assert.strictEqual(
      targetOperation.data().storeId,
      STORE_ID,
  );


  console.log(
      "âœ… retentionDelete persistida como completed",
  );


  // ==========================================================================
  // 14. AUDITORIA DETERMINÃSTICA
  // ==========================================================================

  const targetAudit =
      await auditLogsRef
          .doc(
              getAuditId(
                  TARGET_BACKUP_ID,
              ),
          )
          .get();


  assert.strictEqual(
      targetAudit.exists,
      true,
  );


  assert.strictEqual(
      targetAudit.data().action,
      "store_backup_retention_deleted",
  );


  assert.strictEqual(
      targetAudit.data().backupId,
      TARGET_BACKUP_ID,
  );


  assert.strictEqual(
      targetAudit.data().storeId,
      STORE_ID,
  );


  console.log(
      "âœ… auditoria determinÃ­stica criada",
  );


  // ==========================================================================
  // 15. STORAGE DO TARGET DEVE ESTAR AUSENTE
  // ==========================================================================

  await assertStorageMissing(
      bucket.file(
          getStoragePath(
              TARGET_BACKUP_ID,
          ),
      ),
  );


  console.log(
      "âœ… artefato target removido fisicamente do Storage Emulator",
  );


  // ==========================================================================
  // 16. TODOS OS OUTROS SNAPSHOTS DEVEM CONTINUAR READY
  // ==========================================================================

  for (
    let index = 1;
    index < TOTAL_SNAPSHOTS;
    index++
  ) {
    const backupId =
        getBackupId(
            index,
        );


    const snapshot =
        await snapshotsRef
            .doc(
                backupId,
            )
            .get();


    assert.strictEqual(
        snapshot.exists,
        true,
    );


    assert.strictEqual(
        snapshot.data().status,
        "ready",
    );


    assert.strictEqual(
        snapshot.data().retentionDeleteOperationId,
        undefined,
    );
  }


  console.log(
      "âœ… outros 11 snapshots permaneceram ready",
  );


  // ==========================================================================
  // 17. TODOS OS OUTROS ARTEFATOS DEVEM CONTINUAR EXISTINDO
  // ==========================================================================

  for (
    let index = 1;
    index < TOTAL_SNAPSHOTS;
    index++
  ) {
    const backupId =
        getBackupId(
            index,
        );


    await assertStorageExists(
        bucket.file(
            getStoragePath(
                backupId,
            ),
        ),
    );
  }


  console.log(
      "âœ… outros 11 artefatos permaneceram intactos",
  );


  // ==========================================================================
  // 18. NÃƒO PODE EXISTIR SEGUNDA OPERAÃ‡ÃƒO
  // ==========================================================================

  for (
    let index = 1;
    index < TOTAL_SNAPSHOTS;
    index++
  ) {
    const backupId =
        getBackupId(
            index,
        );


    const operation =
        await operationsRef
            .doc(
                backupId,
            )
            .get();


    assert.strictEqual(
        operation.exists,
        false,
    );
  }


  console.log(
      "âœ… maxFreshDeletes=1 impediu uma segunda exclusÃ£o",
  );


  // ==========================================================================
  // 19. NÃƒO PODE EXISTIR SEGUNDA AUDITORIA DE EXCLUSÃƒO
  // ==========================================================================

  for (
    let index = 1;
    index < TOTAL_SNAPSHOTS;
    index++
  ) {
    const backupId =
        getBackupId(
            index,
        );


    const audit =
        await auditLogsRef
            .doc(
                getAuditId(
                    backupId,
                ),
            )
            .get();


    assert.strictEqual(
        audit.exists,
        false,
    );
  }


  console.log(
      "âœ… existe exatamente uma auditoria de retenÃ§Ã£o",
  );


  // ==========================================================================
  // 20. DAILY RUN INTACTO
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
  // 21. LOJA INTACTA
  // ==========================================================================

  const storeAfter =
      await storeRef.get();


  assert.strictEqual(
      storeAfter.exists,
      true,
  );


  assert.strictEqual(
      storeAfter.data().marker,
      "g9-scheduler-controlled-execution",
  );


  console.log(
      "âœ… documento da loja permaneceu intacto",
  );


  // ==========================================================================
  // FINAL
  // ==========================================================================

  console.log("");

  console.log(
      "============================================================",
  );
  // ==========================================================================
  // 20. RETRY DO MESMO EVENTO DO SCHEDULER
  // ==========================================================================

  console.log(
      "ðŸ§ª executando retry do MESMO ScheduledEvent...",
  );


  await scheduledBackupRetention
      .run(
          SCHEDULE_EVENT,
      );


  console.log(
      "âœ… retry do mesmo evento finalizou",
  );


  // ==========================================================================
  // 21. RETRY NÃƒO PODE REMOVER UM SEGUNDO SNAPSHOT
  // ==========================================================================

  const snapshotsAfterRetry =
      await snapshotsRef.get();


  assert.strictEqual(
      snapshotsAfterRetry.size,
      TOTAL_SNAPSHOTS - 1,
  );


  console.log(
      "âœ… retry nÃ£o removeu um segundo snapshot",
  );


  // ==========================================================================
  // 22. CONTINUA EXISTINDO SOMENTE UMA OPERAÃ‡ÃƒO
  // ==========================================================================

  const operationsAfterRetry =
      await operationsRef.get();


  assert.strictEqual(
      operationsAfterRetry.size,
      1,
  );


  assert.strictEqual(
      operationsAfterRetry.docs[0].id,
      TARGET_BACKUP_ID,
  );


  assert.strictEqual(
      operationsAfterRetry.docs[0].data().status,
      "completed",
  );


  console.log(
      "âœ… retry nÃ£o criou uma segunda retentionDelete",
  );


  // ==========================================================================
  // 23. CONTINUA EXISTINDO SOMENTE UMA AUDITORIA
  // ==========================================================================

  const auditsAfterRetry =
      await auditLogsRef.get();


  assert.strictEqual(
      auditsAfterRetry.size,
      1,
  );


  console.log(
      "âœ… retry nÃ£o criou uma segunda auditoria",
  );


  // ==========================================================================
  // 24. CONTINUA EXISTINDO SOMENTE UM LEDGER
  // ==========================================================================

  const scheduleRunsAfterRetry =
      await scheduleRunsRef.get();


  assert.strictEqual(
      scheduleRunsAfterRetry.size,
      1,
  );


  const scheduleRunAfterRetry =
      scheduleRunsAfterRetry.docs[0];


  assert.strictEqual(
      scheduleRunAfterRetry.id,
      scheduleRunDoc.id,
  );


  assert.deepStrictEqual(
      scheduleRunAfterRetry.data(),
      scheduleRunData,
  );


  console.log(
      "âœ… retry reutilizou o mesmo runId e preservou o ledger completed",
  );


  // ==========================================================================
  // 25. TARGET CONTINUA AUSENTE
  // ==========================================================================

  await assertStorageMissing(
      bucket.file(
          getStoragePath(
              TARGET_BACKUP_ID,
          ),
      ),
  );


  console.log(
      "âœ… artefato jÃ¡ excluÃ­do continuou ausente",
  );


  // ==========================================================================
  // 26. OUTROS 11 ARTEFATOS CONTINUAM INTACTOS
  // ==========================================================================

  for (
    let index = 1;
    index < TOTAL_SNAPSHOTS;
    index++
  ) {
    const backupId =
        getBackupId(
            index,
        );


    await assertStorageExists(
        bucket.file(
            getStoragePath(
                backupId,
            ),
        ),
    );
  }


  console.log(
      "âœ… retry preservou todos os outros 11 artefatos",
  );


  // ==========================================================================
  // 27. DAILY RUN CONTINUA INALTERADO
  // ==========================================================================

  const dailyRunAfterRetry =
      await dailyRunRef.get();


  assert.deepStrictEqual(
      dailyRunAfterRetry.data(),
      dailyRunFixture,
  );


  console.log(
      "âœ… retry manteve dailyRuns absolutamente inalterado",
  );
  console.log(
      "âœ… SCHEDULER EM EXECUÃ‡ÃƒO CONTROLADA PASSOU",
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