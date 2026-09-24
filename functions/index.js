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

const {
  classifySubscriptionCpfRegistry,
  resolveExistingPaidSubscriptionType,
  evaluateLegacyFinancialProof,
} = require(
  "./financeiro/subscriptionLegacyRegistry"
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

           const cpfRegistryDecision =
             classifySubscriptionCpfRegistry({
               exists: cpfRegistryDoc.exists,
               data: cpfRegistryDoc.exists
                 ? cpfRegistryDoc.data() || {}
                 : null,
               userId,
               storeId,
             });

           if (
             cpfRegistryDecision.action === "reject"
           ) {
             throw new HttpsError(
               "already-exists",
               "Este CPF/CNPJ já está vinculado a outra conta do Store Connect."
             );
           }

           // UID legado diferente + storeId ausente.
           //
           // Nao escrevemos nada nesta primeira transacao.
           // O fluxo retorna apenas o contexto necessario
           // para a prova financeira externa.
           const cpfRegistryRequiresFinancialProof =
             cpfRegistryDecision.action ===
             "require_financial_proof";

           if (cpfRegistryRequiresFinancialProof) {
             return {
               cleanDocument,
               userEmail:
                 userData.email || null,
               cpfRegistryAction:
                 cpfRegistryDecision.action,
               legacyRegisteredUid:
                 cpfRegistryDecision.registeredUid,
             };
           }

           const cpfRegistryNeedsStoreIdBackfill =
             cpfRegistryDecision.action ===
             "backfill_store_id";

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
           } else if (cpfRegistryNeedsStoreIdBackfill) {
             transaction.set(
               cpfRegistryRef,
               {
                 storeId,
                 document: cleanDocument,
                 storeIdLinkedAt: serverTimestamp,
                 storeIdLinkedBy: userId,
                 storeIdLinkReason:
                   "subscription_legacy_cpf_registry_backfill",
               },
               { merge: true }
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

       const cleanDocument =
         transactionResult.cleanDocument;

       const requiresLegacyFinancialProof =
         transactionResult.cpfRegistryAction ===
         "require_financial_proof";

       if (!requiresLegacyFinancialProof) {
         creationLockAcquired = true;

         console.log(
           `🔒 Autorização validada e trava adquirida para loja ${storeId}`
         );
       }

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

       let legacyVerifiedSubscriptionId = null;
       let legacyVerifiedSubscription = null;

       // ============================================================
       // 3.1 PROVA FINANCEIRA DE REGISTRO LEGADO
       // ============================================================
       //
       // Este caminho existe somente quando:
       //
       // - a reserva CPF/CNPJ e legada;
       // - possui UID diferente do owner atual;
       // - nao possui storeId.
       //
       // A primeira transacao terminou SEM writes e SEM lock.
       //
       // Antes de migrar a reserva, comprovamos no Asaas que os IDs
       // financeiros ja salvos na loja pertencem exatamente a ela.
       // ============================================================

       if (requiresLegacyFinancialProof) {
         const legacyRegisteredUid = String(
           transactionResult.legacyRegisteredUid || ""
         ).trim();

         const legacyCustomerId = String(
           storeData.asaasCustomerId || ""
         ).trim();

         const legacySubscriptionId = String(
           storeData.asaasSubscriptionId || ""
         ).trim();

         if (
           !legacyRegisteredUid ||
           !legacyCustomerId ||
           !legacySubscriptionId
         ) {
           throw new HttpsError(
             "failed-precondition",
             "O cadastro financeiro legado desta loja não possui vínculos suficientes para regularização automática."
           );
         }

         let legacyCustomer = null;
         let legacySubscription = null;

         try {
           const [
             legacyCustomerResponse,
             legacySubscriptionResponse,
           ] = await Promise.all([
             axios.get(
               `${ASAAS_URL}/customers/${legacyCustomerId}`,
               {
                 headers,
               }
             ),
             axios.get(
               `${ASAAS_URL}/subscriptions/${legacySubscriptionId}`,
               {
                 headers,
               }
             ),
           ]);

           legacyCustomer =
             legacyCustomerResponse.data || {};

           legacySubscription =
             legacySubscriptionResponse.data || {};
         } catch (error) {
           console.error(
             `❌ Falha na prova financeira legada da loja ${storeId}:`,
             error.response?.data ||
             error.message ||
             error
           );

           throw new HttpsError(
             "internal",
             "Não foi possível validar o cadastro financeiro legado desta loja."
           );
         }

         const financialProof =
           evaluateLegacyFinancialProof({
             storeId,
             cleanDocument,
             storeData,
             customer:
               legacyCustomer,
             subscription:
               legacySubscription,
           });

         if (!financialProof.ok) {
           console.error(
             `🚨 Prova financeira legada recusada para loja ${storeId}. ` +
             `Motivo: ${financialProof.reason}`
           );

           throw new HttpsError(
             "failed-precondition",
             "O vínculo financeiro legado desta loja não pôde ser validado automaticamente. Entre em contato com o suporte."
           );
         }

         // ==========================================================
         // 3.2 SEGUNDA TRANSACAO
         // ==========================================================
         //
         // Entre a prova no Asaas e este ponto qualquer dado poderia
         // ter mudado. Por isso revalidamos TUDO antes de escrever:
         //
         // - usuario;
         // - accessStatus;
         // - storeId;
         // - role;
         // - ownerId;
         // - documento;
         // - plano pago;
         // - IDs financeiros;
         // - reserva CPF/CNPJ;
         // - UID legado original;
         // - lock.
         //
         // Somente depois disso:
         //
         // - migramos a reserva;
         // - preservamos o UID anterior;
         // - registramos auditoria;
         // - adquirimos o lock atomicamente.
         // ==========================================================

         const legacyCpfMigrationAuditRef =
           storeRef
             .collection("auditLogs")
             .doc();

         await db.runTransaction(
           async (transaction) => {
             const userDoc =
               await transaction.get(userRef);

             const freshStoreDoc =
               await transaction.get(storeRef);

             const cpfRegistryRef = db
               .collection("cpfs_cadastrados")
               .doc(cleanDocument);

             const cpfRegistryDoc =
               await transaction.get(
                 cpfRegistryRef
               );

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

             const userData =
               userDoc.data() || {};

             const freshData =
               freshStoreDoc.data() || {};

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

             if (
               !ownerId ||
               ownerId !== userId
             ) {
               throw new HttpsError(
                 "permission-denied",
                 "Somente o proprietário da loja pode gerenciar a assinatura."
               );
             }

             const freshStoredDocument =
               String(
                 freshData.document || ""
               ).replace(/\D/g, "");

             if (
               !freshStoredDocument ||
               freshStoredDocument !==
                 cleanDocument
             ) {
               throw new HttpsError(
                 "failed-precondition",
                 "O documento cadastrado na loja mudou durante a validação financeira."
               );
             }

             const freshPlan =
               String(
                 freshData.subscriptionType ||
                 ""
               )
                 .trim()
                 .toLowerCase();

             if (
               freshPlan !== "pro" &&
               freshPlan !== "business"
             ) {
               throw new HttpsError(
                 "failed-precondition",
                 "Esta loja não possui um plano pago compatível com a regularização financeira."
               );
             }

             const freshCustomerId =
               String(
                 freshData.asaasCustomerId ||
                 ""
               ).trim();

             const freshSubscriptionId =
               String(
                 freshData.asaasSubscriptionId ||
                 ""
               ).trim();

             if (
               freshCustomerId !==
                 financialProof.customerId ||
               freshSubscriptionId !==
                 financialProof.subscriptionId
             ) {
               throw new HttpsError(
                 "failed-precondition",
                 "Os vínculos financeiros da loja mudaram durante a validação."
               );
             }

             const registryDecision =
               classifySubscriptionCpfRegistry({
                 exists:
                   cpfRegistryDoc.exists,
                 data:
                   cpfRegistryDoc.exists
                     ? cpfRegistryDoc.data() || {}
                     : null,
                 userId,
                 storeId,
               });

             const currentLegacyUid =
               String(
                 registryDecision.registeredUid ||
                 ""
               ).trim();

             if (
               registryDecision.action !==
                 "require_financial_proof" ||
               currentLegacyUid !==
                 legacyRegisteredUid
             ) {
               throw new HttpsError(
                 "failed-precondition",
                 "O cadastro financeiro legado mudou durante a validação. Tente novamente."
               );
             }

             const creationStatus =
               freshData
                 .subscriptionCreationStatus;

             const creationStartedAt =
               freshData
                 .subscriptionCreationStartedAt;

             let lockStillValid = false;

             if (
               creationStatus === "creating" &&
               creationStartedAt
             ) {
               const started =
                 creationStartedAt.toDate
                   ? creationStartedAt.toDate()
                   : new Date(
                       creationStartedAt
                     );

               const ageMs =
                 Date.now() -
                 started.getTime();

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
               admin.firestore.FieldValue
                 .serverTimestamp();

             transaction.update(
               storeRef,
               {
                 subscriptionCreationStatus:
                   "creating",
                 subscriptionCreationStartedAt:
                   serverTimestamp,
               }
             );

             transaction.set(
               cpfRegistryRef,
               {
                 uid:
                   userId,

                 storeId,

                 document:
                   cleanDocument,

                 legacyUid:
                   legacyRegisteredUid,

                 legacyUidMigratedAt:
                   serverTimestamp,

                 legacyUidMigratedBy:
                   userId,

                 legacyUidMigrationReason:
                   "subscription_legacy_financial_proof",

                 storeIdLinkedAt:
                   serverTimestamp,

                 storeIdLinkedBy:
                   userId,

                 storeIdLinkReason:
                   "subscription_legacy_financial_proof",
               },
               {
                 merge: true,
               }
             );

             transaction.set(
               legacyCpfMigrationAuditRef,
               {
                 action:
                   "legacy_cpf_registry_owner_migrated",

                 entityType:
                   "cpf_registry",

                 entityId:
                   storeId,

                 storeId,

                 performedBy: {
                   uid:
                     userId,
                   role:
                     "admin",
                 },

                 reason:
                   "subscription_legacy_financial_proof",

                 before: {
                   uid:
                     legacyRegisteredUid,
                   storeId:
                     null,
                 },

                 after: {
                   uid:
                     userId,
                   storeId,
                 },

                 financialProof: {
                   customerId:
                     financialProof.customerId,

                   subscriptionId:
                     financialProof.subscriptionId,

                   customerExternalReference:
                     storeId,

                   subscriptionExternalReference:
                     storeId,

                   subscriptionStatus:
                     String(
                       legacySubscription.status ||
                       ""
                     )
                       .trim()
                       .toUpperCase(),
                 },

                 createdAt:
                   serverTimestamp,
               }
             );
           }
         );

         creationLockAcquired = true;

         legacyVerifiedSubscriptionId =
           financialProof.subscriptionId;

         legacyVerifiedSubscription =
           legacySubscription;

         console.log(
           `✅ Reserva financeira legada migrada com prova Asaas para loja ${storeId}.`
         );
       }

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

       // No caminho legado, a assinatura oficial ja foi validada
       // diretamente por ID no Asaas.
       //
       // Se a listagem ainda nao a devolver, usamos o objeto
       // diretamente comprovado. Isso evita criar uma duplicata.
       if (
         legacyVerifiedSubscriptionId &&
         !activeSubscriptions.some(
           (subscription) =>
             String(
               subscription?.id || ""
             ).trim() ===
             legacyVerifiedSubscriptionId
         )
       ) {
         activeSubscriptions.push(
           legacyVerifiedSubscription
         );
       }

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
           legacyVerifiedSubscriptionId
             ? activeSubscriptions.find(
                 (subscription) =>
                   String(
                     subscription?.id || ""
                   ).trim() ===
                   legacyVerifiedSubscriptionId
               )
             : activeSubscriptions[0];

         if (!existingSubscription) {
           throw new HttpsError(
             "failed-precondition",
             "A assinatura financeira oficial desta loja não foi encontrada."
           );
         }

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

          // ----------------------------------------------------------
          // NORMALIZA FORMA DE PAGAMENTO DA ASSINATURA EXISTENTE
          //
          // O Store Connect permite ao cliente escolher a forma
          // de pagamento na fatura.
          //
          // Novas assinaturas ja sao criadas como UNDEFINED.
          // Assinaturas antigas podem permanecer como CREDIT_CARD,
          // BOLETO ou PIX.
          //
          // Alteramos somente a assinatura.
          // Isso faz as proximas cobrancas seguirem UNDEFINED.
          //
          // Nao alteramos cobrancas ja emitidas.
          // Nao alteramos vencimento.
          // Nao usamos updatePendingPayments.
          // ----------------------------------------------------------

          const existingBillingType =
            String(
              existingSubscription.billingType || ""
            )
              .trim()
              .toUpperCase();

          if (
            existingBillingType &&
            existingBillingType !== "UNDEFINED"
          ) {
            try {
              const billingTypeUpdate =
                await axios.put(
                  `${ASAAS_URL}/subscriptions/${existingSubscription.id}`,
                  {
                    billingType:
                      "UNDEFINED",
                  },
                  {
                    headers,
                  }
                );

              const confirmedBillingType =
                String(
                  billingTypeUpdate.data?.billingType || ""
                )
                  .trim()
                  .toUpperCase();

              if (
                confirmedBillingType === "UNDEFINED"
              ) {
                existingSubscription.billingType =
                  "UNDEFINED";

                console.log(
                  `✅ Assinatura ${existingSubscription.id} normalizada para billingType UNDEFINED.`
                );
              } else {
                console.warn(
                  `⚠️ Asaas não confirmou billingType UNDEFINED para assinatura ${existingSubscription.id}.`
                );
              }
            } catch (billingTypeError) {
              const billingTypeStatus =
                billingTypeError.response?.status ||
                billingTypeError.code ||
                "sem_status";

              console.warn(
                `⚠️ Não foi possível normalizar billingType da assinatura ${existingSubscription.id}. Status: ${billingTypeStatus}.`
              );
            }
          } else if (
            existingBillingType === "UNDEFINED"
          ) {
            console.log(
              `✅ Assinatura ${existingSubscription.id} já usa billingType UNDEFINED.`
            );
          } else {
            console.warn(
              `⚠️ Assinatura ${existingSubscription.id} não informou billingType. Nenhuma alteração automática foi feita.`
            );
          }

         await storeRef.update({
           asaasSubscriptionId:
             existingSubscription.id,

           asaasCustomerId:
             customerId,

           subscriptionType:
             resolveExistingPaidSubscriptionType(
               storeData.subscriptionType
             ),

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
      schedule: "0 2 * * *",
      timeZone: "America/Sao_Paulo",
      timeoutSeconds: 120
    },
    async (event) => {
      console.log(
        "⏰ Iniciando verificacao segura de assinaturas overdue..."
      );

      const db =
        admin.firestore();


      // =========================================================
      // DATA CIVIL DE SAO PAULO
      // =========================================================

      const formatter =
        new Intl.DateTimeFormat(
          "en-US",
          {
            timeZone:
              "America/Sao_Paulo",

            year:
              "numeric",

            month:
              "2-digit",

            day:
              "2-digit"
          }
        );


      const dateParts =
        formatter.formatToParts(
          new Date()
        );


      const dateValues = {};

      for (
        const part of dateParts
      ) {
        if (
          part.type !==
          "literal"
        ) {
          dateValues[part.type] =
            part.value;
        }
      }


      const today =
        dateValues.year +
        "-" +
        dateValues.month +
        "-" +
        dateValues.day;


      function dateOnlyToUtc(
        value
      ) {

        if (
          !/^\d{4}-\d{2}-\d{2}$/
            .test(value)
        ) {
          return null;
        }


        const pieces =
          value
            .split("-")
            .map(Number);


        const timestamp =
          Date.UTC(
            pieces[0],
            pieces[1] - 1,
            pieces[2]
          );


        if (
          !Number.isFinite(
            timestamp
          )
        ) {
          return null;
        }


        return timestamp;
      }


      function calendarDaysBetween(
        fromDate,
        toDate
      ) {

        const from =
          dateOnlyToUtc(
            fromDate
          );

        const to =
          dateOnlyToUtc(
            toDate
          );


        if (
          from === null ||
          to === null
        ) {
          return null;
        }


        return Math.floor(
          (to - from) /
          86400000
        );
      }


      try {

        // =======================================================
        // SOMENTE LOJAS JA MARCADAS COMO OVERDUE
        //
        // A descoberta automatica da inadimplencia sera
        // implementada na etapa seguinte.
        // =======================================================

        const snapshot =
          await db
            .collection("stores")
            .where(
              "subscriptionStatus",
              "==",
              "overdue"
            )
            .get();


        if (
          snapshot.empty
        ) {
          console.log(
            "✅ Nenhuma loja overdue encontrada."
          );

          return;
        }


        const batch =
          db.batch();


        let blockedCount =
          0;

        let graceCount =
          0;

        let skippedCount =
          0;


        for (
          const doc of snapshot.docs
        ) {

          const storeData =
            doc.data() || {};

          const storeId =
            doc.id;


          // =====================================================
          // DATA CANONICA DO ATRASO
          //
          // YYYY-MM-DD da cobranca vencida mais antiga da
          // assinatura oficial.
          //
          // Sem essa informacao, o cron NAO bloqueia.
          // =====================================================

          const overdueDueDate =
            typeof storeData
              .overdueDueDate ===
              "string"
              ? storeData
                  .overdueDueDate
                  .trim()
              : "";


          if (
            !overdueDueDate
          ) {

            skippedCount++;

            console.warn(
              `⚠️ Loja ${storeId} overdue sem overdueDueDate. ` +
              "Bloqueio ignorado por seguranca."
            );

            continue;
          }


          const daysLate =
            calendarDaysBetween(
              overdueDueDate,
              today
            );


          if (
            daysLate === null ||
            daysLate < 0
          ) {

            skippedCount++;

            console.warn(
              `⚠️ Loja ${storeId} possui overdueDueDate invalido: ` +
              `${overdueDueDate}. Bloqueio ignorado.`
            );

            continue;
          }


          // =====================================================
          // REGRA STORE&CONNECT
          //
          // dia 0 = vencimento
          // dia 1 = graca 1
          // dia 2 = graca 2
          // dia 3 = graca 3 / ultimo dia
          // dia 4 = bloqueio
          // =====================================================

          if (
            daysLate < 4
          ) {

            graceCount++;

            console.log(
              `⏳ Loja ${storeId} continua em tolerancia. ` +
              `Vencimento=${overdueDueDate}, ` +
              `diasAtraso=${daysLate}.`
            );

            continue;
          }


          // =====================================================
          // BLOQUEIO SOMENTE NO FIRESTORE
          //
          // A assinatura Asaas NAO e cancelada.
          // As cobrancas permanecem disponiveis para pagamento.
          // =====================================================

          batch.update(
            doc.ref,
            {
              subscriptionStatus:
                "inactive",

              blockedAt:
                admin.firestore
                  .FieldValue
                  .serverTimestamp()
            }
          );


          blockedCount++;


          console.log(
            `🔒 Loja ${storeId} marcada como inactive. ` +
            `Vencimento=${overdueDueDate}, ` +
            `diasAtraso=${daysLate}. ` +
            "Assinatura Asaas preservada."
          );
        }


        if (
          blockedCount > 0
        ) {
          await batch.commit();
        }


        console.log(
          "✅ Verificacao concluida. " +
          `Bloqueadas=${blockedCount}, ` +
          `emGraca=${graceCount}, ` +
          `ignoradas=${skippedCount}.`
        );

      } catch (error) {

        console.error(
          "❌ Erro durante verificacao segura de inadimplencia:",
          error
        );

        throw error;
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

// ============================================================================
// STORE CONNECT - TAXONOMIA SEGURA DE PRODUTOS
// ============================================================================

const {
  setProductCategories,
} = require("./products/setProductCategories");

exports.setProductCategories =
  setProductCategories;

// ============================================================================
// STORE CONNECT - CRIACAO SEGURA DE PRODUTOS
// ============================================================================

const {
  createProduct,
} = require("./products/createProduct");

exports.createProduct =
  createProduct;

// ============================================================================
// STORE CONNECT - CRIACAO E EDICAO SEGURA DE CATEGORIAS
// ============================================================================

const {
  upsertCategory,
} = require("./categories/upsertCategory");

exports.upsertCategory =
  upsertCategory;

// ============================================================================// STORE CONNECT - EXCLUSAO SEGURA DE CATEGORIAS
// ============================================================================

const {
  deleteCategory,
} = require("./categories/deleteCategory");

exports.deleteCategory =
  deleteCategory;




// -----------------------------------------------------------------------
// 💾 BACKUP / SNAPSHOT GERAL DA LOJA
// -----------------------------------------------------------------------

const {
  createStoreSnapshot,
} = require("./backups/createStoreSnapshot");

exports.createStoreSnapshot =
  createStoreSnapshot;

// -----------------------------------------------------------------------
// ⏰ BACKUP AUTOMÁTICO DIÁRIO DAS LOJAS
// -----------------------------------------------------------------------
const {
  scheduledStoreBackups,
} = require("./backups/scheduledStoreBackups");

exports.scheduledStoreBackups =
  scheduledStoreBackups;


// -----------------------------------------------------------------------
// 🧪 PREVIEW / DRY RUN DA RETENÇÃO DE BACKUPS
// -----------------------------------------------------------------------
const {
  previewBackupRetention,
} = require("./backups/previewBackupRetention");

exports.previewBackupRetention =
  previewBackupRetention;



// -----------------------------------------------------------------------
// 🧪 RETENÇÃO AUTOMÁTICA DE BACKUPS — DRY RUN
// -----------------------------------------------------------------------
const {
  scheduledBackupRetention,
} = require("./backups/scheduledBackupRetention");

exports.scheduledBackupRetention =
  scheduledBackupRetention;



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

// =============================================================================
// 🛍️ CATÁLOGO INTELIGENTE
// =============================================================================

const {
  createCatalog,
  listCatalogs,
  listCatalogRequests,
  getCatalogRequest,
  transitionCatalogRequest,
  getPublicCatalog,
  submitPublicCatalogSelection,
} = require("./catalog/createCatalog");

exports.createCatalog = createCatalog;
exports.listCatalogs = listCatalogs;
exports.listCatalogRequests = listCatalogRequests;
exports.getCatalogRequest = getCatalogRequest;
exports.transitionCatalogRequest = transitionCatalogRequest;
exports.getPublicCatalog = getPublicCatalog;
exports.submitPublicCatalogSelection = submitPublicCatalogSelection;

// -----------------------------------------------------------------------
// 💰 RECONCILIACAO DIARIA ASAAS -> FIRESTORE
// -----------------------------------------------------------------------
const {
  reconcileAsaasBilling,
} = require("./financeiro/reconcileAsaasBilling");

exports.reconcileAsaasBilling =
  reconcileAsaasBilling;
