"use strict";


const {
  validateRetentionDeleteCandidate,
} = require("./backupRetention");


// ============================================================================
// STORE&CONNECT — PURE CLAIM PLANNER
// ============================================================================
//
// F5.6-D3-D
//
// Este arquivo NÃO:
// - acessa Firestore;
// - acessa Firebase Storage;
// - grava documentos;
// - exclui documentos;
// - exclui arquivos.
//
// Responsabilidade:
//
// receber o estado atual de:
//
// - snapshot;
// - retentionDelete;
// - política de retenção;
// - lease;
//
// e retornar SOMENTE uma decisão.
//
// ============================================================================


const ACTIONS = Object.freeze({
  CREATE_CLAIM:
    "CREATE_CLAIM",

  RESUME:
    "RESUME",

  SKIP_LEASED:
    "SKIP_LEASED",

  ALREADY_COMPLETED:
    "ALREADY_COMPLETED",

  BLOCKED:
    "BLOCKED",

  NOT_ALLOWED:
    "NOT_ALLOWED",
});


const RESUME_STAGES = Object.freeze({
  STORAGE_DELETE:
    "storage_delete",

  FINALIZE:
    "finalize",
});


const OPERATION_STATUSES =
    new Set([
      "claimed",
      "storage_deleted",
      "completed",
      "blocked",
    ]);


// ============================================================================
// NORMALIZA DATA
// ============================================================================

function normalizeDate(value) {
  if (!value) {
    return null;
  }


  if (
    typeof value.toDate === "function"
  ) {
    const date =
        value.toDate();

    return Number.isNaN(
        date.getTime(),
    )
      ? null
      : date;
  }


  if (value instanceof Date) {
    return Number.isNaN(
        value.getTime(),
    )
      ? null
      : value;
  }


  const date =
      new Date(value);

  return Number.isNaN(
      date.getTime(),
  )
    ? null
    : date;
}


// ============================================================================
// CHECKSUM SHA-256
// ============================================================================

function isValidSha256(value) {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{64}$/i.test(
        value.trim(),
    )
  );
}


// ============================================================================
// NORMALIZA CHECKSUM DO SNAPSHOT
// ============================================================================
//
// O metadata oficial criado por createStoreSnapshot.js utiliza:
//
//   checksumSha256
//
// A máquina interna da retenção utiliza:
//
//   checksum
//
// Durante a transição aceitamos ambas as formas, mas:
//
// - normalizamos para lowercase;
// - se ambas existirem, precisam ser idênticas;
// - divergência é tratada como inconsistência de integridade.
//
// ============================================================================

function normalizeChecksum(
    value,
) {
  if (
    typeof value !==
      "string"
  ) {
    return "";
  }


  return value
      .trim()
      .toLowerCase();
}


function resolveSnapshotChecksum(
    snapshot,
) {
  if (
    !snapshot ||
    typeof snapshot !==
      "object" ||
    Array.isArray(snapshot)
  ) {
    return {
      valid:
        false,

      conflict:
        false,

      checksum:
        "",
    };
  }


  const canonicalChecksum =
      normalizeChecksum(
          snapshot.checksum,
      );

  const officialChecksum =
      normalizeChecksum(
          snapshot.checksumSha256,
      );


  // --------------------------------------------------------------------------
  // AMBOS EXISTEM → DEVEM SER IGUAIS
  // --------------------------------------------------------------------------

  if (
    canonicalChecksum &&
    officialChecksum &&
    canonicalChecksum !==
      officialChecksum
  ) {
    return {
      valid:
        false,

      conflict:
        true,

      checksum:
        "",
    };
  }


  const resolvedChecksum =
      officialChecksum ||
      canonicalChecksum;


  return {
    valid:
      isValidSha256(
          resolvedChecksum,
      ),

    conflict:
      false,

    checksum:
      resolvedChecksum,
  };
}


// ============================================================================
// STORAGE PATH CANÔNICO
// ============================================================================

