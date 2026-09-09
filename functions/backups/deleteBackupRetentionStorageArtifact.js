"use strict";


const {
  ACTIONS:
    INSPECTION_ACTIONS,

  isNotFoundError,
} = require(
    "./inspectBackupRetentionStorageArtifact",
);

const {
  isValidSha256,
} = require(
    "./backupRetentionClaimPlanner",
);


// ============================================================================
// STORE&CONNECT — DELETE FÍSICO DO ARTEFATO DE BACKUP
// ============================================================================
//
// F5.6-D3-G4.1
//
// Esta camada executa SOMENTE o delete físico de um artefato que já passou
// pela inspeção de identidade.
//
// Segurança:
//
// ✅ exige ARTIFACT_VALID;
// ✅ exige allowed === true;
// ✅ exige generation válida;
// ✅ usa ifGenerationMatch;
// ✅ trata arquivo já ausente de forma idempotente;
//
// NÃO:
//
// ❌ altera Firestore;
// ❌ muda status da retentionDelete;
// ❌ finaliza operação;
// ❌ cria audit log.
//
// ============================================================================


// ============================================================================
// ACTIONS
// ============================================================================

const ACTIONS =
    Object.freeze({
      STORAGE_ABSENCE_CONFIRMED:
        "STORAGE_ABSENCE_CONFIRMED",

      BLOCKED:
        "BLOCKED",
    });


// ============================================================================
// HELPERS
// ============================================================================

function blocked(
    code,
    message,
) {
  return {
    action:
      ACTIONS.BLOCKED,

    allowed:
      false,

    reasons: [
      {
        code,
        message,
      },
    ],
  };
}


function normalizeString(
    value,
) {
  return typeof value ===
    "string"
    ? value.trim()
    : "";
}


// ============================================================================
// DELETE
// ============================================================================

