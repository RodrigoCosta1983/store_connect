// ============================================================================
// ARQUIVO: functions/usuarios/revogarAcessoFuncionario.js
// ============================================================================
//
// OBJETIVO:
//
// Revogar com segurança o acesso de um funcionário ao Store&Connect sem
// excluir fisicamente seu cadastro.
//
// PRINCÍPIO:
//
// Funcionários fazem parte do histórico operacional da loja.
//
// Portanto:
//
// NÃO:
//   users/{uid}.delete()
//
// SIM:
//   accessStatus: "revoked"
//   revokedAt
//   revokedBy
//
// Além disso, o usuário é desabilitado no Firebase Authentication.
//
// SEGURANÇA:
//
// Somente:
//
//   role == "admin"
//   storeId == loja alvo
//
// pode revogar funcionários.
//
// PROTEÇÕES:
//
// - admin não pode revogar a si próprio;
// - funcionário precisa pertencer à mesma loja;
// - outro admin não pode ser revogado por este fluxo;
// - operação é idempotente;
// - gera auditLogs;
// - documento users/{uid} é preservado.
//
// FLUXO:
//
// 1. valida autenticação;
// 2. valida parâmetros;
// 3. valida administrador solicitante;
// 4. carrega funcionário;
// 5. valida vínculo com a loja;
// 6. bloqueia tentativa contra admin;
// 7. desabilita Firebase Authentication;
// 8. marca documento como revoked;
// 9. grava auditoria.
//
// ============================================================================

const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const admin = require("firebase-admin");

// ============================================================================
// FUNÇÃO
// ============================================================================

