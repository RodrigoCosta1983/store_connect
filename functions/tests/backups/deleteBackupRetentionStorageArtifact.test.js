"use strict";


const assert =
    require("assert");

const {
  deleteBackupRetentionStorageArtifact,
  ACTIONS:
    DELETE_ACTIONS,
} = require(
    "../../backups/deleteBackupRetentionStorageArtifact",
);

const {
  ACTIONS:
    INSPECTION_ACTIONS,
} = require(
    "../../backups/inspectBackupRetentionStorageArtifact",
);


// ============================================================================
// STORE&CONNECT â€” TESTES DO DELETE FÃSICO
// ============================================================================
//
// F5.6-D3-G4.2
//
// âœ… file fake
// âœ… valida ifGenerationMatch
// âœ… valida idempotÃªncia
// âœ… valida propagaÃ§Ã£o de erros
//
// âŒ sem Firebase
// âŒ sem Storage Emulator
// âŒ sem produÃ§Ã£o
//
// ============================================================================


const STORE_ID =
    "store-test";

const BACKUP_ID =
    "backup-test";

const STORAGE_PATH =
    (
      `store_backups/` +
      `${STORE_ID}/` +
      `${BACKUP_ID}/` +
      `snapshot.json.gz`
    );

const GENERATION =
    "1234567890123456";

    const VALID_CHECKSUM =
        "a".repeat(64);


// ============================================================================
// HELPERS
// ============================================================================

function createFakeFile({
  deleteError =
    null,

  metadataError =
    null,

  metadata =
    null,
} = {}) {
  const calls = [];


  const resolvedMetadata =
      metadata || {
        generation:
          GENERATION,

        metadata: {
          storeId:
            STORE_ID,

          backupId:
            BACKUP_ID,

          checksumSha256:
            VALID_CHECKSUM,
        },
      };


  const file = {
    async getMetadata() {
      calls.push({
        type:
          "getMetadata",
      });


      if (metadataError) {
        throw metadataError;
      }


      return [
        resolvedMetadata,
      ];
    },


    async delete(
        options,
    ) {
      calls.push({
        type:
          "delete",

        options,
      });


      if (deleteError) {
        throw deleteError;
      }
    },
  };


  return {
    file,
    calls,
  };
}


function createValidInspection({
  file,
  overrides = {},
}) {
  return {
    action:
      INSPECTION_ACTIONS.ARTIFACT_VALID,

    allowed:
      true,

    storeId:
      STORE_ID,

    backupId:
      BACKUP_ID,

    storagePath:
      STORAGE_PATH,

    checksum:
        VALID_CHECKSUM,

    generation:
      GENERATION,

    file,

    reasons: [],

    ...overrides,
  };
}


