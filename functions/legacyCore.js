'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const admin=require('firebase-admin'),axios=require('./financeiro/provider'),functions=require('firebase-functions');
const {asaasApiKey,getAsaasApiKey}=require('./financeiro/asaasSecrets');
const {resolveAsaasConfig}=require('./financeiro/asaasConfig');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const {completeListResponse}=require('./financeiro/asaasCompleteList');
const readFinancialList=(url,options)=>completeListResponse(axios.get,url,options);
const {SUBSCRIPTION_PLANS,syncAllAsaasSubscriptionPrices}=require('./financeiro/subscriptionPricing');
const {classifySubscriptionCpfRegistry,resolveExistingPaidSubscriptionType,evaluateLegacyFinancialProof}=require('./financeiro/subscriptionLegacyRegistry');
const {classifyAsaasBindingOrigin,stampAsaasBindingOrigin}=require('./financeiro/asaasBindingOrigin');
const {checkStoreFinancialAdmission,assertStoreFinancialAdmission}=require('./financeiro/storeFinancialAdmission');
const {syncExistingSubscriptionPrice}=require('./financeiro/subscriptionPriceSyncPolicy');
function assertAsaasBindingOrigin(storeData, config) {
  const result = classifyAsaasBindingOrigin(storeData, config);
  if (!result.allowed) {
    throw new HttpsError(
      "failed-precondition",
      "Vinculo financeiro exige verificacao manual antes de operacoes Asaas."
    );
  }
}
async function createAsaasSubscriptionLegacy(request) {
     console.info('finance_event',{"file":"legacyCore.js","line":25});
     console.info('finance_event',{"file":"legacyCore.js","line":28});
     console.info('finance_event',{"file":"legacyCore.js","line":31});

     if (!request.auth) {
       throw new HttpsError(
         "unauthenticated",
         "Usuário não logado."
       );
     }

     const asaasConfig = resolveAsaasConfig();
     const ASAAS_API_KEY = getAsaasApiKey();
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

           // A2/02b: recusa IDs antigos/estrangeiros antes da trava e do CPF.
           assertAsaasBindingOrigin(freshData, asaasConfig);

           await assertStoreFinancialAdmission({
             db, storeId, storeData: freshData, config: asaasConfig,
             operation: "subscription.create", transaction,
           });

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

         console.info('finance_event',{"file":"legacyCore.js","line":418});
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

       // Recusa troca concorrente da origem entre a transacao e a leitura.
       assertAsaasBindingOrigin(storeData, asaasConfig);

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
               `${resolveAsaasConfig().baseUrl}/customers/${legacyCustomerId}`,
               {
                 headers,
               }
             ),
             axios.get(
               `${resolveAsaasConfig().baseUrl}/subscriptions/${legacySubscriptionId}`,
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
           console.info('finance_event',{"file":"legacyCore.js","line":517});

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
           console.info('finance_event',{"file":"legacyCore.js","line":542});

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

             assertAsaasBindingOrigin(freshData, asaasConfig);

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

         console.info('finance_event',{"file":"legacyCore.js","line":920});
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

       console.info('finance_event',{"file":"legacyCore.js","line":945});
       console.info('finance_event',{"file":"legacyCore.js","line":946});
       console.info('finance_event',{"file":"legacyCore.js","line":947});
       console.info('finance_event',{"file":"legacyCore.js","line":948});

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
               `${resolveAsaasConfig().baseUrl}/customers/${customerId}`,
               {
                 headers,
               }
             );

           const existingCustomer =
             existingCustomerResponse.data;

           if (existingCustomer?.id !== customerId ||
               String(existingCustomer?.cpfCnpj || "").replace(/\D/g, "") !== cleanDocument ||
               existingCustomer?.deleted === true) {
             throw new HttpsError("failed-precondition", "Customer oficial exige conferencia; nenhuma substituicao automatica.");
           }

           const externalReference =
             existingCustomer?.externalReference ||
             null;

           if (
             externalReference &&
             externalReference !== storeId
           ) {
             console.info('finance_event',{"file":"legacyCore.js","line":1018});

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
             throw new HttpsError("failed-precondition", "Vinculo financeiro sem referencia oficial. Conferencia necessaria; nenhuma normalizacao automatica.");
           }

           console.info('finance_event',{"file":"legacyCore.js","line":1039});

         } catch (error) {
           if (
             error instanceof HttpsError
           ) {
             throw error;
           }

           console.info('finance_event',{"file":"legacyCore.js","line":1050});

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
         console.info('finance_event',{"file":"legacyCore.js","line":1070});

         const search =
           await readFinancialList(
             `${resolveAsaasConfig().baseUrl}/customers`,
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

         if (!Array.isArray(search.data?.data) || search.data.hasMore !== false ||
             customers.some(c => !c?.id || String(c.cpfCnpj || "").replace(/\D/g, "") !== cleanDocument) ||
             customers.filter(c => c.externalReference === storeId).length > 1) {
           throw new HttpsError("failed-precondition", "Busca de customer incompleta ou ambigua; nenhuma criacao permitida.");
         }

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

           console.info('finance_event',{"file":"legacyCore.js","line":1117});

           console.info('finance_event',{"file":"legacyCore.js","line":1121});

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
             console.info('finance_event',{"file":"legacyCore.js","line":1138});

             for (const customer of customers) {
               console.info('finance_event',{"file":"legacyCore.js","line":1145});
             }

             console.info('finance_event',{"file":"legacyCore.js","line":1151});
           }


           // ========================================================
           // CRIA CUSTOMER EXCLUSIVO PARA ESTA LOJA
           // ========================================================

           const create =
             await axios.post(
               `${resolveAsaasConfig().baseUrl}/customers`,
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

           console.info('finance_event',{"file":"legacyCore.js","line":1185});

           console.info('finance_event',{"file":"legacyCore.js","line":1189});
         }


         // ==========================================================
         // SALVA O CUSTOMER CORRETO IMEDIATAMENTE NO FIRESTORE
         // ==========================================================

         await storeRef.update({
           ...stampAsaasBindingOrigin(asaasConfig),
           asaasCustomerId:
             customerId,
         });

         console.info('finance_event',{"file":"legacyCore.js","line":1205});
       }

       // ============================================================
       // 5. PROTEÇÃO 2:
       // CONSULTA O ASAAS ANTES DE CRIAR UMA NOVA ASSINATURA
       //
       // Procura assinatura ACTIVE desta loja.
       // ============================================================

       console.info('finance_event',{"file":"legacyCore.js","line":1217});

       const subscriptionsRes =
         await readFinancialList(
           `${resolveAsaasConfig().baseUrl}/subscriptions`,
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

       if (!Array.isArray(subscriptionsRes.data?.data) || subscriptionsRes.data.hasMore !== false ||
           activeSubscriptions.some(s => !s?.id || s.customer !== customerId || s.externalReference !== storeId || s.status !== "ACTIVE") ||
           activeSubscriptions.length > 1) {
         throw new HttpsError("failed-precondition", "Listagem financeira incompleta ou ambigua. Nenhuma criacao permitida.");
       }

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

         // Nao substituir automaticamente um ID ja registrado por outro.
         const storedSubscriptionId = String(
           storeData.asaasSubscriptionId || ""
         ).trim();
         if (storedSubscriptionId &&
             storedSubscriptionId !== String(existingSubscription.id)) {
           throw new HttpsError(
             "failed-precondition",
             "Assinatura divergente: reconciliacao manual necessaria."
           );
         }

         if (
           activeSubscriptions.length > 1
         ) {
           console.info('finance_event',{"file":"legacyCore.js","line":1313});

           console.info('finance_event',{"file":"legacyCore.js","line":1317});

           console.info('finance_event',{"file":"legacyCore.js","line":1321});
         }

          // ----------------------------------------------------------
          // Existing billing type is preserved; changes require a separate command.
         await storeRef.update({
           ...stampAsaasBindingOrigin(asaasConfig),
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
           await readFinancialList(
             `${resolveAsaasConfig().baseUrl}/payments`,
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
         // Only an outstanding official payment is suitable for this flow.
         if (!Array.isArray(paymentsRes.data?.data) || paymentsRes.data.hasMore !== false ||
             payments.some(p => p.subscription !== existingSubscription.id || p.customer !== customerId)) {
           throw new HttpsError("failed-precondition", "Cobrancas sem identidade conclusiva; nenhum novo pagamento permitido.");
         }
         const payment =
           payments.find(
             (p) => p.status === "OVERDUE"
           ) ||
           payments.find(
             (p) => p.status === "PENDING"
           );

         const paymentLink =
           payment?.invoiceUrl ||
           payment?.billUrl ||
           null;

         // Looking up an existing invoice must not change recurring prices.
         const priceSync = {skipped: true, reason: "explicit_plan_change_required"};

         return {
           success: true,
           alreadyExists: true,
           priceSyncStatus: priceSync.skipped ? priceSync.reason : "completed",
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

       // Nao criar nova assinatura apenas porque a anterior nao aparece ACTIVE.
       if (storeData.asaasSubscriptionId) {
         throw new HttpsError(
           "failed-precondition",
           "Assinatura anterior requer verificacao antes de uma nova cobranca."
         );
       }

       console.info('finance_event',{"file":"legacyCore.js","line":1432});

       const nextDueDate =
         new Date();

       const dueDateString =
         nextDueDate
           .toISOString()
           .split("T")[0];

       const subResponse =
         await axios.post(
           `${resolveAsaasConfig().baseUrl}/subscriptions`,
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

       console.info('finance_event',{"file":"legacyCore.js","line":1466});

       // ============================================================
       // 7. SALVA IMEDIATAMENTE O ID
       //
       // Fazemos isso antes de esperar boleto.
       // ============================================================

       await storeRef.update({
         ...stampAsaasBindingOrigin(asaasConfig),
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

       console.info('finance_event',{"file":"legacyCore.js","line":1505});

       // ============================================================
       // 8. BUSCA LINK DA PRIMEIRA COBRANÇA
       //
       // Reduzi o loop para não encostar no timeout de 120s.
       //
       // 20 tentativas x 3s = no máximo ~60 segundos de espera.
       // ============================================================

       let finalPaymentLink =
         null;

       console.info('finance_event',{"file":"legacyCore.js","line":1520});

       for (
         let i = 1;
         i <= 20;
         i++
       ) {
         const payments =
           await readFinancialList(
             `${resolveAsaasConfig().baseUrl}/payments`,
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
             payments.data.data.find(p => p.status === "PENDING" || p.status === "OVERDUE");

           if (payments.data.data.some(p => p.subscription !== subscriptionId || p.customer !== customerId ||
               (p.externalReference && p.externalReference !== storeId))) {
             throw new HttpsError("failed-precondition", "Identidade da cobranca inconclusiva.");
           }

           const linkGerado =
             payment?.invoiceUrl ||
             payment?.billUrl;

           if (linkGerado) {
             finalPaymentLink =
               linkGerado;

             console.info('finance_event',{"file":"legacyCore.js","line":1562});

             break;
           }
         }

         console.info('finance_event',{"file":"legacyCore.js","line":1570});

         await delay(3000);
       }

       // ============================================================
       // 9. A ASSINATURA JÁ EXISTE MESMO SE O LINK ATRASAR
       //
       // Não apagamos a assinatura e não permitimos criar outra.
       // ============================================================

       if (!finalPaymentLink) {
         console.info('finance_event',{"file":"legacyCore.js","line":1584});

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
       console.info('finance_event',{"file":"legacyCore.js","line":1619});

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

           console.info('finance_event',{"file":"legacyCore.js","line":1643});
         } catch (unlockError) {
           console.info('finance_event',{"file":"legacyCore.js","line":1647});
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
exports.checkOverdueSubscriptions = onSchedule(
    {
      schedule: "0 2 * * *",
      timeZone: "America/Sao_Paulo",
      timeoutSeconds: 120
    },
    async (event) => {
      console.info('finance_event',{"file":"legacyCore.js","line":1677});

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
          console.info('finance_event',{"file":"legacyCore.js","line":1830});

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

          // P2.6.4: origem comprovada antes de qualquer bloqueio. PROD
          // continua fechado globalmente; futura admissao exige grant backend.
          const admission = await checkStoreFinancialAdmission({
            db, storeId, storeData, config: resolveAsaasConfig(),
            operation: "subscription.overdue",
          });
          if (!admission.allowed) {
            skippedCount++;
            console.info('finance_event',{"file":"legacyCore.js","line":1870});
            continue;
          }


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

            console.info('finance_event',{"file":"legacyCore.js","line":1900});

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

            console.info('finance_event',{"file":"legacyCore.js","line":1923});

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

            console.info('finance_event',{"file":"legacyCore.js","line":1948});

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

              subscriptionInactiveReason: "overdue",

              blockedAt:
                admin.firestore
                  .FieldValue
                  .serverTimestamp()
            }
          );


          blockedCount++;


          console.info('finance_event',{"file":"legacyCore.js","line":1984});
        }


        if (
          blockedCount > 0
        ) {
          await batch.commit();
        }


        console.info('finance_event',{"file":"legacyCore.js","line":2000});

      } catch (error) {

        console.info('finance_event',{"file":"legacyCore.js","line":2009});

        throw error;
      }
    }
  );
exports.changeAsaasPlan = onCall(
  { timeoutSeconds: 60, secrets: [asaasApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Usuário não logado."
      );
    }

    const asaasConfig = resolveAsaasConfig();
    const ASAAS_API_KEY = getAsaasApiKey();
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

    // Antes do downgrade ou da alteracao de plano.
    assertAsaasBindingOrigin(storeData, asaasConfig);

    await assertStoreFinancialAdmission({
      db, storeId, storeData, config: asaasConfig,
      operation: "subscription.change-plan",
    });

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

      console.info('finance_event',{"file":"legacyCore.js","line":2153});

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
          await syncExistingSubscriptionPrice({
            storeId,

            subscriptionId,

            plan:
              currentPlan,
          });

        if (syncResult.skipped) {
          return {
            success: true, alreadyOnPlan: true, plan: currentPlan, subscriptionId,
            priceUpdated: false, priceVerified: false,
            priceSyncStatus: syncResult.reason,
            message: "A loja ja esta neste plano. O preco nao foi verificado nem alterado; sincronizacao automatica desabilitada em PROD.",
          };
        }

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
        console.info('finance_event',{"file":"legacyCore.js","line":2242});

        throw new HttpsError(
          "internal",
          "A loja já está neste plano, mas não foi possível verificar o valor da assinatura no Asaas."
        );
      }
    }

    const selectedPlan =
      SUBSCRIPTION_PLANS[newPlan];

    const headers = {
      access_token: ASAAS_API_KEY,
      "Content-Type": "application/json",
      "User-Agent":
        "StoreConnectApp/1.0",
    };

    try {
      console.info('finance_event',{"file":"legacyCore.js","line":2267});

      console.info('finance_event',{"file":"legacyCore.js","line":2271});

      console.info('finance_event',{"file":"legacyCore.js","line":2275});

      console.info('finance_event',{"file":"legacyCore.js","line":2279});

      // ----------------------------------------------------------
      // 4. CONFIRMA QUE A ASSINATURA EXISTE NO ASAAS
      // ----------------------------------------------------------

      const currentSubscription =
        await axios.get(
          `${resolveAsaasConfig().baseUrl}/subscriptions/${subscriptionId}`,
          { headers }
        );

      if (
        !currentSubscription.data ||
        currentSubscription.data.deleted === true ||
        currentSubscription.data.id !== subscriptionId ||
        currentSubscription.data.customer !== storeData.asaasCustomerId ||
        currentSubscription.data.externalReference !== storeId
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
          `${resolveAsaasConfig().baseUrl}/subscriptions/${subscriptionId}`,
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

      console.info('finance_event',{"file":"legacyCore.js","line":2329});

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

      console.info('finance_event',{"file":"legacyCore.js","line":2350});

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
      console.info('finance_event',{"file":"legacyCore.js","line":2379});

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
exports.createAsaasSubscriptionLegacy=createAsaasSubscriptionLegacy;
