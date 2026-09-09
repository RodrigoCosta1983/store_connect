"use strict";


const assert =
    require("assert");

const crypto =
    require("crypto");

const zlib =
    require("zlib");

const admin =
    require("firebase-admin");

const {
  inspectBackupRetentionStorageArtifact,
  ACTIONS:
    INSPECTION_ACTIONS,
} = require(
    "../../backups/inspectBackupRetentionStorageArtifact",
);

const {
  deleteBackupRetentionStorageArtifact,
  ACTIONS:
    DELETE_ACTIONS,
} = require(
    "../../backups/deleteBackupRetentionStorageArtifact",
);


// ============================================================================
// F5.6-D3-G4.3
// DELETE REAL CONTRA FIREBASE STORAGE EMULATOR
// ============================================================================
//
// âœ… grava artefato no Emulator
// âœ… inspeciona objeto real
// âœ… executa delete() real no Emulator
// âœ… confirma ausÃªncia fÃ­sica
// âœ… testa retry idempotente
// âœ… testa generation antiga apÃ³s overwrite
//
// âŒ sem produÃ§Ã£o
// âŒ sem Firestore
//
// ============================================================================


const EXPECTED_EMULATOR_HOST =
    "127.0.0.1:9199";

const PROJECT_ID =
    "store-connect-app";

const BUCKET_NAME =
    "store-connect-app.firebasestorage.app";


const VALID_CHECKSUM_A =
    "a".repeat(64);

const VALID_CHECKSUM_B =
    "b".repeat(64);


// ============================================================================
// SEGURANÃ‡A
// ============================================================================

function assertEmulatorEnvironment() {
  const emulatorHost =
      String(
          process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
          "",
      ).trim();


  if (
    emulatorHost !==
      EXPECTED_EMULATOR_HOST
  ) {
    throw new Error(
        (
          "SEGURANÃ‡A: teste recusado. " +
          "FIREBASE_STORAGE_EMULATOR_HOST deve ser " +
          `${EXPECTED_EMULATOR_HOST}. ` +
          `Valor atual: "${emulatorHost}".`
        ),
    );
  }
}


// ============================================================================
// ADMIN
// ============================================================================

function initializeAdmin() {
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


  return admin.storage().bucket(
      BUCKET_NAME,
  );
}


// ============================================================================
// HELPERS
// ============================================================================

function createCompressedArtifact(
    value,
) {
  const raw =
      Buffer.from(
          JSON.stringify(
              value,
          ),
          "utf8",
      );


  return zlib.gzipSync(
      raw,
  );
}


function sha256(
    buffer,
) {
  return crypto
      .createHash(
          "sha256",
      )
      .update(
          buffer,
      )
      .digest(
          "hex",
      );
}


async function saveArtifact({
  bucket,
  storeId,
  backupId,
  storagePath,
  body,
}) {
  const checksum =
      sha256(
          body,
      );


  const file =
      bucket.file(
          storagePath,
      );


  await file.save(
      body,
      {
        resumable:
          false,

        metadata: {
          contentType:
            "application/gzip",

          metadata: {
            storeId,
            backupId,
            snapshotVersion:
              "1",

            checksumSha256:
              checksum,
          },
        },
      },
  );


  return {
    file,
    checksum,
  };
}


function isNotFound(
    error,
) {
  return (
    error &&
    (
      error.code === 404 ||
      error.code === "404"
    )
  );
}


// ============================================================================
// TESTES
// ============================================================================

