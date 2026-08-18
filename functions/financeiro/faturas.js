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

    const storeId = request.data.storeId;
    if (!storeId) {
      throw new HttpsError("invalid-argument", "O ID da loja é obrigatório.");
    }

    const db = admin.firestore();

    try {
      const storeDoc = await db.collection("stores").doc(storeId).get();
      if (!storeDoc.exists) {
        throw new HttpsError("not-found", "Loja não encontrada.");
      }

      const asaasCustomerId = storeDoc.data().asaasCustomerId;
      if (!asaasCustomerId) {
        throw new HttpsError("failed-precondition", "Loja sem cadastro financeiro.");
      }

      const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

      // Busca até 12 faturas do cliente no Asaas
      const response = await axios.get(`${ASAAS_URL}/payments?customer=${asaasCustomerId}&limit=12`, {
        headers: {
          "access_token": ASAAS_API_KEY,
          "User-Agent": "StoreConnectApp/1.0"
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
      console.error("Erro ao listar faturas:", error.message);
      throw new HttpsError("internal", "Erro ao conectar com o servidor financeiro.");
    }
  });