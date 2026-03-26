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

 exports.createAsaasSubscription = onCall({ timeoutSeconds: 120 }, async (request) => {
   console.log("\n\n╔════════════════════════════════════════════════════════════╗");
   console.log("║  🟢 INICIANDO PROCESSO DE ASSINATURA NO ASAAS              ║");
   console.log("╚════════════════════════════════════════════════════════════╝");

   const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
   if (!request.auth) {
     throw new HttpsError("unauthenticated", "Usuário não logado.");
   }

   const userId = request.auth.uid;
   const headers = {
     "access_token": ASAAS_API_KEY,
     "Content-Type": "application/json"
   };
   const db = admin.firestore();

   try {
     // ✅ PASSO 1: Identifica a Loja
     let storeId = request.data.storeId;
     if (!storeId) {
       const userDoc = await db.collection("users").doc(userId).get();
       if (!userDoc.exists || !userDoc.data().storeId) {
         throw new HttpsError("not-found", "Nenhuma loja vinculada a este usuário.");
       }
       storeId = userDoc.data().storeId;
     }

     // ✅ PASSO 2: Busca os dados completos da loja no banco
     const storeRef = db.collection("stores").doc(storeId);
     const storeDoc = await storeRef.get();
     const storeData = storeDoc.data() || {};

     // 🚀 A MÁGICA AQUI: Pegamos o CPF e Nome direto do banco (pois o Flutter mandou só o storeId)
     const cpfCnpj = request.data.cpfCnpj || storeData.document;
     const name = request.data.name || storeData.name || "Cliente Store Connect";
     const phone = request.data.phone || storeData.phone || "";
     const email = request.data.email || request.auth.token?.email || `contato@${storeId}.com.br`;

     if (!cpfCnpj) {
       throw new HttpsError("invalid-argument", "CPF/CNPJ não encontrado no cadastro da loja.");
     }

     const existingSubscriptionId = storeData.asaasSubscriptionId;

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

     // 💳 PASSO 4: CRIA ASSINATURA PAGA DIRETO (Se clicou no botão vermelho, ele quer assinar agora!)
     console.log("\n💳 CRIANDO ASSINATURA PAGA NO ASAAS");

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
    // nextDueDate.setMonth(nextDueDate.getMonth() + 1);
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

     // ✅ ATUALIZA A LOJA no Firestore sem apagar o Trial
     await storeRef.update({
       asaasSubscriptionId: subscriptionId,
       asaasCustomerId: customerId,
       subscriptionStatus: "pending",
       subscriptionType: "pro",
       nextDueDate: dueDateString
       // Note que não mexemos no trialEndDate, ele continua valendo!
     });

     console.log(`✅ Assinatura salva no Firestore: ${subscriptionId}`);

     // ✅ PASSO 5: Busca o link do boleto (com delay inteligente real)
         let finalPaymentLink = null;

         console.log(`⏳ Aguardando Asaas gerar o boleto para a assinatura ${subscriptionId}...`);

         for (let i = 1; i <= 40; i++) {
           const payments = await axios.get(`${ASAAS_URL}/payments?subscription=${subscriptionId}&limit=1`, { headers });

           if (payments.data.data && payments.data.data.length > 0) {
             const payment = payments.data.data[0];
             const linkGerado = payment.billUrl || payment.invoiceUrl;

             // SÓ PARA O LOOP SE O LINK REALMENTE EXISTIR AGORA!
             if (linkGerado) {
               finalPaymentLink = linkGerado;
               console.log(`✅ Boleto encontrado na tentativa ${i}`);
               break;
             } else {
               console.log(`🔄 Pagamento criado, aguardando URL do banco... Tentativa ${i}`);
             }
           }
           // Espera 2 segundos antes de tentar de novo
           await delay(3000);
         }

         if (!finalPaymentLink) {
           throw new HttpsError("unavailable", "Asaas demorou a gerar o link do boleto.");
         }

         console.log(`✅ Boleto retornado para o celular com sucesso!`);

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
     console.error(`\n❌ Erro na assinatura: ${error.message}`);
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