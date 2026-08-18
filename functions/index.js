/**
 * 🔐 FIREBASE CLOUD FUNCTIONS - STORE CONNECT
 *
 * Este arquivo gerencia:
 * 1. Criação de assinaturas (trial ou paga)
 * 2. Webhook de confirmação de pagamento
 * 3. Limpeza de produtos deletados
 */

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const admin = require('firebase-admin');
const axios = require("axios");
const functions = require("firebase-functions");

const { onSchedule } = require("firebase-functions/v2/scheduler");



// Inicializa o Firebase apenas UMA VEZ aqui no index principal
admin.initializeApp();

const ASAAS_ENV = process.env.ASAAS_ENV || "sandbox";
const ASAAS_URL = ASAAS_ENV === "production"
  ? "https://www.asaas.com/api/v3"
  : "https://sandbox.asaas.com/api/v3";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const SUBSCRIPTION_PLANS = {
  pro: {
    price: 39.90,
    name: "Store Connect Pro",
  },

  business: {
      price: 99.90,
    name: "Store Connect Business",
  },
};

/**
 * 🔵 FUNÇÃO: createAsaasSubscription
 * * Descrição: Responsável por converter uma loja em um cliente pagante no Asaas.
 *
 * Fluxo Atualizado (Arquitetura Segura):
 * 1. Solicitação → Recebe apenas o `storeId` do aplicativo (Flutter).
 * 2. Enriquecimento → Busca de forma segura o CPF, Nome e Email direto no Firestore (evita manipulação de dados pelo frontend).
 * 3. Verificação de Assinatura Existente:
 * - Se já tem assinatura e está PAGA → Retorna aviso de sucesso.
 * - Se já tem assinatura e está PENDENTE → Recupera e retorna o link do boleto já existente.
 * 4. Nova Assinatura (Ação do botão "Assinar Agora"):
 * - Cadastra ou localiza o cliente no Asaas (usando o CPF do banco).
 * - Cria a assinatura PAGA (Plano Pro).
 * - Atualiza a loja no Firestore com os IDs gerados pelo Asaas.
 * - Retorna a URL do boleto recém-criado para o celular abrir na hora.
 *
 * Status possíveis no Firestore (campo `subscriptionStatus`):
 * - "trial"    → Teste gratuito ativo (Definido automaticamente na criação da conta da loja).
 * - "pending"  → Boleto gerado no Asaas, aguardando o cliente realizar o pagamento.
 * - "active"   → Pagamento confirmado pelo Webhook do Asaas (Acesso total liberado).
 * - "inactive" → Assinatura cancelada, vencida ou pagamento rejeitado (Bloqueia o app).
 */

 exports.createAsaasSubscription = onCall(
   { timeoutSeconds: 120 },
   async (request) => {
     console.log(
       "\n\n╔════════════════════════════════════════════════════════════╗"
     );
     console.log(
       "║  🟢 INICIANDO PROCESSO DE ASSINATURA NO ASAAS              ║"
     );
     console.log(
       "╚════════════════════════════════════════════════════════════╝"
     );

     const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

     if (!request.auth) {
       throw new HttpsError(
         "unauthenticated",
         "Usuário não logado."
       );
     }

     const userId = request.auth.uid;

     const headers = {
       access_token: ASAAS_API_KEY,
       "Content-Type": "application/json",
       "User-Agent": "StoreConnectApp/1.0",
     };

     const db = admin.firestore();

     let storeRef = null;
     let creationLockAcquired = false;

     try {
       // ============================================================
       // 1. IDENTIFICA A LOJA
       // ============================================================

       let storeId = request.data.storeId;

       if (!storeId) {
         const userDoc = await db
           .collection("users")
           .doc(userId)
           .get();

         if (
           !userDoc.exists ||
           !userDoc.data().storeId
         ) {
           throw new HttpsError(
             "not-found",
             "Nenhuma loja vinculada a este usuário."
           );
         }

         storeId = userDoc.data().storeId;
       }

       storeRef = db
         .collection("stores")
         .doc(storeId);

       // ============================================================
       // 2. TRAVA CONTRA DUPLO CLIQUE / DUAS REQUISIÇÕES
       //
       // Apenas UMA chamada pode assumir o estado "creating".
       // ============================================================

       await db.runTransaction(async (transaction) => {
         const freshStoreDoc =
           await transaction.get(storeRef);

         if (!freshStoreDoc.exists) {
           throw new HttpsError(
             "not-found",
             "Loja não encontrada."
           );
         }

         const freshData =
           freshStoreDoc.data() || {};

         const creationStatus =
           freshData.subscriptionCreationStatus;

         const creationStartedAt =
           freshData.subscriptionCreationStartedAt;

         // ----------------------------------------------------------
         // Trava expirada:
         // se por algum erro uma chamada morreu deixando "creating",
         // liberamos automaticamente após 3 minutos.
         // ----------------------------------------------------------

         let lockStillValid = false;

         if (
           creationStatus === "creating" &&
           creationStartedAt
         ) {
           const started =
             creationStartedAt.toDate
               ? creationStartedAt.toDate()
               : new Date(creationStartedAt);

           const ageMs =
             Date.now() - started.getTime();

           lockStillValid =
             ageMs < 3 * 60 * 1000;
         }

         if (lockStillValid) {
           throw new HttpsError(
             "already-exists",
             "Já existe uma assinatura sendo criada. Aguarde alguns segundos."
           );
         }

         // Assume a trava.
         transaction.update(storeRef, {
           subscriptionCreationStatus: "creating",
           subscriptionCreationStartedAt:
             admin.firestore.FieldValue.serverTimestamp(),
         });

         creationLockAcquired = true;
       });

       console.log(
         `🔒 Trava de criação adquirida para loja ${storeId}`
       );

       // ============================================================
       // 3. BUSCA DADOS ATUALIZADOS DA LOJA
       // ============================================================

       const storeDoc =
         await storeRef.get();

       const storeData =
         storeDoc.data() || {};

       const cpfCnpj =
         request.data.cpfCnpj ||
         storeData.document;

       const name =
         request.data.name ||
         storeData.name ||
         "Cliente Store Connect";

       const phone =
         request.data.phone ||
         storeData.phone ||
         "";

       const email =
         request.data.email ||
         request.auth.token?.email ||
         `contato@${storeId}.com.br`;

       if (!cpfCnpj) {
         throw new HttpsError(
           "invalid-argument",
           "CPF/CNPJ não encontrado no cadastro da loja."
         );
       }

       console.log(`📌 User ID: ${userId}`);
       console.log(`📌 Store ID: ${storeId}`);
       console.log(`📌 CPF/CNPJ: ${cpfCnpj}`);
       console.log(
         `📌 Assinatura salva atualmente: ${
           storeData.asaasSubscriptionId || "NÃO"
         }`
       );

       // ============================================================
       // 4. LOCALIZA OU CRIA O CUSTOMER
       // ============================================================

       let customerId =
         storeData.asaasCustomerId || null;

       if (!customerId) {
         const search =
           await axios.get(
             `${ASAAS_URL}/customers`,
             {
               headers,
               params: {
                 cpfCnpj,
               },
             }
           );

         if (
           search.data.data?.length > 0
         ) {
           customerId =
             search.data.data[0].id;

           console.log(
             `✅ Cliente encontrado: ${customerId}`
           );
         } else {
           const create =
             await axios.post(
               `${ASAAS_URL}/customers`,
               {
                 name,
                 email,
                 cpfCnpj,
                 phone,
                 externalReference: storeId,
               },
               { headers }
             );

           customerId =
             create.data.id;

           console.log(
             `✅ Novo cliente criado: ${customerId}`
           );
         }
       }

       // ============================================================
       // 5. PROTEÇÃO 2:
       // CONSULTA O ASAAS ANTES DE CRIAR UMA NOVA ASSINATURA
       //
       // Procura assinatura ACTIVE desta loja.
       // ============================================================

       console.log(
         "🔎 Verificando se já existe assinatura ativa no Asaas..."
       );

       const subscriptionsRes =
         await axios.get(
           `${ASAAS_URL}/subscriptions`,
           {
             headers,
             params: {
               customer: customerId,
               externalReference: storeId,
               status: "ACTIVE",
               limit: 100,
             },
           }
         );

       const activeSubscriptions =
         subscriptionsRes.data?.data || [];

       if (
         activeSubscriptions.length > 0
       ) {
         // ----------------------------------------------------------
         // Existe mais de uma?
         // Não criamos outra.
         // Escolhemos a mais recente apenas para reconciliar o
         // Firestore, e registramos o problema no log.
         // ----------------------------------------------------------

         activeSubscriptions.sort(
           (a, b) =>
             new Date(b.dateCreated) -
             new Date(a.dateCreated)
         );

         const existingSubscription =
           activeSubscriptions[0];

         if (
           activeSubscriptions.length > 1
         ) {
           console.warn(
             `⚠️ Foram encontradas ${activeSubscriptions.length} assinaturas ACTIVE para a loja ${storeId}.`
           );

           console.warn(
             "⚠️ Nenhuma nova assinatura será criada."
           );

           console.warn(
             `⚠️ Assinatura considerada oficial: ${existingSubscription.id}`
           );
         }

         await storeRef.update({
           asaasSubscriptionId:
             existingSubscription.id,

           asaasCustomerId:
             customerId,

           subscriptionType:
             "pro",

           // Não forçamos "active" aqui porque
           // ACTIVE no objeto assinatura não significa
           // necessariamente que a cobrança atual foi paga.
           //
           // Preservamos o status financeiro existente da loja.
           nextDueDate:
             existingSubscription.nextDueDate ||
             storeData.nextDueDate ||
             null,

           subscriptionCreationStatus:
             admin.firestore.FieldValue.delete(),

           subscriptionCreationStartedAt:
             admin.firestore.FieldValue.delete(),
         });

         creationLockAcquired = false;

         // ----------------------------------------------------------
         // Agora tenta encontrar uma cobrança utilizável dessa
         // assinatura para devolver ao app.
         // ----------------------------------------------------------

         const paymentsRes =
           await axios.get(
             `${ASAAS_URL}/payments`,
             {
               headers,
               params: {
                 subscription:
                   existingSubscription.id,
                 limit: 100,
               },
             }
           );

         const payments =
           paymentsRes.data?.data || [];

         // Prioridade:
         // OVERDUE -> PENDING -> qualquer outra
         const payment =
           payments.find(
             (p) => p.status === "OVERDUE"
           ) ||
           payments.find(
             (p) => p.status === "PENDING"
           ) ||
           payments[0];

         const paymentLink =
           payment?.billUrl ||
           payment?.invoiceUrl ||
           null;

         return {
           success: true,
           alreadyExists: true,
           subscriptionId:
             existingSubscription.id,
           paymentUrl: paymentLink,
           nextDueDate:
             existingSubscription.nextDueDate,
           message:
             activeSubscriptions.length > 1
               ? "Já existiam assinaturas ativas no Asaas. Nenhuma nova assinatura foi criada."
               : "Já existe uma assinatura ativa para esta loja.",
         };
       }

       // ============================================================
       // 6. NÃO EXISTE ASSINATURA ACTIVE:
       // AGORA SIM PODE CRIAR UMA NOVA
       // ============================================================

       console.log(
         "💳 Nenhuma assinatura ativa encontrada. Criando nova assinatura..."
       );

       const nextDueDate =
         new Date();

       const dueDateString =
         nextDueDate
           .toISOString()
           .split("T")[0];

       const subResponse =
         await axios.post(
           `${ASAAS_URL}/subscriptions`,
           {
             customer: customerId,
             billingType: "UNDEFINED",
             value:
               SUBSCRIPTION_PLANS.pro.price,
             nextDueDate:
               dueDateString,
             cycle: "MONTHLY",
             description:
               "Assinatura Store Connect Pro",
             externalReference:
               storeId,
           },
           { headers }
         );

       const subscriptionId =
         subResponse.data.id;

       console.log(
         `✅ Nova assinatura criada: ${subscriptionId}`
       );

       // ============================================================
       // 7. SALVA IMEDIATAMENTE O ID
       //
       // Fazemos isso antes de esperar boleto.
       // ============================================================

       await storeRef.update({
         asaasSubscriptionId:
           subscriptionId,

         asaasCustomerId:
           customerId,

         subscriptionStatus:
           "pending",

         subscriptionType:
           "pro",

         nextDueDate:
           dueDateString,

         subscriptionCreationStatus:
           admin.firestore.FieldValue.delete(),

         subscriptionCreationStartedAt:
           admin.firestore.FieldValue.delete(),
       });

       creationLockAcquired = false;

       console.log(
         `✅ Assinatura salva imediatamente no Firestore: ${subscriptionId}`
       );

       // ============================================================
       // 8. BUSCA LINK DA PRIMEIRA COBRANÇA
       //
       // Reduzi o loop para não encostar no timeout de 120s.
       //
       // 20 tentativas x 3s = no máximo ~60 segundos de espera.
       // ============================================================

       let finalPaymentLink =
         null;

       console.log(
         `⏳ Aguardando Asaas gerar cobrança da assinatura ${subscriptionId}...`
       );

       for (
         let i = 1;
         i <= 20;
         i++
       ) {
         const payments =
           await axios.get(
             `${ASAAS_URL}/payments`,
             {
               headers,
               params: {
                 subscription:
                   subscriptionId,
                 limit: 1,
               },
             }
           );

         if (
           payments.data.data &&
           payments.data.data.length > 0
         ) {
           const payment =
             payments.data.data[0];

           const linkGerado =
             payment.billUrl ||
             payment.invoiceUrl;

           if (linkGerado) {
             finalPaymentLink =
               linkGerado;

             console.log(
               `✅ Link encontrado na tentativa ${i}`
             );

             break;
           }
         }

         console.log(
           `🔄 Aguardando cobrança... tentativa ${i}`
         );

         await delay(3000);
       }

       // ============================================================
       // 9. A ASSINATURA JÁ EXISTE MESMO SE O LINK ATRASAR
       //
       // Não apagamos a assinatura e não permitimos criar outra.
       // ============================================================

       if (!finalPaymentLink) {
         console.warn(
           "⚠️ Assinatura criada, mas o link ainda não ficou disponível."
         );

         return {
           success: true,
           subscriptionCreated: true,
           waitingPaymentLink: true,
           subscriptionId,
           paymentUrl: null,
           isTrial: false,
           price:
               SUBSCRIPTION_PLANS.pro.price,
           nextDueDate:
             dueDateString,
           message:
             "Assinatura criada. O boleto ainda está sendo processado pelo Asaas. Tente abrir novamente em alguns segundos.",
         };
       }

       return {
         success: true,
         paymentUrl:
           finalPaymentLink,
         subscriptionId,
         isTrial: false,
         price:
           SUBSCRIPTION_PLANS.pro.price,
         nextDueDate:
           dueDateString,
         message:
           "📄 Boleto gerado com sucesso!",
       };

     } catch (error) {
       console.error(
         "❌ Erro na assinatura:",
         error.response?.data ||
         error.message ||
         error
       );

       // ============================================================
       // LIBERA A TRAVA EM CASO DE ERRO
       // ============================================================

       if (
         storeRef &&
         creationLockAcquired
       ) {
         try {
           await storeRef.update({
             subscriptionCreationStatus:
               admin.firestore.FieldValue.delete(),

             subscriptionCreationStartedAt:
               admin.firestore.FieldValue.delete(),
           });

           console.log(
             "🔓 Trava de criação liberada após erro."
           );
         } catch (unlockError) {
           console.error(
             "⚠️ Não foi possível liberar a trava:",
             unlockError.message
           );
         }
       }

       // Mantém HttpsError original quando possível.
       if (
         error instanceof HttpsError
       ) {
         throw error;
       }

       throw new HttpsError(
         "internal",
         `Erro na assinatura: ${
           error.message ||
           "erro desconhecido"
         }`
       );
     }
   }
 );