async function run() {
  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "F5.6-D3-G4.3 â€” DELETE REAL NO STORAGE EMULATOR",
  );

  console.log(
      "============================================================",
  );


  // --------------------------------------------------------------------------
  // SEGURANÃ‡A
  // --------------------------------------------------------------------------

  assertEmulatorEnvironment();


  console.log(
      "âœ… trava confirmou Storage Emulator",
  );


  const bucket =
      initializeAdmin();


  assert.strictEqual(
      bucket.name,
      BUCKET_NAME,
  );


  console.log(
      `âœ… bucket emulado: ${bucket.name}`,
  );


  // ==========================================================================
  // 1. DELETE NORMAL + RETRY IDEMPOTENTE
  // ==========================================================================

  {
    const storeId =
        "emulator-delete-store";

    const backupId =
        "backup-delete-normal";

    const storagePath =
        (
          `store_backups/` +
          `${storeId}/` +
          `${backupId}/` +
          `snapshot.json.gz`
        );


    const body =
        createCompressedArtifact({
          storeId,
          backupId,
          scenario:
            "normal-delete",
        });


    const {
      file,
      checksum,
    } = await saveArtifact({
      bucket,
      storeId,
      backupId,
      storagePath,
      body,
    });


    console.log(
        "âœ… cenÃ¡rio 1: artefato criado no Emulator",
    );


    const inspection =
        await inspectBackupRetentionStorageArtifact({
          bucket,
          storeId,
          backupId,
          storagePath,
          checksum,
        });


    assert.strictEqual(
        inspection.action,
        INSPECTION_ACTIONS.ARTIFACT_VALID,
    );

    assert.strictEqual(
        inspection.allowed,
        true,
    );

    assert(
        /^\d+$/.test(
            inspection.generation,
        ),
    );


    console.log(
        (
          "âœ… cenÃ¡rio 1: inspeÃ§Ã£o vÃ¡lida, generation=" +
          inspection.generation
        ),
    );


    const deleteResult =
        await deleteBackupRetentionStorageArtifact({
          inspection,
        });


    assert.strictEqual(
        deleteResult.action,
        DELETE_ACTIONS.STORAGE_ABSENCE_CONFIRMED,
    );

    assert.strictEqual(
        deleteResult.allowed,
        true,
    );


    console.log(
        "âœ… cenÃ¡rio 1: delete fÃ­sico executado no Emulator",
    );


    let missing =
        false;


    try {
      await file.getMetadata();
    } catch (error) {
      if (
        isNotFound(
            error,
        )
      ) {
        missing =
            true;
      } else {
        throw error;
      }
    }


    assert.strictEqual(
        missing,
        true,
    );


    console.log(
        "âœ… cenÃ¡rio 1: ausÃªncia fÃ­sica confirmada",
    );


    const retryInspection =
        await inspectBackupRetentionStorageArtifact({
          bucket,
          storeId,
          backupId,
          storagePath,
          checksum,
        });


    assert.strictEqual(
        retryInspection.action,
        INSPECTION_ACTIONS.ARTIFACT_ALREADY_MISSING,
    );


    const retryDeleteResult =
        await deleteBackupRetentionStorageArtifact({
          inspection:
            retryInspection,
        });


    assert.strictEqual(
        retryDeleteResult.action,
        DELETE_ACTIONS.STORAGE_ABSENCE_CONFIRMED,
    );

    assert.strictEqual(
        retryDeleteResult.alreadyMissing,
        true,
    );


    console.log(
        "âœ… cenÃ¡rio 1: retry confirmou ausÃªncia sem segundo delete()",
    );
  }


  // ==========================================================================
  // 2. GENERATION ANTIGA APÃ“S OVERWRITE
  // ==========================================================================

  {
    const storeId =
        "emulator-delete-race-store";

    const backupId =
        "backup-delete-race";

    const storagePath =
        (
          `store_backups/` +
          `${storeId}/` +
          `${backupId}/` +
          `snapshot.json.gz`
        );


    const bodyA =
        createCompressedArtifact({
          value:
            VALID_CHECKSUM_A,
        });


    const savedA =
        await saveArtifact({
          bucket,
          storeId,
          backupId,
          storagePath,
          body:
            bodyA,
        });


    const inspectionA =
        await inspectBackupRetentionStorageArtifact({
          bucket,
          storeId,
          backupId,
          storagePath,
          checksum:
            savedA.checksum,
        });


    assert.strictEqual(
        inspectionA.action,
        INSPECTION_ACTIONS.ARTIFACT_VALID,
    );


    const generationA =
        inspectionA.generation;


    console.log(
        (
          "âœ… cenÃ¡rio 2: generation inicial=" +
          generationA
        ),
    );


    // ------------------------------------------------------------------------
    // SUBSTITUI O OBJETO NO MESMO PATH
    // ------------------------------------------------------------------------

    const bodyB =
        createCompressedArtifact({
          value:
            VALID_CHECKSUM_B,

          replaced:
            true,
        });


    const savedB =
        await saveArtifact({
          bucket,
          storeId,
          backupId,
          storagePath,
          body:
            bodyB,
        });


    const inspectionB =
        await inspectBackupRetentionStorageArtifact({
          bucket,
          storeId,
          backupId,
          storagePath,
          checksum:
            savedB.checksum,
        });


    assert.strictEqual(
        inspectionB.action,
        INSPECTION_ACTIONS.ARTIFACT_VALID,
    );


    const generationB =
        inspectionB.generation;


    assert.notStrictEqual(
        generationA,
        generationB,
    );


    console.log(
        (
          "âœ… cenÃ¡rio 2: objeto substituÃ­do, nova generation=" +
          generationB
        ),
    );




        // ------------------------------------------------------------------------
        // TENTA DELETAR USANDO A INSPEÃ‡ÃƒO ANTIGA
        // ------------------------------------------------------------------------

        const staleDeleteResult =
            await deleteBackupRetentionStorageArtifact({
              inspection:
                inspectionA,
            });


        assert.strictEqual(
            staleDeleteResult.action,
            DELETE_ACTIONS.BLOCKED,
        );

        assert.strictEqual(
            staleDeleteResult.allowed,
            false,
        );

        assert(
            Array.isArray(
                staleDeleteResult.reasons,
            ) &&
            staleDeleteResult.reasons.some(
                (reason) =>
                  reason.code ===
                  "storage-generation-changed-before-delete",
            ),
            (
              "A mudanÃ§a de generation deveria " +
              "bloquear o delete antes da exclusÃ£o fÃ­sica."
            ),
        );


        console.log(
            (
              "âœ… cenÃ¡rio 2: generation antiga detectada " +
              "antes do delete â†’ BLOCKED"
            ),
        );



    // ------------------------------------------------------------------------
    // GARANTE QUE O OBJETO NOVO CONTINUA EXISTINDO
    // ------------------------------------------------------------------------

    const finalInspection =
        await inspectBackupRetentionStorageArtifact({
          bucket,
          storeId,
          backupId,
          storagePath,
          checksum:
            savedB.checksum,
        });


    assert.strictEqual(
        finalInspection.action,
        INSPECTION_ACTIONS.ARTIFACT_VALID,
    );

    assert.strictEqual(
        finalInspection.generation,
        generationB,
    );


    console.log(
        "âœ… cenÃ¡rio 2: objeto novo permaneceu intacto",
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
      "âœ… TODOS OS TESTES REAIS DE DELETE NO EMULATOR PASSARAM",
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