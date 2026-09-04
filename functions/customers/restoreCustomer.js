// ============================================================================
// STORE CONNECT - RESTAURAÇÃO SEGURA DE CLIENTE
// ============================================================================
//
// Arquivo:
//   functions/customers/restoreCustomer.js
//
// OBJETIVO:
//
// Restaurar um cliente previamente arquivado sem apagar o histórico
// administrativo da operação anterior.
//
// FLUXO:
//
// Flutter
//   ↓
// callable restoreCustomer
//   ↓
// valida Firebase Auth
//   ↓
// valida users/{uid}: role == admin e storeId correspondente
//   ↓
// transação Firestore
//   ↓
// customers/{customerId}: isArchived = false
//   +
// auditLogs/{logId}: trilha completa da restauração
//
// SEGURANÇA:
//
// - exige usuário autenticado;
// - exige papel `admin`;
// - exige que o usuário pertença à mesma loja;
// - não aceita role enviado pelo Flutter;
// - não aceita UID do executor enviado pelo Flutter;
// - nunca executa delete físico;
// - só restaura cliente que já esteja arquivado;
// - é idempotente: restaurar novamente um cliente já ativo não cria
//   alteração desnecessária.
//
// HISTÓRICO:
//
// archivedAt e archivedBy NÃO são apagados.
//
// Eles continuam representando a última ocorrência de arquivamento.
//
// A cronologia completa de arquivamentos/restaurações é preservada
// na coleção auditLogs.
//
// IMPORTANTE:
//
// Cloud Functions Admin SDK ignora Firestore Rules.
// Portanto toda autorização deve ser validada explicitamente aqui.
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

const restoreCustomer = onCall(
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

    const uid = request.auth.uid;

    const storeId = normalizeString(
      request.data?.storeId,
    );

    const customerId = normalizeString(
      request.data?.customerId,
    );

    const reason = normalizeString(
      request.data?.reason,
    );

    // ========================================================================
    // 2. PARÂMETROS
    // ========================================================================

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

    // ========================================================================
    // 3. VALIDA USUÁRIO E LOJA
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

    const userRole = normalizeString(
      userData.role,
    ).toLowerCase();

    const userStoreId = normalizeString(
      userData.storeId,
    );

    // ========================================================================
    // 4. PERMISSÃO
    // ========================================================================

    if (userRole !== "admin") {
      throw new HttpsError(
        "permission-denied",
        "Somente um administrador pode restaurar clientes.",
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

    const result = await db.runTransaction(
      async (transaction) => {
        const customerSnapshot =
          await transaction.get(
            customerRef,
          );

        if (!customerSnapshot.exists) {
          throw new HttpsError(
            "not-found",
            "Cliente não encontrado.",
          );
        }

        const customerData =
          customerSnapshot.data() || {};

        // Já está ativo.
        if (customerData.isArchived !== true) {
          return {
            alreadyActive: true,
          };
        }

        const before =
          customerAuditSnapshot(
            customerData,
          );

        const now =
          admin.firestore.FieldValue
            .serverTimestamp();

        // ------------------------------------------------------------
        // Mantemos archivedAt e archivedBy.
        // Apenas alteramos o estado atual.
        // ------------------------------------------------------------

        transaction.update(
          customerRef,
          {
            isArchived: false,
          },
        );

        transaction.set(
          auditRef,
          {
            action:
              "customer_restored",

            entityType:
              "customer",

            entityId:
              customerId,

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
    // 6. RESPOSTA
    // ========================================================================

    return {
      success: true,
      customerId,
      alreadyActive:
        result.alreadyActive,
    };
  },
);

module.exports = {
  restoreCustomer,
};