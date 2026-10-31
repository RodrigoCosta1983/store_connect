// Arquivo: financeiro/faturas.js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("./provider");
const {asaasApiKey, getAsaasApiKey} = require("./asaasSecrets");

const {resolveAsaasConfig} = require("./asaasConfig");
const {assertStoreFinancialAdmission} = require("./storeFinancialAdmission");
const {completeListResponse} = require("./asaasCompleteList");
const {billingReadState, billingReadFailure} = require("./billingReadPolicy");
const readFinancialList = (url, options) => completeListResponse(axios.get, url, options);
async function verifyOfficialSubscription(storeId, store, key) {
  const response = await axios.get(`${resolveAsaasConfig().baseUrl}/subscriptions/${store.asaasSubscriptionId}`,
    {headers: {access_token: key, "User-Agent": "StoreConnectApp/1.0"}});
  const sub = response.data;
  if (!sub || sub.id !== store.asaasSubscriptionId || sub.customer !== store.asaasCustomerId || sub.externalReference !== storeId) {
    throw new HttpsError("failed-precondition", "Assinatura oficial exige conferencia.");
  }
}


  /**
   * --- PORTAL DO CLIENTE (ASAAS) ---
   * --- FUNÇÃO PARA PEGAR O LINK DO PORTAL DO CLIENTE (ASAAS) ---
   */
  exports.getAsaasPortalUrl = onCall({secrets: [asaasApiKey], enforceAppCheck: true}, async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "O usuário deve estar logado."
      );
    }

    const userId =
      request.auth.uid;

    const storeId =
      request.data?.storeId;

    if (typeof storeId !== "string" || !storeId.trim() || storeId.includes("/")) {
      throw new HttpsError(
        "invalid-argument",
        "O ID da loja é obrigatório."
      );
    }

    const config = resolveAsaasConfig();
    const db =
      admin.firestore();

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
          "Somente o administrador proprietário pode acessar a cobrança da assinatura."
        );
      }

      if (
        !ownerId ||
        ownerId !== userId
      ) {
        throw new HttpsError(
          "permission-denied",
          "Somente o proprietário da loja pode acessar a cobrança da assinatura."
        );
      }

      const asaasSubscriptionId =
        storeData.asaasSubscriptionId;

      if (billingReadState(storeData) !== "bound") {
        throw new HttpsError(
          "failed-precondition",
          "Esta loja ainda não possui uma assinatura financeira oficial.",
          {reason: billingReadState(storeData) === "unbound" ? "no_subscription" : "incomplete_binding"}
        );
      }
      if (!config.operationsEnabled) throw new HttpsError("failed-precondition",
          "Consulta ao provedor bloqueada neste ambiente.", {reason: "provider_operations_disabled"});
      await assertStoreFinancialAdmission({db, config, storeId, storeData, operation: "subscription.read"});
      const ASAAS_API_KEY = getAsaasApiKey();
      await verifyOfficialSubscription(storeId, storeData, ASAAS_API_KEY);

      // Busca somente cobranças da assinatura oficial da loja.
      const response =
        await readFinancialList(
          `${resolveAsaasConfig().baseUrl}/payments`,
          {
            headers: {
              "access_token":
                ASAAS_API_KEY,

              "User-Agent":
                "StoreConnectApp/1.0"
            },

            params: {
              subscription:
                asaasSubscriptionId,

              limit:
                100
            }
          }
        );

      const payments =
        response.data?.data || [];
      if (!Array.isArray(response.data?.data) || response.data.hasMore !== false ||
          payments.some(p => p.subscription !== asaasSubscriptionId || p.customer !== storeData.asaasCustomerId ||
            (p.externalReference && p.externalReference !== storeId))) {
        throw new HttpsError("failed-precondition", "Consulta de cobrancas incompleta ou divergente.");
      }

      // Somente cobranças que ainda podem ser pagas.
      //
      // Ordenamos pela data de vencimento para que uma PENDING
      // vencida seja escolhida antes de uma cobrança futura.
      const actionablePayments =
        payments
          .filter(
            (payment) =>
              payment.status === "OVERDUE" ||
              payment.status === "PENDING"
          )
          .filter(
            (payment) =>
              Boolean(
                payment.invoiceUrl ||
                payment.billUrl
              )
          )
          .sort(
            (a, b) => {
              const dueA =
                String(
                  a.dueDate ||
                  "9999-12-31"
                );

              const dueB =
                String(
                  b.dueDate ||
                  "9999-12-31"
                );

              return dueA.localeCompare(
                dueB
              );
            }
          );

      if (actionablePayments.length === 0) {
        throw new HttpsError(
          "not-found",
          "Nenhuma cobrança pendente encontrada para esta assinatura."
        );
      }

      const payment =
        actionablePayments[0];

      const invoiceUrl =
        payment.invoiceUrl ||
        payment.billUrl ||
        null;

      if (!invoiceUrl) {
        throw new HttpsError(
          "not-found",
          "A cobrança não possui um link de pagamento disponível."
        );
      }

      return {
        portalUrl:
          invoiceUrl
      };

    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }

      const failure = billingReadFailure(error);
      throw new HttpsError(
        failure.code,
        "Consulta financeira indisponível.",
        {reason: failure.reason}
      );
    }
  });

  /**
   * --- LISTAR FATURAS DO ASAAS ---
   * Busca o histórico de cobranças de uma loja para exibir no app.
   */
  exports.listAsaasInvoices = onCall({secrets: [asaasApiKey], enforceAppCheck: true}, async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "O usuário deve estar logado.");
    }

    const userId = request.auth.uid;

    const config = resolveAsaasConfig();

    const storeId = request.data?.storeId;
    if (typeof storeId !== "string" || !storeId.trim() || storeId.includes("/")) {
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

      if (billingReadState(storeData) === "unbound") {
        return {invoices: [], hasMore: false, billingState: "no_subscription"};
      }
      if (billingReadState(storeData) !== "bound") {
        throw new HttpsError(
          "failed-precondition",
          "Vínculo financeiro incompleto; conferência necessária.",
          {reason: "incomplete_binding"}
        );
      }

      // Busca somente cobranças da assinatura oficial da loja.
      //
      // IMPORTANTE:
      if (!config.operationsEnabled) throw new HttpsError("failed-precondition",
          "Consulta ao provedor bloqueada neste ambiente.", {reason: "provider_operations_disabled"});
      await assertStoreFinancialAdmission({db, config, storeId, storeData, operation: "subscription.read"});
      const ASAAS_API_KEY = getAsaasApiKey();
      await verifyOfficialSubscription(storeId, storeData, ASAAS_API_KEY);

      // IMPORTANTE:
      // Não usamos apenas customer/asaasCustomerId porque um mesmo customer
      // pode estar associado a mais de uma loja no Asaas. O isolamento
      // financeiro deve seguir a asaasSubscriptionId oficial do Firestore.
      const response = await readFinancialList(`${resolveAsaasConfig().baseUrl}/payments`, {
        headers: {
          "access_token": ASAAS_API_KEY,
          "User-Agent": "StoreConnectApp/1.0"
        },
        params: {
          subscription: asaasSubscriptionId,
          limit: 12
        }
      });

      if (!Array.isArray(response.data?.data) || typeof response.data.hasMore !== "boolean" ||
          response.data.data.some(p => p.subscription !== asaasSubscriptionId || p.customer !== storeData.asaasCustomerId ||
            (p.externalReference && p.externalReference !== storeId))) {
        throw new HttpsError("failed-precondition", "Consulta de faturas incompleta ou divergente.");
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

      return { invoices, hasMore: response.data.hasMore };

    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }

      const failure = billingReadFailure(error);
      throw new HttpsError(
        failure.code,
        "Consulta financeira indisponível.",
        {reason: failure.reason}
      );
    }
  });
