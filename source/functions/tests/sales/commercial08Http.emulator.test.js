"use strict";
const {test,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {admin,db,fixture,call,state}=require('./fixtures/commercial08Fixture.cjs');
after(async()=>{await db.terminate();await admin.app().delete();});
test('real deferred sale creates exact installments, civil due dates and single FIFO stock debit without cash',async()=>{
 const f=await fixture(),r=await call(f,'createDeferredSaleV1',f.deferred);assert.equal(r.body.result.status,'confirmed');
 const s=await state(f);assert.equal(s.product.quantidade,4);assert.equal(s.product.lotes[0].quantidade,2);assert.equal(s.product.lotes[0].history,'keep');
 assert.equal(s.sales.length,1);assert.equal(s.cash.length,0);assert.equal(s.receipts,1);
 const sale=s.sales[0];assert.equal(sale.isPaid,false);assert.equal(sale.totalPaidAmount,0);assert.equal(sale.paymentMethod,'A prazo');
 assert.deepEqual(sale.installments.map(p=>p.amount),[33.33,33.33,33.34]);
 assert.deepEqual(sale.installments.map(p=>p.dueDate.toDate().toISOString().slice(0,10)),['2032-01-31','2032-02-29','2032-03-31']);
});
test('concurrent retry and lost response recover original fiado without another stock debit',async()=>{
 const f=await fixture();const replies=await Promise.all(Array.from({length:5},()=>call(f,'createDeferredSaleV1',f.deferred)));
 for(const r of replies)assert.equal(r.body.result.status,'confirmed');
 await f.store.collection('products').doc('p').update({price:101});
 const r=await call(f,'getDeferredSaleResultV1',f.deferred);assert.equal(r.body.result.replayed,true);
 const s=await state(f);assert.equal(s.sales.length,1);assert.equal(s.product.quantidade,4);assert.equal(s.cash.length,0);
 assert.equal((await call(f,'createDeferredSaleV1',{...f.deferred,notes:'changed'})).body.result.status,'identity-conflict');
});
test('partial payment through Commercial 07 preserves deferred receipt and debt',async()=>{
 const f=await fixture();await call(f,'createDeferredSaleV1',f.deferred);
 const payment={schemaVersion:1,requestId:randomUUID(),scope:f.scope,customerId:'c',saleId:null,amountCents:3000};
 assert.equal((await call(f,'receiveDebtPaymentV1',payment)).body.result.status,'confirmed');
 await call(f,'receiveDebtPaymentV1',payment);await call(f,'createDeferredSaleV1',f.deferred);
 const s=await state(f);assert.equal(s.sales[0].totalPaidAmount,30);assert.equal(s.sales[0].installments[0].paidAmount,30);
 assert.equal(s.sales[0].isPaid,false);assert.equal(s.product.quantidade,4);assert.equal(s.cash.length,1);assert.equal(s.cash[0].amount,30);
});
test('concurrent different fiado intentions revalidate insufficient stock atomically',async()=>{
 const f=await fixture();await f.store.collection('products').doc('p').update({quantidade:1,lotes:[]});
 const other={...f.deferred,requestId:randomUUID()};other.saleId=other.requestId;
 const r=await Promise.all([call(f,'createDeferredSaleV1',f.deferred),call(f,'createDeferredSaleV1',other)]);
 assert.deepEqual(r.map(x=>x.body.result.status).sort(),['confirmed','rejected']);
 const s=await state(f);assert.equal(s.sales.length,1);assert.equal(s.product.quantidade,0);
});
test('invalid installment plan, price and forged product never create debt or debit',async()=>{
 const f=await fixture();const tiny={...f.deferred,installmentCount:12,expectedTotalCents:6,
  items:[{productId:'p',quantity:1,expectedUnitPriceCents:6}]};
 assert.equal((await call(f,'createDeferredSaleV1',tiny)).status,400);
 const r=await call(f,'createDeferredSaleV1',{...f.deferred,expectedTotalCents:9900,items:[{productId:'p',quantity:1,expectedUnitPriceCents:9900}]});
 assert.equal(r.body.result.status,'rejected');const s=await state(f);assert.equal(s.sales.length,0);assert.equal(s.product.quantidade,5);
});
test('manual entry, output, independent equal value and retries preserve one cash per identity',async()=>{
 const f=await fixture();const replies=await Promise.all(Array.from({length:4},()=>call(f,'createManualCashV1',f.cash)));
 for(const r of replies)assert.equal(r.body.result.status,'confirmed');
 const output={...f.cash,requestId:randomUUID(),type:'Saída'};
 await call(f,'createManualCashV1',output);await call(f,'createManualCashV1',{...f.cash,requestId:randomUUID()});
 const s=await state(f);assert.equal(s.cash.length,3);assert.equal(s.sales.length,0);assert.equal(s.product.quantidade,5);
 for(const row of s.cash){assert.equal(row.amount,12.5);assert.equal(row.category,'Ajuste');assert.equal(row.operatorUid,f.scope.uid);
  assert.equal(row.reason,'Synthetic manual entry');assert.equal(row.occurredAt.toMillis(),f.cash.occurredAtMs);assert.equal(row.source,'manual');}
 assert.equal((await call(f,'getManualCashResultV1',f.cash)).body.result.status,'confirmed');
 assert.equal((await call(f,'createManualCashV1',{...f.cash,type:'Saída'})).body.result.status,'identity-conflict');
});
test('transaction failure before commit leaves no fiado, stock debit, cash or receipt; same command resumes',async()=>{
 const f=await fixture(),marker=f.store.collection('auditLogs').doc('synthetic-marker');await marker.create({synthetic:true});
 const original=db.runTransaction;process.env.FUNCTIONS_EMULATOR='true';
 for(const [module,handler,command]of [['createDeferredSaleV1','createDeferredSaleV1',f.deferred],['createManualCashV1','createManualCashV1',f.cash]]) {
  const fn=require('../../sales/'+module)[handler];
  try {
   db.runTransaction=function(callback,options){return original.call(this,async tx=>{const result=await callback(tx);tx.create(marker,{synthetic:true});return result;},options);};
   await assert.rejects(fn.run({auth:{uid:f.scope.uid},data:command}));
  }finally{db.runTransaction=original;}
 }
 let s=await state(f);assert.equal(s.sales.length,0);assert.equal(s.cash.length,0);assert.equal(s.product.quantidade,5);assert.equal(s.receipts,1);
 assert.equal((await call(f,'getDeferredSaleResultV1',f.deferred)).body.result.status,'not-recorded');
 assert.equal((await call(f,'getManualCashResultV1',f.cash)).body.result.status,'not-recorded');
 await call(f,'createDeferredSaleV1',f.deferred);await call(f,'createManualCashV1',f.cash);
 s=await state(f);assert.equal(s.sales.length,1);assert.equal(s.cash.length,1);assert.equal(s.product.quantidade,4);
});
test('Auth, App Check, role, scope and revocation protect both protocols and private results',async()=>{
 for(const [send,query,key]of [['createDeferredSaleV1','getDeferredSaleResultV1','deferred'],['createManualCashV1','getManualCashResultV1','cash']]){
  const f=await fixture(),cmd=f[key];
  assert.equal((await call(f,send,cmd,{auth:false})).status,401);assert.equal((await call(f,send,cmd,{appCheck:false})).status,401);
  assert.equal((await call(f,send,{...cmd,scope:{...f.scope,storeId:'other'}})).status,403);
  await db.collection('users').doc(f.scope.uid).update({role:'owner'});assert.equal((await call(f,send,cmd)).status,403);
  await db.collection('users').doc(f.scope.uid).update({role:'caixa'});await call(f,send,cmd);
  await db.collection('users').doc(f.scope.uid).update({accessStatus:'revoked'});assert.equal((await call(f,query,cmd)).status,403);
 }
});
test('subscription and D1-D4 gate new effects while preserving committed recovery',async()=>{
 for(const [send,query,key]of [['createDeferredSaleV1','getDeferredSaleResultV1','deferred'],['createManualCashV1','getManualCashResultV1','cash']]){
  const f=await fixture(),cmd=f[key];await f.store.update({subscriptionStatus:'blocked'});
  assert.equal((await call(f,send,cmd)).status,400);assert.equal((await state(f)).receipts,0);
  await f.store.update({subscriptionStatus:'active'});await db.collection('storeWriterAdmission').doc(f.store.id).update({mode:'draining'});
  assert.equal((await call(f,send,cmd)).status,400);
  await db.collection('storeWriterAdmission').doc(f.store.id).update({mode:'authoritative'});await call(f,send,cmd);
  await f.store.update({subscriptionStatus:'blocked'});await db.collection('storeWriterAdmission').doc(f.store.id).update({mode:'draining',epoch:2});
  assert.equal((await call(f,query,cmd)).body.result.status,'confirmed');
 }
});
test('same identities in different stores remain isolated and do not read or mutate each other',async()=>{
 const a=await fixture(),b=await fixture();b.deferred.requestId=a.deferred.requestId;b.deferred.saleId=a.deferred.saleId;b.cash.requestId=a.cash.requestId;
 await Promise.all([call(a,'createDeferredSaleV1',a.deferred),call(b,'createDeferredSaleV1',b.deferred),
  call(a,'createManualCashV1',a.cash),call(b,'createManualCashV1',b.cash)]);
 for(const f of[a,b]){const s=await state(f);assert.equal(s.sales.length,1);assert.equal(s.cash.length,1);assert.equal(s.product.quantidade,4);}
 assert.equal((await call(a,'getManualCashResultV1',b.cash)).status,403);
});
