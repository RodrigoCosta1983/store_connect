// functions/index.js

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const mercadopago = require("mercadopago");

admin.initializeApp();

// IMPORTANTE: Substitua pelo seu Access Token de TESTE
const MERCADO_PAGO_ACCESS_TOKEN =
  "TEST-8901718055170782-091009-8efa9f1d7576736404695a8394cf5db4-235493638";

// CORRIGIDO: Usa a nova sintaxe para configurar o cliente do Mercado Pago
const mpClient = new mercadopago.MercadoPagoConfig({
  accessToken: MERCADO_PAGO_ACCESS_TOKEN,
});

// Função "chamável" a partir do app Flutter
exports.createPaymentPreference = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
        "unauthenticated",
        "Você precisa estar logado para fazer isso.",
    );
  }

  const preference = {
    items: [
      {
        title: "Assinatura Mensal StoreConnect",
        description: "Acesso completo à plataforma.",
        quantity: 1,
        currency_id: "BRL",
        unit_price: 50.00,
      },
    ],
    back_urls: {
      success: "https://seusite.com/success",
      failure: "https://seusite.com/failure",
      pending: "https://seusite.com/pending",
    },
    auto_return: "approved",
  };

  try {
    // CORRIGIDO: Usa a nova sintaxe para criar a preferência
    const preferenceClient = new mercadopago.Preference(mpClient);
    const response = await preferenceClient.create({body: preference});

    return {preferenceId: response.id};
  } catch (error) {
    console.error("Erro ao criar preferência no Mercado Pago:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Não foi possível criar a preferência de pagamento.",
    );
  }
});
