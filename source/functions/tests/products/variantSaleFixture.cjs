const {randomUUID}=require('node:crypto');
const base=require('./variantRegistrationFixture.cjs');
async function fixture(){const f=await base.fixture(),product=base.command(f);
 product.variants[0].initialStock={kind:'setManualQuantity',quantity:5};
 product.variants[1].initialStock={kind:'convertToLots',lots:[{quantidade:3,validadeMs:2000000000000},{quantidade:5,validadeMs:2100000000000}]};
 product.variants[2].initialStock={kind:'setManualQuantity',quantity:3};
 const r=await base.call(f,'registerVariantProductV1',product);if(r.status!==200)throw Error(JSON.stringify(r));
 f.product=product;const ref=f.store.collection('products').doc(product.productId).collection('variants').doc(product.variants[1].variantId);
 const row=(await ref.get()).data();row.lotes[0].original='oldest-keep';row.lotes[1].original='later-keep';await ref.update({lotes:row.lotes});
 const id=randomUUID();f.sale={schemaVersion:3,requestId:id,saleId:id,scope:{...f.scope},origin:'online',saleKind:'instant',
 expectedAdmissionEpoch:1,items:[{productId:product.productId,variantId:product.variants[1].variantId,quantity:2,expectedUnitPriceCents:4290}],
 expectedTotalCents:8580,paymentMethod:'Dinheiro',notes:'F10 synthetic',customerId:null};return f;
}
async function state(f){const p=f.store.collection('products').doc(f.product.productId);
 const [root,variants,sales,proofs,cash]=await Promise.all([p.get(),p.collection('variants').get(),f.store.collection('sales').get(),
 f.store.collection('auditLogs').get(),f.store.collection('cash_flow').get()]);
 return {parent:root.data(),variants:variants.docs.map(d=>({id:d.id,...d.data()})),sales:sales.docs.map(d=>({id:d.id,...d.data()})),
 receipts:proofs.docs.map(d=>({id:d.id,...d.data()})),cash:cash.size};}
module.exports={...base,fixture,state};
