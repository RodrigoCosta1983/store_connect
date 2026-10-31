const assert = require('node:assert/strict');
assert.equal(process.env.GCLOUD_PROJECT,'demo-store-connect-android04');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8194');
const admin=require('firebase-admin');
admin.initializeApp({projectId:process.env.GCLOUD_PROJECT});
const db=admin.firestore();
const {seedAdmission}=require('./storeWriterAdmissionFixture.cjs');
(async()=>{
  const {operation,uid,storeId}=JSON.parse(process.argv[2]);
  const store=db.collection('stores').doc(storeId);
  if(operation==='seed') {
    await db.collection('users').doc(uid).set({storeId,role:'caixa'});
    await store.set({subscriptionStatus:'active'});
    await seedAdmission(db,storeId,'legacy');
    const due=admin.firestore.Timestamp.fromMillis(100000);
    await store.collection('sales').doc('legacy').set({customerId:'c',paymentMethod:'Fiado',
      totalAmount:100,paidAmount:0,isPaid:false,createdAt:due,dueDate:due});
  }
  const sale=await store.collection('sales').doc('legacy').get();
  const cash=await store.collection('cash_flow').get(), receipts=await store.collection('auditLogs').get();
  console.log(JSON.stringify({sale:sale.data(),cash:cash.size,receipts:receipts.size}));
  await db.terminate();await admin.app().delete();
})().catch(e=>{console.error(e);process.exitCode=1;});
