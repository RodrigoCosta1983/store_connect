const {admin,db,fixture,state}=require('./variantSaleFixture.cjs');
(async()=>{const input=JSON.parse(process.argv[2]);let result;
 if(input.operation==='seed'){const f=await fixture();result={scope:f.scope,token:f.auth.idToken,product:f.product,sale:f.sale};}
 else{if(!input.scope?.storeId?.startsWith('c08-'))throw Error('Synthetic store required');
 const f={scope:input.scope,product:input.product,store:db.collection('stores').doc(input.scope.storeId)};
 if(input.operation==='state')result=await state(f);
 else if(input.operation==='archive'){await f.store.collection('products').doc(f.product.productId).collection('variants').doc(f.product.variants[1].variantId).update({isArchived:true});result={ok:true};}
 else throw Error('Unknown local operation');}
 console.log(JSON.stringify(result));await db.terminate();await admin.app().delete();
})().catch(e=>{console.error(e);process.exitCode=1;});