/**
 * 🔔 WEBHOOK DO ASAAS
 *
 * Recebe notificações de mudanças de pagamento:
 * - PAYMENT_CONFIRMED → ativa assinatura
 * - PAYMENT_RECEIVED → ativa assinatura
 * - PAYMENT_OVERDUE → desativa assinatura
 * - SUBSCRIPTION_DELETED → desativa assinatura
 */




 // =======================================================================
 // 🧾 MÓDULO FISCAL - FOCUS NFE
 // =======================================================================

 // Cadastro / validação da empresa
 const {
   registerFocusCompany,
 } = require("./fiscal/registerFocusCompany");

 exports.registerFocusCompany =
   registerFocusCompany;

 // Emissão NFC-e
 const {
   emitirNfce,
 } = require("./fiscal/emitirNfce");

 exports.emitirNfce =
   emitirNfce;

 // Pesquisa NCM
 const {
   searchNcm,
 } = require("./fiscal/ncm/searchNcm");

 exports.searchNcm =
   searchNcm;

 // -----------------------------------------------------------------------
 // Sincronização da tabela NCM oficial
 // -----------------------------------------------------------------------

 const {
   syncNcmTable,
 } = require("./fiscal/ncm/syncNcmTable");

 exports.syncNcmTable =
   syncNcmTable;


  /**
   * ⏰ CRON JOB: Verificador de Inadimplência
   * Roda todos os dias às 02:00 AM.
   * Bloqueia lojas com mais de 3 dias de atraso e cancela a assinatura no Asaas.
   */
  exports.checkOverdueSubscriptions = onSchedule(
    {
      schedule: "0 2 * * *", // Todo dia às 02:00 AM
      timeZone: "America/Sao_Paulo",
      timeoutSeconds: 120
    },
    async (event) => {
      console.log("⏰ Iniciando varredura de assinaturas em atraso...");

      const db = admin.firestore();

      // Calcula a data exata de 3 dias atrás
      const limitDate = new Date();
      limitDate.setDate(limitDate.getDate() - 3);

      try {
        // Busca lojas que estão no período de tolerância e já passaram dos 3 dias
        const snapshot = await db.collection("stores")
          .where("subscriptionStatus", "==", "overdue")
          .where("overdueSince", "<=", limitDate)
          .get();

        if (snapshot.empty) {
          console.log("✅ Nenhuma loja com atraso superior a 3 dias encontrada hoje.");
          return;
        }

        const batch = db.batch();
        const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

        // Percorre todas as lojas inadimplentes
        for (const doc of snapshot.docs) {
          const storeData = doc.data();
          const asaasSubscriptionId = storeData.asaasSubscriptionId;
          const storeId = doc.id;

          // 1. Aplica o bloqueio no banco de dados
          batch.update(doc.ref, {
            subscriptionStatus: "inactive"
          });

          // 2. A Guilhotina: Cancela a assinatura no Asaas para evitar a bola de neve
          if (asaasSubscriptionId) {
            try {
              await axios.delete(`${ASAAS_URL}/subscriptions/${asaasSubscriptionId}`, {
                              headers: {
                                "access_token": ASAAS_API_KEY,
                                "User-Agent": "StoreConnectApp/1.0"
                              }
                            });
              console.log(`✂️ Guilhotina aplicada: Assinatura ${asaasSubscriptionId} da loja ${storeId} CANCELADA.`);
            } catch (error) {
              console.error(`⚠️ Erro ao cancelar assinatura no Asaas (Loja ${storeId}):`, error.response?.data || error.message);
            }
          }
        }

        // Executa a atualização de todas as lojas no banco de uma vez só (alta performance)
        await batch.commit();
        console.log(`🔒 Processamento concluído. ${snapshot.size} lojas foram bloqueadas.`);

      } catch (error) {
        console.error("❌ Erro durante a execução do Cron Job:", error);
      }
    }
  );

