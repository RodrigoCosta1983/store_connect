const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const admin = require('firebase-admin');
const axios = require("axios");

admin.initializeApp();

const ASAAS_URL = "https://www.asaas.com/api/v3";
// Se for teste use: "https://sandbox.asaas.com/api/v3"

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- 1. FUNÇÃO DE CRIAR ASSINATURA (Versão Paciente & Robusta) ---
// Aumentamos o timeout para 120 segundos para não cair no meio do loop
exports.createAsaasSubscription = onCall({ timeoutSeconds: 120 }, async (request) => {
  console.log(">>> INICIANDO ASSINATURA ROBUSTA <<<");

  const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

  if (!request.auth) throw new HttpsError("unauthenticated", "Usuário não logado.");

  const { cpfCnpj, name, phone, email } = request.data;
  const userId = request.auth.uid;
  const headers = { "access_token": ASAAS_API_KEY, "Content-Type": "application/json" };

  try {
    // A. Busca ou Cria Cliente
    let customerId;
    const search = await axios.get(`${ASAAS_URL}/customers?cpfCnpj=${cpfCnpj}`, { headers });
    if (search.data.data?.length > 0) {
      customerId = search.data.data[0].id;
    } else {
      const create = await axios.post(`${ASAAS_URL}/customers`, {
        name, email, cpfCnpj, phone, externalReference: userId
      }, { headers });
      customerId = create.data.id;
    }

    // B. Cria Assinatura
    // nextDueDate: HOJE -> Força a criação da cobrança
    // billingType: UNDEFINED -> Deixa o cliente escolher (Cartão/Pix) na tela do Asaas
    const subResponse = await axios.post(`${ASAAS_URL}/subscriptions`, {
      customer: customerId,
      billingType: "UNDEFINED",
      value: 29.90,
      nextDueDate: new Date().toISOString().split('T')[0],
      cycle: "MONTHLY",
      description: "Assinatura Store Connect Pro",
      externalReference: userId
    }, { headers });

    const subscriptionId = subResponse.data.id;
    console.log(`Assinatura criada: ${subscriptionId}. Aguardando geração da cobrança...`);

    // C. BUSCA O LINK (Loop Longo e Inteligente)
    let finalPaymentLink = null;

    // Tenta 40 vezes com 1.5s de intervalo (aprox 60 segundos de persistência)
    for (let i = 1; i <= 40; i++) {
        try {
            // MUDANÇA: Buscamos no endpoint geral de pagamentos filtrando pela assinatura.
            // Isso costuma ser mais eficiente para achar a cobrança pendente.
            const payments = await axios.get(
                `${ASAAS_URL}/payments?subscription=${subscriptionId}&limit=1`,
                { headers }
            );

            if (payments.data.data && payments.data.data.length > 0) {
                // Pega a URL do boleto/fatura (serve para cartão também)
                finalPaymentLink = payments.data.data[0].billUrl; // ou invoiceUrl
                console.log(`Link capturado na tentativa ${i}: ${finalPaymentLink}`);
                break; // Sucesso! Sai do loop.
            }
        } catch (e) {
            console.warn(`Tentativa ${i} falhou (o Asaas ainda está processando)...`);
        }

        await delay(1500); // Espera 1.5 segundos
    }

    if (!finalPaymentLink) {
        // Se depois de 1 minuto não veio, aí sim damos erro.
        console.error("Timeout: Asaas não gerou a cobrança a tempo.");
        throw new HttpsError("unavailable", "O sistema de pagamento está demorando mais que o normal. Tente novamente em 1 minuto.");
    }

    return {
      success: true,
      paymentUrl: finalPaymentLink,
      subscriptionId: subscriptionId
    };

  } catch (error) {
    console.error("Erro Fatal:", error);
    throw new HttpsError("internal", error.message);
  }
});

// --- 2. WEBHOOK (Mantido igual) ---
exports.asaasWebhook = onRequest(async (req, res) => {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const event = req.body.event;
    const payment = req.body.payment || {};
    const userId = payment.externalReference || req.body.subscription?.externalReference;

    console.log(`[Webhook] Evento: ${event} | User: ${userId}`);

    if (!userId) return res.json({ received: true });

    try {
        const db = admin.firestore();
        const docRef = db.collection("stores").doc(userId);

        if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
            await docRef.update({
                subscriptionStatus: "active",
                lastPaymentDate: admin.firestore.FieldValue.serverTimestamp(),
                subscriptionId: payment.subscription || null
            });
            console.log(`>>> SUCESSO! Loja ${userId} ativada.`);
        }
        else if (event === "PAYMENT_OVERDUE" || event === "SUBSCRIPTION_DELETED") {
            await docRef.update({ subscriptionStatus: "inactive" });
            console.log(`>>> BLOQUEIO! Loja ${userId} inativada.`);
        }
        res.json({ received: true });
    } catch (error) {
        console.error("Erro Webhook:", error);
        res.status(500).send("Erro interno");
    }
});

// --- 3. Limpeza (Mantido igual) ---
exports.onProductDelete = onDocumentDeleted("stores/{storeId}/products/{productId}", async (event) => {
    // ... código de limpeza ...
});