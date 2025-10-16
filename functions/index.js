// functions/index.js (com formatação corrigida)

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const stripe = require("stripe")(functions.config().stripe.secret_key);

admin.initializeApp();

exports.createPaymentIntent = functions.https.onCall(async (data, context) => {
  // Verifica se o usuário está autenticado
  if (!context.auth) {
    throw new functions.https.HttpsError(
        "unauthenticated",
        "Você precisa estar logado para fazer isso.",
    );
  }

  // Define o valor da cobrança em centavos (R$ 50,00 = 5000)
  const amount = 5000;
  const currency = "brl";

  try {
    // Cria a "Intenção de Pagamento" (PaymentIntent) no Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: currency,
      automatic_payment_methods: {
        enabled: true,
      },
    });

    // Retorna o 'client_secret' para o App Flutter
    return {
      clientSecret: paymentIntent.client_secret,
    };
  } catch (error) {
    console.error("Erro ao criar PaymentIntent no Stripe:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Não foi possível iniciar o processo de pagamento.",
    );
  }
});
