"use strict";


const assert =
    require("assert");

const {
  claimBackupRetentionDelete,
  LEASE_MINUTES,
} = require(
    "../../backups/claimBackupRetentionDelete",
);

const {
  ACTIONS,
} = require(
    "../../backups/backupRetentionClaimPlanner",
);


// ============================================================================
// STORE&CONNECT â€” TESTES LOCAIS DA TRANSACTION DE CLAIM
// ============================================================================
//
// F5.6-D3-E
//
// Estes testes usam um Firestore FAKE em memÃ³ria.
//
// âŒ sem Firebase real
// âŒ sem Firestore real
// âŒ sem Storage
// âŒ sem deploy
// âŒ sem delete()
//
// ============================================================================


const STORE_ID =
    "store-test";

const EXECUTION_ID =
    "execution-test";

const VALID_CHECKSUM =
    "a".repeat(64);

const NOW =
    new Date(
        "2026-09-30T12:00:00.000Z",
    );


// ============================================================================
// HELPERS DE BACKUP
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


function createBackup(
    date,
) {
  const backupId =
      `backup-${date}-automatic-ready`;

  return {
    backupId,

    data: {
      storeId:
        STORE_ID,

      type:
        "automatic",

      status:
        "ready",

      protected:
        false,

      createdAt:
        `${date}T12:00:00.000Z`,

      storagePath:
        storagePath(
            backupId,
        ),

      checksum:
        VALID_CHECKSUM,

      compressedBytes:
        123456,
    },
  };
}


