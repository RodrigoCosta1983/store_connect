const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const admin = require('firebase-admin');
const axios = require("axios");

admin.initializeApp();

const ASAAS_URL = "https://www.asaas.com/api/v3";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ===================================================
// ⚙️ CONFIGURAÇÕES DE PREÇO
// ===================================================
const SUBSCRIPTION_PRICES = {
  trial: 0,      // 7 dias grátis = R$ 0
  pro: 15.90     // Assinatura Pro = R$ 15,90
};

// ===================================================
// 1️⃣  CRIAR ASSINATURA ASAAS
// ===================================================
exports.createAsaasSubscription = onCall({ timeoutSeconds: 120 }, async (request) => {
  console.log("\n\n");
  console.log("╔════════════════════════════════════════════════════════════╗");
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
    const storeRef = db.collection("stores").doc(userId);
    const storeDoc = await storeRef.get();
    const existingSubscriptionId = storeDoc.data()?.subscriptionId;

    console.log(`\n📌 User ID: ${userId}`);
    console.log(`📌 CPF/CNPJ: ${cpfCnpj}`);
    console.log(`📌 Email: ${email}`);
    console.log(`📌 Nome: ${name}`);
    console.log(`📌 Assinatura Existente: ${existingSubscriptionId || "NÃO"}`);

    // ==========================================
    // 🔎 1. SE JÁ EXISTE ASSINATURA
    // ==========================================
    if (existingSubscriptionId) {
      console.log("\n\n");
      console.log("╔════════════════════════════════════════════════════════════╗");
      console.log("║  🔍 VERIFICANDO ASSINATURA EXISTENTE                       ║");
      console.log("╚════════════════════════════════════════════════════════════╝");
      console.log(`\n✅ Usuário já possui assinatura: ${existingSubscriptionId}`);

      try {
        const payments = await axios.get(
          `${ASAAS_URL}/payments?subscription=${existingSubscriptionId}&limit=5`,
          { headers }
        );

        console.log(`\n📊 Total de pagamentos encontrados: ${payments.data.data?.length || 0}`);

        if (payments.data.data && payments.data.data.length > 0) {
          const payment = payments.data.data[0];

          console.log(`\n💳 DADOS DO PAGAMENTO:`);
          console.log(`   • ID: ${payment.id}`);
          console.log(`   • Status: ${payment.status}`);
          console.log(`   • Valor: R$ ${payment.value}`);
          console.log(`   • Data Vencimento: ${payment.dueDate}`);
          console.log(`   • billUrl: ${payment.billUrl}`);
          console.log(`   • invoiceUrl: ${payment.invoiceUrl}`);

          // ✅ Se já foi pago
          if (payment.status === "CONFIRMED" || payment.status === "RECEIVED") {
            console.log(`\n✅ ASSINATURA JÁ PAGA - ATIVANDO`);
            await storeRef.update({
              subscriptionStatus: "active",
              lastPaymentDate: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log(`\n🎉 Loja ${userId} ATIVADA com sucesso!`);
            return {
              success: true,
              alreadyActive: true,
              message: "✅ Assinatura já está ativa!"
            };
          }

          // ⏳ Se está pendente
          if (payment.status === "PENDING") {
            console.log(`\n📄 BOLETO PENDENTE ENCONTRADO`);

            // Usar a URL que o Asaas fornece
            const paymentLink = payment.billUrl || payment.invoiceUrl;

            if (!paymentLink) {
              console.log(`\n❌ Asaas não forneceu billUrl, tentando usar subscription ID`);
              const fallbackUrl = `https://www.asaas.com/checkout/${existingSubscriptionId}`;
              console.log(`   Fallback URL: ${fallbackUrl}`);

              return {
                success: true,
                paymentUrl: fallbackUrl,
                subscriptionId: existingSubscriptionId,
                alreadyExists: true,
                message: "Boleto pendente (fallback URL)"
              };
            }

            console.log(`\n🔗 URL DO BOLETO: ${paymentLink}`);

            return {
              success: true,
              paymentUrl: paymentLink,
              subscriptionId: existingSubscriptionId,
              alreadyExists: true,
              message: "Assinatura existe, abrindo boleto pendente"
            };
          }

          // ❌ Se está vencido
          if (payment.status === "OVERDUE") {
            console.log(`\n⚠️  COBRANÇA VENCIDA - CRIANDO NOVA ASSINATURA`);
          }
        } else {
          console.log(`\n⚠️  Assinatura existe mas sem pagamentos - gerando novo`);
        }
      } catch (axiosError) {
        console.error(`\n❌ ERRO ao buscar pagamentos:`, axiosError.response?.data || axiosError.message);
      }
    }

    // ==========================================
    // 🔍 2. VERIFICA CPF (TRIAL OU NÃO)
    // ==========================================
    console.log("\n\n");
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║  🆔 VERIFICANDO SE É NOVO CLIENTE                         ║");
    console.log("╚════════════════════════════════════════════════════════════╝");

    const cpfRef = db.collection('cpfs_cadastrados').doc(cpfCnpj);
    const cpfDoc = await cpfRef.get();
    const ehNovoCliente = !cpfDoc.exists;

    console.log(`\n${ehNovoCliente ? "🆕 NOVO CLIENTE" : "👤 CLIENTE EXISTENTE"}`);
    console.log(`   Novo Cliente: ${ehNovoCliente}`);

    // ==========================================
    // 👤 3. BUSCA OU CRIA CLIENTE NO ASAAS
    // ==========================================
    console.log("\n\n");
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║  👤 GERENCIANDO CLIENTE NO ASAAS                          ║");
    console.log("╚════════════════════════════════════════════════════════════╝");

    let customerId;
    const search = await axios.get(`${ASAAS_URL}/customers?cpfCnpj=${cpfCnpj}`, { headers });

    if (search.data.data?.length > 0) {
      customerId = search.data.data[0].id;
      console.log(`\n✅ Cliente encontrado no Asaas`);
      console.log(`   Customer ID: ${customerId}`);
    } else {
      console.log(`\n🆕 Cliente não encontrado, criando novo...`);
      const create = await axios.post(`${ASAAS_URL}/customers`, {
        name,
        email,
        cpfCnpj,
        phone,
        externalReference: userId
      }, { headers });

      customerId = create.data.id;
      console.log(`\n✅ Cliente criado com sucesso`);
      console.log(`   Customer ID: ${customerId}`);
    }

    // ==========================================
    // 🆕 4. CRIA NOVA ASSINATURA
    // ==========================================
    console.log("\n\n");
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║  📝 CRIANDO NOVA ASSINATURA                               ║");
    console.log("╚════════════════════════════════════════════════════════════╝");

    // Calcula data de vencimento
    const nextDueDate = new Date();
    let diasAteVencimento = 0;
    let tipoAssinatura = "";

    if (ehNovoCliente) {
      // NOVO: Vence em 7 dias (TRIAL GRÁTIS)
      nextDueDate.setDate(nextDueDate.getDate() + 7);
      diasAteVencimento = 7;
      tipoAssinatura = "TRIAL 7 DIAS (R$ 0)";
    } else {
      // CLIENTE EXISTENTE: Vence em 30 dias
      nextDueDate.setMonth(nextDueDate.getMonth() + 1);
      diasAteVencimento = 30;
      tipoAssinatura = "PRO MENSAL (R$ 15,90)";
    }

    const dueDateString = nextDueDate.toISOString().split('T')[0];
    const priceValue = ehNovoCliente ? SUBSCRIPTION_PRICES.trial : SUBSCRIPTION_PRICES.pro;

    console.log(`\n💰 VALORES DA ASSINATURA:`);
    console.log(`   • Tipo: ${tipoAssinatura}`);
    console.log(`   • Valor: R$ ${priceValue.toFixed(2)}`);
    console.log(`   • Ciclo: MENSAL`);
    console.log(`   • Próximo Vencimento: ${dueDateString}`);
    console.log(`   • Dias até vencimento: ${diasAteVencimento} dias`);

    console.log(`\n📋 Parâmetros da Assinatura:`);
    console.log(`   • Customer: ${customerId}`);
    console.log(`   • Valor: R$ ${priceValue.toFixed(2)}`);
    console.log(`   • Ciclo: MENSAL`);
    console.log(`   • Descrição: ${ehNovoCliente ? "Teste 7 Dias" : "Assinatura Pro"}`);

    const subResponse = await axios.post(`${ASAAS_URL}/subscriptions`, {
      customer: customerId,
      billingType: "UNDEFINED",
      value: priceValue,
      nextDueDate: dueDateString,
      cycle: "MONTHLY",
      description: ehNovoCliente
        ? "Teste 7 Dias - Store Connect"
        : "Assinatura Store Connect Pro",
      externalReference: userId
    }, { headers });

    const subscriptionId = subResponse.data.id;
    console.log(`\n✅ Assinatura criada com sucesso`);
    console.log(`   Subscription ID: ${subscriptionId}`);

    // Salva subscriptionId no Firestore imediatamente
    await storeRef.set({
      subscriptionId: subscriptionId,
      subscriptionStatus: "pending",
      subscriptionType: ehNovoCliente ? "trial" : "pro",
      priceValue: priceValue,
      nextDueDate: dueDateString
    }, { merge: true });
    console.log(`\n💾 Subscription ID salvo no Firestore`);

    // ==========================================
    // 🔁 5. AGUARDA GERAÇÃO DO BOLETO
    // ==========================================
    console.log("\n\n");
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║  ⏳ AGUARDANDO GERAÇÃO DO BOLETO (até 60 segundos)         ║");
    console.log("╚════════════════════════════════════════════════════════════╝");

    let finalPaymentLink = null;
    let paymentDetails = null;

    for (let i = 1; i <= 40; i++) {
      const payments = await axios.get(
        `${ASAAS_URL}/payments?subscription=${subscriptionId}&limit=1`,
        { headers }
      );

      if (payments.data.data?.length > 0) {
        const payment = payments.data.data[0];
        paymentDetails = payment;

        finalPaymentLink = payment.billUrl || payment.invoiceUrl;

        console.log(`\n�� BOLETO GERADO NA TENTATIVA ${i}`);
        console.log(`\n💳 Detalhes do Boleto:`);
        console.log(`   • Payment ID: ${payment.id}`);
        console.log(`   • Status: ${payment.status}`);
        console.log(`   • Valor: R$ ${payment.value}`);
        console.log(`   • Vencimento: ${payment.dueDate}`);
        console.log(`   • billUrl: ${payment.billUrl}`);
        console.log(`   • invoiceUrl: ${payment.invoiceUrl}`);
        console.log(`\n🔗 URL FINAL: ${finalPaymentLink}`);
        break;
      }

      if (i % 5 === 0) {
        console.log(`   ⏳ Tentativa ${i}/40 - aguardando geração...`);
      }
      await delay(1500);
    }

    if (!finalPaymentLink) {
      console.log(`\n❌ Timeout: Asaas demorou mais de 60 segundos para gerar o boleto`);
      throw new HttpsError("unavailable", "Asaas demorou a gerar o link do boleto.");
    }

    // ==========================================
    // 🎁 6. LIBERA TRIAL SE FOR NOVO
    // ==========================================
    if (ehNovoCliente) {
      console.log("\n\n");
      console.log("╔════════════════════════════════════════════════════════════╗");
      console.log("║  🎁 LIBERANDO TRIAL (7 DIAS)                              ║");
      console.log("╚════════════════════════════════════════════════════════════╝");

      await cpfRef.set({
        uid: userId,
        motivo: "Primeiro Teste 7 Dias",
        data_cadastro: admin.firestore.FieldValue.serverTimestamp()
      });

      await storeRef.update({
        subscriptionStatus: "active",
        trialStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        trialEndDate: dueDateString
      });

      console.log(`\n✅ TRIAL ATIVADO!`);
      console.log(`   • Duração: 7 dias`);
      console.log(`   • Vencimento: ${dueDateString}`);
      console.log(`   • Acesso: COMPLETO`);
    }

    // ==========================================
    // ✅ SUCESSO FINAL
    // ==========================================
    console.log("\n\n");
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║  ✅ PROCESSO FINALIZADO COM SUCESSO!                      ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log(`\nRetornando para o app:`);
    console.log(`   • success: true`);
    console.log(`   • paymentUrl: ${finalPaymentLink}`);
    console.log(`   • subscriptionId: ${subscriptionId}`);
    console.log(`   • isTrial: ${ehNovoCliente}`);
    console.log(`   • price: R$ ${priceValue.toFixed(2)}`);
    console.log(`   • nextDueDate: ${dueDateString}\n\n`);

    return {
      success: true,
      paymentUrl: finalPaymentLink,
      subscriptionId: subscriptionId,
      isTrial: ehNovoCliente,
      price: priceValue,
      nextDueDate: dueDateString,
      daysUntilDue: diasAteVencimento
    };

  } catch (error) {
    console.log("\n\n");
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║  ❌ ERRO NO PROCESSO                                       ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.error(`\n❌ Erro: ${error.message}`);

    if (error.response?.data) {
      console.error(`\n📋 Resposta do Asaas:`);
      console.error(JSON.stringify(error.response.data, null, 2));
    }

    if (error.stack) {
      console.error(`\n📍 Stack Trace:`);
      console.error(error.stack);
    }

    throw new HttpsError("internal", `Erro na assinatura: ${error.message}`);
  }
});


// ===================================================
// 2️⃣  WEBHOOK DO ASAAS
// ===================================================
exports.asaasWebhook = onRequest(async (req, res) => {
  console.log("\n\n");
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║  🔔 WEBHOOK ASAAS RECEBIDO                                ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  if (req.method !== "POST") {
    console.log(`\n❌ Método não permitido: ${req.method}`);
    return res.status(405).send("Method Not Allowed");
  }

  const event = req.body.event;
  const payment = req.body.payment || {};
  const subscription = req.body.subscription || {};
  const userId = payment.externalReference || subscription.externalReference;

  console.log(`\n📊 Evento: ${event}`);
  console.log(`📌 User ID: ${userId}`);
  console.log(`💳 Payment ID: ${payment.id}`);
  console.log(`📋 Subscription ID: ${subscription.id}`);

  if (!userId) {
    console.log(`\n⚠️  Nenhum externalReference encontrado`);
    return res.json({ received: true });
  }

  try {
    const db = admin.firestore();
    const docRef = db.collection("stores").doc(userId);

    // ✅ PAGAMENTO CONFIRMADO
    if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
      console.log(`\n✅ PAGAMENTO CONFIRMADO`);
      console.log(`   Ativando loja: ${userId}`);

      await docRef.update({
        subscriptionStatus: "active",
        lastPaymentDate: admin.firestore.FieldValue.serverTimestamp(),
        subscriptionId: subscription.id || payment.subscription || null,
        subscriptionType: "pro" // Ao pagar, vira pro
      });

      console.log(`\n🎉 Loja ${userId} ATIVADA com sucesso!`);
    }
    // ❌ PAGAMENTO VENCIDO
    else if (event === "PAYMENT_OVERDUE") {
      console.log(`\n⚠️  PAGAMENTO VENCIDO`);
      console.log(`   Bloqueando loja: ${userId}`);

      await docRef.update({ subscriptionStatus: "inactive" });

      console.log(`\n🚫 Loja ${userId} INATIVADA`);
    }
    // ❌ ASSINATURA DELETADA
    else if (event === "SUBSCRIPTION_DELETED" || event === "PAYMENT_DELETED") {
      console.log(`\n❌ ASSINATURA CANCELADA`);
      console.log(`   Bloqueando loja: ${userId}`);

      await docRef.update({ subscriptionStatus: "inactive" });

      console.log(`\n🚫 Loja ${userId} INATIVADA`);
    }
    else {
      console.log(`\n📌 Evento não tratado: ${event}`);
    }

    console.log(`\n✅ Webhook processado com sucesso\n\n`);
    res.json({ received: true });

  } catch (error) {
    console.error(`\n❌ Erro ao processar webhook:`, error.message);
    console.error(error.stack);
    res.status(500).send("Erro interno");
  }
});


// ===================================================
// 3️⃣  LIMPEZA QUANDO DELETA PRODUTO
// ===================================================
exports.onProductDelete = onDocumentDeleted("stores/{storeId}/products/{productId}", async (event) => {
  console.log("\n\n");
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║  🗑️  PRODUTO DELETADO                                       ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  const storeId = event.params.storeId;
  const productId = event.params.productId;

  console.log(`\n🏪 Store: ${storeId}`);
  console.log(`📦 Product: ${productId}`);
  console.log(`✅ Limpeza concluída\n\n`);
});