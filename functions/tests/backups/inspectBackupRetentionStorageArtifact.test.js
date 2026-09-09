"use strict";


const assert =
    require("assert");

const {
  inspectBackupRetentionStorageArtifact,
  ACTIONS,
} = require(
    "../../backups/inspectBackupRetentionStorageArtifact",
);


// ============================================================================
// STORE&CONNECT â€” TESTES DO INSPETOR DO ARTEFATO DE BACKUP
// ============================================================================
//
// F5.6-D3-G3.2
//
// âœ… Storage fake
// âœ… valida metadata fÃ­sica
//
// âŒ sem Firebase real
// âŒ sem Firestore
// âŒ sem Storage real
// âŒ sem delete()
//
// ============================================================================


const STORE_ID =
    "store-test";

const BACKUP_ID =
    "backup-test";

const VALID_CHECKSUM =
    "a".repeat(64);

const OTHER_CHECKSUM =
    "b".repeat(64);

const STORAGE_PATH =
    (
      `store_backups/` +
      `${STORE_ID}/` +
      `${BACKUP_ID}/` +
      `snapshot.json.gz`
    );


// ============================================================================
// HELPERS
// ============================================================================

function createMetadata(
    overrides = {},
) {
  return {
          generation:
            "1234567890123456",
    contentType:
      "application/gzip",

    metadata: {
      storeId:
        STORE_ID,

      backupId:
        BACKUP_ID,

      snapshotVersion:
        "1",

      checksumSha256:
        VALID_CHECKSUM,

      ...(
        overrides.customMetadata ||
        {}
      ),
    },

    ...overrides.rootMetadata,
  };
}