/**
 * 🗑️ LIMPEZA: Quando um produto é deletado
 */
exports.onProductDelete = onDocumentDeleted("stores/{storeId}/products/{productId}", async (event) => {
  console.log(`\n🗑️ Produto deletado: ${event.params.productId} da loja ${event.params.storeId}`);
});



// -----------------------------------------------------------------------
// 💰 MÓDULO FINANCEIRO (ASAAS)
// -----------------------------------------------------------------------
const webhook = require("./financeiro/asaasWebhook");
exports.asaasWebhook = webhook.asaasWebhook;

const faturas = require("./financeiro/faturas");
exports.listAsaasInvoices = faturas.listAsaasInvoices;
exports.getAsaasPortalUrl = faturas.getAsaasPortalUrl;



// -----------------------------------------------------------------------
// 👥 MÓDULO DE USUÁRIOS E PERMISSÕES
// -----------------------------------------------------------------------
const { convidarFuncionario } = require("./usuarios/convidarFuncionario");
exports.convidarFuncionario = convidarFuncionario;

/**
 * 🔄 ALTERAR PLANO DA ASSINATURA
 *
 * PRO -> BUSINESS
 * BUSINESS -> PRO
 *
 * IMPORTANTE:
 * Não cria uma nova assinatura.
 * Atualiza a assinatura existente no Asaas.
 */
