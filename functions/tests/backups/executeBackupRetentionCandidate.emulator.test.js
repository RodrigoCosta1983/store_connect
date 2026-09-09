"use strict";


const assert =
    require("assert");

const admin =
    require("firebase-admin");

const {
  executeBackupRetentionCandidate,
} = require(
    "../../backups/executeBackupRetentionCandidate",
);

const {
  claimBackupRetentionDelete,
} = require(
    "../../backups/claimBackupRetentionDelete",
);

const {
  executeBackupRetentionStorageDelete,
} = require(
    "../../backups/executeBackupRetentionStorageDelete",
);

const {
  ACTIONS:
    CLAIM_ACTIONS,
} = require(
    "../../backups/backupRetentionClaimPlanner",
);

const {
  ACTIONS:
    STORAGE_ACTIONS,
} = require(
    "../../backups/backupRetentionStorageDeletePlanner",
);

const {
  ACTIONS:
    FINALIZE_ACTIONS,

  getAuditId,
} = require(
    "../../backups/backupRetentionFinalizePlanner",
);


// ============================================================================
// F5.6-D3-G9.2
// EXECUTOR DE CANDIDATO â€” FIRESTORE + STORAGE EMULATOR
// ============================================================================
//
// CenÃ¡rios:
//
// 1. fresh ready
// 2. resume claimed com lease expirado
// 3. resume storage_deleted com lease expirado
// 4. outro worker com lease ativo
//
// âœ… Firestore Emulator
// âœ… Storage Emulator
// âœ… claim real
// âœ… renew/takeover real
// âœ… delete real
// âœ… finalizaÃ§Ã£o real
//
// âŒ sem Scheduler
// âŒ sem produÃ§Ã£o
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

const WORKER_NEW =
    "worker-g9-new";

const WORKER_OLD =
    "worker-g9-old";

const VALID_CHECKSUM =
    "a".repeat(64);

const NOW =
    new Date(
        "2026-09-30T12:00:00.000Z",
    );

const OLD_NOW =
    new Date(
        "2026-09-30T11:30:00.000Z",
    );

const ACTIVE_NOW =
    new Date(
        "2026-09-30T11:55:00.000Z",
    );

const TOTAL_SNAPSHOTS =
    12;


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


function getTargetId(
    suffix,
) {
  return (
    `backup-g9-${suffix}-target`
  );
}


function getBackupId(
    suffix,
    index,
) {
  if (
    index ===
      0
  ) {
    return getTargetId(
        suffix,
    );
  }


  return (
    `backup-g9-${suffix}-` +
    `${String(index).padStart(2, "0")}`
  );
}


