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

admin.initializeApp();

const ASAAS_ENV = process.env.ASAAS_ENV || "sandbox";
const ASAAS_URL = ASAAS_ENV === "production"
  ? "https://www.asaas.com/api/v3"
  : "https://sandbox.asaas.com/api/v3";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const SUBSCRIPTION_PRICES = {
  pro: 15.90
};

/**
 * 🔵 FUNÇÃO PRINCIPAL: Cria ou retorna assinatura no Asaas
 *
 * Fluxo:
 * 1. Novo cliente → ativa TRIAL de 7 dias (sem Asaas)
 * 2. Cliente existente → cria assinatura PAGA no Asaas
 * 3. Assinatura pendente → retorna link do boleto
 *
 * Status possíveis:
 * - "trial" → teste gratuito ativo
 * - "pending" → boleto gerado, aguardando pagamento
 * - "active" → pagamento confirmado
 * - "inactive" → assinatura cancelada/expirada
 */
exports.createAsaasSubscription = onCall({ timeoutSeconds: 120 }, async (request) => {
  console.log("\n\n╔════════════════════════════════════════════════════════════╗");
  console.log("║  🟢 INICIANDO PROCESSO DE ASSINATURA                       ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Usuário não logado.");
  }

  const { cpfCnpj, name, phone, email } = request.data;
  const userId = request.auth.uid;
  const headers = {
    "access_token": ASAAS_API_KEY,
    "Content-Type": "application/json"
  };
  const db = admin.firestore();

  try {
    // ✅ PASSO 1: Valida se usuário tem loja
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists || !userDoc.data().storeId) {
      throw new HttpsError("not-found", "Nenhuma loja vinculada a este usuário.");
    }
    const storeId = userDoc.data().storeId;

    // ✅ PASSO 2: Busca dados da loja (se houver assinatura anterior)
    const storeRef = db.collection("stores").doc(storeId);
    const storeDoc = await storeRef.get();
    const existingSubscriptionId = storeDoc.data()?.asaasSubscriptionId;

    console.log(`\n📌 User ID: ${userId}`);
    console.log(`📌 Store ID: ${storeId}`);
    console.log(`📌 CPF/CNPJ: ${cpfCnpj}`);
    console.log(`📌 Assinatura Existente: ${existingSubscriptionId || "NÃO"}`);

    // ✅ PASSO 3: Se há assinatura anterior, verifica status do pagamento
    if (existingSubscriptionId) {
      console.log("\n🔍 VERIFICANDO ASSINATURA EXISTENTE");

      try {
        const payments = await axios.get(
          `${ASAAS_URL}/payments?subscription=${existingSubscriptionId}&limit=5`,
          { headers }
        );

        if (payments.data.data && payments.data.data.length > 0) {
          const payment = payments.data.data[0];

          // ✅ Pagamento já foi confirmado
          if (payment.status === "CONFIRMED" || payment.status === "RECEIVED") {
            await storeRef.update({
              subscriptionStatus: "active",
              lastPaymentDate: admin.firestore.FieldValue.serverTimestamp()
            });

            return {
              success: true,
              alreadyActive: true,
              message: "✅ Assinatura já está ativa!"
            };
          }

          // ✅ Boleto ainda está pendente - retorna link
          if (payment.status === "PENDING") {
            const paymentLink = payment.billUrl || payment.invoiceUrl;

            if (!paymentLink) {
              const fallbackUrl = `https://www.asaas.com/checkout/${existingSubscriptionId}`;
              return {
                success: true,
                paymentUrl: fallbackUrl,
                subscriptionId: existingSubscriptionId,
                alreadyExists: true
              };
            }
            return {
              success: true,
              paymentUrl: paymentLink,
              subscriptionId: existingSubscriptionId,
              alreadyExists: true
            };
          }
        }
      } catch (axiosError) {
        console.error(`❌ ERRO ao buscar pagamentos:`, axiosError.response?.data || axiosError.message);
      }
    }

    // ✅ PASSO 4: Verifica se é novo cliente (para liberar trial)
    const cpfRef = db.collection('cpfs_cadastrados').doc(cpfCnpj);
    const cpfDoc = await cpfRef.get();
    const ehNovoCliente = !cpfDoc.exists;

    console.log(`\n📊 CPF Existe? ${cpfDoc.exists}`);
    console.log(`📊 É novo cliente? ${ehNovoCliente}`);

    // 🎁 PASSO 5: NOVO CLIENTE - Libera TRIAL de 7 dias (SEM ASAAS)
    if (ehNovoCliente) {
      const dataHoje = new Date();
      const dataVencimento = new Date();
      dataVencimento.setDate(dataHoje.getDate() + 7);
      const trialEndDateStr = dataVencimento.toISOString().split('T')[0];

      // ✅ Marca o CPF como cadastrado
      await cpfRef.set({
        uid: userId,
        motivo: "Primeiro Teste 7 Dias",
        data_cadastro: admin.firestore.FieldValue.serverTimestamp()
      });

      // ✅ ATUALIZA A LOJA com trial ativo
      await storeRef.update({
        subscriptionStatus: "active",  // ← IMPORTANTE: "active" permite acesso
        subscriptionType: "trial",
        trialEndDate: trialEndDateStr,
        trialStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`✅ TRIAL DE 7 DIAS ATIVADO para loja ${storeId}`);
      console.log(`   Vencimento: ${trialEndDateStr}`);

      return {
        success: true,
        isTrial: true,
        trialEndDate: trialEndDateStr,
        message: "🎉 Aproveite seus 7 dias de teste!"
      };
    }

    // 💳 PASSO 6: CLIENTE EXISTENTE - Cria assinatura PAGA
    console.log("\n💳 CLIENTE EXISTENTE - CRIANDO ASSINATURA PAGA");

    let customerId;
    const search = await axios.get(`${ASAAS_URL}/customers?cpfCnpj=${cpfCnpj}`, { headers });

    if (search.data.data?.length > 0) {
      customerId = search.data.data[0].id;
      console.log(`✅ Cliente encontrado: ${customerId}`);
    } else {
      const create = await axios.post(`${ASAAS_URL}/customers`, {
        name,
        email,
        cpfCnpj,
        phone,
        externalReference: storeId
      }, { headers });
      customerId = create.data.id;
      console.log(`✅ Novo cliente criado: ${customerId}`);
    }

    // ✅ Calcula data de vencimento (próximo mês)
    const nextDueDate = new Date();
    nextDueDate.setMonth(nextDueDate.getMonth() + 1);
    const dueDateString = nextDueDate.toISOString().split('T')[0];

    // ✅ Cria assinatura no Asaas
    const subResponse = await axios.post(`${ASAAS_URL}/subscriptions`, {
      customer: customerId,
      billingType: "UNDEFINED",
      value: SUBSCRIPTION_PRICES.pro,
      nextDueDate: dueDateString,
      cycle: "MONTHLY",
      description: "Assinatura Store Connect Pro",
      externalReference: storeId
    }, { headers });

    const subscriptionId = subResponse.data.id;

    // ✅ ATUALIZA A LOJA com status "pending"
    await storeRef.set({
      asaasSubscriptionId: subscriptionId,
      asaasCustomerId: customerId,
      subscriptionStatus: "pending",  // ← Boleto gerado, aguardando
      subscriptionType: "pro",
      nextDueDate: dueDateString
    }, { merge: true });

    console.log(`✅ Assinatura criada: ${subscriptionId}`);

    // ✅ PASSO 7: Busca o link do boleto (com retry)
    let finalPaymentLink = null;
    for (let i = 1; i <= 40; i++) {
      const payments = await axios.get(`${ASAAS_URL}/payments?subscription=${subscriptionId}&limit=1`, { headers });
      if (payments.data.data?.length > 0) {
        finalPaymentLink = payments.data.data[0].billUrl || payments.data.data[0].invoiceUrl;
        console.log(`✅ Boleto encontrado na tentativa ${i}`);
        break;
      }
      await delay(1500);
    }

    if (!finalPaymentLink) {
      throw new HttpsError("unavailable", "Asaas demorou a gerar o link do boleto.");
    }

    console.log(`✅ Boleto gerado com sucesso`);

    return {
      success: true,
      paymentUrl: finalPaymentLink,
      subscriptionId: subscriptionId,
      isTrial: false,
      price: SUBSCRIPTION_PRICES.pro,
      nextDueDate: dueDateString,
      message: "📄 Boleto gerado com sucesso!"
    };

  } catch (error) {
    console.error(`\n❌ Erro: ${error.message}`);
    throw new HttpsError("internal", `Erro na assinatura: ${error.message}`);
  }
});

