const {admin,db,fixture,state}=require('./commercial08Fixture.cjs');
(async()=>{
 const input=JSON.parse(process.argv[2]);let result;
 if(input.operation==='seed') {
  const f=await fixture();result={scope:f.scope,token:f.auth.idToken,deferred:f.deferred,cash:f.cash};
 }else{
  if(typeof input.storeId!=='string'||!input.storeId.startsWith('c08-'))throw Error('Non-synthetic scope');
  result=await state({store:db.collection('stores').doc(input.storeId)});
 }
 console.log(JSON.stringify(result));await db.terminate();await admin.app().delete();
})().catch(e=>{console.error(e);process.exitCode=1;});
