// STORE CONNECT - ARQUIVAMENTO SEGURO DE CLIENTE
// ============================================================================
//
// Arquivo:
//   functions/customers/archiveCustomer.js
//
// OBJETIVO:
//
// Substituir a exclusão física de clientes por um arquivamento reversível,
// preservando o cadastro, as vendas, as parcelas e o histórico financeiro.
//
// FLUXO:
//
// Flutter
//   ↓
// callable archiveCustomer
//   ↓
// valida Firebase Auth
//   ↓
// valida users/{uid}: role == admin e storeId correspondente
//   ↓
// transação Firestore
//   ↓
// customers/{customerId}: isArchived = true
//   +
// auditLogs/{logId}: trilha completa da operação
//
// SEGURANÇA:
//
// - exige usuário autenticado;
// - exige papel `admin`;
// - exige que o usuário pertença à mesma loja;
// - não aceita role enviado pelo Flutter;
// - não aceita UID do executor enviado pelo Flutter;
// - nunca executa delete físico;
// - é idempotente: arquivar novamente um cliente já arquivado não cria nova
//   alteração destrutiva nem perde o histórico.
//
// AUDITORIA:
//
// O log guarda um snapshot dos campos relevantes antes/depois do arquivamento.
// Isso é a primeira camada de recuperação operacional e não substitui backups
// periódicos completos.
//
// IMPORTANTE:
//
// Cloud Functions Admin SDK ignora Firestore Rules, por isso a função precisa
// validar autorização explicitamente.
//
// As Firestore Rules atuais do projeto ainda precisam de endurecimento
// progressivo, pois existe um match amplo para stores/{storeId}/{document=**}.
// Enquanto esse catch-all permitir writes para qualquer autenticado, a UI +
// callable melhoram o fluxo normal, mas não impedem um cliente modificado de
// tentar escrita direta. A etapa de Rules deve ser feita antes de considerar
// esta proteção completa.
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

function customerAuditSnapshot(data) {
  return {
    name: normalizeString(data.name) || null,
    name_lowercase: normalizeString(data.name_lowercase) || null,
    phone: normalizeString(data.phone) || null,
    createdAt: data.createdAt || null,
    isArchived: data.isArchived === true,
    archivedAt: data.archivedAt || null,
    archivedBy: normalizeString(data.archivedBy) || null,
  };
}

const archiveCustomer = onCall(
    {
      timeoutSeconds: 30,
      memory: "256MiB",
    },
    async (request) => {
      if (!request.auth) {
        throw new HttpsError(
            "unauthenticated",
            "É necessário estar autenticado.",
        );
      }

      const uid = request.auth.uid;
      const storeId = normalizeString(request.data?.storeId);
      const customerId = normalizeString(request.data?.customerId);
      const reason = normalizeString(request.data?.reason);

      if (!storeId) {
        throw new HttpsError(
            "invalid-argument",
            "storeId é obrigatório.",
        );
      }

      if (!customerId) {
        throw new HttpsError(
            "invalid-argument",
            "customerId é obrigatório.",
        );
      }

      const db = admin.firestore();

      const userRef = db
          .collection("users")
          .doc(uid);

      const storeRef = db
          .collection("stores")
          .doc(storeId);

      const customerRef = storeRef
          .collection("customers")
          .doc(customerId);

      const auditRef = storeRef
          .collection("auditLogs")
          .doc();

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

      if (userRole !== "admin") {
        throw new HttpsError(
            "permission-denied",
            "Somente um administrador pode arquivar clientes.",
        );
      }

      if (!userStoreId || userStoreId !== storeId) {
        throw new HttpsError(
            "permission-denied",
            "O usuário não pertence a esta loja.",
        );
      }

      const result = await db.runTransaction(async (transaction) => {
        const customerSnapshot = await transaction.get(customerRef);

        if (!customerSnapshot.exists) {
          throw new HttpsError(
              "not-found",
              "Cliente não encontrado.",
          );
        }

        const customerData = customerSnapshot.data() || {};

        if (customerData.isArchived === true) {
          return {
            alreadyArchived: true,
          };
        }

        const before = customerAuditSnapshot(customerData);
        const now = admin.firestore.FieldValue.serverTimestamp();

        transaction.update(
            customerRef,
            {
              isArchived: true,
              archivedAt: now,
              archivedBy: uid,
            },
        );

        transaction.set(
            auditRef,
            {
              action: "customer_archived",
              entityType: "customer",
              entityId: customerId,
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

      return {
        success: true,
        customerId,
        alreadyArchived: result.alreadyArchived,
      };
    },
);

module.exports = {
  archiveCustomer,
};