const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {db,fixture,command,state,call,seedAdmission}=require('./variantRegistrationFixture.cjs');
const api=require('../../products/registerVariantProductV1');
const {VariantParentDto}=require('../../contracts/productVariantsV1');
after(()=>db.terminate());
const req=(f,c)=>({auth:{uid:f.scope.uid},data:c});
const register=(f,c,options)=>call(f,'registerVariantProductV1',c,options);
const list=(f,c,extra={})=>call(f,'listRegisteredProductVariantsV1',{scope:f.scope,productId:c.productId,...extra});
test('real index exports all F10 callable protocols',()=>{
 const script=`const assert=require('node:assert/strict');const real=require('./functions/index');
 for(const name of ['registerVariantProductV1','getVariantProductRegistrationResultV1','listRegisteredProductVariantsV1']){
 assert.equal(typeof real[name],'function');assert.equal(real[name].__endpoint.platform,'gcfv2');}`;
 const r=require('node:child_process').spawnSync(process.execPath,['-e',script],{encoding:'utf8',env:process.env});
 assert.equal(r.status,0,r.stderr);
});
test('Camiseta commits three explicit variants, commercial profiles, COD and combinations; reopen reads server',async()=>{
 const f=await fixture(),c=command(f);const simpleBefore=(await f.store.collection('products').doc('p').get()).data();
 const r=await register(f,c);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.result.status,'created');
 const s=await state(f,c);assert.equal(s.variants.length,3);assert.equal(s.combos,3);assert.equal(s.codes,4);assert.equal(s.receipts,1);
 assert.equal(s.parent.quantidade,0);assert.deepEqual(s.parent.lotes,[]);assert.equal(Object.hasOwn(s.parent,'price'),false);
 const {createdAt,updatedAt,...parent}=s.parent;assert.equal(new VariantParentDto(c.productId,parent).isSellable,false);
 assert.deepEqual(s.variants.map(v=>v.quantidade).sort(),[4,5,5]);
 const read=await list(f,c);assert.equal(read.status,200,JSON.stringify(read.body));assert.equal(read.body.result.status,'available',JSON.stringify(read.body));
 assert.equal(read.body.result.variants.length,3);assert.equal(read.body.result.parent.isSellable,false);
 assert.equal(read.body.result.parent.commercial.configuration.priceCents,3990);
 assert.deepEqual((await f.store.collection('products').doc('p').get()).data(),simpleBefore);
});
test('parallel retries and response discarded after commit recover same receipt and identities',async()=>{
 const f=await fixture(),c=command(f);const r=await Promise.all([register(f,c),register(f,c)]);
 for(const v of r)assert.equal(v.status,200,JSON.stringify(v.body));
 const before=await state(f,c);const q=await call(f,'getVariantProductRegistrationResultV1',c);
 assert.equal(q.status,200);assert.equal(q.body.result.replayed,true);assert.equal(q.body.result.productId,c.productId);
 assert.equal((await register(f,c)).body.result.replayed,true);assert.deepEqual(await state(f,c),before);
 const changed=structuredClone(c);changed.commercial.priceCents++;
 assert.equal((await register(f,changed)).status,409);assert.deepEqual(await state(f,c),before);
});
test('duplicate COD or combinations reject whole aggregate with no partial writes',async()=>{
 for(const change of [c=>{c.variants[1].variant.cod=c.variants[0].variant.cod;},
 c=>{c.variants[1].variant.attributes=c.variants[0].variant.attributes;},
 c=>{c.variants[1].initialStock.quantity=-1;},c=>{c.variants[0].commercial.priceCents=null;}]){
 const f=await fixture(),c=command(f);change(c);assert.equal((await register(f,c)).status,400);
 assert.deepEqual(await state(f,c),{parent:null,variants:[],combos:0,profile:0,codes:0,receipts:0});}
 const f=await fixture(),c=command(f);await register(f,c);const next=command(f);next.product.cod='NEW';
 assert.equal((await register(f,next)).status,409);assert.equal((await state(f,next)).parent,null);
});
test('exception after queued writes before commit leaves no data; same identity can retry',async()=>{
 const f=await fixture(),c=command(f),original=db.runTransaction;let intercepted=false;
 db.runTransaction=function(fn,options){return original.call(db,tx=>fn(new Proxy(tx,{get(target,key){
 const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
 return(...args)=>{const r=value.apply(target,args);if(key==='create'&&args[0].path.endsWith('/commercialProfiles/current')){
 intercepted=true;throw Error('Injected before commit');}return r;};}})),options);};
 try{await assert.rejects(()=>api.register(db,req(f,c)),/Injected before commit/);}finally{db.runTransaction=original;}
 assert.equal(intercepted,true);assert.deepEqual(await state(f,c),{parent:null,variants:[],combos:0,profile:0,codes:0,receipts:0});
 assert.equal((await register(f,c)).status,200);
});
test('Auth, App Check, scope, revoked user and admission fail closed without writes',async()=>{
 for(const options of [{auth:false},{appCheck:false}]){const f=await fixture(),c=command(f);
 for(const endpoint of ['registerVariantProductV1','getVariantProductRegistrationResultV1','listRegisteredProductVariantsV1']){
 const payload=endpoint.startsWith('list')?{scope:f.scope,productId:c.productId}:c;
 assert.equal((await call(f,endpoint,payload,options)).status,401);}
 assert.equal((await state(f,c)).parent,null);}
 const f=await fixture(),other=await fixture(),c=command(f);c.scope.storeId=other.scope.storeId;
 assert.equal((await register(f,c)).status,403);c.scope=f.scope;
 await db.collection('users').doc(f.scope.uid).update({accessStatus:'revoked'});assert.equal((await register(f,c)).status,403);
 await db.collection('users').doc(f.scope.uid).update({accessStatus:'active'});
 for(const mode of ['legacy','draining']){await seedAdmission(db,f.store.id,mode);assert.equal((await register(f,c)).status,400);}
 assert.equal((await state(f,c)).parent,null);
});
test('receipt and list reauthorize operator/store, no disclosure after revocation',async()=>{
 const f=await fixture(),c=command(f);await register(f,c);const other=await fixture();
 assert.equal((await call(other,'getVariantProductRegistrationResultV1',c)).status,403);
 await db.collection('users').doc(f.scope.uid).update({storeId:other.store.id});
 assert.equal((await call(f,'getVariantProductRegistrationResultV1',c)).status,403);
 assert.equal((await list(f,c)).body.result.status,'access-denied');
});
test('orphan C5-B variants/combinations are never adopted; parent sale and legacy edit stay blocked',async()=>{
 const {updateProduct}=require('../../products/updateProduct');
 const {adjustProductStockV1}=require('../../products/productMutationV2');
 for(const collection of ['variants','variantCombinations']){
 const f=await fixture(),c=command(f),p=f.store.collection('products').doc(c.productId);await p.collection(collection).doc('orphan').set({isArchived:true});
 assert.equal((await register(f,c)).status,400);assert.equal((await p.get()).exists,false);
 await p.set({name:'inconsistent',price:1,quantidade:0,lotes:[]});await seedAdmission(db,f.store.id,'legacy');
 await assert.rejects(()=>updateProduct.run(req(f,{requestId:randomUUID(),productId:p.id,
 product:{name:'changed',price:2,quantidade:1,lotes:[],minimumStock:0,imageUrl:''}})),e=>e.details?.reason==='variant-structure-not-supported');
 assert.equal((await p.get()).data().name,'inconsistent');
 await seedAdmission(db,f.store.id,'authoritative');const time=(await p.get()).updateTime;
 await assert.rejects(()=>adjustProductStockV1.run(req(f,{schemaVersion:1,requestId:randomUUID(),productId:p.id,
 scope:f.scope,expectedUpdateTime:{seconds:String(time.seconds),nanoseconds:time.nanoseconds},reason:'Synthetic count',
 stockChange:{kind:'setManualQuantity',quantity:5}})),e=>e.details?.reason==='variant-structure-not-supported');
 assert.equal((await p.get()).data().quantidade,0);}
 const f=await fixture(),c=command(f);await register(f,c);
 const sale={schemaVersion:1,requestId:randomUUID(),saleId:randomUUID(),scope:f.scope,
 items:[{productId:c.productId,quantity:1,expectedUnitPriceCents:3990}],expectedTotalCents:3990,paymentMethod:'Dinheiro',
 notes:'synthetic parent refusal',customerId:null,createdAtMs:Date.now()};
 sale.saleId=sale.requestId;
 const refused=await call(f,'syncOfflineSaleV1',sale);assert.equal(refused.status,200,JSON.stringify(refused.body));
 assert.equal(refused.body.result.status,'rejected');assert.equal(refused.body.result.reason,'product-ineligible');
 assert.equal((await f.store.collection('sales').get()).size,0);
});
test('pagination includes commercial changes and network/inconsistent data never become confirmed empty list',async()=>{
 const f=await fixture(),c=command(f);await register(f,c);const first=await list(f,c,{pageSize:1});
 assert.equal(first.body.result.pagination.complete,false);
 const p=f.store.collection('products').doc(c.productId);await p.collection('commercialProfiles').doc('current').update({'configuration.priceCents':5000});
 const next=await list(f,c,{pageSize:1,cursor:first.body.result.pagination.nextCursor});assert.equal(next.body.result.status,'unknown');
 await p.collection('variants').doc(c.variants[0].variantId).collection('commercialProfiles').doc('current').update({'identity.storeId':'wrong'});
 const invalid=await list(f,c);assert.equal(invalid.body.result.status,'inconsistent-state');assert.equal(Object.hasOwn(invalid.body.result,'variants'),false);
});
test('remote PROD rejected regardless of opt-in flag',()=>{
 const before=process.env.F10_PRODUCTS_PROJECT;process.env.F10_PRODUCTS_PROJECT='store-connect-app';
 try{assert.throws(()=>api.environment({projectId:'store-connect-app'}),e=>e.details.reason==='f10-environment-not-admitted');}
 finally{if(before===undefined)delete process.env.F10_PRODUCTS_PROJECT;else process.env.F10_PRODUCTS_PROJECT=before;}
});