function createRetentionDataset() {
  const dates = [
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

  return dates.map(
      createBackup,
  );
}


// ============================================================================
// FIRESTORE FAKE
// ============================================================================

function createFakeFirestore({
  backups,
  existingOperation = null,
}) {
  const operations = [];

  const references =
      new Map();


  function makeRef(
      path,
      kind,
  ) {
    const ref = {
      path,
      kind,

      doc(id) {
        return makeRef(
            `${path}/${id}`,
            "document",
        );
      },

      collection(name) {
        return makeRef(
            `${path}/${name}`,
            "collection",
        );
      },
    };

    references.set(
        path,
        ref,
    );

    return ref;
  }


  const db = {
    collection(name) {
      return makeRef(
          name,
          "collection",
      );
    },


    async runTransaction(
        callback,
    ) {
      const transaction = {
        async get(ref) {
          operations.push({
            type:
              "get",

            path:
              ref.path,
          });


          if (
            ref.path ===
            (
              `storeBackups/${STORE_ID}/` +
              "retentionDeletes/" +
              TARGET_BACKUP_ID
            )
          ) {
            return {
              exists:
                existingOperation !== null,

              data() {
                return existingOperation;
              },
            };
          }


          if (
            ref.path ===
            (
              `storeBackups/${STORE_ID}/` +
              "snapshots"
            )
          ) {
            return {
              docs:
                backups.map(
                    (backup) => ({
                      id:
                        backup.backupId,

                      data() {
                        return backup.data;
                      },
                    }),
                ),
            };
          }


          throw new Error(
              `GET inesperado: ${ref.path}`,
          );
        },


        create(
            ref,
            data,
        ) {
          operations.push({
            type:
              "create",

            path:
              ref.path,

            data,
          });
        },


        update(
            ref,
            data,
        ) {
          operations.push({
            type:
              "update",

            path:
              ref.path,

            data,
          });
        },
      };


      return callback(
          transaction,
      );
    },
  };


  return {
    db,
    operations,
  };
}


// ============================================================================
// ALVO PADRÃƒO
// ============================================================================

const TARGET_BACKUP_ID =
    "backup-2026-09-05-automatic-ready";


// ============================================================================
// INÃCIO
// ============================================================================

async function run() {
  console.log("");

  console.log(
      "============================================================",
  );

  console.log(
      "F5.6-D3-E â€” TESTES LOCAIS DA TRANSACTION DE CLAIM",
  );

  console.log(
      "============================================================",
  );


  // ==========================================================================
  // 1. CANDIDATO LEGÃTIMO â†’ DUAS ESCRITAS
  // ==========================================================================

  {
    const backups =
        createRetentionDataset();

    const {
      db,
      operations,
    } = createFakeFirestore({
      backups,
    });


    const result =
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
        result.action,
        ACTIONS.CREATE_CLAIM,
    );

    assert.strictEqual(
        result.wrote,
        true,
    );


    const creates =
        operations.filter(
            (operation) =>
              operation.type ===
              "create",
        );

    const updates =
        operations.filter(
            (operation) =>
              operation.type ===
              "update",
        );


    assert.strictEqual(
        creates.length,
        1,
    );

    assert.strictEqual(
        updates.length,
        1,
    );


    assert.strictEqual(
        creates[0].path,
        (
          `storeBackups/${STORE_ID}/` +
          `retentionDeletes/${TARGET_BACKUP_ID}`
        ),
    );


    assert.strictEqual(
        creates[0].data.status,
        "claimed",
    );

    assert.strictEqual(
        creates[0].data.reason,
        "retention_policy",
    );

    assert.strictEqual(
        creates[0].data.backupId,
        TARGET_BACKUP_ID,
    );

    assert.strictEqual(
        creates[0].data.storeId,
        STORE_ID,
    );

    assert.strictEqual(
        creates[0].data.leaseOwner,
        EXECUTION_ID,
    );

    assert.strictEqual(
        creates[0].data.snapshot.checksum,
        VALID_CHECKSUM,
    );

    assert.strictEqual(
        creates[0].data.snapshot.storagePath,
        storagePath(
            TARGET_BACKUP_ID,
        ),
    );


    assert.strictEqual(
        updates[0].path,
        (
          `storeBackups/${STORE_ID}/` +
          `snapshots/${TARGET_BACKUP_ID}`
        ),
    );

    assert.strictEqual(
        updates[0].data.status,
        "deleting",
    );

    assert.strictEqual(
        updates[0].data
            .retentionDeleteOperationId,
        TARGET_BACKUP_ID,
    );

    assert.strictEqual(
        updates[0].data
            .retentionDeleteReason,
        "retention_policy",
    );


    const expectedLeaseExpiration =
        new Date(
            NOW.getTime() +
            LEASE_MINUTES *
            60 *
            1000,
        ).toISOString();


    assert.strictEqual(
        result.leaseExpiresAt,
        expectedLeaseExpiration,
    );


    console.log(
        "âœ… candidato legÃ­timo â†’ CREATE_CLAIM + 2 writes",
    );
  }


  // ==========================================================================
  // 2. CANDIDATO VIROU KEEP â†’ ZERO WRITES
  // ==========================================================================

  {
    const backups =
        createRetentionDataset()
            .filter(
                (backup) =>
                  backup.backupId !==
                  "backup-2026-09-06-automatic-ready",
            );


    const {
      db,
      operations,
    } = createFakeFirestore({
      backups,
    });


    const result =
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
        result.action,
        ACTIONS.NOT_ALLOWED,
    );

    assert.strictEqual(
        result.wrote,
        false,
    );


    const writes =
        operations.filter(
            (operation) =>
              operation.type ===
                "create" ||
              operation.type ===
                "update",
        );


    assert.strictEqual(
        writes.length,
        0,
    );


    console.log(
        "âœ… candidato que virou KEEP â†’ zero writes",
    );
  }


  // ==========================================================================
  // 3. CHECKSUM INVÃLIDO â†’ ZERO WRITES
  // ==========================================================================

  {
    const backups =
        createRetentionDataset()
            .map(
                (backup) => {
                  if (
                    backup.backupId !==
                      TARGET_BACKUP_ID
                  ) {
                    return backup;
                  }


                  return {
                    ...backup,

                    data: {
                      ...backup.data,

                      checksum:
                        "checksum-invalido",
                    },
                  };
                },
            );


    const {
      db,
      operations,
    } = createFakeFirestore({
      backups,
    });


    const result =
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
        result.action,
        ACTIONS.BLOCKED,
    );

    assert.strictEqual(
        result.wrote,
        false,
    );


    const writes =
        operations.filter(
            (operation) =>
              operation.type ===
                "create" ||
              operation.type ===
                "update",
        );


    assert.strictEqual(
        writes.length,
        0,
    );


    console.log(
        "âœ… checksum invÃ¡lido â†’ zero writes",
    );
  }


  // ==========================================================================
  // 4. ORDEM: TODAS AS LEITURAS ANTES DAS ESCRITAS
  // ==========================================================================

  {
    const backups =
        createRetentionDataset();

    const {
      db,
      operations,
    } = createFakeFirestore({
      backups,
    });


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


    assert.deepStrictEqual(
        operations.map(
            (operation) =>
              operation.type,
        ),

        [
          "get",
          "get",
          "create",
          "update",
        ],
    );


    console.log(
        "âœ… transaction lÃª tudo antes de escrever",
    );
  }


  // ==========================================================================
  // 5. DB INVÃLIDO â†’ ERRO ANTES DA TRANSACTION
  // ==========================================================================

  {
    await assert.rejects(
        async () => {
          await claimBackupRetentionDelete({
            db:
              null,

            storeId:
              STORE_ID,

            backupId:
              TARGET_BACKUP_ID,

            executionId:
              EXECUTION_ID,

            now:
              NOW,
          });
        },

        /Firestore db invÃ¡lido/,
    );


    console.log(
        "âœ… db invÃ¡lido â†’ bloqueado antes da transaction",
    );
  }


  // ==========================================================================
  // 6. EXECUTION ID AUSENTE â†’ ERRO ANTES DA TRANSACTION
  // ==========================================================================

  {
    const backups =
        createRetentionDataset();

    const {
      db,
      operations,
    } = createFakeFirestore({
      backups,
    });


    await assert.rejects(
        async () => {
          await claimBackupRetentionDelete({
            db,

            storeId:
              STORE_ID,

            backupId:
              TARGET_BACKUP_ID,

            executionId:
              "",

            now:
              NOW,
          });
        },

        /executionId obrigatÃ³rio/,
    );


    assert.strictEqual(
        operations.length,
        0,
    );


    console.log(
        "âœ… executionId ausente â†’ zero transaction",
    );
  }


  // ==========================================================================
  // 7. SNAPSHOT NÃƒO EXISTE â†’ NOT_ALLOWED + ZERO WRITES
  // ==========================================================================

  {
    const backups =
        createRetentionDataset()
            .filter(
                (backup) =>
                  backup.backupId !==
                    TARGET_BACKUP_ID,
            );

    const {
      db,
      operations,
    } = createFakeFirestore({
      backups,
    });


    const result =
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
        result.action,
        ACTIONS.NOT_ALLOWED,
    );

    assert.strictEqual(
        result.wrote,
        false,
    );


    const writes =
        operations.filter(
            (operation) =>
              operation.type === "create" ||
              operation.type === "update",
        );


    assert.strictEqual(
        writes.length,
        0,
    );


    console.log(
        "âœ… snapshot inexistente â†’ NOT_ALLOWED + zero writes",
    );
  }


  // ==========================================================================
  // 8. OPERAÃ‡ÃƒO COMPLETED JÃ EXISTE â†’ NÃƒO RECRIA
  // ==========================================================================

  {
    const backups =
        createRetentionDataset()
            .filter(
                (backup) =>
                  backup.backupId !==
                    TARGET_BACKUP_ID,
            );


    const existingOperation = {
      version:
        1,

      storeId:
        STORE_ID,

      backupId:
        TARGET_BACKUP_ID,

      status:
        "completed",

      reason:
        "retention_policy",
    };


    const {
      db,
      operations,
    } = createFakeFirestore({
      backups,

      existingOperation,
    });


    const result =
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
        result.action,
        ACTIONS.ALREADY_COMPLETED,
    );

    assert.strictEqual(
        result.wrote,
        false,
    );


    const writes =
        operations.filter(
            (operation) =>
              operation.type === "create" ||
              operation.type === "update",
        );


    assert.strictEqual(
        writes.length,
        0,
    );


    console.log(
        "âœ… operaÃ§Ã£o completed existente â†’ zero writes / nÃ£o recriada",
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
      "âœ… TODOS OS TESTES LOCAIS DO CLAIM PASSARAM",
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