function createFakeBucket({
  metadata =
    createMetadata(),

  error =
    null,
} = {}) {
  const calls = [];


  const file = {
    async getMetadata() {
      calls.push({
        type:
          "getMetadata",
      });


      if (error) {
        throw error;
      }


      return [
        metadata,
      ];
    },
  };


  const bucket = {
    file(path) {
      calls.push({
        type:
          "file",

        path,
      });


      return file;
    },
  };


  return {
    bucket,
    file,
    calls,
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


async function inspect({
  bucket,
  storeId =
    STORE_ID,

  backupId =
    BACKUP_ID,

  storagePath =
    STORAGE_PATH,

  checksum =
    VALID_CHECKSUM,
}) {
  return inspectBackupRetentionStorageArtifact({
    bucket,
    storeId,
    backupId,
    storagePath,
    checksum,
  });
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
      "F5.6-D3-G3.2 â€” INSPEÃ‡ÃƒO DO ARTEFATO NO STORAGE",
  );

  console.log(
      "============================================================",
  );


  // ==========================================================================
  // 1. ARTEFATO VÃLIDO
  // ==========================================================================

  {
    const {
      bucket,
      file,
      calls,
    } = createFakeBucket();


    const result =
        await inspect({
          bucket,
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
        VALID_CHECKSUM,
    );

    assert.strictEqual(
        result.file,
        file,
    );

    assert.strictEqual(
        calls.length,
        2,
    );

    assert.strictEqual(
        calls[0].type,
        "file",
    );

    assert.strictEqual(
        calls[1].type,
        "getMetadata",
    );


    console.log(
        "âœ… artefato Ã­ntegro â†’ ARTIFACT_VALID",
    );
  }


  // ==========================================================================
  // 2. ARQUIVO JÃ NÃƒO EXISTE
  // ==========================================================================

  {
    const error =
        new Error(
            "Not Found",
        );

    error.code =
        404;


    const {
      bucket,
    } = createFakeBucket({
      error,
    });


    const result =
        await inspect({
          bucket,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.ARTIFACT_ALREADY_MISSING,
    );

    assert.strictEqual(
        result.allowed,
        true,
    );


    console.log(
        "âœ… arquivo ausente â†’ ARTIFACT_ALREADY_MISSING",
    );
  }


  // ==========================================================================
  // 3. STORAGE PATH NÃƒO CANÃ”NICO
  // ==========================================================================

  {
    const {
      bucket,
      calls,
    } = createFakeBucket();


    const result =
        await inspect({
          bucket,

          storagePath:
            (
              "store_backups/store-test/" +
              "outro-backup/snapshot.json.gz"
            ),
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        result.allowed,
        false,
    );

    assert(
        hasReason(
            result,
            "non-canonical-storage-path",
        ),
    );

    assert.strictEqual(
        calls.length,
        0,
    );


    console.log(
        "âœ… storagePath nÃ£o canÃ´nico â†’ BLOCKED antes de acessar objeto",
    );
  }


  // ==========================================================================
  // 4. STORE ID FÃSICO DIVERGENTE
  // ==========================================================================

  {
    const {
      bucket,
    } = createFakeBucket({
      metadata:
        createMetadata({
          customMetadata: {
            storeId:
              "outra-store",
          },
        }),
    });


    const result =
        await inspect({
          bucket,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert(
        hasReason(
            result,
            "storage-store-id-mismatch",
        ),
    );


    console.log(
        "âœ… storeId do objeto divergente â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 5. BACKUP ID FÃSICO DIVERGENTE
  // ==========================================================================

  {
    const {
      bucket,
    } = createFakeBucket({
      metadata:
        createMetadata({
          customMetadata: {
            backupId:
              "outro-backup",
          },
        }),
    });


    const result =
        await inspect({
          bucket,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert(
        hasReason(
            result,
            "storage-backup-id-mismatch",
        ),
    );


    console.log(
        "âœ… backupId do objeto divergente â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 6. CUSTOM METADATA AUSENTE
  // ==========================================================================

  {
    const {
      bucket,
    } = createFakeBucket({
      metadata: {
        contentType:
          "application/gzip",
      },
    });


    const result =
        await inspect({
          bucket,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert(
        hasReason(
            result,
            "missing-custom-storage-metadata",
        ),
    );


    console.log(
        "âœ… custom metadata ausente â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 7. CHECKSUM FÃSICO INVÃLIDO
  // ==========================================================================

  {
    const {
      bucket,
    } = createFakeBucket({
      metadata:
        createMetadata({
          customMetadata: {
            checksumSha256:
              "checksum-invalido",
          },
        }),
    });


    const result =
        await inspect({
          bucket,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert(
        hasReason(
            result,
            "invalid-storage-checksum",
        ),
    );


    console.log(
        "âœ… checksumSha256 fÃ­sico invÃ¡lido â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 8. CHECKSUM FÃSICO DIVERGENTE
  // ==========================================================================

  {
    const {
      bucket,
    } = createFakeBucket({
      metadata:
        createMetadata({
          customMetadata: {
            checksumSha256:
              OTHER_CHECKSUM,
          },
        }),
    });


    const result =
        await inspect({
          bucket,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert(
        hasReason(
            result,
            "storage-checksum-mismatch",
        ),
    );


    console.log(
        "âœ… checksum fÃ­sico divergente â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 9. METADATA INVÃLIDA
  // ==========================================================================

  {
    const {
      bucket,
    } = createFakeBucket({
      metadata:
        null,
    });


    const result =
        await inspect({
          bucket,
        });


    assert.strictEqual(
        result.action,
        ACTIONS.BLOCKED,
    );

    assert(
        hasReason(
            result,
            "invalid-storage-metadata",
        ),
    );


    console.log(
        "âœ… metadata fÃ­sica invÃ¡lida â†’ BLOCKED",
    );
  }


  // ==========================================================================
  // 10. ERRO DIFERENTE DE NOT FOUND DEVE PROPAGAR
  // ==========================================================================

  {
    const unexpectedError =
        new Error(
            "Falha temporÃ¡ria do Storage",
        );

    unexpectedError.code =
        503;


    const {
      bucket,
    } = createFakeBucket({
      error:
        unexpectedError,
    });


    let caught =
        null;


    try {
      await inspect({
        bucket,
      });
    } catch (error) {
      caught =
          error;
    }


    assert.strictEqual(
        caught,
        unexpectedError,
    );


    console.log(
        "âœ… erro inesperado do Storage â†’ propagado, sem mascarar falha",
    );
  }



    // ==========================================================================
    // 11. GENERATION INVÃLIDA
    // ==========================================================================

    {
      const {
        bucket,
      } = createFakeBucket({
        metadata:
          createMetadata({
            rootMetadata: {
              generation:
                "generation-invalida",
            },
          }),
      });


      const result =
          await inspect({
            bucket,
          });


      assert.strictEqual(
          result.action,
          ACTIONS.BLOCKED,
      );

      assert.strictEqual(
          result.allowed,
          false,
      );

      assert(
          hasReason(
              result,
              "invalid-storage-generation",
          ),
      );


      console.log(
          "âœ… generation invÃ¡lida â†’ BLOCKED",
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
      "âœ… TODOS OS TESTES DO INSPETOR DO STORAGE PASSARAM",
  );

  console.log(
      "============================================================",
  );

  console.log("");
}


// ============================================================================
// EXECUTA
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