function hasReason(
    result,
    code,
) {
  return (
    Array.isArray(
        result.reasons,
    ) &&
    result.reasons.some(
        (reason) =>
          reason.code === code,
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
      "F5.6-D3-G4.2 â€” DELETE FÃSICO COM FILE FAKE",
  );

  console.log(
      "============================================================",
  );


  // ==========================================================================
  // 1. ARTEFATO VÃLIDO â†’ DELETE CONDICIONADO
  // ==========================================================================

  {
    const {
      file,
      calls,
    } = createFakeFile();


    const inspection =
        createValidInspection({
          file,
        });


    const result =
        await deleteBackupRetentionStorageArtifact({
          inspection,
        });


    assert.strictEqual(
        result.action,
        DELETE_ACTIONS.STORAGE_ABSENCE_CONFIRMED,
    );

    assert.strictEqual(
        calls.length,
        2,
    );

    assert.strictEqual(
        calls[0].type,
        "getMetadata",
    );

    assert.strictEqual(
        calls[1].type,
        "delete",
    );

    assert.deepStrictEqual(
        calls[1].options,
        {
          ignoreNotFound:
            true,

          ifGenerationMatch:
            GENERATION,
        },
    );


    console.log(
        "âœ… ARTIFACT_VALID â†’ delete condicionado por generation",
    );
  }


  // ==========================================================================
  // 2. ARQUIVO JÃ AUSENTE â†’ NÃƒO EXECUTA SEGUNDO DELETE
  // ==========================================================================

  {
    const {
      file,
      calls,
    } = createFakeFile();


    const inspection = {
      action:
        INSPECTION_ACTIONS.ARTIFACT_ALREADY_MISSING,

      allowed:
        true,

      storeId:
        STORE_ID,

      backupId:
        BACKUP_ID,

      storagePath:
        STORAGE_PATH,

      file,
      reasons: [],
    };


    const result =
        await deleteBackupRetentionStorageArtifact({
          inspection,
        });


    assert.strictEqual(
        result.action,
        DELETE_ACTIONS.STORAGE_ABSENCE_CONFIRMED,
    );

    assert.strictEqual(
        result.allowed,
        true,
    );

    assert.strictEqual(
        result.alreadyMissing,
        true,
    );

    assert.strictEqual(
        result.generation,
        null,
    );

    assert.strictEqual(
        calls.length,
        0,
    );


    console.log(
        "âœ… ARTIFACT_ALREADY_MISSING â†’ nenhum segundo delete()",
    );
  }


  // ==========================================================================
  // 3. INSPEÃ‡ÃƒO BLOCKED â†’ NÃƒO DELETA
  // ==========================================================================

  {
    const {
      file,
      calls,
    } = createFakeFile();


    const inspection = {
      action:
        INSPECTION_ACTIONS.BLOCKED,

      allowed:
        false,

      file,
    };


    const result =
        await deleteBackupRetentionStorageArtifact({
          inspection,
        });


    assert.strictEqual(
        result.action,
        DELETE_ACTIONS.BLOCKED,
    );

    assert(
        hasReason(
            result,
            "inspection-not-artifact-valid",
        ),
    );

    assert.strictEqual(
        calls.length,
        0,
    );


    console.log(
        "âœ… inspeÃ§Ã£o BLOCKED â†’ nenhum delete()",
    );
  }


  // ==========================================================================
  // 4. ARTIFACT_VALID MAS allowed=false â†’ NÃƒO DELETA
  // ==========================================================================

  {
    const {
      file,
      calls,
    } = createFakeFile();


    const inspection =
        createValidInspection({
          file,

          overrides: {
            allowed:
              false,
          },
        });


    const result =
        await deleteBackupRetentionStorageArtifact({
          inspection,
        });


    assert.strictEqual(
        result.action,
        DELETE_ACTIONS.BLOCKED,
    );

    assert(
        hasReason(
            result,
            "inspection-not-allowed",
        ),
    );

    assert.strictEqual(
        calls.length,
        0,
    );


    console.log(
        "âœ… ARTIFACT_VALID sem allowed â†’ nenhum delete()",
    );
  }


  // ==========================================================================
  // 5. GENERATION INVÃLIDA â†’ NÃƒO DELETA
  // ==========================================================================

  {
    const {
      file,
      calls,
    } = createFakeFile();


    const inspection =
        createValidInspection({
          file,

          overrides: {
            generation:
              "generation-invalida",
          },
        });


    const result =
        await deleteBackupRetentionStorageArtifact({
          inspection,
        });


    assert.strictEqual(
        result.action,
        DELETE_ACTIONS.BLOCKED,
    );

    assert(
        hasReason(
            result,
            "invalid-inspection-generation",
        ),
    );

    assert.strictEqual(
        calls.length,
        0,
    );


    console.log(
        "âœ… generation invÃ¡lida â†’ nenhum delete()",
    );
  }


  // ==========================================================================
  // 6. FILE INVÃLIDO â†’ NÃƒO DELETA
  // ==========================================================================

  {
    const inspection =
        createValidInspection({
          file: {},
        });


    const result =
        await deleteBackupRetentionStorageArtifact({
          inspection,
        });


    assert.strictEqual(
        result.action,
        DELETE_ACTIONS.BLOCKED,
    );

    assert(
        hasReason(
            result,
            "invalid-storage-file",
        ),
    );


    console.log(
        "âœ… file invÃ¡lido â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 7. ERRO 412 / PRECONDITION FAILED â†’ PROPAGA
  // ==========================================================================

  {
    const error =
        new Error(
            "Precondition Failed",
        );

    error.code =
        412;


    const {
      file,
      calls,
    } = createFakeFile({
      deleteError:
        error,
    });


    const inspection =
        createValidInspection({
          file,
        });


    let caught =
        null;


    try {
      await deleteBackupRetentionStorageArtifact({
        inspection,
      });
    } catch (caughtError) {
      caught =
          caughtError;
    }


       assert.strictEqual(
           caught,
           error,
       );

       assert.strictEqual(
           calls.length,
           2,
       );

       assert.strictEqual(
           calls[0].type,
           "getMetadata",
       );

       assert.strictEqual(
           calls[1].type,
           "delete",
       );

       assert.strictEqual(
           calls[1].options.ifGenerationMatch,
           GENERATION,
       );


    console.log(
        "âœ… generation mudou / erro 412 â†’ falha propagada",
    );
  }


  // ==========================================================================
  // 8. ERRO TEMPORÃRIO DO STORAGE â†’ PROPAGA
  // ==========================================================================

  {
    const error =
        new Error(
            "Storage temporariamente indisponÃ­vel",
        );

    error.code =
        503;


    const {
      file,
    } = createFakeFile({
      deleteError:
        error,
    });


    const inspection =
        createValidInspection({
          file,
        });


    let caught =
        null;


    try {
      await deleteBackupRetentionStorageArtifact({
        inspection,
      });
    } catch (caughtError) {
      caught =
          caughtError;
    }


    assert.strictEqual(
        caught,
        error,
    );


    console.log(
        "âœ… erro 503 â†’ propagado, operaÃ§Ã£o nÃ£o finge sucesso",
    );
  }


    // ==========================================================================
    // 9. GENERATION MUDOU ENTRE INSPEÃ‡ÃƒO E DELETE â†’ BLOCKED
    // ==========================================================================

    {
      const {
        file,
        calls,
      } = createFakeFile({
        metadata: {
          generation:
            "9999999999999999",

          metadata: {
            storeId:
              STORE_ID,

            backupId:
              BACKUP_ID,

            checksumSha256:
              VALID_CHECKSUM,
          },
        },
      });


      const inspection =
          createValidInspection({
            file,
          });


      const result =
          await deleteBackupRetentionStorageArtifact({
            inspection,
          });


      assert.strictEqual(
          result.action,
          DELETE_ACTIONS.BLOCKED,
      );

      assert.strictEqual(
          result.allowed,
          false,
      );

      assert(
          hasReason(
              result,
              "storage-generation-changed-before-delete",
          ),
      );


      assert.strictEqual(
          calls.length,
          1,
      );

      assert.strictEqual(
          calls[0].type,
          "getMetadata",
      );


      console.log(
          "âœ… generation mudou antes do delete â†’ BLOCKED sem delete()",
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
      "âœ… TODOS OS TESTES DO DELETE FÃSICO PASSARAM",
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