function getExpectedStoragePath({
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


// ============================================================================
// COMPARA DATAS
// ============================================================================

function sameDate(
    first,
    second,
) {
  const a =
      normalizeDate(first);

  const b =
      normalizeDate(second);


  if (!a || !b) {
    return false;
  }


  return (
    a.getTime() ===
    b.getTime()
  );
}


// ============================================================================
// RESULTADO BLOCKED
// ============================================================================

function blockedResult(
    reasons,
) {
  return {
    action:
      ACTIONS.BLOCKED,

    allowed:
      false,

    reasons,
  };
}


// ============================================================================
// VALIDA IDENTIDADE DO SNAPSHOT EM OPERAÇÃO EXISTENTE
// ============================================================================

function validateExistingOperationIntegrity({
  storeId,
  backupId,
  snapshot,
  operation,
}) {
  const reasons = [];


  // --------------------------------------------------------------------------
  // OPERAÇÃO
  // --------------------------------------------------------------------------

  if (
    !operation ||
    typeof operation !== "object" ||
    Array.isArray(operation)
  ) {
    reasons.push({
      code:
        "invalid-operation",

      message:
        "A operação de retenção é inválida.",
    });

    return reasons;
  }


  if (
    String(
        operation.storeId || "",
    ).trim() !== storeId
  ) {
    reasons.push({
      code:
        "operation-store-id-mismatch",

      message:
        "O storeId da operação não corresponde à loja processada.",
    });
  }


  if (
    String(
        operation.backupId || "",
    ).trim() !== backupId
  ) {
    reasons.push({
      code:
        "operation-backup-id-mismatch",

      message:
        "O backupId da operação não corresponde ao backup processado.",
    });
  }


  if (
    !OPERATION_STATUSES.has(
        operation.status,
    )
  ) {
    reasons.push({
      code:
        "invalid-operation-status",

      message:
        "A operação possui status inválido.",
    });
  }


  // --------------------------------------------------------------------------
  // COMPLETED NÃO DEVE POSSUIR SNAPSHOT
  // --------------------------------------------------------------------------

  if (
    operation.status ===
      "completed"
  ) {
    if (snapshot) {
      reasons.push({
        code:
          "completed-snapshot-still-exists",

        message:
          (
            "A operação está completed, mas a metadata " +
            "do snapshot ainda existe."
          ),
      });
    }

    return reasons;
  }


  // --------------------------------------------------------------------------
  // BLOCKED É ESTADO TERMINAL AUTOMÁTICO
  // --------------------------------------------------------------------------

  if (
    operation.status ===
      "blocked"
  ) {
    return reasons;
  }


  // --------------------------------------------------------------------------
  // CLAIMED / STORAGE_DELETED EXIGEM SNAPSHOT
  // --------------------------------------------------------------------------

  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot)
  ) {
    reasons.push({
      code:
        "snapshot-missing-for-active-operation",

      message:
        (
          "Uma operação ativa exige que a metadata " +
          "do snapshot ainda exista."
        ),
    });

    return reasons;
  }


  // --------------------------------------------------------------------------
  // SNAPSHOT PRECISA ESTAR DELETING
  // --------------------------------------------------------------------------

  if (
    snapshot.status !==
      "deleting"
  ) {
    reasons.push({
      code:
        "snapshot-not-deleting",

      message:
        (
          "Uma operação ativa exige snapshot " +
          "com status deleting."
        ),
    });
  }


  // --------------------------------------------------------------------------
  // VÍNCULO OPERAÇÃO ↔ SNAPSHOT
  // --------------------------------------------------------------------------

  if (
    String(
        snapshot.retentionDeleteOperationId ||
        "",
    ).trim() !== backupId
  ) {
    reasons.push({
      code:
        "snapshot-operation-id-mismatch",

      message:
        (
          "O snapshot não está vinculado à operação " +
          "de retenção esperada."
        ),
    });
  }


  if (
    snapshot.retentionDeleteReason !==
      "retention_policy"
  ) {
    reasons.push({
      code:
        "invalid-retention-delete-reason",

      message:
        "O motivo da exclusão do snapshot é inválido.",
    });
  }


  // --------------------------------------------------------------------------
  // IDENTIDADE BÁSICA DO SNAPSHOT
  // --------------------------------------------------------------------------

  if (
    snapshot.type !==
      "automatic"
  ) {
    reasons.push({
      code:
        "snapshot-not-automatic",

      message:
        "O snapshot da operação não é automático.",
    });
  }


  if (
    String(
        snapshot.storeId || "",
    ).trim() !== storeId
  ) {
    reasons.push({
      code:
        "snapshot-store-id-mismatch",

      message:
        "O storeId do snapshot é divergente.",
    });
  }


  // --------------------------------------------------------------------------
  // SNAPSHOT CONGELADO NA OPERAÇÃO
  // --------------------------------------------------------------------------

  const frozen =
      operation.snapshot;


  if (
    !frozen ||
    typeof frozen !== "object" ||
    Array.isArray(frozen)
  ) {
    reasons.push({
      code:
        "invalid-frozen-snapshot",

      message:
        "A operação não possui snapshot congelado válido.",
    });

    return reasons;
  }


  if (
    frozen.type !==
      "automatic"
  ) {
    reasons.push({
      code:
        "frozen-snapshot-not-automatic",

      message:
        "O snapshot congelado possui tipo inválido.",
    });
  }


  if (
    frozen.originalStatus !==
      "ready"
  ) {
    reasons.push({
      code:
        "invalid-original-status",

      message:
        "O status original congelado deve ser ready.",
    });
  }


  // --------------------------------------------------------------------------
  // STORAGE PATH
  // --------------------------------------------------------------------------

  const expectedStoragePath =
      getExpectedStoragePath({
        storeId,
        backupId,
      });


  if (
    String(
        frozen.storagePath || "",
    ).trim() !==
      expectedStoragePath
  ) {
    reasons.push({
      code:
        "frozen-storage-path-mismatch",

      message:
        (
          "O storagePath congelado não corresponde " +
          "ao caminho canônico."
        ),
    });
  }


  if (
    String(
        snapshot.storagePath || "",
    ).trim() !==
      expectedStoragePath
  ) {
    reasons.push({
      code:
        "snapshot-storage-path-mismatch",

      message:
        (
          "O storagePath atual do snapshot não corresponde " +
          "ao caminho canônico."
        ),
    });
  }


  if (
    String(
        snapshot.storagePath || "",
    ).trim() !==
      String(
          frozen.storagePath || "",
      ).trim()
  ) {
    reasons.push({
      code:
        "storage-path-changed-after-claim",

      message:
        (
          "O storagePath atual diverge do valor " +
          "congelado no CLAIM."
        ),
    });
  }


   // --------------------------------------------------------------------------
   // CHECKSUM
   // --------------------------------------------------------------------------

   const frozenChecksum =
       resolveSnapshotChecksum(
           frozen,
       );

   const currentChecksum =
       resolveSnapshotChecksum(
           snapshot,
       );


   // --------------------------------------------------------------------------
   // CONFLITO ENTRE checksum E checksumSha256
   // --------------------------------------------------------------------------

   if (
     frozenChecksum.conflict ===
       true
   ) {
     reasons.push({
       code:
         "frozen-checksum-fields-conflict",

       message:
         (
           "O snapshot congelado possui checksum e " +
           "checksumSha256 divergentes."
         ),
     });
   } else if (
     frozenChecksum.valid !==
       true
   ) {
     reasons.push({
       code:
         "invalid-frozen-checksum",

       message:
         "O checksum congelado é inválido.",
     });
   }


   if (
     currentChecksum.conflict ===
       true
   ) {
     reasons.push({
       code:
         "current-checksum-fields-conflict",

       message:
         (
           "O snapshot atual possui checksum e " +
           "checksumSha256 divergentes."
         ),
     });
   } else if (
     currentChecksum.valid !==
       true
   ) {
     reasons.push({
       code:
         "invalid-current-checksum",

       message:
         "O checksum atual do snapshot é inválido.",
     });
   }


   // --------------------------------------------------------------------------
   // COMPARAÇÃO APÓS NORMALIZAÇÃO
   // --------------------------------------------------------------------------

   if (
     frozenChecksum.valid ===
       true &&
     currentChecksum.valid ===
       true &&
     frozenChecksum.checksum !==
       currentChecksum.checksum
   ) {
     reasons.push({
       code:
         "checksum-changed-after-claim",

       message:
         (
           "O checksum atual diverge do checksum " +
           "congelado no CLAIM."
         ),
     });
   }



  // --------------------------------------------------------------------------
  // CREATED AT
  // --------------------------------------------------------------------------

  if (
    !sameDate(
        snapshot.createdAt,
        frozen.createdAt,
    )
  ) {
    reasons.push({
      code:
        "created-at-changed-after-claim",

      message:
        (
          "O createdAt atual diverge do createdAt " +
          "congelado no CLAIM."
        ),
    });
  }


  return reasons;
}


