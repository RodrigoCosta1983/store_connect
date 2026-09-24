"use strict";

const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const admin = require("firebase-admin");
const {
  isDeepStrictEqual,
} = require("node:util");

const {
  validateCategoryIds,
  captureTaxonomyState,
  projectLegacyCategories,
} = require("./productCategoryContract");

const {
  normalizeStoredParentCategoryId,
} = require("../categories/categoryHierarchyContract");

const TAXONOMY_FIELDS = [
  "categoryIds",
  "categoryId",
  "categoryName",
];

const ALLOWED_ROLES = new Set([
  "admin",
  "gerente",
  "operador",
]);

function normalizeString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function normalizeRole(value) {
  const role =
    normalizeString(value).toLowerCase();

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

function invalidArgument(message) {
  throw new HttpsError(
    "invalid-argument",
    message,
  );
}

function validateDocumentId(value, fieldName) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes("/")
  ) {
    invalidArgument(
      `${fieldName} deve ser um ID valido.`,
    );
  }

  return value;
}

function validateExpectedTaxonomy(value) {
  if (!isPlainObject(value)) {
    invalidArgument(
      "expectedTaxonomy deve ser um objeto.",
    );
  }

  const keys =
    Object.keys(value);

  const unexpected =
    keys.filter(
      (key) =>
        !TAXONOMY_FIELDS.includes(key),
    );

  if (unexpected.length > 0) {
    invalidArgument(
      "expectedTaxonomy possui campos nao permitidos.",
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      value,
      "categoryIds",
    )
  ) {
    try {
      validateCategoryIds(
        value.categoryIds,
      );
    } catch (error) {
      invalidArgument(
        "expectedTaxonomy.categoryIds e invalido.",
      );
    }
  }

  for (
    const field of [
      "categoryId",
      "categoryName",
    ]
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        value,
        field,
      ) &&
      value[field] !== null &&
      typeof value[field] !== "string"
    ) {
      invalidArgument(
        `expectedTaxonomy.${field} e invalido.`,
      );
    }
  }

  return value;
}

function validateCurrentTaxonomy(productData) {
  const state =
    captureTaxonomyState(
      productData,
    );

  if (state.categoryIds.present) {
    try {
      validateCategoryIds(
        state.categoryIds.value,
      );
    } catch (error) {
      throw new HttpsError(
        "failed-precondition",
        "A taxonomia atual do produto possui categoryIds invalido.",
        {
          reason:
            "invalid-current-taxonomy",
        },
      );
    }
  }

  for (
    const field of [
      "categoryId",
      "categoryName",
    ]
  ) {
    const fieldState =
      state[field];

    if (
      fieldState.present &&
      fieldState.value !== null &&
      typeof fieldState.value !== "string"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "A taxonomia atual do produto possui estrutura invalida.",
        {
          reason:
            "invalid-current-taxonomy",
        },
      );
    }
  }

  return state;
}

function validatePayload(data) {
  if (!isPlainObject(data)) {
    invalidArgument(
      "Payload invalido.",
    );
  }

  const allowedKeys =
    new Set([
      "productId",
      "categoryIds",
      "expectedTaxonomy",
    ]);

  const extraKeys =
    Object.keys(data)
      .filter(
        (key) =>
          !allowedKeys.has(key),
      );

  if (extraKeys.length > 0) {
    invalidArgument(
      "Payload possui campos nao permitidos.",
    );
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      data,
      "productId",
    ) ||
    !Object.prototype.hasOwnProperty.call(
      data,
      "categoryIds",
    ) ||
    !Object.prototype.hasOwnProperty.call(
      data,
      "expectedTaxonomy",
    )
  ) {
    invalidArgument(
      "productId, categoryIds e expectedTaxonomy sao obrigatorios.",
    );
  }

  const productId =
    validateDocumentId(
      data.productId,
      "productId",
    );

  let categoryIds;

  try {
    categoryIds =
      validateCategoryIds(
        data.categoryIds,
      );
  } catch (error) {
    invalidArgument(
      "categoryIds e invalido.",
    );
  }

  const expectedTaxonomy =
    validateExpectedTaxonomy(
      data.expectedTaxonomy,
    );

  return {
    productId,
    categoryIds,
    expectedTaxonomy,
  };
}

