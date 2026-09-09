"use strict";

// ============================================================================
// STORE&CONNECT — CRIAÇÃO SEGURA DE SNAPSHOT DA LOJA
// ============================================================================
//
// Arquivo:
//   functions/backups/createStoreSnapshot.js
//
// F5 — BACKUP / SNAPSHOT GERAL
//
// Responsabilidades:
// - validar autenticação/autorização do backup manual;
// - criar snapshot operacional da loja;
// - preservar tipos especiais do Firestore;
// - compactar o snapshot em GZIP;
// - gerar SHA-256;
// - salvar o arquivo no Firebase Storage;
// - registrar metadata no Firestore;
// - registrar auditoria da criação do backup;
//
// F5.5:
// - o motor do backup foi separado da callable;
// - o mesmo motor poderá ser utilizado futuramente pelo backup automático.
//
// ============================================================================

const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const admin = require("firebase-admin");

const zlib = require("zlib");
const crypto = require("crypto");

const {
  promisify,
} = require("util");

const gzipAsync =
    promisify(zlib.gzip);


// ============================================================================
// HELPERS
// ============================================================================

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}


function buildSafeStoreSettings(storeData) {
  return {
    name:
      normalizeString(storeData.name) || null,

    phone:
      normalizeString(storeData.phone) || null,

    logoUrl:
      normalizeString(storeData.logoUrl) || null,

    lowStockThreshold:
      typeof storeData.lowStockThreshold === "number"
        ? storeData.lowStockThreshold
        : null,

    pixQrCodePath:
      normalizeString(storeData.pixQrCodePath) || null,

    pixQrCodeUrl:
      normalizeString(storeData.pixQrCodeUrl) || null,

    pixQrCodeUpdatedAt:
      storeData.pixQrCodeUpdatedAt || null,
  };
}


// ============================================================================
// SERIALIZAÇÃO SEGURA DE TIPOS DO FIRESTORE
// ============================================================================
//
// JSON puro não preserva automaticamente todos os tipos especiais do
// Firestore.
//
// Marcamos esses valores para que uma futura restauração consiga
// reconstruí-los corretamente.
//
// ============================================================================

function encodeFirestoreValue(value) {
  if (value === null) {
    return null;
  }


  // --------------------------------------------------------------------------
  // TIMESTAMP
  // --------------------------------------------------------------------------

  if (value instanceof admin.firestore.Timestamp) {
    return {
      __storeConnectType: "timestamp",
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
    };
  }


  // --------------------------------------------------------------------------
  // GEOPOINT
  // --------------------------------------------------------------------------

  if (value instanceof admin.firestore.GeoPoint) {
    return {
      __storeConnectType: "geoPoint",
      latitude: value.latitude,
      longitude: value.longitude,
    };
  }


  // --------------------------------------------------------------------------
  // BYTES / BUFFER
  // --------------------------------------------------------------------------

  if (Buffer.isBuffer(value)) {
    return {
      __storeConnectType: "bytes",
      base64: value.toString("base64"),
    };
  }


  // --------------------------------------------------------------------------
  // ARRAYS
  // --------------------------------------------------------------------------

  if (Array.isArray(value)) {
    return value.map(
        (item) => encodeFirestoreValue(item),
    );
  }


  // --------------------------------------------------------------------------
  // DOCUMENT REFERENCE
  // --------------------------------------------------------------------------

  if (
    typeof value === "object" &&
    value !== null &&
    value.constructor?.name === "DocumentReference" &&
    typeof value.path === "string"
  ) {
    return {
      __storeConnectType: "documentReference",
      path: value.path,
    };
  }


  // --------------------------------------------------------------------------
  // MAP / OBJETO
  // --------------------------------------------------------------------------

  if (
    typeof value === "object" &&
    value !== null
  ) {
    const result = {};

    for (
      const [key, nestedValue]
      of Object.entries(value)
    ) {
      result[key] =
          encodeFirestoreValue(nestedValue);
    }

    return result;
  }


  // --------------------------------------------------------------------------
  // STRING / NUMBER / BOOLEAN
  // --------------------------------------------------------------------------

  return value;
}


// ============================================================================
// LEITURA DE COLEÇÃO PARA O SNAPSHOT
// ============================================================================
//
// Mantemos:
// - ID original do documento;
// - todos os campos do documento.
//
// Não lemos subcoleções internas.
//
// As coleções que podem entrar no backup são definidas explicitamente
// dentro do motor do snapshot.
//
// ============================================================================

async function readCollectionForSnapshot(collectionRef) {
  const snapshot =
      await collectionRef.get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,

    data:
      encodeFirestoreValue(
          doc.data(),
      ),
  }));
}


