// ============================================================================
// STORE CONNECT - ARQUIVAMENTO SEGURO DE PRODUTO
// ============================================================================
//
// Arquivo:
//   functions/products/archiveProduct.js
//
// OBJETIVO:
//
// Substituir a exclusão física de produtos por arquivamento lógico, preservando
// cadastro, estoque, dados fiscais, imagens e referências históricas de vendas.
//
// FLUXO:
//
// Flutter
//   ↓
// callable archiveProduct
//   ↓
// valida Firebase Auth
//   ↓
// valida users/{uid}: role == admin e storeId correspondente
//   ↓
// transação Firestore
//   ↓
// products/{productId}: isArchived = true
//   +
// auditLogs/{logId}: trilha completa da operação
//
// SEGURANÇA:
//
// - exige usuário autenticado;
// - exige papel `admin`;
// - exige que o usuário pertença à mesma loja;
// - bloqueia usuário com accessStatus == `revoked`;
// - não confia em role ou UID enviados pelo Flutter;
// - nunca executa delete físico;
// - não remove a imagem do Firebase Storage;
// - é idempotente.
//
// COMPATIBILIDADE:
//
// Produtos antigos podem não possuir `isArchived`.
// A ausência do campo é tratada como produto ativo.
//
// AUDITORIA:
//
// O log registra um snapshot dos campos operacionais relevantes antes/depois.
// O documento original do produto permanece integralmente preservado.
//
// IMPORTANTE:
//
// Cloud Functions Admin SDK ignora Firestore Rules. Portanto, a autorização
// precisa ser validada novamente nesta função.
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
    name_lowercase: normalizeString(data.name_lowercase) || null,
    price: typeof data.price === "number" ? data.price : null,
    quantidade:
      typeof data.quantidade === "number" ? data.quantidade : null,
    minimumStock:
      typeof data.minimumStock === "number" ? data.minimumStock : null,
    categoryId: normalizeString(data.categoryId) || null,
    categoryName: normalizeString(data.categoryName) || null,
    imageUrl: normalizeString(data.imageUrl) || null,
    createdAt: data.createdAt || null,
    isArchived: data.isArchived === true,
    archivedAt: data.archivedAt || null,
    archivedBy: normalizeString(data.archivedBy) || null,
  };
}

const archiveProduct = onCall(
    {
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
      const storeId = normalizeString(request.data?.storeId);
      const productId = normalizeString(request.data?.productId);
      const reason = normalizeString(request.data?.reason);

      // ======================================================================
      // 2. ARGUMENTOS
      // ======================================================================

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

      const db = admin.firestore();

      const userRef = db
          .collection("users")
          .doc(uid);

      const storeRef = db
          .collection("stores")
          .doc(storeId);

      const productRef = storeRef
          .collection("products")
          .doc(productId);

      const auditRef = storeRef
          .collection("auditLogs")
          .doc();

      // ======================================================================
      // 3. AUTORIZAÇÃO ADMINISTRATIVA
      // ======================================================================

      const [userSnapshot, storeSnapshot] = await Promise.all([
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

      const userData = userSnapshot.data() || {};
      const userRole = normalizeString(userData.role).toLowerCase();
      const userStoreId = normalizeString(userData.storeId);
      const accessStatus = normalizeString(userData.accessStatus)
          .toLowerCase();

      if (accessStatus === "revoked") {
        throw new HttpsError(
            "permission-denied",
            "O acesso deste usuário está revogado.",
        );
      }

      if (userRole !== "admin") {
        throw new HttpsError(
            "permission-denied",
            "Somente um administrador pode arquivar produtos.",
        );
      }

      if (!userStoreId || userStoreId !== storeId) {
        throw new HttpsError(
            "permission-denied",
            "O usuário não pertence a esta loja.",
        );
      }

      // ======================================================================
      // 4. TRANSAÇÃO
      // ======================================================================

      const result = await db.runTransaction(async (transaction) => {
        const productSnapshot = await transaction.get(productRef);

        if (!productSnapshot.exists) {
          throw new HttpsError(
              "not-found",
              "Produto não encontrado.",
          );
        }

        const productData = productSnapshot.data() || {};

        // ------------------------------------------------------------------
        // IDEMPOTÊNCIA
        // ------------------------------------------------------------------

        if (productData.isArchived === true) {
          return {
            alreadyArchived: true,
          };
        }

        const before = productAuditSnapshot(productData);
        const now = admin.firestore.FieldValue.serverTimestamp();

        transaction.update(
            productRef,
            {
              isArchived: true,
              archivedAt: now,
              archivedBy: uid,
            },
        );

        transaction.set(
            auditRef,
            {
              action: "product_archived",
              entityType: "product",
              entityId: productId,
              storeId,
              performedBy: {
                uid,
                role: userRole,
              },
              reason: reason || null,
              before,
              after: {
                ...before,
                isArchived: true,
                archivedAt: now,
                archivedBy: uid,
              },
              createdAt: now,
            },
        );

        return {
          alreadyArchived: false,
        };
      });

      // ======================================================================
      // 5. RETORNO
      // ======================================================================

      return {
        success: true,
        productId,
        alreadyArchived: result.alreadyArchived,
      };
    },
);

module.exports = {
  archiveProduct,
};