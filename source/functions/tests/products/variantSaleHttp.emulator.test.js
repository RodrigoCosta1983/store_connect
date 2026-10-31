const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {db,admin,fixture,state,call,seedAdmission}=require('./variantSaleFixture.cjs');
const api=require('../../sales/variantSaleV1');
after(()=>db.terminate());
const send=(f,c=f.sale,o)=>call(f,'confirmVariantSaleV1',c,o);
const query=(f,c=f.sale)=>call(f,'getVariantSaleResultV1',c);
const choices=(f,o)=>call(f,'getVariantSaleChoicesV1',{scope:f.scope,productId:f.product.productId},o);
const newId=c=>{c=structuredClone(c);c.saleId=c.requestId=randomUUID();return c;};
const quantity=(s,f,i)=>s.variants.find(v=>v.id===f.product.variants[i].variantId).quantidade;
const confirmed=r=>{assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.result.status,'confirmed',JSON.stringify(r.body));};
test('real index exports F10 sale, choices and result plus all existing commercial endpoints',()=>{
 const r=require('node:child_process').spawnSync(process.execPath,['-e',`const a=require('node:assert/strict'),e=require('./functions/index');
 for(const n of ['confirmVariantSaleV1','getVariantSaleResultV1','getVariantSaleChoicesV1','confirmCommercialSaleV2','getCommercialSaleMutationResultV1',
 'createDeferredSaleV1','receiveDebtPaymentV1','createManualCashV1','syncOfflineSaleV1','getOfflineSaleResultV1','registerVariantProductV1'])a.equal(e[n].__endpoint.platform,'gcfv2');`],{encoding:'utf8',env:process.env});assert.equal(r.status,0,r.stderr);
});
test('real choices and two Azul/M units decrement only that variant, preserve FIFO metadata and paid history',async()=>{
 const f=await fixture(),before=await state(f),q=await choices(f);assert.equal(q.status,200,JSON.stringify(q.body));
 assert.equal(q.body.result.admissionEpoch,1);assert.equal(q.body.result.variants.length,3);
 confirmed(await send(f));const s=await state(f);assert.deepEqual(s.parent,before.parent);
 assert.deepEqual([0,1,2].map(i=>quantity(s,f,i)),[5,6,3]);const m=s.variants.find(v=>v.id===f.sale.items[0].variantId);
 assert.equal(m.lotes[0].quantidade,1);assert.equal(m.lotes[0].original,'oldest-keep');assert.equal(m.lotes[1].quantidade,5);assert.equal(m.lotes[1].original,'later-keep');
 assert.equal(s.sales.length,1);assert.equal(s.cash,0);const sale=s.sales[0],item=sale.products[0];
 assert.equal(sale.commercialProtocol,'confirmVariantSaleV1');assert.equal(sale.isPaid,true);assert.equal(sale.totalPaidAmount,85.8);
 assert.equal(sale.totalCents,8580);assert.equal(item.unitPriceCents,4290);assert.equal(item.subtotalCents,8580);
 assert.equal(item.variantId,f.sale.items[0].variantId);assert.match(item.name,/Azul.*M/);
 assert.equal(item.commercialSnapshot.costCents.value,1500);assert.equal(item.quantity,2);
});
test('two variants of same parent are distinct; null/omitted variant, duplicate tuple, mixed, fiado and offline rejected',async()=>{
 const f=await fixture();f.sale.items.push({productId:f.product.productId,variantId:f.product.variants[0].variantId,quantity:1,expectedUnitPriceCents:3990});
 f.sale.expectedTotalCents+=3990;confirmed(await send(f));const s=await state(f);assert.deepEqual([0,1,2].map(i=>quantity(s,f,i)),[4,6,3]);assert.equal(s.sales[0].products.length,2);
 for(const mutate of [c=>{c.items[0].variantId=null;},c=>{delete c.items[0].variantId;},c=>{c.saleKind='fiado';},c=>{c.origin='offline';},
 c=>{c.items.push(c.items[0]);c.expectedTotalCents+=8580;}]){const c=newId(f.sale);mutate(c);assert.equal((await send(f,c)).status,400);}
});
test('insufficient inventory and changed prices seal rejection without effects and cannot resurrect on retry',async()=>{
 for(const reason of ['insufficient-stock','price-conflict']){
 const f=await fixture();if(reason==='insufficient-stock'){f.sale.items[0].quantity=9;f.sale.expectedTotalCents=4290*9;}
 else await f.store.collection('products').doc(f.product.productId).collection('variants').doc(f.sale.items[0].variantId)
 .collection('commercialProfiles').doc('current').update({'configuration.priceCents.value':5000});
 const r=await send(f);assert.equal(r.body.result.status,'rejected',JSON.stringify(r.body));assert.equal(r.body.result.reason,reason);
 const s=await state(f);assert.equal(quantity(s,f,1),8);assert.equal(s.sales.length,0);assert.equal(s.cash,0);
 const again=await send(f);assert.equal(again.body.result.replayed,true);assert.deepEqual(await state(f),s);}
});
test('archived, missing, inconsistent parent and cross-store variant never sell',async()=>{
 for(const target of ['leaf','missing','parent']){const f=await fixture(),p=f.store.collection('products').doc(f.product.productId),v=p.collection('variants').doc(f.sale.items[0].variantId);
 if(target==='missing')await v.delete();else await(target==='leaf'?v:p).update({isArchived:true});
 assert.equal((await send(f)).body.result.status,'rejected');assert.equal((await state(f)).sales.length,0);}
 const f=await fixture(),other=await fixture(),c=newId(f.sale);c.items[0].productId=other.product.productId;c.items[0].variantId=other.sale.items[0].variantId;
 const before=await state(other);assert.equal((await send(f,c)).body.result.status,'rejected');assert.deepEqual(await state(other),before);
 const parent=structuredClone(f.sale);parent.items[0].variantId=null;assert.equal((await send(f,parent)).status,400);
});
test('Auth and App Check required on all three routes; current roles, revocation and scope checked',async()=>{
 const f=await fixture();for(const option of [{auth:false},{appCheck:false}])for(const name of ['confirmVariantSaleV1','getVariantSaleResultV1','getVariantSaleChoicesV1']){
 const r=await call(f,name,name.endsWith('ChoicesV1')?{scope:f.scope,productId:f.product.productId}:f.sale,option);assert.equal(r.status,401);}
 for(const fields of [{accessStatus:'revoked'},{accessStatus:'active',role:'viewer'}]){
 await db.collection('users').doc(f.scope.uid).update(fields);assert.equal((await send(f)).status,403);}
 await db.collection('users').doc(f.scope.uid).update({role:'caixa'});
 const c=structuredClone(f.sale);c.scope.storeId='other';assert.equal((await send(f,c)).status,403);assert.equal((await state(f)).sales.length,0);
});
test('absent, legacy, draining and incompatible epoch deny new effects without receipts',async()=>{
 for(const mode of [null,'legacy','draining','epoch']){const f=await fixture();
 if(mode===null)await db.collection('storeWriterAdmission').doc(f.store.id).delete();
 else await seedAdmission(db,f.store.id,mode==='epoch'?'authoritative':mode,mode==='epoch'?2:1);
 const before=await state(f);assert.equal((await send(f)).status,400);assert.deepEqual(await state(f),before);}
});
test('concurrent distinct sales cannot oversell; repeated same identity cannot decrement twice',async()=>{
 const f=await fixture(),a=newId(f.sale),b=newId(f.sale);for(const c of [a,b]){c.items[0].quantity=6;c.expectedTotalCents=25740;}
 const r=await Promise.all([send(f,a),send(f,b)]);assert.deepEqual(r.map(v=>v.body.result.status).sort(),['confirmed','rejected']);
 const s=await state(f);assert.equal(quantity(s,f,1),2);assert.equal(s.sales.length,1);
 const g=await fixture();const all=await Promise.all([send(g),send(g),send(g)]);all.forEach(confirmed);assert.equal((await state(g)).sales.length,1);assert.equal(quantity(await state(g),g,1),6);
});
test('lost response uses same proof after stock/label changes; actor switch cannot recover or submit',async()=>{
 const f=await fixture();confirmed(await send(f));const before=await state(f);
 const q=await query(f);assert.equal(q.body.result.replayed,true);assert.equal(q.body.result.saleId,f.sale.saleId);
 await f.store.collection('products').doc(f.product.productId).update({name:'Renamed after sale'});
 assert.equal((await send(f)).body.result.replayed,true);assert.deepEqual((await state(f)).sales,before.sales);
 const other=await fixture();assert.equal((await call(other,'getVariantSaleResultV1',f.sale)).status,403);
 await db.collection('users').doc(f.scope.uid).update({storeId:other.store.id});assert.equal((await query(f)).status,403);
});
test('throw after queued stock and sale before commit leaves all documents unchanged',async()=>{
 const f=await fixture(),before=await state(f),original=db.runTransaction;let injected=false;
 db.runTransaction=function(fn,options){return original.call(db,tx=>fn(new Proxy(tx,{get(target,key){const value=Reflect.get(target,key,target);
 if(typeof value!=='function')return value;return(...args)=>{const result=value.apply(target,args);
 if(key==='create'&&args[0].id.startsWith('variant-sale-v1-')){injected=true;throw Error('Injected precommit failure');}return result;};}})),options);};
 try{await assert.rejects(()=>api.confirmVariantSaleV1.run({auth:{uid:f.scope.uid},data:f.sale}),/Injected precommit failure/);}finally{db.runTransaction=original;}
 assert.equal(injected,true);assert.deepEqual(await state(f),before);confirmed(await send(f));
});
test('F9 and F10 cross-protocol identity is serialized, including rejected variant sales and legacy rejection',async()=>{
 const f=await fixture();f.sale.items[0].quantity=20;f.sale.expectedTotalCents=85800;assert.equal((await send(f)).body.result.status,'rejected');
 const id=f.sale.saleId,instant={schemaVersion:2,requestId:id,saleId:id,scope:f.scope,origin:'online',saleKind:'instant',
 items:[{productId:'p',quantity:1,expectedUnitPriceCents:10000}],expectedTotalCents:10000,paymentMethod:'Dinheiro',notes:'synthetic',customerId:null};
 assert.equal((await call(f,'confirmCommercialSaleV2',instant)).body.result.status,'identity-conflict');
 assert.equal((await call(f,'createDeferredSaleV1',{...f.deferred,requestId:id,saleId:id})).body.result.status,'identity-conflict');
 const offline={...instant,schemaVersion:1,createdAtMs:Date.now()};delete offline.origin;delete offline.saleKind;
 assert.equal((await call(f,'syncOfflineSaleV1',offline)).body.result.status,'identity-conflict');
 assert.equal((await state(f)).sales.length,0);
 const g=await fixture(),simple={...instant,scope:g.scope,requestId:g.sale.saleId,saleId:g.sale.saleId};
 const race=await Promise.all([send(g),call(g,'confirmCommercialSaleV2',simple)]);
 assert.deepEqual(race.map(r=>r.body.result.status).sort(),['confirmed','identity-conflict']);assert.equal((await state(g)).sales.length,1);
 const h=await fixture(),old={...instant,scope:h.scope,requestId:h.sale.saleId,saleId:h.sale.saleId,items:[{productId:'p',quantity:9,expectedUnitPriceCents:10000}],expectedTotalCents:90000};
 assert.equal((await call(h,'confirmCommercialSaleV2',old)).body.result.status,'rejected');assert.equal((await send(h)).body.result.status,'identity-conflict');
});
test('simple V2 remains unchanged and remote PROD has no opt-in',async()=>{
 const f=await fixture(),id=randomUUID(),r=await call(f,'confirmCommercialSaleV2',{schemaVersion:2,requestId:id,saleId:id,scope:f.scope,origin:'online',saleKind:'instant',
 items:[{productId:'p',quantity:1,expectedUnitPriceCents:10000}],expectedTotalCents:10000,paymentMethod:'Dinheiro',notes:'simple preserved',customerId:null});confirmed(r);
 const s=await state(f);assert.equal(s.sales[0].products[0].productId,'p');assert.equal(Object.hasOwn(s.sales[0].products[0],'variantId'),false);
 assert.equal(quantity(s,f,1),8);assert.equal((await f.store.collection('products').doc('p').get()).data().quantidade,4);
 assert.throws(()=>api.environment({projectId:'store-connect-app'}),e=>e.details?.reason==='f10-sale-environment-denied');
});
test('captured epoch is retained across automatic transaction retry',async()=>{
 const f=await fixture(),before=await state(f),original=db.runTransaction;let attempts=0;
 db.runTransaction=function(fn,options){return original.call(db,async tx=>{
 attempts++;if(attempts===2)await seedAdmission(db,f.store.id,'authoritative',2);
 return fn(new Proxy(tx,{get(target,key){const value=Reflect.get(target,key,target);
 if(typeof value!=='function')return value;return(...args)=>{
 const result=value.apply(target,args);if(attempts===1&&key==='create'&&args[0].id.startsWith('variant-sale-v1-')){
 const e=Error('Synthetic ABORTED before commit');e.code=10;throw e;}return result;};}}));},options);};
 try{await assert.rejects(()=>api.confirmVariantSaleV1.run({auth:{uid:f.scope.uid},data:f.sale}),
 e=>e.code==='failed-precondition'&&['writer-admission-denied','variant-sale-epoch-conflict'].includes(e.details?.reason));}
 finally{db.runTransaction=original;}
 assert.equal(attempts,2);assert.deepEqual(await state(f),before);
});