// ============================================================================
// MOTOR INTERNO DE BACKUP
// ============================================================================
//
// Responsável exclusivamente por criar o snapshot.
//
// Pode ser utilizado por:
// - backup manual solicitado por um Admin;
// - backup automático agendado.
//
// Autenticação e autorização NÃO são responsabilidade deste helper.
//
// Cada ponto de entrada deve validar seu próprio contexto antes de
// chamá-lo.
//
// ============================================================================

async function createStoreSnapshotCore({
  db,
  storeRef,
  storeSnapshot,
  storeId,
  createdBy,
  createdByRole,
  backupType,
  reason,
  reservedBackupId = null,
}) {
  // --------------------------------------------------------------------------
  // 8. SELECIONA SOMENTE CONFIGURAÇÕES SEGURAS DA LOJA
  // --------------------------------------------------------------------------

  const storeData =
      storeSnapshot.data() || {};

  const storeSettings =
      buildSafeStoreSettings(storeData);


  // --------------------------------------------------------------------------
  // 9. LÊ AS COLEÇÕES OPERACIONAIS DA LOJA
  // --------------------------------------------------------------------------
  //
  // IMPORTANTE:
  // - incluímos documentos ativos e arquivados;
  // - auditLogs fica propositalmente fora;
  // - usuários ficam fora;
  // - assinatura/Asaas ficam fora.
  //
  // --------------------------------------------------------------------------

  const products =
      await readCollectionForSnapshot(
          storeRef.collection("products"),
      );

  const customers =
      await readCollectionForSnapshot(
          storeRef.collection("customers"),
      );

  const categories =
      await readCollectionForSnapshot(
          storeRef.collection("categories"),
      );

  const sales =
      await readCollectionForSnapshot(
          storeRef.collection("sales"),
      );

  const cashFlow =
      await readCollectionForSnapshot(
          storeRef.collection("cash_flow"),
      );


  // --------------------------------------------------------------------------
  // 10. CONTADORES DO SNAPSHOT
  // --------------------------------------------------------------------------

  const counts = {
    products: products.length,
    customers: customers.length,
    categories: categories.length,
    sales: sales.length,
    cashFlow: cashFlow.length,
  };


  // --------------------------------------------------------------------------
  // 11. MONTA O CONTEÚDO DO SNAPSHOT
  // --------------------------------------------------------------------------
  //
  // O snapshot contém somente:
  // - metadados necessários para identificação;
  // - configurações seguras da loja;
  // - coleções operacionais.
  //
  // Campos de assinatura, Asaas, identidade da conta e auditLogs
  // permanecem fora.
  //
  // --------------------------------------------------------------------------

  const snapshotCreatedAt =
      admin.firestore.Timestamp.now();

  const snapshotData = {
    snapshotVersion: 1,

    metadata: {
      storeId,

      createdAt:
        encodeFirestoreValue(snapshotCreatedAt),

      createdBy,
      createdByRole,

      type: backupType,

      reason:
        reason || null,

      counts,
    },

    storeSettings:
      encodeFirestoreValue(storeSettings),

    collections: {
      products,
      customers,
      categories,
      sales,
      cashFlow,
    },
  };


  // --------------------------------------------------------------------------
  // 12. SERIALIZA O SNAPSHOT
  // --------------------------------------------------------------------------

  let snapshotJson;

  try {
    snapshotJson =
        JSON.stringify(snapshotData);
  } catch (error) {
    console.error(
        "❌ Erro ao serializar snapshot:",
        error,
    );

    throw new HttpsError(
        "internal",
        "Não foi possível preparar o backup da loja.",
    );
  }


  // --------------------------------------------------------------------------
  // 13. COMPACTA O SNAPSHOT
  // --------------------------------------------------------------------------

  let compressedSnapshot;

  try {
    compressedSnapshot =
        await gzipAsync(
            Buffer.from(
                snapshotJson,
                "utf8",
            ),
            {
              level:
                zlib.constants
                    .Z_BEST_COMPRESSION,
            },
        );
  } catch (error) {
    console.error(
        "❌ Erro ao compactar snapshot:",
        error,
    );

    throw new HttpsError(
        "internal",
        "Não foi possível compactar o backup da loja.",
    );
  }


  // --------------------------------------------------------------------------
  // 14. GERA HASH DE INTEGRIDADE
  // --------------------------------------------------------------------------
  //
  // Esse hash permitirá confirmar futuramente se o arquivo do backup
  // continua exatamente igual ao arquivo criado originalmente.
  //
  // Será especialmente importante na futura F5.12,
  // quando replicarmos o backup para outro ambiente.
  //
  // --------------------------------------------------------------------------

  const checksumSha256 =
      crypto
          .createHash("sha256")
          .update(compressedSnapshot)
          .digest("hex");

  const originalSizeBytes =
      Buffer.byteLength(
          snapshotJson,
          "utf8",
      );

  const compressedSizeBytes =
      compressedSnapshot.length;


  // --------------------------------------------------------------------------
  // 15. PREPARA IDENTIFICAÇÃO DO BACKUP
  // --------------------------------------------------------------------------
  //
  // Criamos o ID no Firestore apenas para obter um identificador único.
  //
  // O documento de metadata ainda NÃO é gravado nesta etapa.
  //
  // --------------------------------------------------------------------------

  const snapshotsRef = db
      .collection("storeBackups")
      .doc(storeId)
      .collection("snapshots");

  const backupRef =
      reservedBackupId
        ? snapshotsRef.doc(reservedBackupId)
        : snapshotsRef.doc();

  const backupId =
      backupRef.id;

  const storagePath =
      `store_backups/${storeId}/${backupId}/snapshot.json.gz`;


  // --------------------------------------------------------------------------
  // 16. SALVA O SNAPSHOT COMPACTADO NO FIREBASE STORAGE
  // --------------------------------------------------------------------------

  const bucket =
      admin.storage().bucket();

  const backupFile =
      bucket.file(storagePath);

  try {
    await backupFile.save(
        compressedSnapshot,
        {
          resumable: false,

          metadata: {
            contentType:
              "application/gzip",

            metadata: {
              storeId,
              backupId,
              snapshotVersion: "1",
              checksumSha256,
            },
          },
        },
    );
  } catch (error) {
    console.error(
        "❌ Erro ao salvar snapshot no Storage:",
        error,
    );

    throw new HttpsError(
        "internal",
        "Não foi possível armazenar o backup da loja.",
    );
  }


  // --------------------------------------------------------------------------
  // 17. PREPARA METADADOS DO BACKUP NO FIRESTORE
  // --------------------------------------------------------------------------
  //
  // O arquivo completo permanece no Storage.
  //
  // O Firestore guarda somente informações para:
  // - listar backups;
  // - verificar integridade;
  // - controlar retenção;
  // - iniciar restauração futuramente.
  //
  // --------------------------------------------------------------------------

  const backupMetadata = {
    storeId,

    createdAt:
      snapshotCreatedAt,

    createdBy,
    createdByRole,

    type:
      backupType,

    reason:
      reason || null,

    status:
      "ready",

    snapshotVersion:
      1,

    storagePath,

    counts,

    originalSizeBytes,
    compressedSizeBytes,

    checksumSha256,
  };


  // --------------------------------------------------------------------------
  // 18. PREPARA AUDITORIA DO BACKUP
  // --------------------------------------------------------------------------
  //
  // A criação do backup é uma operação administrativa crítica.
  //
  // Registramos:
  // - quem executou;
  // - qual backup foi criado;
  // - motivo;
  // - estado final;
  // - contagens;
  // - tamanho;
  // - hash de integridade.
  //
  // --------------------------------------------------------------------------

  const auditRef = storeRef
      .collection("auditLogs")
      .doc();

  const backupAuditLog = {
    action:
      "store_backup_created",

    entityType:
      "backup",

    entityId:
      backupId,

    storeId,

    performedBy: {
      uid:
        createdBy,

      role:
        createdByRole,
    },

    reason:
      reason || null,

    before:
      null,

    after: {
      status:
        "ready",

      type:
        backupType,

      snapshotVersion:
        1,

      storagePath,

      counts,

      originalSizeBytes,
      compressedSizeBytes,

      checksumSha256,
    },

    createdAt:
      snapshotCreatedAt,
  };


  // --------------------------------------------------------------------------
  // 19. GRAVA METADATA + AUDITORIA ATOMICAMENTE
  // --------------------------------------------------------------------------

  try {
    const batch =
        db.batch();

    batch.set(
        backupRef,
        backupMetadata,
    );

    batch.set(
        auditRef,
        backupAuditLog,
    );

    await batch.commit();
  } catch (error) {
    console.error(
        "❌ Erro ao registrar backup e auditoria:",
        error,
    );


    // ------------------------------------------------------------------------
    // O batch do Firestore é atômico:
    //
    // metadata e auditLog gravam juntos ou nenhum dos dois grava.
    //
    // Como o arquivo do Storage já foi criado, tentamos removê-lo
    // para evitar um backup órfão.
    // ------------------------------------------------------------------------

    try {
      await backupFile.delete({
        ignoreNotFound: true,
      });
    } catch (cleanupError) {
      console.error(
          "⚠️ Não foi possível remover o arquivo órfão:",
          cleanupError,
      );
    }

    throw new HttpsError(
        "internal",
        "Não foi possível concluir o registro e a auditoria do backup.",
    );
  }


  // --------------------------------------------------------------------------
  // 20. RETORNA RESULTADO DO BACKUP CONCLUÍDO
  // --------------------------------------------------------------------------
  //
  // Neste ponto:
  // - o snapshot foi criado;
  // - o arquivo GZIP foi salvo no Storage;
  // - a metadata foi registrada;
  // - a auditoria foi registrada atomicamente.
  //
  // --------------------------------------------------------------------------

  return {
    success: true,

    backupId,
    storeId,

    status:
      "ready",

    type:
      backupType,

    reason:
      reason || null,

    counts,

    snapshotVersion:
      1,

    originalSizeBytes,
    compressedSizeBytes,

    checksumSha256,
    storagePath,
  };
}


