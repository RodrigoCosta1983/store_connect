'use strict';
const {setGlobalOptions}=require('firebase-functions/v2');
const {onCall,onRequest}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const admin=require('firebase-admin');
setGlobalOptions({region:'us-central1',serviceAccount:'294766590074-compute@developer.gserviceaccount.com'});
if(!admin.apps.length)admin.initializeApp({projectId:'store-connect-app'});
const {resolveAsaasConfig}=require('./financeiro/asaasConfig');
const {asaasApiKey,asaasWebhookToken,getAsaasApiKey}=require('./financeiro/asaasSecrets');
const {authorize}=require('./financeiro/subscriptionAttempt');
const {createPublicContract,canonicalRequest,publicState}=require('./publicContract');
const core=require('./legacyCore'),readers=require('./financeiro/faturas');
// Preserve the currently published Web/pilot callable App Check behavior.
// Auth, canonical owner and explicit binding-origin validation remain mandatory.
exports.createAsaasSubscription=onCall({timeoutSeconds:120,secrets:[asaasApiKey]},createPublicContract({db:()=>admin.firestore(),FieldValue:admin.firestore.FieldValue,config:resolveAsaasConfig,getKey:getAsaasApiKey,legacy:core.createAsaasSubscriptionLegacy,portal:readers.getAsaasPortalUrl.run}));
exports.getAsaasSubscriptionStateV1=onCall({enforceAppCheck:true},request=>publicState({db:admin.firestore(),config:resolveAsaasConfig,request}));
for(const name of ['getAsaasPortalUrl','listAsaasInvoices'])exports[name]=onCall({secrets:[asaasApiKey]},async request=>readers[name].run(await canonicalRequest(admin.firestore(),request)));
exports.changeAsaasPlan=onCall({timeoutSeconds:60,secrets:[asaasApiKey]},async request=>{
 const config=resolveAsaasConfig();getAsaasApiKey();const r=await canonicalRequest(admin.firestore(),request);
 await authorize(admin.firestore(),config,r);return core.changeAsaasPlan.run(r);
});
exports.asaasWebhook=onRequest({secrets:[asaasApiKey,asaasWebhookToken]},require('./webhookScope').publicWebhook({db:()=>admin.firestore(),handler:require('./financeiro/asaasWebhook').asaasWebhook}));
exports.reconcileAsaasBilling=require('./financeiro/reconcileAsaasBilling').reconcileAsaasBilling;
exports.checkOverdueSubscriptions=core.checkOverdueSubscriptions;
// Keep the existing PROD policy: no automatic mass repricing.
exports.syncAsaasSubscriptionPrices=onSchedule({schedule:'0 3 * * *',timeZone:'America/Sao_Paulo',timeoutSeconds:540},async()=>{
 const config=resolveAsaasConfig();if(!config.operationsEnabled)throw Error('operations_disabled');
 console.info('production_price_sync_disabled');return {skipped:true,updated:false,reason:'production_price_sync_disabled'};
});
