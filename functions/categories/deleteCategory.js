"use strict";

const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const admin =
  require("firebase-admin");

const {
  validateDeleteCategoryInput,
} = require("./deleteCategoryContract");

const DELETE_ROLES =
  new Set([
    "admin",
    "gerente",
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

  if (
    role === "admin" ||
    role === "gerente" ||
    role === "operador"
  ) {
    return role;
  }

  return "";
}

function validatePayload(data) {
  try {
    return validateDeleteCategoryInput(
      data,
    );
  } catch (error) {
    if (
      error instanceof TypeError ||
      error instanceof RangeError
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Payload de exclusao de categoria invalido.",
      );
    }

    throw error;
  }
}

function captureCategoryAuditState(
  categoryData,
) {
  const result = {};

  for (
    const field of [
      "name",
      "imageUrl",
      "createdAt",
    ]
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        categoryData,
        field,
      )
    ) {
      result[field] =
        categoryData[field];
    }
  }

  return result;
}

const deleteCategory =
  onCall(
    {
      timeoutSeconds: 30,
      memory: "256MiB",
    },
    async (request) => {
      // =========================================================
      // 1. AUTENTICACAO + CONTRATO
      // =========================================================

      if (!request.auth) {
        throw new HttpsError(
          "unauthenticated",
          "E necessario estar autenticado.",
        );
      }

      const uid =
        request.auth.uid;

      const {
        categoryId,
      } =
        validatePayload(
          request.data,
        );

      const db =
        admin.firestore();

      const userRef =
        db.collection("users")
          .doc(uid);

      // ID criado uma unica vez fora do callback transacional.
      // Retry automatico reutiliza o mesmo auditLogId.
      const auditLogId =
        db.collection("stores")
          .doc()
          .id;

      // =========================================================
      // 2. TRANSACAO
      // =========================================================

      await db.runTransaction(
        async (transaction) => {
          // -----------------------------------------------------
          // PERFIL
          // -----------------------------------------------------

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

          if (
            !DELETE_ROLES.has(
              userRole,
            )
          ) {
            throw new HttpsError(
              "permission-denied",
              "Somente administradores e gerentes podem excluir categorias.",
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

          // -----------------------------------------------------
          // LOJA
          // -----------------------------------------------------

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

          // -----------------------------------------------------
          // CATEGORIA
          // -----------------------------------------------------

          const categoryRef =
            storeRef
              .collection("categories")
              .doc(categoryId);

          const categorySnapshot =
            await transaction.get(
              categoryRef,
            );

          if (!categorySnapshot.exists) {
            throw new HttpsError(
              "not-found",
              "Categoria nao encontrada.",
              {
                reason:
                  "category-not-found",
              },
            );
          }

          const categoryData =
            categorySnapshot.data() || {};

          // -----------------------------------------------------
          // INTEGRIDADE REFERENCIAL
          //
          // Nao filtramos isArchived.
          //
          // Portanto:
          // - produto ativo bloqueia;
          // - produto arquivado bloqueia.
          //
          // Verificamos duas identidades:
          //
          // 1. categoryIds canonico;
          // 2. categoryId legado.
          //
          // categoryName NAO e identidade.
          // -----------------------------------------------------

          const productsRef =
            storeRef
              .collection("products");

          // -----------------------------------------------------
          // REFERENCIA CANONICA
          // -----------------------------------------------------

          const canonicalQuery =
            productsRef
              .where(
                "categoryIds",
                "array-contains",
                categoryId,
              )
              .limit(1);

          const canonicalSnapshot =
            await transaction.get(
              canonicalQuery,
            );

          if (!canonicalSnapshot.empty) {
            throw new HttpsError(
              "failed-precondition",
              "A categoria esta vinculada a pelo menos um produto.",
              {
                reason:
                  "category-in-use",
              },
            );
          }

          // -----------------------------------------------------
          // REFERENCIA LEGADA
          //
          // Mesmo que um produto possua categoryIds apontando
          // para outra categoria, um categoryId legado ainda
          // apontando para esta categoria bloqueia a exclusao.
          // -----------------------------------------------------

          const legacyQuery =
            productsRef
              .where(
                "categoryId",
                "==",
                categoryId,
              )
              .limit(1);

          const legacySnapshot =
            await transaction.get(
              legacyQuery,
            );

          if (!legacySnapshot.empty) {
            throw new HttpsError(
              "failed-precondition",
              "A categoria esta vinculada a pelo menos um produto.",
              {
                reason:
                  "category-in-use",
              },
            );
          }

          // -----------------------------------------------------
          // TODAS AS LEITURAS TERMINARAM.
          // -----------------------------------------------------

          const auditRef =
            storeRef
              .collection("auditLogs")
              .doc(auditLogId);

          const now =
            admin.firestore
              .FieldValue
              .serverTimestamp();

          transaction.delete(
            categoryRef,
          );

          transaction.set(
            auditRef,
            {
              action:
                "category_deleted",

              entityType:
                "category",

              entityId:
                categoryId,

              storeId,

              performedBy: {
                uid,
                role:
                  userRole,
              },

              before:
                captureCategoryAuditState(
                  categoryData,
                ),

              after:
                null,

              createdAt:
                now,
            },
          );
        },
      );

      return {
        success: true,
        categoryId,
        deleted: true,
      };
    },
  );

module.exports = {
  deleteCategory,
};