// ============================================================================
// CREATE STORE SNAPSHOT — BACKUP MANUAL
// ============================================================================
//
// Esta callable é responsável apenas pelo contexto MANUAL:
//
// - exige Firebase Auth;
// - busca o usuário diretamente no Firestore;
// - exige role == admin;
// - confirma que o Admin pertence à loja solicitada;
// - não confia em UID ou role enviados pelo Flutter;
// - após as validações, delega a criação para createStoreSnapshotCore().
//
// ============================================================================

const createStoreSnapshot = onCall(
    {
      timeoutSeconds: 540,
      memory: "512MiB",
    },

    async (request) => {
      // ----------------------------------------------------------------------
      // 1. AUTENTICAÇÃO
      // ----------------------------------------------------------------------

      if (!request.auth) {
        throw new HttpsError(
            "unauthenticated",
            "É necessário estar autenticado para criar um backup.",
        );
      }

      const uid =
          request.auth.uid;


      // ----------------------------------------------------------------------
      // 2. DADOS RECEBIDOS DO FLUTTER
      // ----------------------------------------------------------------------

      const storeId =
          normalizeString(
              request.data?.storeId,
          );

      const reason =
          normalizeString(
              request.data?.reason,
          );

      if (!storeId) {
        throw new HttpsError(
            "invalid-argument",
            "storeId é obrigatório.",
        );
      }


      // ----------------------------------------------------------------------
      // 3. BUSCA O USUÁRIO E A LOJA NO BACKEND
      // ----------------------------------------------------------------------

      const db =
          admin.firestore();

      const userRef = db
          .collection("users")
          .doc(uid);

      const storeRef = db
          .collection("stores")
          .doc(storeId);

      const [
        userSnapshot,
        storeSnapshot,
      ] = await Promise.all([
        userRef.get(),
        storeRef.get(),
      ]);


      // ----------------------------------------------------------------------
      // 4. VALIDA EXISTÊNCIA DO USUÁRIO
      // ----------------------------------------------------------------------

      if (!userSnapshot.exists) {
        throw new HttpsError(
            "permission-denied",
            "Perfil do usuário não encontrado.",
        );
      }


      // ----------------------------------------------------------------------
      // 5. VALIDA EXISTÊNCIA DA LOJA
      // ----------------------------------------------------------------------

      if (!storeSnapshot.exists) {
        throw new HttpsError(
            "not-found",
            "Loja não encontrada.",
        );
      }


      const userData =
          userSnapshot.data() || {};

      const userRole =
          normalizeString(
              userData.role,
          ).toLowerCase();

      const userStoreId =
          normalizeString(
              userData.storeId,
          );


      // ----------------------------------------------------------------------
      // 6. SOMENTE ADMIN PODE CRIAR BACKUP MANUAL
      // ----------------------------------------------------------------------

      if (userRole !== "admin") {
        throw new HttpsError(
            "permission-denied",
            "Somente um administrador pode criar backups da loja.",
        );
      }


      // ----------------------------------------------------------------------
      // 7. CONFIRMA QUE O ADMIN PERTENCE À MESMA LOJA
      // ----------------------------------------------------------------------

      if (
        !userStoreId ||
        userStoreId !== storeId
      ) {
        throw new HttpsError(
            "permission-denied",
            "O usuário não pertence a esta loja.",
        );
      }


      // ----------------------------------------------------------------------
      // DELEGA A CRIAÇÃO AO MOTOR INTERNO
      // ----------------------------------------------------------------------

      return await createStoreSnapshotCore({
        db,
        storeRef,
        storeSnapshot,
        storeId,

        createdBy:
          uid,

        createdByRole:
          userRole,

        backupType:
          "manual",

        reason,
      });
    },
);


// ============================================================================
// EXPORT
// ============================================================================

module.exports = {
  createStoreSnapshot,
  createStoreSnapshotCore,
};