async function deleteBackupRetentionStorageArtifact({
  inspection,
}) {
  // --------------------------------------------------------------------------
  // INSPEÇÃO OBRIGATÓRIA
  // --------------------------------------------------------------------------

  if (
    !inspection ||
    typeof inspection !==
      "object" ||
    Array.isArray(
        inspection,
    )
  ) {
    return blocked(
        "invalid-inspection",
        "A inspeção do artefato é obrigatória.",
    );
  }


    // --------------------------------------------------------------------------
    // ARTEFATO JÁ AUSENTE
    // --------------------------------------------------------------------------
    //
    // Cenário de recuperação:
    //
    // delete físico ocorreu
    // → processo caiu antes de atualizar Firestore
    // → retry inspeciona novamente
    // → arquivo já não existe
    //
    // Nesse caso a ausência física já está confirmada e NÃO devemos
    // tentar executar um segundo delete().
    //
    // --------------------------------------------------------------------------

    if (
      inspection.action ===
        INSPECTION_ACTIONS.ARTIFACT_ALREADY_MISSING
    ) {
      if (
        inspection.allowed !==
          true
      ) {
        return blocked(
            "missing-artifact-inspection-not-allowed",
            (
              "A inspeção informou arquivo ausente, " +
              "mas não autorizou a continuidade."
            ),
        );
      }


      const storeId =
          normalizeString(
              inspection.storeId,
          );

      const backupId =
          normalizeString(
              inspection.backupId,
          );

      const storagePath =
          normalizeString(
              inspection.storagePath,
          );


      if (
        !storeId ||
        !backupId ||
        !storagePath
      ) {
        return blocked(
            "invalid-missing-artifact-identity",
            (
              "A inspeção do arquivo ausente não possui " +
              "identidade completa."
            ),
        );
      }


      return {
        action:
          ACTIONS.STORAGE_ABSENCE_CONFIRMED,

        allowed:
          true,

        storeId,

        backupId,

        storagePath,

        generation:
          null,

        alreadyMissing:
          true,

        reasons: [],
      };
    }


  if (
    inspection.action !==
      INSPECTION_ACTIONS.ARTIFACT_VALID
  ) {
    return blocked(
        "inspection-not-artifact-valid",
        (
          "O artefato não recebeu autorização " +
          "ARTIFACT_VALID para exclusão."
        ),
    );
  }


  if (
    inspection.allowed !==
      true
  ) {
    return blocked(
        "inspection-not-allowed",
        "A inspeção não autorizou a exclusão física.",
    );
  }


  // --------------------------------------------------------------------------
  // IDENTIDADE
  // --------------------------------------------------------------------------

  const storeId =
      normalizeString(
          inspection.storeId,
      );

  const backupId =
      normalizeString(
          inspection.backupId,
      );

  const storagePath =
      normalizeString(
          inspection.storagePath,
      );

  const generation =
      normalizeString(
          inspection.generation,
      );


  if (
    !storeId ||
    !backupId ||
    !storagePath
  ) {
    return blocked(
        "invalid-inspection-identity",
        (
          "A inspeção não possui identidade completa " +
          "do artefato."
        ),
    );
  }


  if (
    !generation ||
    !/^\d+$/.test(
        generation,
    )
  ) {
    return blocked(
        "invalid-inspection-generation",
        (
          "A inspeção não possui generation válida " +
          "para exclusão condicionada."
        ),
    );
  }


  // --------------------------------------------------------------------------
  // FILE
  // --------------------------------------------------------------------------

  const file =
      inspection.file;


    if (
      !file ||
      typeof file.delete !==
        "function" ||
      typeof file.getMetadata !==
        "function"
    ) {
    return blocked(
        "invalid-storage-file",
        (
          "A inspeção não forneceu um objeto Storage " +
          "válido para exclusão."
        ),
    );
  }


    // --------------------------------------------------------------------------
    // REVALIDAÇÃO IMEDIATAMENTE ANTES DO DELETE
    // --------------------------------------------------------------------------
    //
    // A inspeção inicial autorizou generation G1.
    //
    // Antes da operação irreversível, relê o objeto físico:
    //
    // G1 continua G1 → pode prosseguir;
    // mudou para G2 → BLOCKED, nenhum delete();
    // objeto já sumiu → ausência física já confirmada.
    //
    // A precondição ifGenerationMatch continua sendo mantida no delete()
    // como última barreira atômica no Cloud Storage real.
    //
    // --------------------------------------------------------------------------

    let currentMetadata;


    try {
      const metadataResult =
          await file.getMetadata();


      currentMetadata =
          Array.isArray(
              metadataResult,
          )
            ? metadataResult[0]
            : metadataResult;
    } catch (error) {
      if (
        isNotFoundError(
            error,
        )
      ) {
        return {
          action:
            ACTIONS.STORAGE_ABSENCE_CONFIRMED,

          allowed:
            true,

          storeId,

          backupId,

          storagePath,

          generation:
            null,

          alreadyMissing:
            true,

          reasons: [],
        };
      }


      throw error;
    }


    if (
      !currentMetadata ||
      typeof currentMetadata !==
        "object"
    ) {
      return blocked(
          "invalid-current-storage-metadata",
          (
            "Não foi possível confirmar a metadata atual " +
            "do objeto antes da exclusão."
          ),
      );
    }


    const currentGeneration =
        normalizeString(
            currentMetadata.generation,
        );


    if (
      !currentGeneration ||
      !/^\d+$/.test(
          currentGeneration,
      )
    ) {
      return blocked(
          "invalid-current-storage-generation",
          (
            "A generation atual do objeto é inválida. " +
            "A exclusão foi bloqueada."
          ),
      );
    }


    if (
      currentGeneration !==
        generation
    ) {
      return blocked(
          "storage-generation-changed-before-delete",
          (
            "O objeto do Storage foi alterado após a inspeção. " +
            "A exclusão foi bloqueada."
          ),
      );
    }


    // --------------------------------------------------------------------------
    // REVALIDAÇÃO DA IDENTIDADE FÍSICA
    // --------------------------------------------------------------------------

    const currentCustomMetadata =
        currentMetadata.metadata;


    if (
      !currentCustomMetadata ||
      typeof currentCustomMetadata !==
        "object"
    ) {
      return blocked(
          "missing-current-storage-custom-metadata",
          (
            "A identidade física do objeto não pôde ser " +
            "reconfirmada antes da exclusão."
          ),
      );
    }


    const currentStoreId =
        normalizeString(
            currentCustomMetadata.storeId,
        );

    const currentBackupId =
        normalizeString(
            currentCustomMetadata.backupId,
        );

    const currentChecksum =
        normalizeString(
            currentCustomMetadata.checksumSha256,
        ).toLowerCase();

    const expectedChecksum =
        normalizeString(
            inspection.checksum,
        ).toLowerCase();


    if (
      currentStoreId !==
        storeId
    ) {
      return blocked(
          "storage-store-id-changed-before-delete",
          (
            "O storeId físico mudou após a inspeção. " +
            "A exclusão foi bloqueada."
          ),
      );
    }


    if (
      currentBackupId !==
        backupId
    ) {
      return blocked(
          "storage-backup-id-changed-before-delete",
          (
            "O backupId físico mudou após a inspeção. " +
            "A exclusão foi bloqueada."
          ),
      );
    }


    if (
      !isValidSha256(
          expectedChecksum,
      ) ||
      !isValidSha256(
          currentChecksum,
      )
    ) {
      return blocked(
          "invalid-current-storage-checksum",
          (
            "O checksum não pôde ser reconfirmado " +
            "antes da exclusão."
          ),
      );
    }


    if (
      currentChecksum !==
        expectedChecksum
    ) {
      return blocked(
          "storage-checksum-changed-before-delete",
          (
            "O checksum físico mudou após a inspeção. " +
            "A exclusão foi bloqueada."
          ),
      );
    }


  // --------------------------------------------------------------------------
  // DELETE CONDICIONADO
  // --------------------------------------------------------------------------
  //
  // Se o objeto tiver sido substituído depois do getMetadata(),
  // sua generation será diferente e o Storage deverá recusar
  // a exclusão com PRECONDITION FAILED.
  //
  // ignoreNotFound mantém o fluxo idempotente caso o arquivo já
  // tenha desaparecido após uma tentativa anterior.
  //
  // --------------------------------------------------------------------------

  await file.delete({
    ignoreNotFound:
      true,

    ifGenerationMatch:
      generation,
  });


  // --------------------------------------------------------------------------
  // AUSÊNCIA FÍSICA CONFIRMADA
  // --------------------------------------------------------------------------

  return {
    action:
      ACTIONS.STORAGE_ABSENCE_CONFIRMED,

    allowed:
      true,

    storeId,

    backupId,

    storagePath,

    generation,

    reasons: [],
  };
}


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  deleteBackupRetentionStorageArtifact,
  ACTIONS,
};