const setProductCategories =
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

      const {
        productId,
        categoryIds,
        expectedTaxonomy,
      } =
        validatePayload(
          request.data,
        );

      const db =
        admin.firestore();

      const userRef =
        db.collection("users")
          .doc(uid);

      // ============================================================
      // 2. TRANSACAO
      //
      // O storeId NAO vem do payload.
      // Ele e derivado exclusivamente de users/{uid}.
      // Perfil, loja, produto e categorias sao relidos dentro da
      // mesma transacao que persiste a taxonomia.
      // ============================================================

      // ID gerado uma unica vez fora do callback da transacao.
      // Em caso de retry automatico, o mesmo audit log sera usado.
      const auditLogId =
        db.collection("stores")
          .doc()
          .id;

      const transactionResult =
        await db.runTransaction(
          async (transaction) => {
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

            const productRef =
              storeRef
                .collection("products")
                .doc(productId);

            const productSnapshot =
              await transaction.get(
                productRef,
              );

            if (!productSnapshot.exists) {
              throw new HttpsError(
                "not-found",
                "Produto nao encontrado.",
              );
            }

            const productData =
              productSnapshot.data() || {};

            const currentState =
              validateCurrentTaxonomy(
                productData,
              );

            // ======================================================
            // 3. RESOLVER CATEGORIAS CANONICAS
            //
            // Maximo de 10; cada categoria e lida dentro da
            // transacao e somente dentro da loja autenticada.
            // ======================================================

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

            // Somente a selecao desejada; cache renovado a cada tentativa.
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

            const desiredState =
              captureTaxonomyState(
                projection,
              );

            // ======================================================
            // 4. IDEMPOTENCIA
            //
            // Se o Firestore ja possui exatamente o resultado
            // desejado, a operacao termina sem write e sem audit.
            // ======================================================

            if (
              isDeepStrictEqual(
                currentState,
                desiredState,
              )
            ) {
              return {
                changed: false,
                projection,
              };
            }

            // ======================================================
            // 5. CONTROLE DE CONCORRENCIA
            //
            // expectedTaxonomy representa exatamente o estado
            // observado pelo cliente:
            //
            // - chave ausente continua ausente;
            // - null continua null;
            // - [] continua [];
            //
            // Se outro editor mudou a taxonomia, nao aplicamos
            // last-write-wins silenciosamente.
            // ======================================================

            const expectedState =
              captureTaxonomyState(
                expectedTaxonomy,
              );

            if (
              !isDeepStrictEqual(
                currentState,
                expectedState,
              )
            ) {
              throw new HttpsError(
                "aborted",
                "A taxonomia do produto mudou. Recarregue os dados e tente novamente.",
                {
                  reason:
                    "taxonomy-conflict",
                },
              );
            }

            // ======================================================
            // 6. WRITE MINIMO
            //
            // Opcao D7 aprovada:
            // produtos arquivados PODEM receber manutencao de
            // taxonomia. Nenhum campo de arquivamento e alterado.
            //
            // Tambem nao alteramos:
            // - estoque;
            // - lotes;
            // - preco;
            // - fiscal;
            // - imagem;
            // - nome.
            // ======================================================

            const auditRef =
              storeRef
                .collection("auditLogs")
                .doc(auditLogId);

            const now =
              admin.firestore
                .FieldValue
                .serverTimestamp();

            transaction.update(
              productRef,
              {
                categoryIds:
                  projection.categoryIds,
                categoryId:
                  projection.categoryId,
                categoryName:
                  projection.categoryName,
              },
            );

            transaction.set(
              auditRef,
              {
                action:
                  "product_categories_changed",

                entityType:
                  "product",

                entityId:
                  productId,

                storeId,

                performedBy: {
                  uid,
                  role:
                    userRole,
                },

                before:
                  currentState,

                after:
                  desiredState,

                createdAt:
                  now,
              },
            );

            return {
              changed: true,
              projection,
            };
          },
        );

      return {
        success: true,
        productId,

        changed:
          transactionResult.changed,

        categoryIds:
          transactionResult
            .projection
            .categoryIds,

        categoryId:
          transactionResult
            .projection
            .categoryId,

        categoryName:
          transactionResult
            .projection
            .categoryName,
      };
    },
  );

module.exports = {
  setProductCategories,
};
