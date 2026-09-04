// ============================================================================
// STORE CONNECT - RESTAURAÇÃO SEGURA DE PRODUTO
// ============================================================================
//
// Arquivo:
//   functions/products/restoreProduct.js
//
// OBJETIVO:
//
// Restaurar um produto previamente arquivado sem apagar o cadastro, estoque,
// dados fiscais, imagem ou histórico administrativo.
//
// FLUXO:
//
// Flutter
//   ↓
// callable restoreProduct
//   ↓
// valida Firebase Auth
//   ↓
// valida users/{uid}: role == admin e storeId correspondente
//   ↓
// valida accessStatus
//   ↓
// transação Firestore
//   ↓
// products/{productId}: isArchived = false
//   +
// auditLogs/{logId}: trilha completa da restauração
//
// SEGURANÇA:
//
// - exige usuário autenticado;
// - exige papel `admin`;
// - exige que o usuário pertença à mesma loja;
// - bloqueia usuário com accessStatus == `revoked`;
// - não confia em role ou UID enviados pelo Flutter;
// - nunca executa delete físico;
// - não altera estoque;
// - não altera lotes;
// - não altera imagem;
// - não altera dados fiscais;
// - é idempotente.
//
// HISTÓRICO:
//
// archivedAt e archivedBy NÃO são apagados.
//
// Eles permanecem como informação do último arquivamento.
// O estado atual é determinado exclusivamente por:
//
//   isArchived
//
// A cronologia completa permanece em:
//
//   stores/{storeId}/auditLogs
//
// COMPATIBILIDADE COM VENDA OFFLINE:
//
// syncOfflineSale somente trata archivedAt quando:
//
//   product.isArchived === true
//
// Portanto um produto restaurado com:
//
//   isArchived = false
//
// volta a ser considerado ativo, mesmo preservando archivedAt/archivedBy.
//
// IMPORTANTE:
//
// Cloud Functions Admin SDK ignora Firestore Rules.
// Toda autorização precisa ser validada novamente aqui.
//
// ============================================================================

"use strict";

const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const admin = require("firebase-admin");

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function productAuditSnapshot(data) {
  return {
    name: normalizeString(data.name) || null,

    name_lowercase:
      normalizeString(data.name_lowercase) || null,

    price:
      typeof data.price === "number"
        ? data.price
        : null,

    quantidade:
      typeof data.quantidade === "number"
        ? data.quantidade
        : null,

    minimumStock:
      typeof data.minimumStock === "number"
        ? data.minimumStock
        : null,

    categoryId:
      normalizeString(data.categoryId) || null,

    categoryName:
      normalizeString(data.categoryName) || null,

    imageUrl:
      normalizeString(data.imageUrl) || null,

    createdAt:
      data.createdAt || null,

    isArchived:
      data.isArchived === true,

    archivedAt:
      data.archivedAt || null,

    archivedBy:
      normalizeString(data.archivedBy) || null,
  };
}

const restoreProduct = onCall(
  {
    timeoutSeconds: 30,
    memory: "256MiB",
  },

  async (request) => {
    // ========================================================================
    // 1. AUTENTICAÇÃO
    // ========================================================================

    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "É necessário estar autenticado.",
      );
    }

    const uid =
      request.auth.uid;

    const storeId =
      normalizeString(
        request.data?.storeId,
      );

    const productId =
      normalizeString(
        request.data?.productId,
      );

    const reason =
      normalizeString(
        request.data?.reason,
      );

    // ========================================================================
    // 2. ARGUMENTOS
    // ========================================================================

    if (!storeId) {
      throw new HttpsError(
        "invalid-argument",
        "storeId é obrigatório.",
      );
    }

    if (!productId) {
      throw new HttpsError(
        "invalid-argument",
        "productId é obrigatório.",
      );
    }

    const db =
      admin.firestore();

    const userRef =
      db.collection("users")
        .doc(uid);

    const storeRef =
      db.collection("stores")
        .doc(storeId);

    const productRef =
      storeRef
        .collection("products")
        .doc(productId);

    const auditRef =
      storeRef
        .collection("auditLogs")
        .doc();

    // ========================================================================
    // 3. AUTORIZAÇÃO ADMINISTRATIVA
    // ========================================================================

    const [
      userSnapshot,
      storeSnapshot,
    ] = await Promise.all([
      userRef.get(),
      storeRef.get(),
    ]);

    if (!userSnapshot.exists) {
      throw new HttpsError(
        "permission-denied",
        "Perfil do usuário não encontrado.",
      );
    }

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

    const accessStatus =
      normalizeString(
        userData.accessStatus,
      ).toLowerCase();

    // ========================================================================
    // 4. PERMISSÕES
    // ========================================================================

    if (accessStatus === "revoked") {
      throw new HttpsError(
        "permission-denied",
        "O acesso deste usuário está revogado.",
      );
    }

    if (userRole !== "admin") {
      throw new HttpsError(
        "permission-denied",
        "Somente um administrador pode restaurar produtos.",
      );
    }

    if (
      !userStoreId ||
      userStoreId !== storeId
    ) {
      throw new HttpsError(
        "permission-denied",
        "O usuário não pertence a esta loja.",
      );
    }

    // ========================================================================
    // 5. RESTAURAÇÃO TRANSACIONAL
    // ========================================================================

    const result =
      await db.runTransaction(
        async (transaction) => {
          const productSnapshot =
            await transaction.get(
              productRef,
            );

          if (!productSnapshot.exists) {
            throw new HttpsError(
              "not-found",
              "Produto não encontrado.",
            );
          }

          const productData =
            productSnapshot.data() || {};

          // ================================================================
          // IDEMPOTÊNCIA
          //
          // Produto já ativo não precisa ser alterado novamente.
          // ================================================================

          if (
            productData.isArchived !== true
          ) {
            return {
              alreadyActive: true,
            };
          }

          const before =
            productAuditSnapshot(
              productData,
            );

          const now =
            admin.firestore
              .FieldValue
              .serverTimestamp();

          // ================================================================
          // RESTAURAÇÃO
          //
          // Apenas o estado atual é alterado.
          //
          // Não modificamos:
          // - archivedAt
          // - archivedBy
          // - quantidade
          // - lotes
          // - preço
          // - dados fiscais
          // - imagem
          // ================================================================

          transaction.update(
            productRef,
            {
              isArchived: false,
            },
          );

          // ================================================================
          // AUDITORIA
          // ================================================================

          transaction.set(
            auditRef,
            {
              action:
                "product_restored",

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

              reason:
                reason || null,

              before,

              after: {
                ...before,
                isArchived: false,
              },

              createdAt:
                now,
            },
          );

          return {
            alreadyActive: false,
          };
        },
      );

    // ========================================================================
    // 6. RETORNO
    // ========================================================================

    return {
      success: true,

      productId,

      alreadyActive:
        result.alreadyActive,
    };
  },
);

module.exports = {
  restoreProduct,
};