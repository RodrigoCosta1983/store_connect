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



// =============================================================================
// 💰 SINCRONIZAÇÃO AUTOMÁTICA DE PREÇOS ASAAS
//
// Executada diariamente para garantir que nenhuma assinatura permaneça
// com um preço antigo depois de uma alteração nos planos do Store Connect.
// =============================================================================

exports.syncAsaasSubscriptionPrices =
  onSchedule(
    {
      schedule:
        "0 3 * * *",

      timeZone:
        "America/Sao_Paulo",

      timeoutSeconds:
        540,
    },

    async () => {
      return await syncAllAsaasSubscriptionPrices();
    }
  );



// Inicializa o Firebase apenas UMA VEZ aqui no index principal
admin.initializeApp();

const ASAAS_ENV = process.env.ASAAS_ENV || "sandbox";
const ASAAS_URL = ASAAS_ENV === "production"
  ? "https://www.asaas.com/api/v3"
  : "https://sandbox.asaas.com/api/v3";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const {
  SUBSCRIPTION_PLANS,
  syncAsaasSubscriptionPrice,
  syncAllAsaasSubscriptionPrices,
} = require(
  "./financeiro/subscriptionPricing"
);

/**
 * 🔵 FUNÇÃO: createAsaasSubscription
 * * Descrição: Responsável por converter uma loja em um cliente pagante no Asaas.
 *
 * Fluxo Atualizado (P6.8-B - Arquitetura Segura):
 * 1. Solicitação → Recebe `storeId` e, apenas para legado sem documento, CPF/CNPJ.
 * 2. Autorização → Confirma ownerId + users/{uid}.storeId + role admin + accessStatus.
 * 3. Enriquecimento → Nome, telefone e e-mail vêm de fontes canônicas do backend.
 * 4. Verificação de Assinatura Existente:
 * - Se já tem assinatura e está PAGA → Retorna aviso de sucesso.
 * - Se já tem assinatura e está PENDENTE → Recupera e retorna o link do boleto já existente.
 * 5. Nova Assinatura (Ação do botão "Assinar Agora"):
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
       // 1. IDENTIFICA A LOJA PELO VÍNCULO DO USUÁRIO
       // ============================================================
       //
       // O storeId enviado pelo Flutter é tratado apenas como identificador
       // solicitado. A autorização real é confirmada no Firestore dentro da
       // mesma transação que adquire a trava de criação da assinatura.
       // ============================================================

       const userRef = db
         .collection("users")
         .doc(userId);

       let storeId = String(
         request.data?.storeId || ""
       ).trim();

       if (!storeId) {
         const userDocForStore = await userRef.get();

         if (
           !userDocForStore.exists ||
           !userDocForStore.data()?.storeId
         ) {
           throw new HttpsError(
             "not-found",
             "Nenhuma loja vinculada a este usuário."
           );
         }

         storeId = String(
           userDocForStore.data().storeId
         ).trim();
       }

       if (!storeId) {
         throw new HttpsError(
           "invalid-argument",
           "Store ID inválido."
         );
       }

       storeRef = db
         .collection("stores")
         .doc(storeId);

       const requestedDocument = String(
         request.data?.cpfCnpj || ""
       ).replace(/\D/g, "");

       const documentAuditRef = storeRef
         .collection("auditLogs")
         .doc();

       // ============================================================
       // 2. AUTORIZAÇÃO + CPF/CNPJ + TRAVA EM UMA ÚNICA TRANSAÇÃO
       // ============================================================
       //
       // Segurança:
       // • o usuário precisa existir;
       // • não pode estar revogado;
       // • precisa pertencer à loja;
       // • precisa ser admin;
       // • precisa ser o ownerId da loja;
       // • CPF/CNPJ não pode pertencer a outra conta/loja;
       // • o documento legado, quando ausente, é persistido pelo backend;
       // • a trava contra duplo clique é adquirida atomicamente.
       //
       // IMPORTANTE:
       // Firestore Rules NÃO protegem o Admin SDK. Por isso estas validações
       // são obrigatórias dentro da própria Cloud Function.
       // ============================================================

       const transactionResult = await db.runTransaction(
         async (transaction) => {
           const userDoc = await transaction.get(userRef);
           const freshStoreDoc = await transaction.get(storeRef);

           if (!userDoc.exists) {
             throw new HttpsError(
               "permission-denied",
               "Usuário sem cadastro válido no Store Connect."
             );
           }

           if (!freshStoreDoc.exists) {
             throw new HttpsError(
               "not-found",
               "Loja não encontrada."
             );
           }

           const userData = userDoc.data() || {};
           const freshData = freshStoreDoc.data() || {};

           const userStoreId = String(
             userData.storeId || ""
           ).trim();

           const role = String(
             userData.role || ""
           ).trim().toLowerCase();

           const accessStatus = String(
             userData.accessStatus || "active"
           ).trim().toLowerCase();

           const ownerId = String(
             freshData.ownerId || ""
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
               "Somente o administrador proprietário pode gerenciar a assinatura."
             );
           }

           // Enquanto as Firestore Rules finais do P7 ainda não foram
           // publicadas, ownerId é a âncora mais forte contra autoelevação
           // indevida de role/storeId pelo cliente.
           if (!ownerId || ownerId !== userId) {
             throw new HttpsError(
               "permission-denied",
               "Somente o proprietário da loja pode gerenciar a assinatura."
             );
           }

           const storedDocument = String(
             freshData.document || ""
           ).replace(/\D/g, "");

           if (
             storedDocument &&
             requestedDocument &&
             storedDocument !== requestedDocument
           ) {
             throw new HttpsError(
               "failed-precondition",
               "O CPF/CNPJ informado não corresponde ao documento cadastrado nesta loja."
             );
           }

           const cleanDocument =
             storedDocument || requestedDocument;

           if (
             cleanDocument.length !== 11 &&
             cleanDocument.length !== 14
           ) {
             throw new HttpsError(
               "invalid-argument",
               "Informe um CPF/CNPJ válido para continuar."
             );
           }

           const cpfRegistryRef = db
             .collection("cpfs_cadastrados")
             .doc(cleanDocument);

           const cpfRegistryDoc = await transaction.get(
             cpfRegistryRef
           );

           if (cpfRegistryDoc.exists) {
             const cpfRegistryData =
               cpfRegistryDoc.data() || {};

             const registeredUid = String(
               cpfRegistryData.uid || ""
             ).trim();

             const registeredStoreId = String(
               cpfRegistryData.storeId || ""
             ).trim();

             if (
               !registeredUid ||
               !registeredStoreId ||
               registeredUid !== userId ||
               registeredStoreId !== storeId
             ) {
               throw new HttpsError(
                 "already-exists",
                 "Este CPF/CNPJ já está vinculado a outra conta do Store Connect."
               );
             }
           }

           const creationStatus =
             freshData.subscriptionCreationStatus;

           const creationStartedAt =
             freshData.subscriptionCreationStartedAt;

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

           const serverTimestamp =
             admin.firestore.FieldValue.serverTimestamp();

           const storeUpdate = {
             subscriptionCreationStatus: "creating",
             subscriptionCreationStartedAt:
               serverTimestamp,
           };

           const documentWasMissing =
             !storedDocument;

           if (documentWasMissing) {
             storeUpdate.document = cleanDocument;
             storeUpdate.documentUpdatedAt =
               serverTimestamp;
             storeUpdate.documentUpdatedBy =
               userId;
           }

           transaction.update(
             storeRef,
             storeUpdate
           );

           if (!cpfRegistryDoc.exists) {
             transaction.set(
               cpfRegistryRef,
               {
                 uid: userId,
                 storeId,
                 document: cleanDocument,
                 createdAt: serverTimestamp,
                 motivo:
                   "Cadastro financeiro Store Connect",
               }
             );
           }

           if (documentWasMissing) {
             transaction.set(
               documentAuditRef,
               {
                 action:
                   "store_document_registered",
                 entityType:
                   "store",
                 entityId:
                   storeId,
                 storeId,
                 performedBy: {
                   uid: userId,
                   role: "admin",
                 },
                 reason:
                   "subscription_legacy_fallback",
                 before: {
                   hasDocument: false,
                 },
                 after: {
                   hasDocument: true,
                 },
                 createdAt:
                   serverTimestamp,
               }
             );
           }

           return {
             cleanDocument,
             userEmail:
               userData.email || null,
           };
         }
       );

       creationLockAcquired = true;

       const cleanDocument =
         transactionResult.cleanDocument;

       console.log(
         `🔒 Autorização validada e trava adquirida para loja ${storeId}`
       );

       // ============================================================
       // 3. BUSCA DADOS CANÔNICOS DA LOJA APÓS A TRANSAÇÃO
       // ============================================================
       //
       // Nome e telefone vêm do Firestore. O cliente não escolhe esses dados
       // para o cadastro financeiro do Asaas.
       // ============================================================

       const storeDoc = await storeRef.get();

       if (!storeDoc.exists) {
         throw new HttpsError(
           "not-found",
           "Loja não encontrada após a validação."
         );
       }

       const storeData =
         storeDoc.data() || {};

       const name = String(
         storeData.name ||
         "Cliente Store Connect"
       ).trim();

       const phone = String(
         storeData.phone || ""
       ).trim();

       const email = String(
         request.auth.token?.email ||
         transactionResult.userEmail ||
         `contato@${storeId}.com.br`
       ).trim();

       const maskedDocument =
         cleanDocument.length >= 4
           ? `***${cleanDocument.slice(-4)}`
           : "***";

       console.log(`📌 User ID: ${userId}`);
       console.log(`📌 Store ID: ${storeId}`);
       console.log(`📌 CPF/CNPJ: ${maskedDocument}`);
       console.log(
         `📌 Assinatura salva atualmente: ${
           storeData.asaasSubscriptionId || "NÃO"
         }`
       );

       // ============================================================
       // 4.1 LOCALIZA OU CRIA O CUSTOMER NO ASAAS
       //
       // SEGUNDA CAMADA DE PROTEÇÃO:
       //
       // Mesmo que exista um customer no Asaas com o mesmo CPF/CNPJ,
       // ele NÃO é automaticamente reutilizado.
       //
       // Para reutilizar, exigimos:
       //
       // customer.externalReference === storeId
       //
       // Isso impede que:
       //
       // Loja A -> CPF 123 -> customer cus_A
       //
       // seja reutilizado acidentalmente por:
       //
       // Loja B -> CPF 123
       //
       // Mesmo CPF/CNPJ NÃO significa mesma loja.
       //
       // O vínculo oficial Store Connect <-> Asaas é:
       //
       // asaasCustomerId + externalReference/storeId
       // ============================================================

       let customerId =
         storeData.asaasCustomerId || null;


       // ============================================================
       // 4.2 SE A LOJA JÁ TEM CUSTOMER SALVO
       //
       // Confirma que esse customer realmente pertence à loja atual.
       // ============================================================

       if (customerId) {
         try {
           const existingCustomerResponse =
             await axios.get(
               `${ASAAS_URL}/customers/${customerId}`,
               {
                 headers,
               }
             );

           const existingCustomer =
             existingCustomerResponse.data;

           const externalReference =
             existingCustomer?.externalReference ||
             null;

           if (
             externalReference &&
             externalReference !== storeId
           ) {
             console.error(
               `🚨 CUSTOMER ASAAS INCONSISTENTE. ` +
               `Customer ${customerId} pertence a "${externalReference}", ` +
               `mas a loja atual é "${storeId}".`
             );

             throw new HttpsError(
               "failed-precondition",
               "O cadastro financeiro desta loja está inconsistente. Entre em contato com o suporte."
             );
           }

           // Customer antigo pode não ter externalReference.
           //
           // Se o ID já estava salvo NA PRÓPRIA loja,
           // podemos corrigir o externalReference com segurança.

           if (!externalReference) {
             console.log(
               `🔧 Customer ${customerId} sem externalReference. Vinculando à loja ${storeId}.`
             );

             await axios.put(
               `${ASAAS_URL}/customers/${customerId}`,
               {
                 externalReference:
                   storeId,
               },
               {
                 headers,
               }
             );
           }

           console.log(
             `✅ Customer Asaas salvo na loja validado: ${customerId}`
           );

         } catch (error) {
           if (
             error instanceof HttpsError
           ) {
             throw error;
           }

           console.error(
             `❌ Falha ao validar customer ${customerId}:`,
             error.response?.data ||
             error.message ||
             error
           );

           throw new HttpsError(
             "internal",
             "Não foi possível validar o cadastro financeiro existente."
           );
         }
       }


       // ============================================================
       // 4.3 LOJA AINDA NÃO TEM CUSTOMER ASAAS
       // ============================================================

       if (!customerId) {
         console.log(
           `🔎 Procurando CPF/CNPJ ${cleanDocument} no Asaas...`
         );

         const search =
           await axios.get(
             `${ASAAS_URL}/customers`,
             {
               headers,

               params: {
                 cpfCnpj:
                   cleanDocument,

                 limit:
                   100,
               },
             }
           );

         const customers =
           search.data?.data || [];

         // ==========================================================
         // PROCURA SOMENTE CUSTOMER QUE PERTENCE À LOJA ATUAL
         //
         // Não usamos mais customers[0].
         // ==========================================================

         const customerDaLoja =
           customers.find(
             (customer) =>
               customer.externalReference ===
               storeId
           );

         if (customerDaLoja) {

           customerId =
             customerDaLoja.id;

           console.log(
             `✅ Customer correto encontrado no Asaas: ${customerId}`
           );

           console.log(
             `🔗 externalReference confirmado: ${storeId}`
           );

         } else {

           // ========================================================
           // EXISTE O MESMO CPF NO ASAAS, MAS PERTENCE A OUTRA LOJA
           //
           // NÃO reutilizamos.
           // NÃO alteramos.
           // NÃO sobrescrevemos.
           //
           // Criamos um customer próprio para a loja atual.
           // ========================================================

           if (customers.length > 0) {
             console.warn(
               `⚠️ Existem ${customers.length} customer(s) no Asaas ` +
               `com o CPF/CNPJ ${cleanDocument}, mas nenhum pertence ` +
               `à loja atual ${storeId}.`
             );

             for (const customer of customers) {
               console.warn(
                 `   Customer: ${customer.id} | ` +
                 `externalReference: ${customer.externalReference || "SEM REFERÊNCIA"}`
               );
             }

             console.warn(
               "🛡️ Nenhum customer de outra loja será reutilizado."
             );
           }


           // ========================================================
           // CRIA CUSTOMER EXCLUSIVO PARA ESTA LOJA
           // ========================================================

           const create =
             await axios.post(
               `${ASAAS_URL}/customers`,
               {
                 name,

                 email,

                 cpfCnpj:
                   cleanDocument,

                 phone,

                 externalReference:
                   storeId,
               },
               {
                 headers,
               }
             );

           customerId =
             create.data.id;

           console.log(
             `✅ Novo customer criado no Asaas: ${customerId}`
           );

           console.log(
             `🔗 Vinculado exclusivamente à loja: ${storeId}`
           );
         }


         // ==========================================================
         // SALVA O CUSTOMER CORRETO IMEDIATAMENTE NO FIRESTORE
         // ==========================================================

         await storeRef.update({
           asaasCustomerId:
             customerId,
         });

         console.log(
           `✅ asaasCustomerId ${customerId} salvo na loja ${storeId}.`
         );
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
           payment?.invoiceUrl ||
           payment?.billUrl ||
           null;

         await syncAsaasSubscriptionPrice({
           storeId,
           subscriptionId:
             existingSubscription.id,
           plan:
             storeData.subscriptionType ||
             "pro",
         });

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

         subscriptionPlanPrice:
           SUBSCRIPTION_PLANS.pro.price,
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
             payment.invoiceUrl ||
             payment.billUrl;

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


// ============================================================================
// STORE CONNECT - EXPORT: ARQUIVAMENTO E RESTAURAÇÃO SEGURA DE CLIENTE
// ============================================================================
//
// Arquivo:
//   functions/index.js
//
// Exporta as Cloud Functions responsáveis pelo ciclo seguro de:
// - arquivamento de clientes;
// - restauração de clientes.
//
// ============================================================================

const {
  archiveCustomer,
} = require("./customers/archiveCustomer");

exports.archiveCustomer =
  archiveCustomer;

const {
  restoreCustomer,
} = require("./customers/restoreCustomer");

exports.restoreCustomer =
  restoreCustomer;




 /// =======================================================================
  // 🧾 MÓDULO FISCAL - FOCUS NFE
  // =======================================================================

  // Cadastro / validação da empresa
  const {
    registerFocusCompany,
  } = require("./fiscal/registerFocusCompany");

  exports.registerFocusCompany =
    registerFocusCompany;

  // Credenciais individuais Focus
  const {
    saveFocusCredentials,
  } = require("./fiscal/saveFocusCredentials");

  exports.saveFocusCredentials =
    saveFocusCredentials;

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

 // Certificado Digital A1
 const {
   vincularCertificadoA1,
 } = require("./fiscal/vincularCertificadoA1");

 exports.vincularCertificadoA1 =
   vincularCertificadoA1;

 // -----------------------------------------------------------------------
 // Sincronização da tabela NCM oficial
 // -----------------------------------------------------------------------

 const {
   syncNcmTable,
 } = require("./fiscal/ncm/syncNcmTable");

 exports.syncNcmTable =
   syncNcmTable;

// -----------------------------------------------------------------------
// 📴 VENDAS OFFLINE - SINCRONIZAÇÃO IDEMPOTENTE
// -----------------------------------------------------------------------

const {
  syncOfflineSale,
} = require("./sales/syncOfflineSale");

exports.syncOfflineSale =
  syncOfflineSale;


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
// ⏳ EXPIRAÇÃO SERVER-SIDE DE TRIALS - P6
// -----------------------------------------------------------------------
//
// O Flutter não persiste mais mudanças em subscriptionStatus por expiração.
// Esta rotina agendada usa o relógio do servidor e mantém auditLog.
// -----------------------------------------------------------------------

const {
  expireTrials,
} = require("./financeiro/expireTrials");

exports.expireTrials =
  expireTrials;


// -----------------------------------------------------------------------
// 🏪 BOOTSTRAP SEGURO DA PRIMEIRA LOJA - P6.8
// -----------------------------------------------------------------------
//
// Cria loja + owner admin + trial + reserva de CPF/CNPJ somente no backend.
// -----------------------------------------------------------------------

const {
  bootstrapStore,
} = require("./auth/bootstrapStore");

exports.bootstrapStore =
  bootstrapStore;



// -----------------------------------------------------------------------
// 👥 MÓDULO DE USUÁRIOS E PERMISSÕES
// -----------------------------------------------------------------------

const {
  convidarFuncionario,
} = require(
  "./usuarios/convidarFuncionario"
);

exports.convidarFuncionario =
  convidarFuncionario;

const {
  revogarAcessoFuncionario,
} = require(
  "./usuarios/revogarAcessoFuncionario"
);

exports.revogarAcessoFuncionario =
  revogarAcessoFuncionario;

// -----------------------------------------------------------------------
// 👥 MÓDULO PRODUTOS
// -----------------------------------------------------------------------

const {
  archiveProduct,
} = require("./products/archiveProduct");

exports.archiveProduct = archiveProduct;

// ============================================================================
// STORE CONNECT - RESTAURAÇÃO SEGURA DE PRODUTO
// ============================================================================

const {
  restoreProduct,
} = require("./products/restoreProduct");

exports.restoreProduct =
  restoreProduct;

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

    // ============================================================
    // JÁ ESTÁ NO MESMO PLANO
    //
    // Mesmo que o Firestore diga que a loja já está no plano,
    // ainda precisamos garantir que o valor real da assinatura
    // no Asaas esteja sincronizado com o preço oficial.
    //
    // Exemplo:
    //
    // Firestore:
    // subscriptionType = "pro"
    //
    // Asaas:
    // assinatura antiga = R$ 15,90
    //
    // Preço oficial:
    // PRO = R$ 39,90
    //
    // Nesse caso, NÃO podemos simplesmente retornar
    // "já está no plano".
    //
    // Primeiro sincronizamos o preço.
    // ============================================================

    if (currentPlan === newPlan) {
      try {
        const syncResult =
          await syncAsaasSubscriptionPrice({
            storeId,

            subscriptionId,

            plan:
              currentPlan,
          });

        return {
          success: true,

          alreadyOnPlan: true,

          plan:
            currentPlan,

          subscriptionId,

          // --------------------------------------------------------
          // INFORMA SE O PREÇO PRECISOU SER CORRIGIDO
          // --------------------------------------------------------

          priceUpdated:
            syncResult.updated,

          oldPrice:
            syncResult.oldPrice,

          price:
            syncResult.newPrice,

          message:
            syncResult.updated
              ? `A loja já estava no plano ${currentPlan}, mas o valor da assinatura foi atualizado de R$ ${syncResult.oldPrice.toFixed(2)} para R$ ${syncResult.newPrice.toFixed(2)}.`
              : `A loja já está no plano ${currentPlan} e o valor da assinatura está correto.`,
        };
      } catch (error) {
        console.error(
          `❌ Erro ao sincronizar preço da assinatura ${subscriptionId}:`,
          error.response?.data ||
            error.message ||
            error
        );

        throw new HttpsError(
          "internal",
          "A loja já está neste plano, mas não foi possível verificar o valor da assinatura no Asaas."
        );
      }
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
