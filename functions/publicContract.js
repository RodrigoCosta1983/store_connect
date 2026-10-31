'use strict';
const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const {authorize,runSubscriptionAttempt,readSubscriptionState}=require('./financeiro/subscriptionAttempt');
const {classifyAsaasBindingOrigin}=require('./financeiro/asaasBindingOrigin');
const {assertStoreFinancialAdmission}=require('./financeiro/storeFinancialAdmission');
async function canonicalRequest(db,request){
 if(!request.auth?.uid)throw new HttpsError('unauthenticated','Autenticacao necessaria.');
 if(request.auth.token?.firebase?.tenant)throw new HttpsError('permission-denied','Conta nao autorizada neste ambiente.');
 const input=request.data;
 if(input!=null&&(typeof input!=='object'||Array.isArray(input)))throw new HttpsError('invalid-argument','Pedido invalido.');
 const profile=await db.collection('users').doc(request.auth.uid).get();
 const storeId=input?.storeId??profile.data()?.storeId;
 return {...request,data:{...input,storeId}};
}
function safePaymentUrl(value){let u;try{u=new URL(value);}catch{throw new HttpsError('failed-precondition','Fatura indisponivel.');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||/sandbox/i.test(u.hostname)||!(u.hostname==='asaas.com'||u.hostname.endsWith('.asaas.com')))throw new HttpsError('failed-precondition','Fatura indisponivel.');return u.href;
}
function createPublicContract({db,FieldValue,config,getKey,legacy,portal}){
 return async request=>{
  const c=config();getKey();
  const r=await canonicalRequest(db(),request),owner=await authorize(db(),c,r,{write:true});
  if(owner.store.asaasCustomerId&&owner.store.asaasSubscriptionId){
   const invoice=await portal(r);
   return {success:true,alreadyExists:true,subscriptionId:owner.store.asaasSubscriptionId,paymentUrl:safePaymentUrl(invoice?.portalUrl)};
  }
  const fields=['schemaVersion','requestId','consentToContract'];
  const legacyInput=fields.every(k=>!Object.prototype.hasOwnProperty.call(r.data,k));
  if(legacyInput){
   // Deployed Web invokes the contract button without a nonce or checkbox.
   // Record that evidence accurately; stable identity prevents repeat creation.
   r.data={...r.data,schemaVersion:1,requestId:createHash('sha256').update(JSON.stringify([c.projectId,c.environment,owner.storeId,owner.uid,'first-contract-v1'])).digest('hex').slice(0,32),consentToContract:true};
  }
  return runSubscriptionAttempt({db:db(),FieldValue,config:c,request:r,consentEvidence:legacyInput?'authenticated_legacy_contract_invocation':'explicit_client_confirmation',execute:()=>legacy(r)});
 };
}
async function publicState({db,config,request}){
 const r=await canonicalRequest(db,request),c=config();
 const result=await readSubscriptionState({db,config:c,request:r});
 if(result.canStart){const o=await authorize(db,c,r);const origin=classifyAsaasBindingOrigin(o.store,c);
  try{if(!origin.allowed)throw Error('origin');await assertStoreFinancialAdmission({db,config:c,storeId:o.storeId,storeData:o.store,operation:'subscription.create'});}catch{result.canStart=false;}
 }return result;
}
module.exports={canonicalRequest,safePaymentUrl,createPublicContract,publicState};
