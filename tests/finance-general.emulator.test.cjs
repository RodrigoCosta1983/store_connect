'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),https=require('node:https');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8198');assert.equal(process.env.GCLOUD_PROJECT,'demo-store-connect-finance-general');
// All provider traffic is synthetic. The only real connection is Firestore loopback.
https.request=()=>{throw Error('External HTTP forbidden in financial tests');};
const root=path.join(__dirname,'../functions'),local=f=>require(path.join(root,f));
const testDeps=require('node:module').createRequire(path.join(root,'package.json'));
const admin=local('node_modules/firebase-admin');admin.initializeApp({projectId:process.env.GCLOUD_PROJECT});const db=admin.firestore();
const config={projectId:'store-connect-app',environment:'production',operationsEnabled:true,publicRollout:true,baseUrl:'https://api.asaas.com/v3'};
const configPath=require.resolve(path.join(root,'financeiro/asaasConfig'));const realConfig=local('financeiro/asaasConfig');
require.cache[configPath].exports={resolveAsaasConfig:()=>config};
const secrets=local('financeiro/asaasSecrets');secrets.getAsaasApiKey=()=>{if(keyError)throw Error('credential_unavailable');return 'synthetic-test-only';};secrets.getAsaasWebhookToken=()=> 'synthetic-webhook-only';
let keyError=false,calls=[],scenario={},sequence=0;
const axios=local('node_modules/axios');axios.request=async options=>{
 assert.equal(new URL(options.url).origin,'https://api.asaas.com');assert.equal(options.maxRedirects,0);assert.equal(options.timeout,25000);
 calls.push({method:options.method,path:new URL(options.url).pathname,params:options.params||{},data:options.data});
 if(scenario.failure)throw {response:{status:scenario.failure,data:{secret:'never expose'}},config:{headers:{access_token:'never expose'}}};
 const p=new URL(options.url).pathname,method=options.method,params=options.params||{};
 if(scenario.transport)return scenario.transport(options);
 if(method==='GET'&&p==='/v3/customers')return page(scenario.customers||[],params);
 if(method==='POST'&&p==='/v3/customers'){scenario.customer={...options.data,id:'cus_synthetic'+sequence};return {data:scenario.customer};}
 if(method==='GET'&&p.startsWith('/v3/customers/'))return {data:scenario.customer};
 if(method==='GET'&&p==='/v3/subscriptions')return page(scenario.subscriptions||[],params);
 if(method==='POST'&&p==='/v3/subscriptions'){scenario.subscription={...options.data,id:'sub_synthetic'+sequence,status:'ACTIVE'};return {data:scenario.subscription};}
 if(method==='GET'&&p.startsWith('/v3/subscriptions/'))return {data:scenario.subscription};
 if(method==='PUT'&&p.startsWith('/v3/subscriptions/')){scenario.subscription={...scenario.subscription,...options.data};return {data:scenario.subscription};}
 if(method==='GET'&&p==='/v3/payments'){
  const customer=scenario.subscription?.customer||scenario.customer?.id;
  const sub=scenario.subscription?.id;
  const all=scenario.payments||[{id:'pay_synthetic'+sequence,customer,subscription:sub,externalReference:scenario.storeId,status:'PENDING',dueDate:'2026-11-15',value:39.9,invoiceUrl:'https://www.asaas.com/i/synthetic'}];
  return page(params.status?all.filter(p=>p.status===params.status):all,params);
 }
 if(method==='GET'&&p.startsWith('/v3/payments/'))return {data:(scenario.payments||[]).find(x=>p.endsWith('/'+x.id))};
 throw Error('Unexpected synthetic provider call '+method+' '+p);
};
function page(all,params){const offset=params.offset||0,limit=params.limit||100;return {data:{data:all.slice(offset,offset+limit),totalCount:all.length,hasMore:offset+limit<all.length,offset,limit}};}
const fns=local('index'),{createPublicContract,publicState,safePaymentUrl}=local('publicContract'),{attemptRef}=local('financeiro/subscriptionAttempt');
const {checkStoreFinancialAdmission}=local('financeiro/storeFinancialAdmission');
const {runAsaasBillingReconciliation}=local('financeiro/reconcileAsaasBilling');
async function fixture(extra={},profile={}){
 sequence++;calls=[];keyError=false;scenario={};const storeId='synthetic-store-'+sequence,uid='synthetic-owner-'+sequence;
 const store={ownerId:uid,name:'Synthetic store',phone:'00000000000',document:String(10000000000+sequence),subscriptionStatus:'trial',subscriptionType:'free',...extra};
 await db.collection('users').doc(uid).set({storeId,role:'admin',email:'synthetic@example.invalid',...profile});await db.collection('stores').doc(storeId).set(store);
 scenario.storeId=storeId;
 return {storeId,uid,store,request:{auth:{uid,token:{email:'synthetic@example.invalid'}},data:{storeId}},ref:db.collection('stores').doc(storeId)};
}
async function bound(extra={},profile={}){
 const f=await fixture({subscriptionStatus:'active',subscriptionType:'business',subscriptionPlanPrice:99.9,nextDueDate:'2026-11-15',asaasBindingEnvironment:'production',asaasBindingProjectId:'store-connect-app',...extra},profile);
 const ids={asaasCustomerId:'cus_synthetic'+sequence,asaasSubscriptionId:'sub_synthetic'+sequence};await f.ref.update(ids);Object.assign(f.store,ids);
 scenario.customer={id:ids.asaasCustomerId,cpfCnpj:f.store.document,externalReference:f.storeId};
 scenario.subscription={id:ids.asaasSubscriptionId,customer:ids.asaasCustomerId,externalReference:f.storeId,status:'ACTIVE',value:99.9,nextDueDate:'2026-11-15'};
 return f;
}
const snapshot=async f=>(await f.ref.get()).data();
const writes=()=>calls.filter(x=>x.method!=='GET');
async function webhook(f,event='PAYMENT_RECEIVED',overrides={},token='synthetic-webhook-only'){
 const payment={id:'pay_synthetic'+sequence,subscription:f.store.asaasSubscriptionId,customer:f.store.asaasCustomerId,externalReference:f.storeId,status:event==='PAYMENT_OVERDUE'?'OVERDUE':'RECEIVED',value:99.9,dueDate:'2026-11-15',...overrides};
 scenario.payments=scenario.payments||[payment];
 const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;},setHeader(){}};
 const req={method:'POST',headers:{},body:{id:'evt_synthetic'+sequence,event,payment},get:n=>n==='asaas-access-token'?token:undefined};
 await fns.asaasWebhook(req,res);return res;
}
after(async()=>{await db.terminate();await admin.app().delete();});
test('runtime rejects wrong projects, Sandbox credential, emulator and conflicting project IDs',()=>{
 const names=['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','ASAAS_ENV','ASAAS_CREDENTIAL_ENV','ASAAS_PROD_MODE','ASAAS_PROD_READS','FUNCTIONS_EMULATOR','FIRESTORE_EMULATOR_HOST'];const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 try{for(const k of names)delete process.env[k];Object.assign(process.env,{GCLOUD_PROJECT:'store-connect-app',ASAAS_ENV:'production',ASAAS_CREDENTIAL_ENV:'production',ASAAS_PROD_MODE:'public',ASAAS_PROD_READS:'enabled'});
  assert.equal(realConfig.resolveAsaasConfig().operationsEnabled,true);
  for(const [key,value]of [['GCLOUD_PROJECT','store-connect-hml'],['GOOGLE_CLOUD_PROJECT','wrong-project'],['ASAAS_ENV','sandbox'],['ASAAS_CREDENTIAL_ENV','sandbox'],['FUNCTIONS_EMULATOR','true'],['FIRESTORE_EMULATOR_HOST','127.0.0.1:8198']]){const old=process.env[key];process.env[key]=value;assert.throws(()=>realConfig.resolveAsaasConfig());if(old===undefined)delete process.env[key];else process.env[key]=old;}
  process.env.ASAAS_PROD_MODE='pilot';assert.equal(realConfig.resolveAsaasConfig().operationsEnabled,false);
 }finally{for(const k of names)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
});
test('exactly nine financial exports; no commerce, trial, F9 or F10 exports',()=>{assert.deepEqual(Object.keys(fns).sort(),['createAsaasSubscription','getAsaasSubscriptionStateV1','getAsaasPortalUrl','listAsaasInvoices','changeAsaasPlan','asaasWebhook','reconcileAsaasBilling','checkOverdueSubscriptions','syncAsaasSubscriptionPrices'].sort());});
test('new legacy Web request creates one canonical customer and Pro monthly subscription',async()=>{
 const f=await fixture();f.request.data={name:'Spoofed',email:'spoofed@example.invalid',phone:'x',value:0.01};
 const result=await fns.createAsaasSubscription.run(f.request);assert.equal(result.success,true);assert.equal(result.price,39.9);
 const w=writes();assert.deepEqual(w.map(x=>x.path),['/v3/customers','/v3/subscriptions']);assert.equal(w[0].data.name,'Synthetic store');assert.equal(w[0].data.email,'synthetic@example.invalid');assert.equal(w[1].data.value,39.9);assert.equal(w[1].data.cycle,'MONTHLY');assert.equal(w[1].data.externalReference,f.storeId);
 const store=await snapshot(f);assert.equal(store.asaasBindingEnvironment,'production');assert.equal(store.asaasBindingProjectId,'store-connect-app');assert.equal(store.subscriptionStatus,'pending');
 const record=(await attemptRef(db,config,f.storeId).get()).data();assert.equal(record.status,'completed');assert.equal(record.consentEvidence,'authenticated_legacy_contract_invocation');
 await fns.createAsaasSubscription.run(f.request);assert.equal(writes().length,2);
});
test('concurrent first-contract requests execute the original financial core once',async()=>{
 const f=await fixture();const results=await Promise.allSettled([fns.createAsaasSubscription.run(f.request),fns.createAsaasSubscription.run(f.request),fns.createAsaasSubscription.run(f.request)]);
 assert.ok(results.some(x=>x.status==='fulfilled'));assert.equal(writes().filter(x=>x.path==='/v3/subscriptions').length,1);
});
test('lost provider response remains needs_review; same and changed identities never resend',async()=>{
 const f=await fixture();let sent=0;
 const handler=createPublicContract({db:()=>db,FieldValue:admin.firestore.FieldValue,config:()=>config,getKey:()=>{},portal:async()=>{},legacy:async()=>{sent++;throw Error('Synthetic accepted but reply lost');}});
 await assert.rejects(handler(f.request),{code:'failed-precondition'});await assert.rejects(handler(f.request),{code:'failed-precondition'});
 f.request.data={...f.request.data,schemaVersion:1,requestId:'b'.repeat(32),consentToContract:true};await assert.rejects(handler(f.request),{code:'failed-precondition'});assert.equal(sent,1);assert.equal((await attemptRef(db,config,f.storeId).get()).data().status,'needs_review');
});
test('modern contract explicitly records consent and completed result replays without execution',async()=>{
 const f=await fixture();let count=0;Object.assign(f.request.data,{schemaVersion:1,requestId:'a'.repeat(32),consentToContract:true});
 const h=createPublicContract({db:()=>db,FieldValue:admin.firestore.FieldValue,config:()=>config,getKey:()=>{},legacy:async()=>{count++;return {success:true,subscriptionId:'sub_result'};},portal:async()=>{}});
 assert.deepEqual(await h(f.request),await h(f.request));assert.equal(count,1);assert.equal((await attemptRef(db,config,f.storeId).get()).data().consentEvidence,'explicit_client_confirmation');
});
test('partial schema cannot fall back to legacy; explicit refusal never starts contract',async()=>{
 const f=await fixture();for(const input of [{requestId:'a'.repeat(32)},{schemaVersion:1,requestId:'a'.repeat(32),consentToContract:false},{schemaVersion:1,requestId:'bad',consentToContract:true}]){
 f.request.data={storeId:f.storeId,...input};await assert.rejects(fns.createAsaasSubscription.run(f.request),{code:'failed-precondition'});}
 assert.equal((await attemptRef(db,config,f.storeId).get()).exists,false);assert.equal(calls.length,0);
});
test('bound Business pilot contract invocation only reads existing invoice; preserves access, price and due date',async()=>{
 const f=await bound(),before=await snapshot(f);const r=await fns.createAsaasSubscription.run(f.request);assert.equal(r.alreadyExists,true);assert.equal(r.subscriptionId,f.store.asaasSubscriptionId);assert.equal(writes().length,0);assert.deepEqual(await snapshot(f),before);assert.equal((await attemptRef(db,config,f.storeId).get()).exists,false);
});
test('Sandbox, unmarked and partially marked bindings never invoke provider or create attempts',async()=>{
 for(const extra of [{asaasBindingEnvironment:'sandbox',asaasBindingProjectId:'store-connect-hml'},{asaasBindingEnvironment:admin.firestore.FieldValue.delete(),asaasBindingProjectId:admin.firestore.FieldValue.delete()},{asaasBindingEnvironment:'production',asaasBindingProjectId:admin.firestore.FieldValue.delete()}]){
 const f=await bound();await f.ref.update(extra);await assert.rejects(fns.createAsaasSubscription.run(f.request),{code:'failed-precondition'});assert.equal(calls.length,0);assert.equal((await attemptRef(db,config,f.storeId).get()).exists,false);
 }
});
test('foreign owner, revoked profile, missing auth, tenant and cross-store requests fail',async()=>{
 const f=await fixture();await assert.rejects(fns.createAsaasSubscription.run({data:f.request.data}),{code:'unauthenticated'});
 await assert.rejects(fns.createAsaasSubscription.run({...f.request,auth:{uid:'foreign'}}),{code:'permission-denied'});
 await assert.rejects(fns.createAsaasSubscription.run({...f.request,auth:{...f.request.auth,token:{firebase:{tenant:'foreign'}}}}),{code:'permission-denied'});
 await db.collection('users').doc(f.uid).update({accessStatus:'revoked'});await assert.rejects(fns.createAsaasSubscription.run(f.request),{code:'permission-denied'});assert.equal(calls.length,0);
});
test('explicit backend denial stays effective during public rollout',async()=>{
 const f=await fixture();await db.collection('asaasFinancialAdmission').doc(f.storeId).set({schemaVersion:1,enabled:false,storeId:f.storeId,environment:'production',projectId:'store-connect-app',operations:['subscription.create']});
 await assert.rejects(fns.createAsaasSubscription.run(f.request),{code:'failed-precondition'});assert.equal(calls.length,0);
});
test('credential unavailable does not reserve or modify a store',async()=>{
 const f=await fixture(),before=await snapshot(f);keyError=true;await assert.rejects(fns.createAsaasSubscription.run(f.request));keyError=false;assert.equal((await attemptRef(db,config,f.storeId).get()).exists,false);assert.deepEqual(await snapshot(f),before);
});
test('state query is read-only and respects denied admission; returns no payment identifiers',async()=>{
 const f=await fixture();const before=await snapshot(f);let r=await publicState({db,config:()=>config,request:f.request});assert.equal(r.canStart,true);assert.equal(r.authority,'firestore_only');
 await db.collection('asaasFinancialAdmission').doc(f.storeId).set({enabled:false});r=await publicState({db,config:()=>config,request:f.request});assert.equal(r.canStart,false);assert.equal(calls.length,0);assert.deepEqual(await snapshot(f),before);
 for(const key of ['asaasCustomerId','asaasSubscriptionId','paymentUrl','document'])assert.equal(Object.hasOwn(r,key),false);
});
test('provider rejects Sandbox, arbitrary hosts, redirects, payments creation and pending invoice repricing',async()=>{
 const p=local('financeiro/provider');for(const [method,url,data]of [['GET','https://api-sandbox.asaas.com/v3/payments'],['GET','https://evil.invalid/v3/payments'],['GET','https://u:p@api.asaas.com/v3/payments'],['GET','https://api.asaas.com/v3/payments#redirect'],['DELETE','https://api.asaas.com/v3/subscriptions/sub_test'],['POST','https://api.asaas.com/v3/payments'],['PUT','https://api.asaas.com/v3/subscriptions/sub_test',{updatePendingPayments:true}]])assert.throws(()=>p.validate(method,url,data));
});
test('provider failures preserve only status and generic error, never original config or payload',async()=>{
 await fixture();scenario.failure=401;try{await local('financeiro/provider').get(config.baseUrl+'/subscriptions/sub_test');assert.fail();}catch(e){assert.equal(e.response.status,401);assert.equal(e.config,undefined);assert.ok(!JSON.stringify(e).includes('never expose'));}
});
test('readers reject foreign official subscription and invoice identity',async()=>{
 const f=await bound();scenario.subscription.customer='cus_foreign';await assert.rejects(fns.listAsaasInvoices.run(f.request),{code:'failed-precondition'});assert.equal(writes().length,0);
});
test('webhook rejects invalid token and cross-store identity without writes or provider calls',async()=>{
 const f=await bound(),before=await snapshot(f);let r=await webhook(f,'PAYMENT_RECEIVED',{},'wrong');assert.equal(r.statusCode,401);assert.equal(calls.length,0);
 r=await webhook(f,'PAYMENT_RECEIVED',{customer:'cus_foreign'});assert.equal(r.body.status,'ignored_identity_mismatch');assert.equal(calls.length,0);assert.deepEqual(await snapshot(f),before);
});
test('webhook requires a unique official binding and rejects Sandbox binding',async()=>{
 const f=await bound(),before=await snapshot(f);await db.collection('stores').doc('synthetic-duplicate-'+sequence).set(f.store);let r=await webhook(f);assert.equal(r.statusCode,503);assert.deepEqual(await snapshot(f),before);
 await db.collection('stores').doc('synthetic-duplicate-'+sequence).delete();await f.ref.update({asaasBindingEnvironment:'sandbox',asaasBindingProjectId:'store-connect-hml'});r=await webhook(f);assert.equal(r.body.status,'ignored_unverified_binding_origin');assert.equal(calls.length,0);
});
test('valid confirmed webhook activates its store only; duplicate delivery creates no provider writes',async()=>{
 const f=await bound({subscriptionStatus:'pending'});const other=await db.collection('stores').doc('unrelated-sentinel').get();
 let r=await webhook(f);assert.equal(r.statusCode,200);assert.equal((await snapshot(f)).subscriptionStatus,'active');await webhook(f);assert.equal(writes().length,0);assert.deepEqual((await db.collection('stores').doc('unrelated-sentinel').get()).data(),other.data());
});
test('paid event with another overdue invoice retains overdue state',async()=>{
 const f=await bound();scenario.transport=options=>{
 const p=new URL(options.url).pathname,params=options.params||{};
 if(p.includes('/subscriptions/'))return {data:scenario.subscription};
 if(p.includes('/payments/'))return {data:{id:'pay_synthetic'+sequence,subscription:f.store.asaasSubscriptionId,customer:f.store.asaasCustomerId,externalReference:f.storeId,status:'RECEIVED',value:99.9}};
 return page(params.status==='OVERDUE'?[{id:'pay_overdue',subscription:f.store.asaasSubscriptionId,customer:f.store.asaasCustomerId,externalReference:f.storeId,status:'OVERDUE',dueDate:'2026-10-01'}]:[],params);
 };
 const r=await webhook(f);assert.equal(r.statusCode,200);assert.equal((await snapshot(f)).subscriptionStatus,'overdue');assert.equal(writes().length,0);
});
test('provider unavailable webhook returns retryable failure and leaves access unchanged',async()=>{
 const f=await bound({subscriptionStatus:'pending'}),before=await snapshot(f);scenario.failure=503;const r=await webhook(f);assert.equal(r.statusCode,503);assert.deepEqual(await snapshot(f),before);
});
test('explicit upgrade updates the same subscription, never issued invoices',async()=>{
 const f=await bound({subscriptionType:'pro',subscriptionPlanPrice:39.9});scenario.subscription.value=39.9;const r=await fns.changeAsaasPlan.run({...f.request,data:{...f.request.data,plan:'business'}});
 assert.equal(r.success,true);assert.equal(writes().length,1);assert.equal(writes()[0].path,'/v3/subscriptions/'+f.store.asaasSubscriptionId);assert.equal(writes()[0].data.value,99.9);assert.equal(writes()[0].data.updatePendingPayments,undefined);assert.equal((await snapshot(f)).subscriptionType,'business');
});
test('downgrade stays scheduled; same-plan selection does not mass reprice',async()=>{
 const f=await bound();const r=await fns.changeAsaasPlan.run({...f.request,data:{...f.request.data,plan:'pro'}});assert.equal(r.downgradePending,true);assert.equal((await snapshot(f)).subscriptionType,'business');assert.equal((await snapshot(f)).pendingPlanChange,'pro');assert.equal(writes().length,0);
 const same=await fns.changeAsaasPlan.run({...f.request,data:{...f.request.data,plan:'business'}});assert.equal(same.priceUpdated,false);assert.equal(writes().length,0);
});
test('repricing scheduler performs no provider calls or writes',async()=>{
 await fixture();const r=await fns.syncAsaasSubscriptionPrices.run({});assert.equal(r.skipped,true);assert.equal(calls.length,0);
});
test('overdue scheduler blocks day four, preserves subscription and skips Sandbox',async()=>{
 const f=await bound({subscriptionStatus:'overdue',overdueDueDate:'2000-01-01'});const sandbox=await fixture({subscriptionStatus:'overdue',overdueDueDate:'2000-01-01',asaasSubscriptionId:'sub_sandbox',asaasCustomerId:'cus_sandbox',asaasBindingEnvironment:'sandbox',asaasBindingProjectId:'store-connect-hml'});
 await fns.checkOverdueSubscriptions.run({});assert.equal((await snapshot(f)).subscriptionStatus,'inactive');assert.equal((await snapshot(f)).asaasSubscriptionId,f.store.asaasSubscriptionId);assert.equal((await snapshot(sandbox)).subscriptionStatus,'overdue');assert.equal(writes().length,0);
});
test('trial expiry preserves paid Business and valid trial; expires only elapsed free trial',async()=>{
 const expired=await fixture({trialEndDate:'2000-01-01T00:00:00Z'}),valid=await fixture({trialEndDate:'2099-01-01T00:00:00Z'}),paid=await bound({trialEndDate:'2000-01-01T00:00:00Z'});
 await local('financeiro/expireTrials').expireTrials.run({});assert.equal((await snapshot(expired)).subscriptionStatus,'inactive');assert.equal((await snapshot(valid)).subscriptionStatus,'trial');assert.equal((await snapshot(paid)).subscriptionStatus,'active');assert.equal(calls.length,0);
});
test('reconciliation skips foreign binding and does not create or reprice contracts',async()=>{
 const f=await bound();await f.ref.update({asaasBindingEnvironment:'sandbox',asaasBindingProjectId:'store-connect-hml'});const before=await snapshot(f);
 const r=await runAsaasBillingReconciliation({targetStoreIds:[f.storeId]});assert.equal(r.skipped,1);assert.equal(calls.length,0);assert.deepEqual(await snapshot(f),before);
});
test('external billing URLs allow only HTTPS Asaas production',()=>{
 assert.equal(safePaymentUrl('https://www.asaas.com/i/synthetic'),'https://www.asaas.com/i/synthetic');for(const url of ['http://asaas.com/i/x','https://sandbox.asaas.com/i/x','https://asaas.com.evil.invalid/i/x','https://u:p@asaas.com/i/x','javascript:alert(1)'])assert.throws(()=>safePaymentUrl(url));
});
test('scheduled downgrade finishes after a Business payment even with no overdue invoices',async()=>{
 const f=await bound({pendingPlanChange:'pro'});const r=await webhook(f);assert.equal(r.statusCode,200);assert.equal((await snapshot(f)).subscriptionType,'pro');assert.equal((await snapshot(f)).pendingPlanChange,undefined);assert.equal(writes().length,1);assert.equal(writes()[0].data.value,39.9);assert.equal(writes()[0].data.updatePendingPayments,undefined);
 await webhook(f);assert.equal(writes().length,1);
});
test('scheduled downgrade also finishes with another overdue invoice and preserves overdue access',async()=>{
 const f=await bound({pendingPlanChange:'pro'});scenario.payments=[{id:'pay_synthetic'+sequence,subscription:f.store.asaasSubscriptionId,customer:f.store.asaasCustomerId,externalReference:f.storeId,status:'RECEIVED',value:99.9,dueDate:'2026-11-15'},{id:'pay_otherOverdue',subscription:f.store.asaasSubscriptionId,customer:f.store.asaasCustomerId,externalReference:f.storeId,status:'OVERDUE',value:99.9,dueDate:'2026-10-01'}];
 const r=await webhook(f);assert.equal(r.statusCode,200);const state=await snapshot(f);assert.equal(state.subscriptionType,'pro');assert.equal(state.subscriptionStatus,'overdue');assert.equal(writes().length,1);
});
test('different paid value does not prematurely complete a scheduled Business downgrade',async()=>{
 const f=await bound({pendingPlanChange:'pro'});const r=await webhook(f,'PAYMENT_RECEIVED',{value:39.9});assert.equal(r.statusCode,200);assert.equal((await snapshot(f)).subscriptionType,'business');assert.equal((await snapshot(f)).pendingPlanChange,'pro');assert.equal(writes().length,0);
});
test('downgrade provider failure stays pending and requests webhook retry',async()=>{
 const f=await bound({pendingPlanChange:'pro'});scenario.transport=options=>{
  const p=new URL(options.url).pathname;if(options.method==='PUT')throw {response:{status:503}};
  if(p.includes('/subscriptions/'))return {data:scenario.subscription};
  if(p.includes('/payments/'))return {data:scenario.payments[0]};
  return page([],options.params||{});
 };
 const r=await webhook(f);assert.equal(r.statusCode,503);assert.equal((await snapshot(f)).subscriptionType,'business');assert.equal((await snapshot(f)).pendingPlanChange,'pro');assert.equal(writes().length,1);
});
test('old paid event cannot reactivate a provider subscription that is no longer active',async()=>{
 const f=await bound({subscriptionStatus:'inactive'}),before=await snapshot(f);scenario.subscription.status='INACTIVE';const r=await webhook(f);assert.equal(r.statusCode,503);assert.deepEqual(await snapshot(f),before);assert.equal(writes().length,0);
});
test('second invoice page is read and foreign invoice causes the whole reader to reject',async()=>{
 const f=await bound();scenario.payments=Array.from({length:101},(_,i)=>({id:'pay_page'+i,customer:i===100?'cus_foreign':f.store.asaasCustomerId,subscription:f.store.asaasSubscriptionId,externalReference:f.storeId,status:'PENDING',dueDate:'2026-11-15',value:99.9,invoiceUrl:'https://asaas.com/i/synthetic'}));
 await assert.rejects(fns.listAsaasInvoices.run(f.request),{code:'failed-precondition'});assert.ok(calls.some(c=>c.path==='/v3/payments'&&c.params.offset===100));assert.equal(writes().length,0);
});
test('incomplete provider page cannot authorize a new subscription',async()=>{
 const f=await fixture();scenario.transport=()=>({data:{data:[],hasMore:false}});await assert.rejects(fns.createAsaasSubscription.run(f.request),{code:'failed-precondition'});assert.equal(writes().length,0);assert.equal((await attemptRef(db,config,f.storeId).get()).data().status,'needs_review');
});
test('same document customer from a different store is not reused; original policy creates an exclusive customer',async()=>{
 const f=await fixture();scenario.customers=[{id:'cus_foreign',cpfCnpj:f.store.document,externalReference:'different-store'}];const previous=structuredClone(scenario.customers);const r=await fns.createAsaasSubscription.run(f.request);assert.equal(r.success,true);assert.notEqual((await snapshot(f)).asaasCustomerId,'cus_foreign');assert.deepEqual(scenario.customers,previous);assert.equal(writes()[0].path,'/v3/customers');assert.equal(writes()[0].data.externalReference,f.storeId);assert.equal(writes().filter(c=>c.path==='/v3/subscriptions').length,1);
});
test('explicit upgrade rejects a subscription belonging to another customer before PUT',async()=>{
 const f=await bound({subscriptionType:'pro'}),before=await snapshot(f);scenario.subscription.customer='cus_foreign';await assert.rejects(fns.changeAsaasPlan.run({...f.request,data:{...f.request.data,plan:'business'}}));assert.equal(writes().length,0);assert.deepEqual(await snapshot(f),before);
});
test('reconciliation reads canonical provider state and preserves an active future-due Business store',async()=>{
 const f=await bound(),before=await snapshot(f);scenario.payments=[{id:'pay_future',subscription:f.store.asaasSubscriptionId,customer:f.store.asaasCustomerId,externalReference:f.storeId,status:'PENDING',dueDate:'2099-11-15',value:99.9}];scenario.subscription.nextDueDate='2099-11-15';
 const r=await runAsaasBillingReconciliation({targetStoreIds:[f.storeId]});assert.equal(r.errors,0);assert.equal((await snapshot(f)).subscriptionStatus,before.subscriptionStatus);assert.equal((await snapshot(f)).subscriptionPlanPrice,99.9);assert.equal(writes().length,0);
});
test('published rules keep private financial roots unreadable and unwritable to app clients',async()=>{
 const fs=require('node:fs'),{initializeTestEnvironment,assertFails}=testDeps('@firebase/rules-unit-testing'),{doc,getDoc,setDoc}=testDeps('firebase/firestore');
 const env=await initializeTestEnvironment({projectId:process.env.GCLOUD_PROJECT,firestore:{host:'127.0.0.1',port:8198,rules:fs.readFileSync(path.join(__dirname,'finance-migration-baseline/published-firestore.rules'),'utf8')}});
 try{const f=await fixture(),client=env.authenticatedContext(f.uid).firestore();
  for(const collection of ['asaasFinancialAdmission','asaasSubscriptionAttempts','asaasSubscriptionExecutionReceipts']){const r=doc(client,collection+'/synthetic-private');await assertFails(getDoc(r));await assertFails(setDoc(r,{enabled:true}));}
 }finally{await env.cleanup();}
});
test('published rules deny financial fields but preserve ordinary own-store editing',async()=>{
 const fs=require('node:fs'),{initializeTestEnvironment,assertFails,assertSucceeds}=testDeps('@firebase/rules-unit-testing'),{doc,updateDoc}=testDeps('firebase/firestore');
 const env=await initializeTestEnvironment({projectId:process.env.GCLOUD_PROJECT,firestore:{host:'127.0.0.1',port:8198,rules:fs.readFileSync(path.join(__dirname,'finance-migration-baseline/published-firestore.rules'),'utf8')}});
 try{const f=await fixture(),client=env.authenticatedContext(f.uid).firestore(),r=doc(client,'stores/'+f.storeId);
  for(const field of ['asaasCustomerId','asaasSubscriptionId','asaasBindingEnvironment','asaasBindingProjectId','subscriptionStatus','subscriptionType','subscriptionPlanPrice','nextDueDate','pendingPlanChange','ownerId'])await assertFails(updateDoc(r,{[field]:'forged'}));
  await assertSucceeds(updateDoc(r,{name:'Allowed ordinary name'}));
 }finally{await env.cleanup();}
});