exports.revogarAcessoFuncionario = onCall(
  async (request) => {
    // ========================================================================
    // 1. AUTENTICAÇÃO
    // ========================================================================

    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "O usuário precisa estar logado."
      );
    }

    const requesterUid = request.auth.uid;

    // ========================================================================
    // 2. PARÂMETROS
    // ========================================================================

    const {
      storeId,
      employeeUid,
      reason,
    } = request.data || {};

    const normalizedStoreId =
      typeof storeId === "string"
        ? storeId.trim()
        : "";

    const normalizedEmployeeUid =
      typeof employeeUid === "string"
        ? employeeUid.trim()
        : "";

    const normalizedReason =
      typeof reason === "string" &&
      reason.trim().length > 0
        ? reason.trim()
        : null;

    if (
      !normalizedStoreId ||
      !normalizedEmployeeUid
    ) {
      throw new HttpsError(
        "invalid-argument",
        "storeId e employeeUid são obrigatórios."
      );
    }

    // ========================================================================
    // 3. NÃO PODE REVOGAR A SI PRÓPRIO
    // ========================================================================

    if (
      requesterUid ===
      normalizedEmployeeUid
    ) {
      throw new HttpsError(
        "failed-precondition",
        "O administrador não pode remover o próprio acesso."
      );
    }

    const db = admin.firestore();

    try {
      // ======================================================================
      // 4. CARREGA ADMIN SOLICITANTE
      // ======================================================================

      const requesterRef =
        db.collection("users")
          .doc(requesterUid);

      const requesterDoc =
        await requesterRef.get();

      if (!requesterDoc.exists) {
        throw new HttpsError(
          "permission-denied",
          "Usuário solicitante não encontrado."
        );
      }

      const requesterData =
        requesterDoc.data() || {};

      const requesterStoreId =
        requesterData.storeId
          ?.toString()
          .trim() || "";

      const requesterRole =
        requesterData.role
          ?.toString()
          .trim()
          .toLowerCase() || "";

      const requesterAccessStatus =
        requesterData.accessStatus
          ?.toString()
          .trim()
          .toLowerCase() || "active";

      // ======================================================================
      // 5. SOLICITANTE PRECISA SER ADMIN ATIVO DA PRÓPRIA LOJA
      // ======================================================================

      if (
        requesterStoreId !==
        normalizedStoreId
      ) {
        throw new HttpsError(
          "permission-denied",
          "Você não tem permissão para gerenciar esta loja."
        );
      }

      if (
        requesterRole !== "admin"
      ) {
        throw new HttpsError(
          "permission-denied",
          "Somente o administrador da loja pode remover funcionários."
        );
      }

      if (
        requesterAccessStatus ===
        "revoked"
      ) {
        throw new HttpsError(
          "permission-denied",
          "Seu acesso administrativo está revogado."
        );
      }

      // ======================================================================
      // 6. CARREGA FUNCIONÁRIO
      // ======================================================================

      const employeeRef =
        db.collection("users")
          .doc(normalizedEmployeeUid);

      const employeeDoc =
        await employeeRef.get();

      if (!employeeDoc.exists) {
        throw new HttpsError(
          "not-found",
          "Funcionário não encontrado."
        );
      }

      const employeeData =
        employeeDoc.data() || {};

      const employeeStoreId =
        employeeData.storeId
          ?.toString()
          .trim() || "";

      const employeeRole =
        employeeData.role
          ?.toString()
          .trim()
          .toLowerCase() || "operador";

      const currentAccessStatus =
        employeeData.accessStatus
          ?.toString()
          .trim()
          .toLowerCase() || "active";

      // ======================================================================
      // 7. FUNCIONÁRIO PRECISA PERTENCER À MESMA LOJA
      // ======================================================================

      if (
        employeeStoreId !==
        normalizedStoreId
      ) {
        throw new HttpsError(
          "permission-denied",
          "Este funcionário não pertence à sua loja."
        );
      }

      // ======================================================================
      // 8. ADMIN NÃO É REVOGADO POR ESTE FLUXO
      // ======================================================================

      if (
        employeeRole === "admin"
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Administradores não podem ser removidos por esta operação."
        );
      }

      // ======================================================================
      // 9. IDEMPOTÊNCIA
      // ======================================================================

      if (
        currentAccessStatus ===
        "revoked"
      ) {
        // ---------------------------------------------------------------
        // Mesmo já revogado no Firestore, garantimos que o Auth permaneça
        // desabilitado.
        // ---------------------------------------------------------------

        try {
          await admin
            .auth()
            .updateUser(
              normalizedEmployeeUid,
              {
                disabled: true,
              }
            );
        } catch (authError) {
          console.error(
            "⚠️ Funcionário já revogado, mas não foi possível confirmar Auth:",
            authError
          );
        }

        return {
          success: true,
          alreadyRevoked: true,
          message:
            "O acesso deste funcionário já estava revogado.",
        };
      }

      // ======================================================================
      // 10. DESABILITA FIREBASE AUTHENTICATION
      // ======================================================================

      try {
        await admin
          .auth()
          .updateUser(
            normalizedEmployeeUid,
            {
              disabled: true,
            }
          );
      } catch (authError) {
        // ---------------------------------------------------------------
        // Se o usuário não existir no Auth, ainda preservamos a possibilidade
        // de revogar o registro Firestore.
        // ---------------------------------------------------------------

        if (
          authError.code !==
          "auth/user-not-found"
        ) {
          throw authError;
        }

        console.warn(
          `⚠️ Usuário ${normalizedEmployeeUid} não encontrado no Firebase Auth.`
        );
      }

      // ======================================================================
      // 11. AUDITORIA
      // ======================================================================

      const auditRef =
        db.collection("stores")
          .doc(normalizedStoreId)
          .collection("auditLogs")
          .doc();

      // ======================================================================
      // 12. BATCH
      // ======================================================================

      const batch = db.batch();

      batch.update(
        employeeRef,
        {
          accessStatus:
            "revoked",

          revokedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),

          revokedBy:
            requesterUid,

          revokedReason:
            normalizedReason,

          updatedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        }
      );

      batch.set(
        auditRef,
        {
          action:
            "employee_access_revoked",

          entityType:
            "user",

          entityId:
            normalizedEmployeeUid,

          storeId:
            normalizedStoreId,

          performedBy: {
            uid:
              requesterUid,

            role:
              requesterRole,
          },

          reason:
            normalizedReason,

          before: {
            name:
              employeeData.name ??
              null,

            email:
              employeeData.email ??
              null,

            role:
              employeeRole,

            storeId:
              employeeStoreId,

            accessStatus:
              currentAccessStatus,
          },

          after: {
            name:
              employeeData.name ??
              null,

            email:
              employeeData.email ??
              null,

            role:
              employeeRole,

            storeId:
              employeeStoreId,

            accessStatus:
              "revoked",

            revokedBy:
              requesterUid,
          },

          createdAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        }
      );

      await batch.commit();

      // ======================================================================
      // 13. LOG
      // ======================================================================

      console.log(
        [
          "🔒 Acesso de funcionário revogado:",
          `employeeUid=${normalizedEmployeeUid}`,
          `storeId=${normalizedStoreId}`,
          `revokedBy=${requesterUid}`,
        ].join(" ")
      );

      // ======================================================================
      // 14. RETORNO
      // ======================================================================

      return {
        success: true,
        alreadyRevoked: false,
        message:
          "Acesso do funcionário revogado com sucesso.",
      };
    } catch (error) {
      console.error(
        "❌ Erro ao revogar acesso do funcionário:",
        error
      );

      // ======================================================================
      // PRESERVA ERROS CONTROLADOS
      // ======================================================================

      if (
        error instanceof HttpsError
      ) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        "Não foi possível revogar o acesso do funcionário."
      );
    }
  }
);