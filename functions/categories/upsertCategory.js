"use strict";

const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const admin =
  require("firebase-admin");

const {
  validateCategoryId,
  validateCategoryMutationInput,
  validateCategoryHierarchyDecision,
} = require("./categoryHierarchyContract");

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

function hasOwn(object, field) {
  return Object.prototype.hasOwnProperty.call(
    object,
    field,
  );
}

function validatePayload(data) {
  try {
    return validateCategoryMutationInput(
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

/**
 * Compatibilidade:
 *
 * categorias legadas nao possuem parentCategoryId.
 * Ausencia do campo significa categoria raiz.
 */
function normalizeStoredParentCategoryId(
  categoryData,
) {
  if (
    !hasOwn(
      categoryData,
      "parentCategoryId",
    ) ||
    categoryData.parentCategoryId === null
  ) {
    return null;
  }

  try {
    return validateCategoryId(
      categoryData.parentCategoryId,
      "parentCategoryId",
    );
  } catch (error) {
    throw new HttpsError(
      "failed-precondition",
      "Categoria possui hierarquia armazenada invalida.",
      {
        reason:
          "invalid-category-hierarchy",
      },
    );
  }
}

function captureCategoryAuditState(
  categoryData,
) {
  const result = {
    parentCategoryId:
      normalizeStoredParentCategoryId(
        categoryData,
      ),
  };

  if (
    hasOwn(
      categoryData,
      "name",
    )
  ) {
    result.name =
      categoryData.name;
  }

  if (
    hasOwn(
      categoryData,
      "imageUrl",
    )
  ) {
    result.imageUrl =
      categoryData.imageUrl;
  }

  return result;
}

function validateHierarchy(context) {
  try {
    return validateCategoryHierarchyDecision(
      context,
    );
  } catch (error) {
    if (
      !(
        error instanceof TypeError ||
        error instanceof RangeError
      )
    ) {
      throw error;
    }

    let reason =
      "invalid-category-hierarchy";

    if (
      error.message ===
      "target parent must be a root category"
    ) {
      reason =
        "target-parent-not-root";
    } else if (
      error.message ===
      "category with children cannot become a subcategory"
    ) {
      reason =
        "category-has-children";
    }

    throw new HttpsError(
      "failed-precondition",
      error.message,
      {
        reason,
      },
    );
  }
}

async function upsertCategoryHandler(
  request,
) {
  // ============================================================
  // 1. AUTENTICACAO + CONTRATO
  // ============================================================

  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "E necessario estar autenticado.",
    );
  }

  const uid =
    request.auth.uid;

  const mutation =
    validatePayload(
      request.data,
    );

  const db =
    admin.firestore();

  const userRef =
    db.collection("users")
      .doc(uid);

  // IDs sao criados uma unica vez fora da transacao.
  // Se a transacao sofrer retry, permanecem estaveis.
  const candidateCategoryId =
    mutation.mode === "create"
      ? db.collection("stores")
          .doc()
          .id
      : mutation.categoryId;

  const auditLogId =
    db.collection("stores")
      .doc()
      .id;

  // ============================================================
  // 2. TRANSACAO
  //
  // storeId nunca vem do payload.
  // Perfil, loja, categoria, filhos e pai sao lidos antes
  // de qualquer escrita.
  // ============================================================

  const transactionResult =
    await db.runTransaction(
      async (transaction) => {
        // --------------------------------------------------------
        // PERFIL / AUTORIZACAO
        // --------------------------------------------------------

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
          accessStatus === "revoked"
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

        // --------------------------------------------------------
        // LOJA
        // --------------------------------------------------------

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

        const categoriesRef =
          storeRef.collection(
            "categories",
          );

        const categoryRef =
          categoriesRef.doc(
            candidateCategoryId,
          );

        // --------------------------------------------------------
        // CATEGORIA ATUAL
        // --------------------------------------------------------

        const categorySnapshot =
          await transaction.get(
            categoryRef,
          );

        if (
          mutation.mode === "update" &&
          !categorySnapshot.exists
        ) {
          throw new HttpsError(
            "not-found",
            "Categoria nao encontrada.",
          );
        }

        if (
          mutation.mode === "create" &&
          categorySnapshot.exists
        ) {
          throw new HttpsError(
            "already-exists",
            "ID de categoria ja existe.",
          );
        }

        const categoryData =
          categorySnapshot.exists
            ? categorySnapshot.data() || {}
            : null;

        // --------------------------------------------------------
        // FILHOS
        //
        // So precisamos consultar filhos em update.
        // Uma categoria nova nao pode possuir filhos.
        // --------------------------------------------------------

        let childCount = 0;

        if (
          mutation.mode === "update"
        ) {
          const childrenQuery =
            categoriesRef
              .where(
                "parentCategoryId",
                "==",
                candidateCategoryId,
              )
              .limit(1);

          const childrenSnapshot =
            await transaction.get(
              childrenQuery,
            );

          childCount =
            childrenSnapshot.empty
              ? 0
              : 1;
        }

        // --------------------------------------------------------
        // PAI DE DESTINO
        //
        // parentCategoryId ausente em documentos antigos
        // e tratado como null => categoria raiz.
        // --------------------------------------------------------

        let targetParent = null;

        if (
          mutation.parentCategoryId !== null
        ) {
          const targetParentRef =
            categoriesRef.doc(
              mutation.parentCategoryId,
            );

          const targetParentSnapshot =
            await transaction.get(
              targetParentRef,
            );

          if (!targetParentSnapshot.exists) {
            throw new HttpsError(
              "not-found",
              "Categoria pai nao encontrada.",
              {
                reason:
                  "parent-category-not-found",
              },
            );
          }

          const targetParentData =
            targetParentSnapshot.data() ||
            {};

          targetParent = {
            id:
              targetParentSnapshot.id,

            parentCategoryId:
              normalizeStoredParentCategoryId(
                targetParentData,
              ),
          };
        }

        // --------------------------------------------------------
        // DECISAO HIERARQUICA
        // --------------------------------------------------------

        validateHierarchy({
          categoryId:
            mutation.mode === "create"
              ? null
              : candidateCategoryId,

          nextParentCategoryId:
            mutation.parentCategoryId,

          childCount,

          targetParent,
        });

        const desiredState = {
          name:
            mutation.name,

          imageUrl:
            mutation.imageUrl,

          parentCategoryId:
            mutation.parentCategoryId,
        };

        // --------------------------------------------------------
        // IDEMPOTENCIA DE UPDATE
        //
        // Categorias legadas sem parentCategoryId sao comparadas
        // como raiz (null).
        // --------------------------------------------------------

        if (
          mutation.mode === "update"
        ) {
          const currentComparable = {
            name:
              categoryData.name,

            imageUrl:
              categoryData.imageUrl,

            parentCategoryId:
              normalizeStoredParentCategoryId(
                categoryData,
              ),
          };

          if (
            currentComparable.name ===
              desiredState.name &&
            currentComparable.imageUrl ===
              desiredState.imageUrl &&
            currentComparable.parentCategoryId ===
              desiredState.parentCategoryId &&
            hasOwn(
              categoryData,
              "parentCategoryId",
            )
          ) {
            return {
              mode:
                "update",

              categoryId:
                candidateCategoryId,

              parentCategoryId:
                mutation.parentCategoryId,

              changed:
                false,
            };
          }
        }

        // ========================================================
        // TODAS AS LEITURAS TERMINARAM.
        // ========================================================

        const now =
          admin.firestore
            .FieldValue
            .serverTimestamp();

        const auditRef =
          storeRef
            .collection("auditLogs")
            .doc(auditLogId);

        const before =
          mutation.mode === "update"
            ? captureCategoryAuditState(
                categoryData,
              )
            : null;

        // --------------------------------------------------------
        // PERSISTENCIA
        // --------------------------------------------------------

        if (
          mutation.mode === "create"
        ) {
          transaction.set(
            categoryRef,
            {
              name:
                mutation.name,

              imageUrl:
                mutation.imageUrl,

              parentCategoryId:
                mutation.parentCategoryId,

              createdAt:
                now,
            },
          );
        } else {
          transaction.update(
            categoryRef,
            {
              name:
                mutation.name,

              imageUrl:
                mutation.imageUrl,

              parentCategoryId:
                mutation.parentCategoryId,
            },
          );
        }

        // --------------------------------------------------------
        // AUDITORIA
        // --------------------------------------------------------

        transaction.set(
          auditRef,
          {
            action:
              mutation.mode === "create"
                ? "category_created"
                : "category_updated",

            entityType:
              "category",

            entityId:
              candidateCategoryId,

            storeId,

            performedBy: {
              uid,
              role:
                userRole,
            },

            before,

            after:
              desiredState,

            createdAt:
              now,
          },
        );

        return {
          mode:
            mutation.mode,

          categoryId:
            candidateCategoryId,

          parentCategoryId:
            mutation.parentCategoryId,

          changed:
            true,
        };
      },
    );

  return {
    success: true,
    ...transactionResult,
  };
}

const upsertCategory =
  onCall(
    {
      timeoutSeconds: 30,
      memory: "256MiB",
    },
    upsertCategoryHandler,
  );

module.exports = {
  upsertCategory,
  upsertCategoryHandler,
};