// ============================================================================
// ANALISA LEASE
// ============================================================================

function evaluateLease({
  operation,
  executionId,
  now,
}) {
  const leaseOwner =
      String(
          operation.leaseOwner || "",
      ).trim();

  const normalizedExecutionId =
      String(
          executionId || "",
      ).trim();

  const currentDate =
      normalizeDate(now);

  const leaseExpiresAt =
      normalizeDate(
          operation.leaseExpiresAt,
      );


  if (
    !normalizedExecutionId
  ) {
    return {
      valid:
        false,

      reason: {
        code:
          "missing-execution-id",

        message:
          "executionId não informado.",
      },
    };
  }


  if (!currentDate) {
    return {
      valid:
        false,

      reason: {
        code:
          "invalid-current-time",

        message:
          "Horário atual inválido.",
      },
    };
  }


  if (
    !leaseOwner ||
    !leaseExpiresAt
  ) {
    return {
      valid:
        false,

      reason: {
        code:
          "invalid-operation-lease",

        message:
          "A operação ativa possui lease inválido.",
      },
    };
  }


  if (
    leaseOwner ===
      normalizedExecutionId
  ) {
    return {
      valid:
        true,

      canResume:
        true,

      shouldTakeOver:
        false,
    };
  }


  if (
    leaseExpiresAt.getTime() <=
      currentDate.getTime()
  ) {
    return {
      valid:
        true,

      canResume:
        true,

      shouldTakeOver:
        true,
    };
  }


  return {
    valid:
      true,

    canResume:
      false,

    shouldTakeOver:
      false,

    leaseOwner,

    leaseExpiresAt:
      leaseExpiresAt.toISOString(),
  };
}


