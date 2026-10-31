const {admin,db,fixture,command,state}=require('./variantRegistrationFixture.cjs');
(async()=>{
 const input=JSON.parse(process.argv[2]);let result;
 if(input.operation==='seed'){const f=await fixture();result={scope:f.scope,token:f.auth.idToken,command:command(f)};}
 else {
 if(typeof input.scope?.storeId!=='string'||!input.scope.storeId.startsWith('c08-'))throw Error('Synthetic store required');
 result=await state({store:db.collection('stores').doc(input.scope.storeId)},input.command);
 }
 console.log(JSON.stringify(result));await db.terminate();await admin.app().delete();
})().catch(e=>{console.error(e);process.exitCode=1;});
