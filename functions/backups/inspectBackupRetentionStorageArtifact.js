"use strict";


const {
  isValidSha256,
} = require(
    "./backupRetentionClaimPlanner",
);


// ============================================================================
// STORE&CONNECT — INSPEÇÃO DO ARTEFATO DE BACKUP NO STORAGE
// ============================================================================
//
// F5.6-D3-G3.1
//
// Esta camada confirma que o objeto físico encontrado no Storage
// corresponde exatamente ao backup autorizado pela retenção.
//
// ESTE ARQUIVO:
//
// ✅ lê metadata do objeto;
// ✅ valida storeId;
// ✅ valida backupId;
// ✅ valida checksumSha256;
// ✅ reconhece arquivo inexistente;
//
// NÃO:
//
// ❌ executa delete();
// ❌ altera Firestore;
// ❌ altera Storage.
//
// ============================================================================


// ============================================================================
// ACTIONS
// ============================================================================

const ACTIONS =
    Object.freeze({
      ARTIFACT_VALID:
        "ARTIFACT_VALID",

      ARTIFACT_ALREADY_MISSING:
        "ARTIFACT_ALREADY_MISSING",

      BLOCKED:
        "BLOCKED",
    });


// ============================================================================
// HELPERS
// ============================================================================

function normalizeString(
    value,
) {
  return typeof value ===
    "string"
    ? value.trim()
    : "";
}


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


function isNotFoundError(
    error,
) {
  if (!error) {
    return false;
  }


  return (
    error.code === 404 ||
    error.code === "404" ||
    error.code === "not-found" ||
    error.code === "storage/object-not-found"
  );
}


// ============================================================================
// INSPEÇÃO
// ============================================================================

async function inspectBackupRetentionStorageArtifact({
  bucket,
  storeId,
  backupId,
  storagePath,
  checksum,
}) {
  // --------------------------------------------------------------------------
  // INPUTS
  // --------------------------------------------------------------------------

  if (
    !bucket ||
    typeof bucket.file !==
      "function"
  ) {
    throw new Error(
        "Storage bucket inválido.",
    );
  }


  const normalizedStoreId =
      normalizeString(
          storeId,
      );

  const normalizedBackupId =
      normalizeString(
          backupId,
      );

  const normalizedStoragePath =
      normalizeString(
          storagePath,
      );

  const normalizedChecksum =
      normalizeString(
          checksum,
      ).toLowerCase();


  if (!normalizedStoreId) {
    throw new Error(
        "storeId obrigatório.",
    );
  }


  if (!normalizedBackupId) {
    throw new Error(
        "backupId obrigatório.",
    );
  }


  if (!normalizedStoragePath) {
    throw new Error(
        "storagePath obrigatório.",
    );
  }


  if (
    !isValidSha256(
        normalizedChecksum,
    )
  ) {
    throw new Error(
        "checksum SHA-256 inválido.",
    );
  }


  // --------------------------------------------------------------------------
  // CAMINHO CANÔNICO
  // --------------------------------------------------------------------------

  const expectedStoragePath =
      (
        `store_backups/` +
        `${normalizedStoreId}/` +
        `${normalizedBackupId}/` +
        `snapshot.json.gz`
      );


  if (
    normalizedStoragePath !==
      expectedStoragePath
  ) {
    return blocked(
        "non-canonical-storage-path",
        (
          "O storagePath recebido não corresponde " +
          "ao caminho canônico do backup."
        ),
    );
  }


  // --------------------------------------------------------------------------
  // OBJETO
  // --------------------------------------------------------------------------

  const file =
      bucket.file(
          normalizedStoragePath,
      );


  if (
    !file ||
    typeof file.getMetadata !==
      "function"
  ) {
    throw new Error(
        "Objeto Storage inválido.",
    );
  }


  // --------------------------------------------------------------------------
  // LÊ METADATA
  // --------------------------------------------------------------------------

  let metadata;


  try {
    const result =
        await file.getMetadata();


    metadata =
        Array.isArray(result)
          ? result[0]
          : result;
  } catch (error) {
    if (
      isNotFoundError(
          error,
      )
    ) {
      return {
        action:
          ACTIONS.ARTIFACT_ALREADY_MISSING,

        allowed:
          true,

        storeId:
          normalizedStoreId,

        backupId:
          normalizedBackupId,

        storagePath:
          normalizedStoragePath,

        reasons: [],
      };
    }


    throw error;
  }


  if (
    !metadata ||
    typeof metadata !==
      "object"
  ) {
    return blocked(
        "invalid-storage-metadata",
        "O objeto do Storage não possui metadata válida.",
    );
  }


  // --------------------------------------------------------------------------
  // CUSTOM METADATA
  // --------------------------------------------------------------------------

  const customMetadata =
      metadata.metadata;


  if (
    !customMetadata ||
    typeof customMetadata !==
      "object"
  ) {
    return blocked(
        "missing-custom-storage-metadata",
        (
          "O arquivo de backup não possui a metadata " +
          "de identidade esperada."
        ),
    );
  }


  const storedStoreId =
      normalizeString(
          customMetadata.storeId,
      );

  const storedBackupId =
      normalizeString(
          customMetadata.backupId,
      );

  const storedChecksum =
      normalizeString(
          customMetadata.checksumSha256,
      ).toLowerCase();


  // --------------------------------------------------------------------------
  // STORE ID
  // --------------------------------------------------------------------------

  if (
    storedStoreId !==
      normalizedStoreId
  ) {
    return blocked(
        "storage-store-id-mismatch",
        (
          "A identidade da loja gravada no arquivo " +
          "não corresponde ao backup autorizado."
        ),
    );
  }


  // --------------------------------------------------------------------------
  // BACKUP ID
  // --------------------------------------------------------------------------

  if (
    storedBackupId !==
      normalizedBackupId
  ) {
    return blocked(
        "storage-backup-id-mismatch",
        (
          "O backupId gravado no arquivo não corresponde " +
          "ao backup autorizado."
        ),
    );
  }


  // --------------------------------------------------------------------------
  // CHECKSUM
  // --------------------------------------------------------------------------

  if (
    !isValidSha256(
        storedChecksum,
    )
  ) {
    return blocked(
        "invalid-storage-checksum",
        (
          "O arquivo do Storage não possui " +
          "checksumSha256 válido."
        ),
    );
  }


  if (
    storedChecksum !==
      normalizedChecksum
  ) {
    return blocked(
        "storage-checksum-mismatch",
        (
          "O checksum do arquivo físico não corresponde " +
          "ao checksum autorizado pela retenção."
        ),
    );
  }


    // --------------------------------------------------------------------------
    // GENERATION
    // --------------------------------------------------------------------------

    const generation =
        normalizeString(
            metadata.generation,
        );


    if (
      !generation ||
      !/^\d+$/.test(
          generation,
      )
    ) {
      return blocked(
          "invalid-storage-generation",
          (
            "O objeto físico não possui uma generation " +
            "válida para exclusão condicionada."
          ),
      );
    }



  // --------------------------------------------------------------------------
  // OK
  // --------------------------------------------------------------------------

  return {
    action:
      ACTIONS.ARTIFACT_VALID,

    allowed:
      true,

    storeId:
      normalizedStoreId,

    backupId:
      normalizedBackupId,

    storagePath:
      normalizedStoragePath,

    checksum:
      normalizedChecksum,

    generation,

    file,

    reasons: [],
  };
  }


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  inspectBackupRetentionStorageArtifact,
  ACTIONS,
  isNotFoundError,
};