'use strict';
const {authenticateAsaasWebhook}=require('./financeiro/asaasWebhookAuth');
const {resolveAsaasConfig}=require('./financeiro/asaasConfig');
const {getAsaasApiKey}=require('./financeiro/asaasSecrets');
const {classifyAsaasBindingOrigin}=require('./financeiro/asaasBindingOrigin');
const {checkStoreFinancialAdmission}=require('./financeiro/storeFinancialAdmission');
const provider=require('./financeiro/provider');
function publicWebhook({db,handler}){return async(req,res)=>{
 if(req.method!=='POST')return res.status(405).send('Method Not Allowed');
 const authenticated=authenticateAsaasWebhook(req);if(authenticated!==200)return res.status(authenticated).send('Webhook unavailable');
 try{
  const config=resolveAsaasConfig();if(!config.operationsEnabled)return res.status(503).send('Webhook unavailable');
  let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return res.status(400).send('Invalid event');}
  if(!body||typeof body.event!=='string')return res.status(400).send('Invalid event');
  const entity=body.payment||body.subscription,sub=body.payment?.subscription||body.subscription?.id;
  if(typeof sub!=='string'||!/^sub_[A-Za-z0-9_-]+$/.test(sub))return res.json({received:true,status:'ignored_missing_official_subscription'});
  const bindings=await db().collection('stores').where('asaasSubscriptionId','==',sub).limit(2).get();
  if(bindings.empty)return res.json({received:true,status:'ignored_no_official_binding'});
  if(bindings.size!==1)return res.status(503).send('Binding uniqueness requires review');
  const snap=bindings.docs[0],store=snap.data();
  if(!classifyAsaasBindingOrigin(store,config).allowed)return res.json({received:true,status:'ignored_unverified_binding_origin'});
  if(!entity||entity.customer!==store.asaasCustomerId||(entity.externalReference&&entity.externalReference!==snap.id))return res.json({received:true,status:'ignored_identity_mismatch'});
  if(!(await checkStoreFinancialAdmission({db:db(),storeId:snap.id,storeData:store,config,operation:'subscription.webhook'})).allowed)return res.status(503).send('Financial admission denied');
  // Signed deletion references the exact current persisted subscription. Other
  // events additionally prove their current official provider identity.
  if(body.event!=='SUBSCRIPTION_DELETED'){
   const headers={access_token:getAsaasApiKey(),'User-Agent':'StoreConnectApp/1.0'};
   const official=(await provider.get(config.baseUrl+'/subscriptions/'+sub,{headers})).data;
   if(official?.id!==sub||official.customer!==store.asaasCustomerId||official.externalReference!==snap.id)return res.status(503).send('Official identity requires review');
   if(['PAYMENT_CONFIRMED','PAYMENT_RECEIVED'].includes(body.event)&&(official.deleted===true||official.status!=='ACTIVE'))return res.status(503).send('Subscription status requires review');
   if(body.payment){
    if(typeof entity.id!=='string'||!/^pay_[A-Za-z0-9_-]+$/.test(entity.id))return res.status(400).send('Invalid payment');
    const paid=(await provider.get(config.baseUrl+'/payments/'+entity.id,{headers})).data;
    if(paid?.id!==entity.id||paid.subscription!==sub||paid.customer!==store.asaasCustomerId||(paid.externalReference&&paid.externalReference!==snap.id))return res.status(503).send('Official payment requires review');
    if(['PAYMENT_CONFIRMED','PAYMENT_RECEIVED'].includes(body.event)&&(!['CONFIRMED','RECEIVED','RECEIVED_IN_CASH'].includes(paid.status)||Number(paid.value)!==Number(entity.value)))return res.status(503).send('Payment confirmation requires review');
   }
  }
  return handler(req,res);
 }catch{return res.status(503).send('Webhook unavailable');}
};}
module.exports={publicWebhook};
