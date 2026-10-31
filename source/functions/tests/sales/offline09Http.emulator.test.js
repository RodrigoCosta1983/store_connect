"use strict";
const {test,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {admin,db,fixture,call,state}=require('./fixtures/commercial08Fixture.cjs');
after(async()=>{await db.terminate();await admin.app().delete();});
const command=f=>({schemaVersion:1,requestId:f.deferred.saleId,saleId:f.deferred.saleId,scope:f.scope,
 items:f.deferred.items,expectedTotalCents:10000,paymentMethod:'Dinheiro',notes:'offline',customerId:null,createdAtMs:Date.now()});
test('offline repeated/concurrent sync and lost-response query have one atomic FIFO debit and receipt',async()=>{
 const f=await fixture(),c=command(f);assert.equal((await call(f,'getOfflineSaleResultV1',c)).body.result.status,'not-recorded');
 const replies=await Promise.all(Array.from({length:5},()=>call(f,'syncOfflineSaleV1',c)));
 for(const r of replies)assert.equal(r.body.result.status,'confirmed');
 await f.store.collection('products').doc('p').update({price:500});
 await f.store.update({subscriptionStatus:'blocked'});
 const r=await call(f,'getOfflineSaleResultV1',c);assert.equal(r.body.result.replayed,true);
 const s=await state(f);assert.equal(s.sales.length,1);assert.equal(s.product.quantidade,4);
 assert.equal(s.product.lotes[0].quantidade,2);assert.equal(s.receipts,1);assert.equal(s.cash.length,0);
 assert.equal((await call(f,'syncOfflineSaleV1',{...c,notes:'changed'})).body.result.status,'identity-conflict');
});
test('stock and price changed offline produce durable rejection without stock/sale effects',async()=>{
 for(const patch of [{quantidade:0,lotes:[]},{price:101},{isArchived:true}]){
  const f=await fixture(),c=command(f);await f.store.collection('products').doc('p').update(patch);
  const result=(await call(f,'syncOfflineSaleV1',c)).body.result;assert.equal(result.status,'rejected');assert.ok(result.reason);
  await f.store.collection('products').doc('p').update({quantidade:5,lotes:[],price:100,isArchived:false});
  assert.deepEqual((await call(f,'getOfflineSaleResultV1',c)).body.result,{...result,replayed:true});
  assert.equal((await state(f)).sales.length,0);
 }
});
test('two distinct offline sales compete for stock with complete rollback for loser',async()=>{
 const f=await fixture(),a=command(f),id=randomUUID(),b={...a,requestId:id,saleId:id};
 await f.store.collection('products').doc('p').update({quantidade:1,lotes:[]});
 const r=await Promise.all([call(f,'syncOfflineSaleV1',a),call(f,'syncOfflineSaleV1',b)]);
 assert.deepEqual(r.map(x=>x.body.result.status).sort(),['confirmed','rejected']);
 const s=await state(f);assert.equal(s.sales.length,1);assert.equal(s.product.quantidade,0);
});
test('Auth, App Check, revoked user, changed store and foreign actor cannot sync/recover',async()=>{
 const f=await fixture(),c=command(f);
 assert.equal((await call(f,'syncOfflineSaleV1',c,{auth:false})).status,401);
 assert.equal((await call(f,'syncOfflineSaleV1',c,{appCheck:false})).status,401);
 await call(f,'syncOfflineSaleV1',c);
 await db.collection('users').doc(f.scope.uid).update({accessStatus:'revoked'});
 assert.equal((await call(f,'getOfflineSaleResultV1',c)).status,403);
 await db.collection('users').doc(f.scope.uid).update({accessStatus:'active',storeId:'other'});
 assert.equal((await call(f,'syncOfflineSaleV1',c)).status,403);
 const other=await fixture();assert.equal((await call(other,'getOfflineSaleResultV1',c)).status,403);
});
test('subscription and D1-D4 block fresh effects and committed recovery does not create new effects',async()=>{
 const f=await fixture(),c=command(f),ref=db.collection('storeWriterAdmission').doc(f.store.id);
 await f.store.update({subscriptionStatus:'blocked'});assert.equal((await call(f,'syncOfflineSaleV1',c)).status,400);
 await f.store.update({subscriptionStatus:'active'});await ref.update({mode:'draining'});
 assert.equal((await call(f,'syncOfflineSaleV1',c)).status,400);
 await ref.update({mode:'authoritative'});assert.equal((await call(f,'syncOfflineSaleV1',c)).body.result.status,'confirmed');
 await ref.update({mode:'draining',epoch:2});assert.equal((await call(f,'getOfflineSaleResultV1',c)).body.result.status,'confirmed');
 assert.equal((await state(f)).product.quantidade,4);
});
test('missing/invalid admission and deleted store fail closed without effects',async()=>{
 for(const mode of ['missing','invalid','store-deleted']){
  const f=await fixture(),c=command(f),ref=db.collection('storeWriterAdmission').doc(f.store.id);
  if(mode==='missing')await ref.delete();
  else if(mode==='invalid')await ref.update({policyRevision:'obsolete'});
  else await f.store.delete();
  assert.ok([400,403].includes((await call(f,'syncOfflineSaleV1',c)).status));
  const s=await state(f);assert.equal(s.sales.length,0);assert.equal(s.receipts,0);assert.equal(s.product.quantidade,5);
 }
});
test('legacy endpoint cannot produce new effects and historical rows stay recoverable without debit',async()=>{
 const f=await fixture();await f.store.update({ownerId:f.scope.uid});
 const c={storeId:f.store.id,localSaleId:'offline_legacy_09',totalAmount:100,
  products:[{productId:'p',name:'Synthetic',price:100,quantity:1}],paymentMethod:'Dinheiro',
  notes:'legacy',customerId:null,customerName:null,createdAt:new Date().toISOString()};
 const r=await call(f,'syncOfflineSale',c);assert.equal(r.status,400);assert.equal(r.body.error.details.reason,'legacy-offline-intent-unproven');
 await f.store.collection('sales').doc(c.localSaleId).create({localSaleId:c.localSaleId,isPaid:false,synthetic:true});
 assert.equal((await call(f,'syncOfflineSale',c)).body.result.alreadyProcessed,true);
 const s=await state(f);assert.equal(s.sales.length,1);assert.equal(s.sales[0].isPaid,false);assert.equal(s.product.quantidade,5);assert.equal(s.receipts,0);
});
test('historical collision and fiado cannot be converted into new instant effects',async()=>{
 const f=await fixture(),c=command(f);await call(f,'createDeferredSaleV1',f.deferred);
 assert.equal((await call(f,'syncOfflineSaleV1',c)).body.result.status,'identity-conflict');
 const id=randomUUID();assert.equal((await call(f,'syncOfflineSaleV1',{...c,requestId:id,saleId:id,paymentMethod:'A prazo'})).status,400);
 const s=await state(f);assert.equal(s.sales.length,1);assert.equal(s.sales[0].isPaid,false);assert.equal(s.cash.length,0);
});
test('transaction commit failure rolls back sale, FIFO and receipt, same command can resume',async()=>{
 const f=await fixture(),c=command(f),marker=f.store.collection('auditLogs').doc('marker');await marker.create({synthetic:true});
 const original=db.runTransaction;process.env.FUNCTIONS_EMULATOR='true';
 try { db.runTransaction=function(cb,opts){return original.call(this,async tx=>{const r=await cb(tx);tx.create(marker,{});return r;},opts);};
  await assert.rejects(require('../../sales/syncOfflineSaleV1').syncOfflineSaleV1.run({auth:{uid:f.scope.uid},data:c}));
 }finally{db.runTransaction=original;}
 const s=await state(f);assert.equal(s.sales.length,0);assert.equal(s.product.quantidade,5);assert.equal(s.receipts,1);
 assert.equal((await call(f,'getOfflineSaleResultV1',c)).body.result.status,'not-recorded');
 assert.equal((await call(f,'syncOfflineSaleV1',c)).body.result.status,'confirmed');
});