// ============================================================================
// PLANNER PRINCIPAL
// ============================================================================

function planRetentionDeleteClaim({
  storeId,
  backupId,
  snapshot,
  operation = null,
  allBackups,
  executionId,
  now,
}) {
  const normalizedStoreId =
      String(
          storeId || "",
      ).trim();

  const normalizedBackupId =
      String(
          backupId || "",
      ).trim();


  // --------------------------------------------------------------------------
  // IDENTIFICADORES BÁSICOS
  // --------------------------------------------------------------------------

  if (
    !normalizedStoreId ||
    !normalizedBackupId
  ) {
    return blockedResult([
      {
        code:
          "missing-identifiers",

        message:
          "storeId e backupId são obrigatórios.",
      },
    ]);
  }


  // ==========================================================================
  // NÃO EXISTE OPERAÇÃO → ANALISA NOVO CLAIM
  // ==========================================================================

  if (!operation) {
    // ------------------------------------------------------------------------
    // SNAPSHOT PRECISA EXISTIR
    // ------------------------------------------------------------------------

    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      Array.isArray(snapshot)
    ) {
      return {
        action:
          ACTIONS.NOT_ALLOWED,

        allowed:
          false,

        reasons: [
          {
            code:
              "snapshot-not-found",

            message:
              "Snapshot não encontrado para criação do CLAIM.",
          },
        ],
      };
    }


    // ------------------------------------------------------------------------
    // NÃO PODE JÁ ESTAR VINCULADO A OUTRA OPERAÇÃO
    // ------------------------------------------------------------------------

    if (
      snapshot.retentionDeleteOperationId !==
        undefined &&
      snapshot.retentionDeleteOperationId !==
        null
    ) {
      return blockedResult([
        {
          code:
            "unexpected-existing-operation-link",

          message:
            (
              "O snapshot já possui retentionDeleteOperationId, " +
              "mas nenhuma operação foi fornecida."
            ),
        },
      ]);
    }


    // ------------------------------------------------------------------------
    // CHECKSUM OBRIGATÓRIO
    // ------------------------------------------------------------------------

        const snapshotChecksum =
            resolveSnapshotChecksum(
                snapshot,
            );


        if (
          snapshotChecksum.conflict ===
            true
        ) {
          return blockedResult([
            {
              code:
                "snapshot-checksum-fields-conflict",

              message:
                (
                  "O snapshot possui checksum e checksumSha256 " +
                  "com valores divergentes."
                ),
            },
          ]);
        }


        if (
          snapshotChecksum.valid !==
            true
        ) {
          return blockedResult([
            {
              code:
                "invalid-snapshot-checksum",

              message:
                (
                  "O snapshot não possui checksum SHA-256 " +
                  "válido para criação do CLAIM."
                ),
            },
          ]);
        }

    // ------------------------------------------------------------------------
    // EXECUÇÃO OBRIGATÓRIA PARA NOVO CLAIM
    // ------------------------------------------------------------------------
    //
    // Um novo CLAIM futuramente criará um lease.
    //
    // Portanto não pode existir CREATE_CLAIM sem:
    //
    // - executionId válido;
    // - horário atual válido.
    //
    // ------------------------------------------------------------------------

    const normalizedExecutionId =
        String(
            executionId || "",
        ).trim();


    if (!normalizedExecutionId) {
      return blockedResult([
        {
          code:
            "missing-execution-id",

          message:
            "executionId não informado para criação do CLAIM.",
        },
      ]);
    }


    const currentDate =
        normalizeDate(now);


    if (!currentDate) {
      return blockedResult([
        {
          code:
            "invalid-current-time",

          message:
            "Horário atual inválido para criação do CLAIM.",
        },
      ]);
    }



    // ------------------------------------------------------------------------
    // VALIDADOR OFICIAL DA RETENÇÃO
    // ------------------------------------------------------------------------

    const validation =
        validateRetentionDeleteCandidate({
          storeId:
            normalizedStoreId,

          backupId:
            normalizedBackupId,

          backupData:
            snapshot,

          allBackups,
        });


    if (
      validation.allowed !==
        true
    ) {
      return {
        action:
          ACTIONS.NOT_ALLOWED,

        allowed:
          false,

        reasons:
          validation.reasons || [],
      };
    }


    // ------------------------------------------------------------------------
    // CREATE CLAIM
    // ------------------------------------------------------------------------

    return {
      action:
        ACTIONS.CREATE_CLAIM,

      allowed:
        true,

      reasons: [],

      storeId:
        normalizedStoreId,

      backupId:
        normalizedBackupId,

      frozenSnapshot: {
        type:
          snapshot.type,

        originalStatus:
          snapshot.status,

        createdAt:
          snapshot.createdAt,

        storagePath:
          validation.storagePath,

        checksum:
          snapshotChecksum.checksum,
        compressedBytes:
          Number.isFinite(
              snapshot.compressedBytes,
          )
            ? snapshot.compressedBytes
            : null,
      },
    };
  }


  // ==========================================================================
  // OPERAÇÃO JÁ EXISTE
  // ==========================================================================

  const integrityReasons =
      validateExistingOperationIntegrity({
        storeId:
          normalizedStoreId,

        backupId:
          normalizedBackupId,

        snapshot,

        operation,
      });


  if (
    integrityReasons.length >
      0
  ) {
    return blockedResult(
        integrityReasons,
    );
  }


  // --------------------------------------------------------------------------
  // COMPLETED
  // --------------------------------------------------------------------------

  if (
    operation.status ===
      "completed"
  ) {
    return {
      action:
        ACTIONS.ALREADY_COMPLETED,

      allowed:
        false,

      reasons: [],
    };
  }


  // --------------------------------------------------------------------------
  // BLOCKED
  // --------------------------------------------------------------------------

  if (
    operation.status ===
      "blocked"
  ) {
    return {
      action:
        ACTIONS.BLOCKED,

      allowed:
        false,

      reasons: [
        {
          code:
            "operation-already-blocked",

          message:
            (
              "A operação já está blocked e não pode " +
              "continuar automaticamente."
            ),
        },
      ],
    };
  }


  // --------------------------------------------------------------------------
  // CLAIMED / STORAGE_DELETED → LEASE
  // --------------------------------------------------------------------------

  const lease =
      evaluateLease({
        operation,

        executionId,

        now,
      });


  if (!lease.valid) {
    return blockedResult([
      lease.reason,
    ]);
  }


  if (
    lease.canResume !==
      true
  ) {
    return {
      action:
        ACTIONS.SKIP_LEASED,

      allowed:
        false,

      reasons: [],

      leaseOwner:
        lease.leaseOwner,

      leaseExpiresAt:
        lease.leaseExpiresAt,
    };
  }


  // --------------------------------------------------------------------------
  // RESUME
  // --------------------------------------------------------------------------

  return {
    action:
      ACTIONS.RESUME,

    allowed:
      true,

    reasons: [],

    resumeStage:
      operation.status ===
        "storage_deleted"
        ? RESUME_STAGES.FINALIZE
        : RESUME_STAGES.STORAGE_DELETE,

    shouldTakeOverLease:
      lease.shouldTakeOver ===
        true,
  };
}


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  planRetentionDeleteClaim,

  ACTIONS,
  RESUME_STAGES,

  isValidSha256,
  getExpectedStoragePath,
  resolveSnapshotChecksum,
};