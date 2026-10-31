"use strict";
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const project='demo-store-connect-android04';
assert.equal(process.env.GCLOUD_PROJECT,project);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8194');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9194');
const admin=require('firebase-admin');if(!admin.apps.length)admin.initializeApp({projectId:project});
const db=admin.firestore();const {seedAdmission}=require('./storeWriterAdmissionFixture.cjs');
async function fixture() {
 const response=await fetch('http://127.0.0.1:9194/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-only',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`c08-${randomUUID()}@example.invalid`,password:'synthetic-only-password',returnSecureToken:true})});
 assert.equal(response.status,200);const auth=await response.json(),uid=auth.localId,storeId='c08-'+uid;
 const store=db.collection('stores').doc(storeId);
 await db.collection('users').doc(uid).set({storeId,role:'caixa'});await store.set({subscriptionStatus:'active'});
 await store.collection('customers').doc('c').set({name:'Synthetic Customer'});
 await store.collection('products').doc('p').set({name:'Synthetic Product',price:100,quantidade:5,
  lotes:[{quantidade:3,validade:admin.firestore.Timestamp.fromMillis(1900000000000),history:'keep'},
   {quantidade:2,validade:admin.firestore.Timestamp.fromMillis(2000000000000),history:'later'}]});
 await seedAdmission(db,storeId,'legacy');
 const id=randomUUID(),scope={projectId:project,uid,storeId};
 const deferred={schemaVersion:1,requestId:id,saleId:id,scope,items:[{productId:'p',quantity:1,expectedUnitPriceCents:10000}],
  expectedTotalCents:10000,customerId:'c',notes:'credit',installmentCount:3,firstDueDate:'2032-01-31',utcOffsetMinutes:-180};
 const cash={schemaVersion:1,requestId:randomUUID(),scope,amountCents:1250,type:'Entrada',category:'Ajuste',reason:'Synthetic manual entry',occurredAtMs:Date.now()};
 return {auth,store,scope,deferred,cash};
}
async function call(f,endpoint,command,options={}) {
 const jwt=[Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url'),
  Buffer.from(JSON.stringify({sub:'synthetic-app',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),''].join('.');
 const headers={'Content-Type':'application/json'};
 if(options.auth!==false)headers.Authorization='Bearer '+f.auth.idToken;
 if(options.appCheck!==false)headers['X-Firebase-AppCheck']=jwt;
 const response=await fetch(`http://127.0.0.1:5194/${project}/us-central1/${endpoint}`,{method:'POST',headers,body:JSON.stringify({data:command})});
 return {status:response.status,body:await response.json()};
}
async function state(f) {
 const [product,sales,cash,receipts]=await Promise.all([f.store.collection('products').doc('p').get(),
  f.store.collection('sales').get(),f.store.collection('cash_flow').get(),f.store.collection('auditLogs').get()]);
 return {product:product.data(),sales:sales.docs.map(d=>({id:d.id,...d.data()})),cash:cash.docs.map(d=>({id:d.id,...d.data()})),receipts:receipts.size};
}
module.exports={project,admin,db,fixture,call,state};