function getStoragePath({
  storeId,
  backupId,
}) {
  return (
    `store_backups/` +
    `${storeId}/` +
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
  storeId,
  backupId,
  index,
}) {
  return {
    storeId,

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
      getStoragePath({
        storeId,
        backupId,
      }),

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
      "O arquivo deveria estar ausente.",
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


async function prepareScenario({
  db,
  bucket,
  suffix,
}) {
  const storeId =
      `emulator-g9-candidate-${suffix}`;

  const targetBackupId =
      getTargetId(
          suffix,
      );

  const storeBackupsRef =
      db
          .collection(
              "storeBackups",
          )
          .doc(
              storeId,
          );

  const snapshotsRef =
      storeBackupsRef
          .collection(
              "snapshots",
          );

  const operationRef =
      storeBackupsRef
          .collection(
              "retentionDeletes",
          )
          .doc(
              targetBackupId,
          );

  const auditRef =
      db
          .collection(
              "stores",
          )
          .doc(
              storeId,
          )
          .collection(
              "auditLogs",
          )
          .doc(
              getAuditId(
                  targetBackupId,
              ),
          );

  const storagePath =
      getStoragePath({
        storeId,

        backupId:
          targetBackupId,
      });

  const file =
      bucket.file(
          storagePath,
      );


  // --------------------------------------------------------------------------
  // LIMPEZA
  // --------------------------------------------------------------------------

  const cleanup =
      [];


  for (
    let index = 0;
    index < TOTAL_SNAPSHOTS;
    index++
  ) {
    cleanup.push(
        snapshotsRef
            .doc(
                getBackupId(
                    suffix,
                    index,
                ),
            )
            .delete(),
    );
  }


  cleanup.push(
      operationRef.delete(),
  );


  cleanup.push(
      auditRef.delete(),
  );


  cleanup.push(
      file.delete({
        ignoreNotFound:
          true,
      }),
  );


  await Promise.all(
      cleanup,
  );


  // --------------------------------------------------------------------------
  // 12 SNAPSHOTS READY
  // --------------------------------------------------------------------------

  for (
    let index = 0;
    index < TOTAL_SNAPSHOTS;
    index++
  ) {
    const backupId =
        getBackupId(
            suffix,
            index,
        );


    await snapshotsRef
        .doc(
            backupId,
        )
        .set(
            createReadySnapshot({
              storeId,

              backupId,

              index,
            }),
        );
  }


  // --------------------------------------------------------------------------
  // ARTEFATO REAL DO TARGET
  // --------------------------------------------------------------------------

  await file.save(
      Buffer.from(
          `G9-CANDIDATE-${suffix}`,
          "utf8",
      ),
      {
        resumable:
          false,

        metadata: {
          contentType:
            "application/gzip",

          metadata: {
            storeId,

            backupId:
              targetBackupId,

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


  return {
    storeId,
    targetBackupId,
    snapshotsRef,
    operationRef,
    auditRef,
    file,
  };
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
      "F5.6-D3-G9.2 â€” EXECUTOR DE CANDIDATO NOS EMULATORS",
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
  // 1. FRESH READY
  // ==========================================================================

  {
    const scenario =
        await prepareScenario({
          db,
          bucket,
          suffix:
            "fresh",
        });


    const result =
        await executeBackupRetentionCandidate({
          db,

          bucket,

          storeId:
            scenario.storeId,

          backupId:
            scenario.targetBackupId,

          executionId:
            WORKER_NEW,

          now:
            NOW,
        });


    assert.strictEqual(
        result.claim.action,
        CLAIM_ACTIONS.CREATE_CLAIM,
    );


    assert.strictEqual(
        result.renewal,
        null,
    );


    assert.strictEqual(
        result.stage,
        "finalize",
    );


    assert.strictEqual(
        result.completed,
        true,
    );


    assert.strictEqual(
        result.finalization.action,
        FINALIZE_ACTIONS
            .FINALIZE_ALLOWED,
    );


    const [
      snapshotAfter,
      operationAfter,
      auditAfter,
    ] =
        await Promise.all([
          scenario.snapshotsRef
              .doc(
                  scenario.targetBackupId,
              )
              .get(),

          scenario.operationRef.get(),

          scenario.auditRef.get(),
        ]);


    assert.strictEqual(
        snapshotAfter.exists,
        false,
    );


    assert.strictEqual(
        operationAfter.data().status,
        "completed",
    );


    assert.strictEqual(
        auditAfter.exists,
        true,
    );


    await assertStorageMissing(
        scenario.file,
    );


    console.log(
        "âœ… fresh ready â†’ CREATE_CLAIM â†’ delete â†’ finalize â†’ completed",
    );


    // ------------------------------------------------------------------------
    // RETRY COMPLETED
    // ------------------------------------------------------------------------

    const retry =
        await executeBackupRetentionCandidate({
          db,

          bucket,

          storeId:
            scenario.storeId,

          backupId:
            scenario.targetBackupId,

          executionId:
            WORKER_NEW,

          now:
            NOW,
        });


    assert.strictEqual(
        retry.claim.action,
        CLAIM_ACTIONS.ALREADY_COMPLETED,
    );


    assert.strictEqual(
        retry.completed,
        true,
    );


    assert.strictEqual(
        retry.storageDelete,
        null,
    );


    assert.strictEqual(
        retry.finalization,
        null,
    );


    console.log(
        "âœ… completed â†’ retry encerrou jÃ¡ no claim",
    );
  }


  // ==========================================================================
  // 2. RESUME CLAIMED â€” LEASE EXPIRADO
  // ==========================================================================

  {
    const scenario =
        await prepareScenario({
          db,
          bucket,
          suffix:
            "claimed",
        });


    const initialClaim =
        await claimBackupRetentionDelete({
          db,

          storeId:
            scenario.storeId,

          backupId:
            scenario.targetBackupId,

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
        await scenario
            .operationRef
            .get();


    assert.strictEqual(
        operationBefore.data().status,
        "claimed",
    );


    assert.strictEqual(
        operationBefore.data().leaseOwner,
        WORKER_OLD,
    );


    await assertStorageExists(
        scenario.file,
    );


    const result =
        await executeBackupRetentionCandidate({
          db,

          bucket,

          storeId:
            scenario.storeId,

          backupId:
            scenario.targetBackupId,

          executionId:
            WORKER_NEW,

          now:
            NOW,
        });


    assert.strictEqual(
        result.claim.action,
        CLAIM_ACTIONS.RESUME,
    );


    assert(
        result.renewal,
        "Resume deveria renovar/tomar o lease.",
    );


    assert.strictEqual(
        result.renewal.action,
        CLAIM_ACTIONS.RESUME,
    );


    assert.strictEqual(
        result.renewal.allowed,
        true,
    );


    assert.strictEqual(
        result.renewal.wrote,
        true,
    );


    assert.strictEqual(
        result.renewal.leaseOwner,
        WORKER_NEW,
    );


    assert.strictEqual(
        result.completed,
        true,
    );


    const operationAfter =
        await scenario
            .operationRef
            .get();


    assert.strictEqual(
        operationAfter.data().status,
        "completed",
    );


    await assertStorageMissing(
        scenario.file,
    );


    console.log(
        "âœ… claimed interrompido â†’ RESUME + takeover â†’ completed",
    );
  }


  // ==========================================================================
  // 3. RESUME storage_deleted â€” LEASE EXPIRADO
  // ==========================================================================

  {
    const scenario =
        await prepareScenario({
          db,
          bucket,
          suffix:
            "storage-deleted",
        });


    const initialClaim =
        await claimBackupRetentionDelete({
          db,

          storeId:
            scenario.storeId,

          backupId:
            scenario.targetBackupId,

          executionId:
            WORKER_OLD,

          now:
            OLD_NOW,
        });


    assert.strictEqual(
        initialClaim.action,
        CLAIM_ACTIONS.CREATE_CLAIM,
    );


    const storageDelete =
        await executeBackupRetentionStorageDelete({
          db,

          bucket,

          storeId:
            scenario.storeId,

          backupId:
            scenario.targetBackupId,

          executionId:
            WORKER_OLD,

          now:
            new Date(
                "2026-09-30T11:31:00.000Z",
            ),
        });


    assert.strictEqual(
        storageDelete.wrote,
        true,
    );


    const operationBefore =
        await scenario
            .operationRef
            .get();


    assert.strictEqual(
        operationBefore.data().status,
        "storage_deleted",
    );


    await assertStorageMissing(
        scenario.file,
    );


    const result =
        await executeBackupRetentionCandidate({
          db,

          bucket,

          storeId:
            scenario.storeId,

          backupId:
            scenario.targetBackupId,

          executionId:
            WORKER_NEW,

          now:
            NOW,
        });


    assert.strictEqual(
        result.claim.action,
        CLAIM_ACTIONS.RESUME,
    );


    assert.strictEqual(
        result.renewal.action,
        CLAIM_ACTIONS.RESUME,
    );


    assert.strictEqual(
        result.renewal.wrote,
        true,
    );


    assert.strictEqual(
        result.storageDelete.action,
        STORAGE_ACTIONS
            .ALREADY_STORAGE_DELETED,
    );


    assert.strictEqual(
        result.finalization.action,
        FINALIZE_ACTIONS
            .FINALIZE_ALLOWED,
    );


    assert.strictEqual(
        result.completed,
        true,
    );


    const operationAfter =
        await scenario
            .operationRef
            .get();


    assert.strictEqual(
        operationAfter.data().status,
        "completed",
    );


    await assertStorageMissing(
        scenario.file,
    );


    console.log(
        "âœ… storage_deleted interrompido â†’ RESUME + takeover â†’ finalize",
    );
  }


  // ==========================================================================
  // 4. OUTRO WORKER COM LEASE ATIVO
  // ==========================================================================

  {
    const scenario =
        await prepareScenario({
          db,
          bucket,
          suffix:
            "leased",
        });


    const initialClaim =
        await claimBackupRetentionDelete({
          db,

          storeId:
            scenario.storeId,

          backupId:
            scenario.targetBackupId,

          executionId:
            WORKER_OLD,

          now:
            ACTIVE_NOW,
        });


    assert.strictEqual(
        initialClaim.action,
        CLAIM_ACTIONS.CREATE_CLAIM,
    );


    const result =
        await executeBackupRetentionCandidate({
          db,

          bucket,

          storeId:
            scenario.storeId,

          backupId:
            scenario.targetBackupId,

          executionId:
            WORKER_NEW,

          now:
            NOW,
        });


    assert.strictEqual(
        result.claim.action,
        CLAIM_ACTIONS.SKIP_LEASED,
    );


    assert.strictEqual(
        result.completed,
        false,
    );


    assert.strictEqual(
        result.renewal,
        null,
    );


    assert.strictEqual(
        result.storageDelete,
        null,
    );


    assert.strictEqual(
        result.finalization,
        null,
    );


    const [
      snapshotAfter,
      operationAfter,
      auditAfter,
    ] =
        await Promise.all([
          scenario.snapshotsRef
              .doc(
                  scenario.targetBackupId,
              )
              .get(),

          scenario.operationRef.get(),

          scenario.auditRef.get(),
        ]);


    assert.strictEqual(
        snapshotAfter.exists,
        true,
    );


    assert.strictEqual(
        snapshotAfter.data().status,
        "deleting",
    );


    assert.strictEqual(
        operationAfter.data().status,
        "claimed",
    );


    assert.strictEqual(
        operationAfter.data().leaseOwner,
        WORKER_OLD,
    );


    assert.strictEqual(
        auditAfter.exists,
        false,
    );


    await assertStorageExists(
        scenario.file,
    );


    console.log(
        "âœ… lease ativo de outro worker â†’ SKIP_LEASED + Storage intacto",
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
      "âœ… EXECUTOR DE CANDIDATO PASSOU EM TODOS OS CENÃRIOS",
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