/**
 * 🔔 WEBHOOK DO ASAAS
 *
 * Recebe notificações de mudanças de pagamento:
 * - PAYMENT_CONFIRMED → ativa assinatura
 * - PAYMENT_RECEIVED → ativa assinatura
 * - PAYMENT_OVERDUE → desativa assinatura
 * - SUBSCRIPTION_DELETED → desativa assinatura
 */

 /**
  * 🔔 WEBHOOK DO ASAAS
  */
 exports.asaasWebhook = onRequest(async (req, res) => {
   console.log("\n\n╔════════════════════════════════════════════════════════════╗");
   console.log("║  🔔 WEBHOOK ASAAS RECEBIDO                                ║");
   console.log("╚════════════════════════════════════════════════════════════╝");

   if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

   try {
     // 🛡️ Prevenção caso o Asaas mande o body como String crua
     const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

     const event = body.event;
     const payment = body.payment || {};

     const asaasSubscriptionId = payment.subscription;
     let targetId = payment.externalReference;

     console.log(`📌 Evento: ${event}`);
     console.log(`📌 ID Assinatura: ${asaasSubscriptionId}`);
     console.log(`📌 External Reference: ${targetId}`);

     const db = admin.firestore();
     let storeIdParaAtualizar = null;

     // 🔍 1ª Tentativa: Busca pelo ID da assinatura
     if (asaasSubscriptionId) {
         const snapshot = await db.collection("stores").where("asaasSubscriptionId", "==", asaasSubscriptionId).get();
         if (!snapshot.empty) {
             storeIdParaAtualizar = snapshot.docs[0].id;
             console.log(`✅ Loja encontrada pela Assinatura: ${storeIdParaAtualizar}`);
         }
     }

     // 🔍 2ª Tentativa: Busca pela referência externa
     if (!storeIdParaAtualizar && targetId) {
         const userDoc = await db.collection("users").doc(targetId).get();
         if (userDoc.exists && userDoc.data().storeId) {
             storeIdParaAtualizar = userDoc.data().storeId;
             console.log(`✅ Convertido de UID para StoreID: ${storeIdParaAtualizar}`);
         } else {
             storeIdParaAtualizar = targetId;
             console.log(`✅ Usando targetId direto como StoreID: ${storeIdParaAtualizar}`);
         }
     }

     if (!storeIdParaAtualizar) {
         console.log(`⚠️ Nenhuma loja encontrada! Ignorando.`);
         return res.json({ received: true, status: "ignored_no_store" });
     }

     const storeRef = db.collection("stores").doc(storeIdParaAtualizar);
     const storeSnap = await storeRef.get();

     if (!storeSnap.exists) {
         console.log(`⚠️ O documento da loja ${storeIdParaAtualizar} não existe no Firestore.`);
         return res.json({ received: true, status: "ignored_not_found" });
     }

     // 🔄 ATUALIZA O STATUS
     if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
         await storeRef.update({
             subscriptionStatus: "active",
             lastPaymentDate: admin.firestore.FieldValue.serverTimestamp(),
             subscriptionType: "pro"
         });
         console.log(`🎉 Sucesso! Loja ${storeIdParaAtualizar} ATIVADA.`);
     }
     else if (event === "PAYMENT_OVERDUE" || event === "SUBSCRIPTION_DELETED" || event === "PAYMENT_DELETED") {
         await storeRef.update({ subscriptionStatus: "inactive" });
         console.log(`🚫 Sucesso! Loja ${storeIdParaAtualizar} INATIVADA.`);
     } else {
         console.log(`ℹ️ Evento ${event} ignorado pois não afeta o status.`);
     }

     res.json({ received: true, updatedStore: storeIdParaAtualizar });

   } catch (error) {
     console.error(`❌ Erro crítico no webhook:`, error);
     res.status(500).send("Erro interno");
   }
 });

/**
 * 🗑️ LIMPEZA: Quando um produto é deletado
 */
exports.onProductDelete = onDocumentDeleted("stores/{storeId}/products/{productId}", async (event) => {
  console.log(`\n🗑️ Produto deletado: ${event.params.productId} da loja ${event.params.storeId}`);
});



/**
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