exports.changeAsaasPlan = onCall(
  { timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Usuário não logado."
      );
    }

    const db = admin.firestore();

    const storeId = request.data.storeId;
    const newPlan = request.data.plan;

    // ------------------------------------------------------------
    // 1. VALIDAÇÃO
    // ------------------------------------------------------------

    if (!storeId) {
      throw new HttpsError(
        "invalid-argument",
        "Store ID não informado."
      );
    }

    if (
      !newPlan ||
      !SUBSCRIPTION_PLANS[newPlan]
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Plano inválido."
      );
    }

    const storeRef = db
      .collection("stores")
      .doc(storeId);

    const storeDoc =
      await storeRef.get();

    if (!storeDoc.exists) {
      throw new HttpsError(
        "not-found",
        "Loja não encontrada."
      );
    }

    const storeData =
      storeDoc.data();

    // ------------------------------------------------------------
    // 2. SEGURANÇA:
    // Somente dono/admin da própria loja
    // ------------------------------------------------------------

    const userId =
      request.auth.uid;

    const ownerId =
      storeData.ownerId;

    const authorizedUsers =
      storeData.authorizedUsers || [];

    if (
      ownerId !== userId &&
      !authorizedUsers.includes(userId)
    ) {
      throw new HttpsError(
        "permission-denied",
        "Você não tem permissão para alterar este plano."
      );
    }

    // ------------------------------------------------------------
    // 3. VERIFICA ASSINATURA ATUAL
    // ------------------------------------------------------------

    const subscriptionId =
      storeData.asaasSubscriptionId;

    if (!subscriptionId) {
      throw new HttpsError(
        "failed-precondition",
        "A loja ainda não possui uma assinatura ativa no Asaas."
      );
    }

    const currentPlan =
      storeData.subscriptionType || "pro";

    // ============================================================
    // REGRA ESPECIAL:
    // BUSINESS -> PRO NÃO ACONTECE IMEDIATAMENTE
    //
    // O cliente solicita o downgrade,
    // mas continua Business até pagar a próxima mensalidade de R$ 99.90.
    // ============================================================

    if (
      currentPlan === "business" &&
      newPlan === "pro"
    ) {
      // Se já existe pedido de downgrade, não duplica.
      if (storeData.pendingPlanChange === "pro") {
        return {
          success: true,
          downgradePending: true,
          currentPlan: "business",
          requestedPlan: "pro",
          subscriptionId,
          message:
            "Seu downgrade para o Plano Pro já está agendado. Ele será aplicado após o próximo pagamento do Plano Business.",
        };
      }

      await storeRef.update({
        pendingPlanChange: "pro",
        pendingPlanChangeRequestedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(
        `📌 Downgrade BUSINESS -> PRO agendado para a loja ${storeId}`
      );

      return {
        success: true,
        downgradePending: true,
        currentPlan: "business",
        requestedPlan: "pro",
        subscriptionId,
        message:
          "Downgrade agendado. Você continuará no Plano Business até o próximo pagamento de R$ 99.90. Depois disso, sua assinatura passará para o Plano Pro.",
      };
    }

    // Já está no plano solicitado
    if (currentPlan === newPlan) {
      return {
        success: true,
        alreadyOnPlan: true,
        plan: currentPlan,
        subscriptionId,
        message:
          `A loja já está no plano ${currentPlan}.`,
      };
    }

    const selectedPlan =
      SUBSCRIPTION_PLANS[newPlan];

    const ASAAS_API_KEY =
      process.env.ASAAS_API_KEY;

    const headers = {
      access_token: ASAAS_API_KEY,
      "Content-Type": "application/json",
      "User-Agent":
        "StoreConnectApp/1.0",
    };

    try {
      console.log(
        `🔄 Alterando plano da loja ${storeId}`
      );

      console.log(
        `📦 ${currentPlan} -> ${newPlan}`
      );

      console.log(
        `💰 Novo valor: R$ ${selectedPlan.price}`
      );

      console.log(
        `🔗 Assinatura: ${subscriptionId}`
      );

      // ----------------------------------------------------------
      // 4. CONFIRMA QUE A ASSINATURA EXISTE NO ASAAS
      // ----------------------------------------------------------

      const currentSubscription =
        await axios.get(
          `${ASAAS_URL}/subscriptions/${subscriptionId}`,
          { headers }
        );

      if (
        !currentSubscription.data ||
        currentSubscription.data.deleted === true
      ) {
        throw new HttpsError(
          "failed-precondition",
          "A assinatura atual não está mais disponível no Asaas."
        );
      }

      // ----------------------------------------------------------
      // 5. ALTERA A MESMA ASSINATURA
      //
      // NÃO usamos updatePendingPayments.
      //
      // Portanto:
      // cobrança já criada continua como está;
      // próximas cobranças usam o novo valor.
      // ----------------------------------------------------------

      const updateResponse =
        await axios.put(
          `${ASAAS_URL}/subscriptions/${subscriptionId}`,
          {
            value:
              selectedPlan.price,

            description:
              `Assinatura ${selectedPlan.name}`,

            externalReference:
              storeId,
          },
          { headers }
        );

      console.log(
        `✅ Assinatura atualizada no Asaas: ${subscriptionId}`
      );

      // ----------------------------------------------------------
      // 6. SOMENTE DEPOIS DO SUCESSO NO ASAAS
      // ATUALIZA O FIRESTORE
      // ----------------------------------------------------------

      await storeRef.update({
        subscriptionType:
          newPlan,

        subscriptionPlanPrice:
          selectedPlan.price,

        subscriptionPlanChangedAt:
          admin.firestore.FieldValue
            .serverTimestamp(),
      });

      console.log(
        `✅ Firestore atualizado para plano ${newPlan}`
      );

      return {
        success: true,

        oldPlan:
          currentPlan,

        newPlan:
          newPlan,

        subscriptionId:
          subscriptionId,

        price:
          selectedPlan.price,

        nextDueDate:
          updateResponse.data?.nextDueDate ||
          currentSubscription.data?.nextDueDate ||
          null,

        message:
          `Plano alterado para ${selectedPlan.name} com sucesso.`,
      };

    } catch (error) {
      console.error(
        "❌ Erro ao alterar plano:",
        error.response?.data ||
        error.message ||
        error
      );

      if (
        error instanceof HttpsError
      ) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        `Não foi possível alterar o plano: ${
          error.response?.data?.errors?.[0]
            ?.description ||
          error.message
        }`
      );
    }
  }
);