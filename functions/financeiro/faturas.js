// Arquivo: financeiro/faturas.js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

const ASAAS_ENV = process.env.ASAAS_ENV || "sandbox";
const ASAAS_URL = ASAAS_ENV === "production"
  ? "https://www.asaas.com/api/v3"
  : "https://sandbox.asaas.com/api/v3";


  /**
   * --- PORTAL DO CLIENTE (ASAAS) ---
   * --- FUNÇÃO PARA PEGAR O LINK DO PORTAL DO CLIENTE (ASAAS) ---
   */
  exports.getAsaasPortalUrl = onCall(async (request) => {
    // 1. Verificação de segurança (Sintaxe V2 usando request.auth)
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "O usuário deve estar logado."
      );
    }

    // Na V2, os dados ficam dentro de request.data
    const storeId = request.data.storeId;
    if (!storeId) {
      throw new HttpsError(
        "invalid-argument",
        "O ID da loja é obrigatório."
      );
    }

    const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

    try {
      const storeDoc = await admin.firestore().collection("stores").doc(storeId).get();
      if (!storeDoc.exists) {
        throw new HttpsError("not-found", "Loja não encontrada.");
      }

      const storeData = storeDoc.data();
      const asaasCustomerId = storeData.asaasCustomerId;

      if (!asaasCustomerId) {
        throw new HttpsError(
          "failed-precondition",
          "Esta loja ainda não possui um cadastro financeiro."
        );
      }

      const response = await axios.get(`${ASAAS_URL}/payments`, {
        headers: {
          "access_token": ASAAS_API_KEY,
          "User-Agent": "StoreConnectApp/1.0"
        },
        params: {
          customer: asaasCustomerId,
          limit: 1
        }
      });

      const payments = response.data.data;

      if (!payments || payments.length === 0) {
         throw new HttpsError(
          "not-found",
          "Nenhuma fatura encontrada para este cliente."
        );
      }

      const invoiceUrl = payments[0].invoiceUrl;
      return { portalUrl: invoiceUrl };

    } catch (error) {
      console.error("Erro ao buscar portal Asaas:", error);
      throw new HttpsError("internal", "Erro ao conectar com o financeiro.");
    }
  });

  /**
   * --- LISTAR FATURAS DO ASAAS ---
   * Busca o histórico de cobranças de uma loja para exibir no app.
   */
  exports.listAsaasInvoices = onCall(async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "O usuário deve estar logado.");
    }

    const userId = request.auth.uid;

    const storeId = request.data.storeId;
    if (!storeId) {
      throw new HttpsError("invalid-argument", "O ID da loja é obrigatório.");
    }

    const db = admin.firestore();

    try {
      const userDoc =
        await db
          .collection("users")
          .doc(userId)
          .get();

      const storeDoc =
        await db
          .collection("stores")
          .doc(storeId)
          .get();

      if (!userDoc.exists) {
        throw new HttpsError(
          "permission-denied",
          "Usuário sem cadastro válido no Store Connect."
        );
      }

      if (!storeDoc.exists) {
        throw new HttpsError(
          "not-found",
          "Loja não encontrada."
        );
      }

      const userData =
        userDoc.data() || {};

      const storeData =
        storeDoc.data() || {};

      const userStoreId =
        String(
          userData.storeId || ""
        ).trim();

      const role =
        String(
          userData.role || ""
        )
          .trim()
          .toLowerCase();

      const accessStatus =
        String(
          userData.accessStatus || "active"
        )
          .trim()
          .toLowerCase();

      const ownerId =
        String(
          storeData.ownerId || ""
        ).trim();

      if (accessStatus === "revoked") {
        throw new HttpsError(
          "permission-denied",
          "Seu acesso a esta loja foi revogado."
        );
      }

      if (userStoreId !== storeId) {
        throw new HttpsError(
          "permission-denied",
          "Esta conta não pertence à loja informada."
        );
      }

      if (role !== "admin") {
        throw new HttpsError(
          "permission-denied",
          "Somente o administrador proprietário pode acessar as faturas da assinatura."
        );
      }

      if (
        !ownerId ||
        ownerId !== userId
      ) {
        throw new HttpsError(
          "permission-denied",
          "Somente o proprietário da loja pode acessar as faturas da assinatura."
        );
      }

      const asaasSubscriptionId =
        storeData.asaasSubscriptionId;

      if (!asaasSubscriptionId) {
        throw new HttpsError(
          "failed-precondition",
          "Loja sem assinatura financeira oficial."
        );
      }

      const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

      // Busca somente cobranças da assinatura oficial da loja.
      //
      // IMPORTANTE:
      // Não usamos apenas customer/asaasCustomerId porque um mesmo customer
      // pode estar associado a mais de uma loja no Asaas. O isolamento
      // financeiro deve seguir a asaasSubscriptionId oficial do Firestore.
      const response = await axios.get(`${ASAAS_URL}/payments`, {
        headers: {
          "access_token": ASAAS_API_KEY,
          "User-Agent": "StoreConnectApp/1.0"
        },
        params: {
          subscription: asaasSubscriptionId,
          limit: 12
        }
      });

      if (!response.data || !response.data.data) {
        return { invoices: [] };
      }

      // Mapeia apenas os dados que o Flutter precisa
      const invoices = response.data.data.map(p => ({
        id: p.id,
        dueDate: p.dueDate,
        value: p.value,
        status: p.status,
        invoiceUrl: p.invoiceUrl || p.billUrl || ""
      }));

      // Ordena da mais antiga para a mais nova, para as faturas atrasadas/atuais aparecerem primeiro
      invoices.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

      return { invoices: invoices };

    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }

      console.error(
        "Erro ao listar faturas:",
        error.message
      );

      throw new HttpsError(
        "internal",
        "Erro ao conectar com o servidor financeiro."
      );
    }
  });