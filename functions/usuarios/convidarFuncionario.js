// ============================================================================
// ARQUIVO: functions/usuarios/convidarFuncionario.js
// ============================================================================
//
// OBJETIVO:
//
// Criar com segurança um novo usuário funcionário para uma loja do
// Store&Connect.
//
// PAPÉIS CANÔNICOS:
//
// - admin
// - gerente
// - operador
//
// Nesta função, somente os seguintes papéis podem ser atribuídos:
//
// - gerente
// - operador
//
// O papel "admin" NÃO pode ser criado por convite.
//
// SEGURANÇA:
//
// Somente um usuário autenticado com:
//
//   role == "admin"
//   storeId == storeId solicitado
//
// pode convidar funcionários.
//
// A autorização é validada no servidor.
//
// Não confiamos:
// - na interface Flutter;
// - no role enviado pelo cliente;
// - no storeId informado sem validação.
//
// COMPATIBILIDADE:
//
// Os papéis legados:
//
// - caixa
// - vendedor
//
// não são mais aceitos em novos convites.
//
// Eles continuam sendo tratados como "operador" no Flutter até concluirmos
// a migração dos documentos antigos.
//
// FLUXO:
//
// 1. valida autenticação;
// 2. valida argumentos;
// 3. carrega o usuário solicitante;
// 4. confirma que é admin da própria loja;
// 5. valida o papel solicitado;
// 6. cria o usuário no Firebase Authentication;
// 7. cria users/{uid};
// 8. gera link para definição da senha;
// 9. retorna o link ao app.
//
// CUIDADO:
//
// Se a criação no Authentication ocorrer e a gravação no Firestore falhar,
// tentamos remover o usuário recém-criado para evitar uma conta órfã.
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

exports.convidarFuncionario = onCall(
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
    // 2. DADOS RECEBIDOS
    // ========================================================================

    const {
      storeId,
      email,
      nome,
      role,
    } = request.data || {};

    const normalizedStoreId =
      typeof storeId === "string"
        ? storeId.trim()
        : "";

    const normalizedEmail =
      typeof email === "string"
        ? email.trim().toLowerCase()
        : "";

    const normalizedName =
      typeof nome === "string"
        ? nome.trim()
        : "";

    const normalizedRole =
      typeof role === "string"
        ? role.trim().toLowerCase()
        : "";

    // ========================================================================
    // 3. VALIDAÇÃO DOS CAMPOS
    // ========================================================================

    if (
      !normalizedStoreId ||
      !normalizedEmail ||
      !normalizedRole
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Preencha todos os campos obrigatórios."
      );
    }

    if (
      !normalizedEmail.includes("@")
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Informe um e-mail válido."
      );
    }

    // ========================================================================
    // 4. PAPÉIS PERMITIDOS
    // ========================================================================

    const rolesPermitidas = [
      "operador",
      "gerente",
    ];

    if (
      !rolesPermitidas.includes(
        normalizedRole
      )
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Cargo inválido."
      );
    }

    const db = admin.firestore();

    let createdEmployeeUid = null;

    try {
      // ======================================================================
      // 5. BUSCA USUÁRIO SOLICITANTE
      // ======================================================================

      const requesterUserDoc =
        await db
          .collection("users")
          .doc(requesterUid)
          .get();

      if (!requesterUserDoc.exists) {
        throw new HttpsError(
          "permission-denied",
          "Usuário solicitante não encontrado."
        );
      }

      const requesterData =
        requesterUserDoc.data() || {};

      const requesterStoreId =
        typeof requesterData.storeId ===
        "string"
          ? requesterData.storeId.trim()
          : "";

      const requesterRole =
        typeof requesterData.role ===
        "string"
          ? requesterData.role
              .trim()
              .toLowerCase()
          : "";

      // ======================================================================
      // 6. SOMENTE ADMIN DA PRÓPRIA LOJA
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
          "Somente o administrador da loja pode convidar funcionários."
        );
      }

      // ======================================================================
      // 7. CONFIRMA EXISTÊNCIA DA LOJA
      // ======================================================================

      const storeDoc =
        await db
          .collection("stores")
          .doc(normalizedStoreId)
          .get();

      if (!storeDoc.exists) {
        throw new HttpsError(
          "not-found",
          "Loja não encontrada."
        );
      }

      // ======================================================================
      // 8. CRIA USUÁRIO NO FIREBASE AUTHENTICATION
      // ======================================================================

      const userRecord =
        await admin.auth().createUser({
          email: normalizedEmail,
          displayName:
            normalizedName ||
            "Colaborador",
          emailVerified: false,
          disabled: false,
        });

      createdEmployeeUid =
        userRecord.uid;

      // ======================================================================
      // 9. CRIA PERFIL NO FIRESTORE
      // ======================================================================

      await db
        .collection("users")
        .doc(createdEmployeeUid)
        .set({
          name:
            normalizedName ||
            "Colaborador",

          email:
            normalizedEmail,

          storeId:
            normalizedStoreId,

          role:
            normalizedRole,

          // ---------------------------------------------------------------
          // CONTROLE DE ACESSO
          //
          // Já deixamos preparado para a futura revogação segura.
          // ---------------------------------------------------------------

          accessStatus:
            "active",

          createdAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),

          createdBy:
            requesterUid,
        });

      // ======================================================================
      // 10. GERA LINK PARA DEFINIR SENHA
      // ======================================================================

      const linkRedefinicao =
        await admin
          .auth()
          .generatePasswordResetLink(
            normalizedEmail
          );

      console.log(
        [
          "✅ Funcionário convidado:",
          `email=${normalizedEmail}`,
          `storeId=${normalizedStoreId}`,
          `role=${normalizedRole}`,
          `createdBy=${requesterUid}`,
        ].join(" ")
      );

      // ======================================================================
      // 11. RETORNO
      // ======================================================================

      return {
        success: true,

        message:
          "Convite gerado com sucesso!",

        tempResetLink:
          linkRedefinicao,

        employeeUid:
          createdEmployeeUid,
      };
    } catch (error) {
      console.error(
        "❌ Erro ao convidar funcionário:",
        error
      );

      // ======================================================================
      // ROLLBACK
      //
      // Se o Auth foi criado mas alguma etapa seguinte falhou,
      // tentamos apagar somente o usuário recém-criado.
      // ======================================================================

      if (createdEmployeeUid) {
        try {
          await admin
            .auth()
            .deleteUser(
              createdEmployeeUid
            );

          console.log(
            `↩️ Rollback do usuário ${createdEmployeeUid} realizado.`
          );
        } catch (rollbackError) {
          console.error(
            "❌ Falha no rollback do usuário:",
            rollbackError
          );
        }
      }

      // ======================================================================
      // PRESERVA HttpsError ORIGINAL
      // ======================================================================

      if (
        error instanceof HttpsError
      ) {
        throw error;
      }

      // ======================================================================
      // ERROS DO FIREBASE AUTH
      // ======================================================================

      if (
        error.code ===
        "auth/email-already-exists"
      ) {
        throw new HttpsError(
          "already-exists",
          "Este e-mail já está cadastrado no sistema."
        );
      }

      if (
        error.code ===
        "auth/invalid-email"
      ) {
        throw new HttpsError(
          "invalid-argument",
          "O e-mail informado é inválido."
        );
      }

      // ======================================================================
      // ERRO GENÉRICO
      // ======================================================================

      throw new HttpsError(
        "internal",
        "Não foi possível criar o funcionário."
      );
    }
  }
);