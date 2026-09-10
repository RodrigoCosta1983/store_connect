// ============================================================================
// STORE CONNECT - CRIAÇÃO SEGURA DE CATÁLOGO
// ============================================================================
//
// Arquivo:
//   functions/catalog/createCatalog.js
//
// F7.2-D
//
// Nesta primeira etapa a função implementa apenas autenticação, autorização
// e validação do contrato de entrada.
//
// IMPORTANTE:
// - ainda não cria documentos no Firestore;
// - ainda não gera token público;
// - ainda não consulta os produtos;
// - Admin SDK ignora Firestore Rules, portanto toda autorização é feita aqui.
// ============================================================================

"use strict";

const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");

const admin = require("firebase-admin");
const {
  Timestamp,
  FieldValue,
} = require("firebase-admin/firestore");
const crypto = require("crypto");

const catalogTokenEncryptionKey = defineSecret(
    "CATALOG_TOKEN_ENCRYPTION_KEY",
);


const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_VERSION = 1;

const MAX_TITLE_LENGTH = 100;
const MAX_PRODUCTS = 200;
const MIN_EXPIRATION_DAYS = 1;
const MAX_EXPIRATION_DAYS = 30;

const ALLOWED_SUBSCRIPTION_STATUS = new Set([
  "active",
  "trial",
  "overdue",
]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getCatalogTokenEncryptionKey() {
  const rawKey = normalizeString(
      catalogTokenEncryptionKey.value(),
  );

  if (!rawKey) {
    throw new HttpsError(
        "failed-precondition",
        "Chave de criptografia dos tokens de catálogo não configurada.",
    );
  }

  let key;

  try {
    key = Buffer.from(rawKey, "base64");
  } catch (error) {
    console.error(
        "[createCatalog] Falha ao decodificar chave Base64:",
        error,
    );

    throw new HttpsError(
        "internal",
        "A chave de criptografia do catálogo possui formato inválido.",
    );
  }

  if (key.length !== 32) {
    console.error(
        "[createCatalog] Chave inválida. Bytes encontrados:",
        key.length,
    );

    throw new HttpsError(
        "internal",
        "A chave de criptografia do catálogo deve possuir exatamente 32 bytes.",
    );
  }

  return key;
}


function buildPublicSlugBase(value) {
  const normalized = normalizeString(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "");

  return normalized || "loja";
}

async function ensurePublicStoreSlug(db, storeRef, knownStoreData) {
  const knownPublicSlug = normalizeString(
      knownStoreData?.publicSlug,
  );

  if (knownPublicSlug) {
    return knownPublicSlug;
  }

  const publicSlugBase = buildPublicSlugBase(
      knownStoreData?.name,
  );

  const publicSlugFallback =
    `${publicSlugBase}-${storeRef.id}`;

  const publicSlugBaseRef = db
      .collection("storePublicSlugs")
      .doc(publicSlugBase);

  const publicSlugFallbackRef = db
      .collection("storePublicSlugs")
      .doc(publicSlugFallback);

  return db.runTransaction(async (transaction) => {
    const currentStoreSnapshot =
      await transaction.get(storeRef);

    if (!currentStoreSnapshot.exists) {
      throw new HttpsError(
          "not-found",
          "Loja não encontrada.",
      );
    }

    const currentStoreData =
      currentStoreSnapshot.data() || {};

    const existingPublicSlug = normalizeString(
        currentStoreData.publicSlug,
    );

    if (existingPublicSlug) {
      return existingPublicSlug;
    }

    const publicSlugBaseSnapshot =
      await transaction.get(publicSlugBaseRef);

    const publicSlugFallbackSnapshot =
      await transaction.get(publicSlugFallbackRef);

    let publicSlug;
    let publicSlugRef;
    let publicSlugSnapshot;

    const baseOwnerStoreId = normalizeString(
        publicSlugBaseSnapshot.data()?.storeId,
    );

    const fallbackOwnerStoreId = normalizeString(
        publicSlugFallbackSnapshot.data()?.storeId,
    );

    if (
      !publicSlugBaseSnapshot.exists ||
      baseOwnerStoreId === storeRef.id
    ) {
      publicSlug = publicSlugBase;
      publicSlugRef = publicSlugBaseRef;
      publicSlugSnapshot = publicSlugBaseSnapshot;
    } else if (
      !publicSlugFallbackSnapshot.exists ||
      fallbackOwnerStoreId === storeRef.id
    ) {
      publicSlug = publicSlugFallback;
      publicSlugRef = publicSlugFallbackRef;
      publicSlugSnapshot = publicSlugFallbackSnapshot;
    } else {
      throw new HttpsError(
          "already-exists",
          "Não foi possível reservar uma URL pública para esta loja.",
      );
    }

    transaction.set(
        storeRef,
        { publicSlug },
        { merge: true },
    );

    if (!publicSlugSnapshot.exists) {
      transaction.set(
          publicSlugRef,
          {
            storeId: storeRef.id,
            publicSlug,
            createdAt:
              FieldValue.serverTimestamp(),
            createdBy: "system:createCatalog:publicSlug",
          },
      );
    }

    return publicSlug;
  });
}

function encryptCatalogPublicToken(publicToken) {
  const key = getCatalogTokenEncryptionKey();

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
      ENCRYPTION_ALGORITHM,
      key,
      iv,
  );

  const encrypted = Buffer.concat([
    cipher.update(publicToken, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    version: ENCRYPTION_VERSION,
  };
}


function decryptCatalogPublicToken(encryptedToken) {
  try {
    if (
      !encryptedToken ||
      typeof encryptedToken !== "object"
    ) {
      throw new Error(
          "Token público criptografado não informado.",
      );
    }

    const version = Number(encryptedToken.version);

    if (version !== ENCRYPTION_VERSION) {
      throw new Error(
          `Versão de criptografia não suportada: ${version}.`,
      );
    }

    const key = getCatalogTokenEncryptionKey();

    const iv = Buffer.from(
        normalizeString(encryptedToken.iv),
        "base64",
    );

    const authTag = Buffer.from(
        normalizeString(encryptedToken.authTag),
        "base64",
    );

    const ciphertext = Buffer.from(
        normalizeString(encryptedToken.ciphertext),
        "base64",
    );

    if (
      iv.length !== 12 ||
      authTag.length !== 16 ||
      ciphertext.length === 0
    ) {
      throw new Error(
          "Token público criptografado está incompleto ou inválido.",
      );
    }

    const decipher = crypto.createDecipheriv(
        ENCRYPTION_ALGORITHM,
        key,
        iv,
    );

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    const publicToken = decrypted
        .toString("utf8")
        .trim();

    if (!publicToken) {
      throw new Error(
          "Token público descriptografado ficou vazio.",
      );
    }

    return publicToken;
  } catch (error) {
    console.error(
        "[createCatalog] Falha ao descriptografar token público:",
        error.message,
    );

    throw new HttpsError(
        "failed-precondition",
        "Não foi possível recuperar o token público do catálogo.",
    );
  }
}

function generatePublicToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashPublicToken(token) {
  return crypto
      .createHash("sha256")
      .update(token, "utf8")
      .digest("hex");
}

function normalizeRole(value) {
  const role = normalizeString(value).toLowerCase();

  switch (role) {
    case "admin":
      return "admin";

    case "gerente":
      return "gerente";

    case "operador":
    case "caixa":
    case "vendedor":
      return "operador";

    default:
      return null;
  }
}

function validateInput(data) {
  const title = normalizeString(data?.title);

  if (!title) {
    throw new HttpsError(
        "invalid-argument",
        "O título do catálogo é obrigatório.",
    );
  }

  if (title.length > MAX_TITLE_LENGTH) {
    throw new HttpsError(
        "invalid-argument",
        `O título deve possuir no máximo ${MAX_TITLE_LENGTH} caracteres.`,
    );
  }

  if (!Array.isArray(data?.productIds) || data.productIds.length === 0) {
    throw new HttpsError(
        "invalid-argument",
        "Informe pelo menos um produto.",
    );
  }

  if (data.productIds.length > MAX_PRODUCTS) {
    throw new HttpsError(
        "invalid-argument",
        `O catálogo pode possuir no máximo ${MAX_PRODUCTS} produtos.`,
    );
  }

  const normalizedProductIds = data.productIds.map((value) => {
    if (typeof value !== "string" || !value.trim()) {
      throw new HttpsError(
          "invalid-argument",
          "Todos os productIds devem ser strings válidas.",
      );
    }

    const productId = value.trim();

    if (productId.includes("/")) {
      throw new HttpsError(
          "invalid-argument",
          "productId inválido.",
      );
    }

    return productId;
  });

  const productIds = [...new Set(normalizedProductIds)];

  const expiresInDays = data?.expiresInDays;

  if (
    !Number.isInteger(expiresInDays) ||
    expiresInDays < MIN_EXPIRATION_DAYS ||
    expiresInDays > MAX_EXPIRATION_DAYS
  ) {
    throw new HttpsError(
        "invalid-argument",
        `expiresInDays deve ser um inteiro entre ${MIN_EXPIRATION_DAYS} e ${MAX_EXPIRATION_DAYS}.`,
    );
  }

  return {
    title,
    productIds,
    expiresInDays,
  };
}

const createCatalog = onCall(
    {
      secrets: [catalogTokenEncryptionKey],
      timeoutSeconds: 30,
      memory: "256MiB",
    },
    async (request) => {
      // ======================================================================
      // 1. AUTENTICAÇÃO
      // ======================================================================

      if (!request.auth) {
        throw new HttpsError(
            "unauthenticated",
            "É necessário estar autenticado.",
        );
      }

      const uid = request.auth.uid;

      // ======================================================================
      // 2. CONTRATO DE ENTRADA
      // ======================================================================

      const {
        title,
        productIds,
        expiresInDays,
      } = validateInput(request.data);

      const db = admin.firestore();

      // ======================================================================
      // 3. USUÁRIO
      // ======================================================================

      const userSnapshot = await db
          .collection("users")
          .doc(uid)
          .get();

      if (!userSnapshot.exists) {
        throw new HttpsError(
            "permission-denied",
            "Perfil do usuário não encontrado.",
        );
      }

      const userData = userSnapshot.data() || {};
      const accessStatus = normalizeString(userData.accessStatus)
          .toLowerCase();

      if (accessStatus === "revoked") {
        throw new HttpsError(
            "permission-denied",
            "O acesso deste usuário está revogado.",
        );
      }

      const userRole = normalizeRole(userData.role);

      if (!userRole) {
        throw new HttpsError(
            "permission-denied",
            "O perfil deste usuário não possui um papel válido.",
        );
      }

      const storeId = normalizeString(userData.storeId);

      if (!storeId) {
        throw new HttpsError(
            "failed-precondition",
            "Nenhuma loja válida está vinculada ao usuário.",
        );
      }

      // ======================================================================
      // 4. LOJA / ASSINATURA
      // ======================================================================

      const storeSnapshot = await db
          .collection("stores")
          .doc(storeId)
          .get();

      if (!storeSnapshot.exists) {
        throw new HttpsError(
            "not-found",
            "Loja não encontrada.",
        );
      }

      const storeData = storeSnapshot.data() || {};
      const subscriptionStatus = normalizeString(
          storeData.subscriptionStatus,
      ).toLowerCase();

      if (!ALLOWED_SUBSCRIPTION_STATUS.has(subscriptionStatus)) {
        throw new HttpsError(
            "failed-precondition",
            "A assinatura da loja está inativa ou expirada.",
        );
      }

      // ======================================================================
      // 5. PRODUTOS SELECIONADOS
      // ======================================================================

      const productsCollection = db
          .collection("stores")
          .doc(storeId)
          .collection("products");

      const productRefs = productIds.map(
          (productId) => productsCollection.doc(productId),
      );

      const productSnapshots = await db.getAll(...productRefs);

      const validatedProducts = [];

      for (let index = 0; index < productSnapshots.length; index += 1) {
        const productSnapshot = productSnapshots[index];
        const productId = productIds[index];

        if (!productSnapshot.exists) {
          throw new HttpsError(
              "not-found",
              `Produto não encontrado: ${productId}.`,
          );
        }

        const productData = productSnapshot.data() || {};

        if (productData.isArchived === true) {
          throw new HttpsError(
              "failed-precondition",
              `O produto ${productId} está arquivado e não pode ser publicado.`,
          );
        }

        const availableQuantity = Number(productData.quantidade ?? 0);

        if (
          !Number.isFinite(availableQuantity) ||
          availableQuantity <= 0
        ) {
          throw new HttpsError(
              "failed-precondition",
              `O produto ${productId} está sem estoque e não pode ser publicado.`,
          );
        }

        validatedProducts.push({
          productId,
        });
      }

      // ======================================================================
      // 5.1 SLUG PÚBLICO DA LOJA
      // ======================================================================

      const publicSlug = await ensurePublicStoreSlug(
          db,
          storeSnapshot.ref,
          storeData,
      );

      // ======================================================================
      // 6. TOKEN PÚBLICO
      // ======================================================================

      const publicToken = generatePublicToken();
      const publicTokenHash = hashPublicToken(publicToken);
      const publicTokenEncrypted = encryptCatalogPublicToken(publicToken);


      // ======================================================================
      // 7. DATAS CONTROLADAS PELO BACKEND
      // ======================================================================

      const nowMilliseconds = Date.now();

      const expiresAt = Timestamp.fromMillis(
          nowMilliseconds + (expiresInDays * 24 * 60 * 60 * 1000),
      );

      const serverTimestamp =
        FieldValue.serverTimestamp();

      // ======================================================================
      // 8. REFERÊNCIAS DO CATÁLOGO
      // ======================================================================

      const catalogRef = db
          .collection("stores")
          .doc(storeId)
          .collection("catalogs")
          .doc();

      const catalogId = catalogRef.id;

      const publicTokenRef = db
          .collection("catalogPublicTokens")
          .doc(publicTokenHash);

      // ======================================================================
      // 9. WRITE BATCH ATÔMICO
      // ======================================================================

      const batch = db.batch();

      batch.create(
          catalogRef,
          {
            status: "active",
            title,
            createdAt: serverTimestamp,
            createdByUid: uid,
            expiresAt,
            publicTokenHash,
            productCount: validatedProducts.length,
            publicTokenEncrypted,
          },
      );

      for (let index = 0; index < validatedProducts.length; index += 1) {
        const validatedProduct = validatedProducts[index];

        const itemRef = catalogRef
            .collection("items")
            .doc();

        batch.create(
            itemRef,
            {
              productId: validatedProduct.productId,
              position: index,
              addedAt: serverTimestamp,
            },
        );
      }

      batch.create(
          publicTokenRef,
          {
            storeId,
            catalogId,
            createdAt: serverTimestamp,
          },
      );

      // ======================================================================
      // 10. COMMIT
      // ======================================================================

      await batch.commit();

      // ======================================================================
      // 11. RETORNO
      // ======================================================================

      return {
        success: true,
        catalogId,
        publicSlug,
        publicToken,
        expiresAt: expiresAt.toDate().toISOString(),
        productCount: validatedProducts.length,
      };
    },
);

const listCatalogs = onCall(
    {
      secrets: [catalogTokenEncryptionKey],
      timeoutSeconds: 30,
      memory: "256MiB",
    },
    async (request) => {
      // ======================================================================
      // 1. AUTENTICAÇÃO
      // ======================================================================

      if (!request.auth) {
        throw new HttpsError(
            "unauthenticated",
            "É necessário estar autenticado.",
        );
      }

      const uid = request.auth.uid;
      const db = admin.firestore();

      // ======================================================================
      // 2. USUÁRIO / LOJA
      // ======================================================================

      const userSnapshot = await db
          .collection("users")
          .doc(uid)
          .get();

      if (!userSnapshot.exists) {
        throw new HttpsError(
            "permission-denied",
            "Perfil do usuário não encontrado.",
        );
      }

      const userData = userSnapshot.data() || {};

      const accessStatus = normalizeString(
          userData.accessStatus,
      ).toLowerCase();

      if (accessStatus === "revoked") {
        throw new HttpsError(
            "permission-denied",
            "O acesso deste usuário está revogado.",
        );
      }

      const userRole = normalizeRole(userData.role);

      if (!userRole) {
        throw new HttpsError(
            "permission-denied",
            "O perfil deste usuário não possui um papel válido.",
        );
      }

      const storeId = normalizeString(userData.storeId);

      if (!storeId) {
        throw new HttpsError(
            "failed-precondition",
            "Nenhuma loja válida está vinculada ao usuário.",
        );
      }

      const storeSnapshot = await db
          .collection("stores")
          .doc(storeId)
          .get();

      if (!storeSnapshot.exists) {
        throw new HttpsError(
            "not-found",
            "Loja não encontrada.",
        );
      }

      const storeData = storeSnapshot.data() || {};
      const publicSlug = normalizeString(storeData.publicSlug);

      // ======================================================================
      // 3. CATÁLOGOS
      // ======================================================================

      const catalogsSnapshot = await storeSnapshot.ref
          .collection("catalogs")
          .orderBy("createdAt", "desc")
          .limit(50)
          .get();

      const catalogs = [];

      for (const catalogSnapshot of catalogsSnapshot.docs) {
        const catalogData = catalogSnapshot.data() || {};

        let publicUrl = null;
        let linkAvailable = false;

        const encryptedToken =
          catalogData.publicTokenEncrypted;

        if (
          encryptedToken &&
          publicSlug
        ) {
          try {
            const publicToken =
              decryptCatalogPublicToken(encryptedToken);

            publicUrl =
              `https://www.storeconnect.com.br/${publicSlug}/catalogo/${publicToken}`;

            linkAvailable = true;
          } catch (error) {
            console.error(
                `[listCatalogs] Link indisponível para catálogo ${catalogSnapshot.id}:`,
                error.message,
            );
          }
        }

        const createdAt = catalogData.createdAt;
        const expiresAt = catalogData.expiresAt;

        catalogs.push({
          catalogId: catalogSnapshot.id,
          title: normalizeString(catalogData.title),
          status:
            normalizeString(catalogData.status).toLowerCase() ||
            "unknown",
          createdAt:
            createdAt &&
            typeof createdAt.toDate === "function" ?
              createdAt.toDate().toISOString() :
              null,
          expiresAt:
            expiresAt &&
            typeof expiresAt.toDate === "function" ?
              expiresAt.toDate().toISOString() :
              null,
          productCount:
            Number(catalogData.productCount ?? 0),
          publicSlug,
          publicUrl,
          linkAvailable,
        });
      }

      // ======================================================================
      // 4. RETORNO
      // ======================================================================

      return {
        success: true,
        catalogs,
      };
    },
);

module.exports = {
  createCatalog,
  listCatalogs,
};
