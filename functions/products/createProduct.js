"use strict";

const {
  createHash,
} = require("node:crypto");

const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const admin =
  require("firebase-admin");

const {
  validateCreateProductInput,
} = require("./createProductContract");

const {
  captureTaxonomyState,
  projectLegacyCategories,
} = require("./productCategoryContract");

const {
  normalizeStoredParentCategoryId,
} = require("../categories/categoryHierarchyContract");

const ALLOWED_ROLES =
  new Set([
    "admin",
    "gerente",
    "operador",
  ]);

function normalizeString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function normalizeRole(value) {
  const role =
    normalizeString(value)
      .toLowerCase();

  if (
    role === "caixa" ||
    role === "vendedor"
  ) {
    return "operador";
  }

  if (ALLOWED_ROLES.has(role)) {
    return role;
  }

  return "";
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function validateInput(data) {
  try {
    return validateCreateProductInput(
      data,
    );
  } catch (error) {
    if (
      error instanceof TypeError ||
      error instanceof RangeError
    ) {
      throw new HttpsError(
        "invalid-argument",
        error.message,
      );
    }

    throw error;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(
      (item) =>
        canonicalize(item),
    );
  }

  if (isPlainObject(value)) {
    const result = {};

    const keys =
      Object.keys(value)
        .sort();

    for (const key of keys) {
      result[key] =
        canonicalize(
          value[key],
        );
    }

    return result;
  }

  return value;
}

function sha256Text(value) {
  return createHash("sha256")
    .update(
      value,
      "utf8",
    )
    .digest("hex");
}

function buildReceiptId({
  storeId,
  uid,
  requestId,
}) {
  return sha256Text(
    JSON.stringify([
      "createProduct",
      storeId,
      uid,
      requestId,
    ]),
  );
}

function buildRequestHash({
  product,
  categoryIds,
}) {
  const canonical =
    canonicalize({
      product,
      categoryIds,
    });

  return sha256Text(
    JSON.stringify(
      canonical,
    ),
  );
}

function buildPersistedLots(lotes) {
  try {
    return lotes.map(
      (lot) => ({
        quantidade:
          lot.quantidade,

        validade:
          admin.firestore
            .Timestamp
            .fromMillis(
              lot.validadeMs,
            ),
      }),
    );
  } catch (error) {
    throw new HttpsError(
      "invalid-argument",
      "Um lote possui validadeMs fora do intervalo aceito pelo Firestore.",
      {
        reason:
          "invalid-validade-ms",
      },
    );
  }
}

function validateExistingReceipt({
  receiptData,
  storeId,
  uid,
  requestHash,
}) {
  const invalid =
    !isPlainObject(receiptData) ||
    receiptData.action !==
      "product_created" ||
    receiptData.entityType !==
      "product" ||
    receiptData.storeId !==
      storeId ||
    !isPlainObject(
      receiptData.performedBy,
    ) ||
    receiptData.performedBy.uid !==
      uid ||
    typeof receiptData.requestHash !==
      "string" ||
    !/^[a-f0-9]{64}$/.test(
      receiptData.requestHash,
    ) ||
    typeof receiptData.resultId !==
      "string" ||
    receiptData.resultId.length === 0 ||
    receiptData.resultId.trim() !==
      receiptData.resultId ||
    receiptData.resultId.includes("/") ||
    receiptData.entityId !==
      receiptData.resultId;

  if (invalid) {
    throw new HttpsError(
      "failed-precondition",
      "O comprovante de idempotencia existente possui estrutura invalida.",
      {
        reason:
          "invalid-idempotency-receipt",
      },
    );
  }

  if (
    receiptData.requestHash !==
    requestHash
  ) {
    throw new HttpsError(
      "already-exists",
      "Este requestId ja foi utilizado com outro conteudo.",
      {
        reason:
          "request-id-reused",
      },
    );
  }

  return receiptData.resultId;
}

const createProduct =
  onCall(
    {
      timeoutSeconds: 30,
      memory: "256MiB",
    },
    async (request) => {
      // ============================================================
      // 1. AUTENTICACAO
      // ============================================================

      if (!request.auth) {
        throw new HttpsError(
          "unauthenticated",
          "E necessario estar autenticado.",
        );
      }

      const uid =
        request.auth.uid;

      // ============================================================
      // 2. CONTRATO PURO
      // ============================================================

      const {
        requestId,
        product,
        categoryIds,
      } =
        validateInput(
          request.data,
        );

      // O hash usa somente o conteudo normalizado da intencao.
      // requestId identifica a intencao, mas nao entra no requestHash.
      const requestHash =
        buildRequestHash({
          product,
          categoryIds,
        });

      // Conversao para Timestamp acontece antes da transacao.
      // Nenhum efeito externo ocorre aqui.
      const persistedLots =
        buildPersistedLots(
          product.lotes,
        );

      const db =
        admin.firestore();

      const userRef =
        db.collection("users")
          .doc(uid);

      // ID servidor gerado UMA vez por invocacao.
      // Permanece estavel durante retries automaticos da transacao.
      const candidateProductId =
        db.collection("stores")
          .doc()
          .id;

      // ============================================================
      // 3. TRANSACAO
      // ============================================================

      const transactionResult =
        await db.runTransaction(
          async (transaction) => {
            // ------------------------------------------------------
            // PERFIL / AUTORIZACAO
            // ------------------------------------------------------

            const userSnapshot =
              await transaction.get(
                userRef,
              );

            if (!userSnapshot.exists) {
              throw new HttpsError(
                "permission-denied",
                "Perfil do usuario nao encontrado.",
              );
            }

            const userData =
              userSnapshot.data() || {};

            const accessStatus =
              normalizeString(
                userData.accessStatus,
              ).toLowerCase();

            if (
              accessStatus ===
              "revoked"
            ) {
              throw new HttpsError(
                "permission-denied",
                "O acesso deste usuario esta revogado.",
              );
            }

            const userRole =
              normalizeRole(
                userData.role,
              );

            if (!userRole) {
              throw new HttpsError(
                "permission-denied",
                "Papel do usuario nao autorizado.",
              );
            }

            const storeId =
              normalizeString(
                userData.storeId,
              );

            if (
              !storeId ||
              storeId.includes("/")
            ) {
              throw new HttpsError(
                "permission-denied",
                "Perfil do usuario nao possui loja valida.",
              );
            }

            const storeRef =
              db.collection("stores")
                .doc(storeId);

            const storeSnapshot =
              await transaction.get(
                storeRef,
              );

            if (!storeSnapshot.exists) {
              throw new HttpsError(
                "not-found",
                "Loja nao encontrada.",
              );
            }

            const storeData =
              storeSnapshot.data() || {};

            // ------------------------------------------------------
            // RECEIPT DE IDEMPOTENCIA
            //
            // O ID nunca usa requestId diretamente como document ID.
            // ------------------------------------------------------

            const receiptId =
              buildReceiptId({
                storeId,
                uid,
                requestId,
              });

            const receiptRef =
              storeRef
                .collection("auditLogs")
                .doc(receiptId);

            const receiptSnapshot =
              await transaction.get(
                receiptRef,
              );

            // Replay e resolvido ANTES de validar categorias ou plano.
            // Auth/perfil/role/store continuam revalidados.
            if (receiptSnapshot.exists) {
              const productId =
                validateExistingReceipt({
                  receiptData:
                    receiptSnapshot.data(),

                  storeId,
                  uid,
                  requestHash,
                });

              return {
                productId,
                replayed: true,
              };
            }

            // ------------------------------------------------------
            // PLANO PARA DADOS FISCAIS
            //
            // Nao existe gate de assinatura para criar produto comum.
            // Apenas a persistencia de fiscal exige Business ativo.
            // ------------------------------------------------------

            if (
              Object.prototype.hasOwnProperty.call(
                product,
                "fiscal",
              )
            ) {
              const subscriptionType =
                normalizeString(
                  storeData.subscriptionType,
                ).toLowerCase();

              const subscriptionStatus =
                normalizeString(
                  storeData.subscriptionStatus,
                ).toLowerCase();

              if (
                subscriptionType !==
                  "business" ||
                subscriptionStatus !==
                  "active"
              ) {
                throw new HttpsError(
                  "failed-precondition",
                  "Dados fiscais de produto exigem plano Business ativo.",
                  {
                    reason:
                      "fiscal-business-required",
                  },
                );
              }
            }

            // ------------------------------------------------------
            // PRODUCT ID CANDIDATO
            //
            // Leitura defensiva evita qualquer overwrite em uma
            // colisao extremamente improvavel de auto-ID.
            // ------------------------------------------------------

            const productRef =
              storeRef
                .collection("products")
                .doc(
                  candidateProductId,
                );

            const productSnapshot =
              await transaction.get(
                productRef,
              );

            if (productSnapshot.exists) {
              throw new HttpsError(
                "aborted",
                "Nao foi possivel reservar um novo identificador de produto.",
                {
                  reason:
                    "generated-product-id-collision",
                },
              );
            }

            // ------------------------------------------------------
            // CATEGORIAS CANONICAS
            //
            // Toda categoria desejada e lida dentro da MESMA
            // transacao da criacao do vinculo.
            // ------------------------------------------------------

            const resolvedCategories =
              new Map();
            const categoryDataById = new Map();

            for (
              const categoryId
              of categoryIds
            ) {
              const categoryRef =
                storeRef
                  .collection(
                    "categories",
                  )
                  .doc(
                    categoryId,
                  );

              const categorySnapshot =
                await transaction.get(
                  categoryRef,
                );

              if (
                !categorySnapshot.exists
              ) {
                throw new HttpsError(
                  "failed-precondition",
                  "Uma categoria selecionada nao esta disponivel nesta loja.",
                  {
                    reason:
                      "category-unavailable",
                  },
                );
              }

              const categoryData =
                categorySnapshot.data() ||
                {};

              categoryDataById.set(categoryId, categoryData);
              resolvedCategories.set(
                categoryId,
                {
                  name:
                    categoryData.name,
                },
              );
            }

            // Cache local a esta tentativa; todos os reads precedem os writes.
            const invalidHierarchy = () => new HttpsError(
              "failed-precondition",
              "Uma categoria selecionada possui hierarquia invalida.",
              {reason: "invalid-category-hierarchy"},
            );
            const storedParent = (data) => {
              try {
                return normalizeStoredParentCategoryId(data);
              } catch (error) {
                if (error instanceof TypeError || error instanceof RangeError) {
                  throw invalidHierarchy();
                }
                throw error;
              }
            };
            const parentIds = new Set();
            for (const categoryId of categoryIds) {
              const parentId = storedParent(categoryDataById.get(categoryId));
              if (parentId === categoryId) {
                throw invalidHierarchy();
              }
              if (parentId !== null) {
                parentIds.add(parentId);
              }
            }
            for (const parentId of parentIds) {
              if (!categoryDataById.has(parentId)) {
                const parentSnapshot = await transaction.get(
                  storeRef.collection("categories").doc(parentId),
                );
                if (!parentSnapshot.exists) {
                  throw invalidHierarchy();
                }
                categoryDataById.set(parentId, parentSnapshot.data());
              }
              if (storedParent(categoryDataById.get(parentId)) !== null) {
                throw invalidHierarchy();
              }
            }

            let projection;

            try {
              projection =
                projectLegacyCategories(
                  categoryIds,
                  resolvedCategories,
                );
            } catch (error) {
              throw new HttpsError(
                "failed-precondition",
                "Uma categoria selecionada possui dados canonicos invalidos.",
                {
                  reason:
                    "invalid-category-data",
                },
              );
            }

            // ------------------------------------------------------
            // DOCUMENTO CANONICO
            // ------------------------------------------------------

            const serverTimestamp =
              admin.firestore
                .FieldValue
                .serverTimestamp();

            const productDocument = {
              name:
                product.name,

              name_lowercase:
                product.name
                  .toLowerCase(),

              price:
                product.price,

              lotes:
                persistedLots,

              quantidade:
                product.quantidade,

              minimumStock:
                product.minimumStock,

              imageUrl:
                product.imageUrl,

              categoryIds:
                projection.categoryIds,

              categoryId:
                projection.categoryId,

              categoryName:
                projection.categoryName,

              createdAt:
                serverTimestamp,
            };

            if (
              Object.prototype.hasOwnProperty.call(
                product,
                "barcode",
              )
            ) {
              productDocument.barcode =
                product.barcode;
            }

            if (
              Object.prototype.hasOwnProperty.call(
                product,
                "costPrice",
              )
            ) {
              productDocument.costPrice =
                product.costPrice;
            }

            if (
              Object.prototype.hasOwnProperty.call(
                product,
                "fiscal",
              )
            ) {
              productDocument.fiscal = {
                ...product.fiscal,

                updatedAt:
                  serverTimestamp,
              };
            }

            // ------------------------------------------------------
            // AUDIT + RECEIPT
            // ------------------------------------------------------

            const beforeTaxonomy =
              captureTaxonomyState(
                {},
              );

            const afterTaxonomy =
              captureTaxonomyState(
                projection,
              );

            // Todas as leituras terminaram antes de qualquer write.
            transaction.set(
              productRef,
              productDocument,
            );

            transaction.set(
              receiptRef,
              {
                action:
                  "product_created",

                entityType:
                  "product",

                entityId:
                  candidateProductId,

                resultId:
                  candidateProductId,

                storeId,

                performedBy: {
                  uid,
                  role:
                    userRole,
                },

                requestHash,

                before:
                  beforeTaxonomy,

                after:
                  afterTaxonomy,

                createdAt:
                  serverTimestamp,
              },
            );

            return {
              productId:
                candidateProductId,

              replayed: false,
            };
          },
        );

      return {
        success: true,

        productId:
          transactionResult.productId,

        replayed:
          transactionResult.replayed,
      };
    },
  );

module.exports = {
  createProduct,
};
