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
  ACTIONS,
} = require(
    "../../backups/inspectBackupRetentionStorageArtifact",
);


// ============================================================================
// F5.6-D3-G3.3
// TESTE REAL CONTRA FIREBASE STORAGE EMULATOR
// ============================================================================
//
// âœ… Storage Emulator real
// âœ… grava artefato fÃ­sico local
// âœ… lÃª metadata pelo inspetor real
//
// âŒ nÃ£o executa delete()
// âŒ nÃ£o acessa Storage de produÃ§Ã£o
//
// ============================================================================


const EXPECTED_EMULATOR_HOST =
    "127.0.0.1:9199";

const PROJECT_ID =
    "store-connect-app";

const BUCKET_NAME =
    "store-connect-app.firebasestorage.app";


const STORE_ID =
    "emulator-storage-inspector-store";

const BACKUP_ID =
    "backup-artifact-valid";


const STORAGE_PATH =
    (
      `store_backups/` +
      `${STORE_ID}/` +
      `${BACKUP_ID}/` +
      `snapshot.json.gz`
    );


// ============================================================================
// TRAVA DE SEGURANÃ‡A
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
// TESTE
// ============================================================================

async function run() {
  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "F5.6-D3-G3.3 â€” STORAGE EMULATOR REAL",
  );

  console.log(
      "============================================================",
  );


  // --------------------------------------------------------------------------
  // SEGURANÃ‡A
  // --------------------------------------------------------------------------

  assertEmulatorEnvironment();


  console.log(
      "âœ… trava de seguranÃ§a confirmou Storage Emulator",
  );


  // --------------------------------------------------------------------------
  // BUCKET
  // --------------------------------------------------------------------------

  const bucket =
      initializeAdmin();


  assert.strictEqual(
      bucket.name,
      BUCKET_NAME,
  );


  console.log(
      `âœ… bucket local selecionado: ${bucket.name}`,
  );


  // --------------------------------------------------------------------------
  // ARTEFATO DE TESTE
  // --------------------------------------------------------------------------

  const snapshot =
      {
        snapshotVersion:
          1,

        storeId:
          STORE_ID,

        test:
          true,

        createdFor:
          "F5.6-D3-G3.3",
      };


  const rawSnapshot =
      Buffer.from(
          JSON.stringify(
              snapshot,
          ),
          "utf8",
      );


  const compressedSnapshot =
      zlib.gzipSync(
          rawSnapshot,
      );


  const checksumSha256 =
      crypto
          .createHash(
              "sha256",
          )
          .update(
              compressedSnapshot,
          )
          .digest(
              "hex",
          );


  assert.strictEqual(
      checksumSha256.length,
      64,
  );


  // --------------------------------------------------------------------------
  // GRAVA SOMENTE NO EMULADOR
  // --------------------------------------------------------------------------

  const file =
      bucket.file(
          STORAGE_PATH,
      );


  await file.save(
      compressedSnapshot,
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
              BACKUP_ID,

            snapshotVersion:
              "1",

            checksumSha256,
          },
        },
      },
  );


  console.log(
      "âœ… artefato gravado no Storage Emulator",
  );


  // --------------------------------------------------------------------------
  // INSPEÃ‡ÃƒO REAL
  // --------------------------------------------------------------------------

  const result =
      await inspectBackupRetentionStorageArtifact({
        bucket,

        storeId:
          STORE_ID,

        backupId:
          BACKUP_ID,

        storagePath:
          STORAGE_PATH,

        checksum:
          checksumSha256,
      });


  assert.strictEqual(
      result.action,
      ACTIONS.ARTIFACT_VALID,
  );

  assert.strictEqual(
      result.allowed,
      true,
  );

  assert.strictEqual(
      result.storeId,
      STORE_ID,
  );

  assert.strictEqual(
      result.backupId,
      BACKUP_ID,
  );

  assert.strictEqual(
      result.storagePath,
      STORAGE_PATH,
  );

  assert.strictEqual(
      result.checksum,
      checksumSha256,
  );


  console.log(
      "âœ… inspetor confirmou artefato fÃ­sico â†’ ARTIFACT_VALID",
  );


  // --------------------------------------------------------------------------
  // IMPORTANTE
  // --------------------------------------------------------------------------

  console.log(
      "âœ… nenhum delete() foi executado",
  );


  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "âœ… TESTE REAL DO STORAGE EMULATOR PASSOU",
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
