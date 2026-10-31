'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const admin=require('firebase-admin');
const names=['GCLOUD_PROJECT','FUNCTIONS_EMULATOR','FIRESTORE_EMULATOR_HOST','F9_COMMERCIAL_CHECKOUT_PROJECT'];
const prior=Object.fromEntries(names.map(k=>[k,process.env[k]]));
for(const k of names)delete process.env[k];
admin.initializeApp({projectId:'store-connect-hml'});
const {confirmCommercialSaleV2:send,confirmSaleV2:demo}=require('../../sales/confirmSaleV2');
after(async()=>{for(const k of names){if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}await admin.app().delete();});
const reason=(expected)=>e=>e.code==='failed-precondition'&&e.details.reason===expected;
test('commercial remote destination disabled without explicit project admission',async()=>{
  process.env.GCLOUD_PROJECT='store-connect-hml';
  await assert.rejects(send.run({}),reason('commercial-checkout-disabled'));
  process.env.F9_COMMERCIAL_CHECKOUT_PROJECT='store-connect-app';
  await assert.rejects(send.run({}),reason('commercial-checkout-disabled'));
});
test('explicit commercial destination still requires authentication before any database access',async()=>{
  process.env.F9_COMMERCIAL_CHECKOUT_PROJECT='store-connect-hml';
  await assert.rejects(send.run({}),e=>e.code==='unauthenticated');
});
test('demo handler cannot be reused remotely even with commercial project configuration',async()=>{
  await assert.rejects(demo.run({}),reason('local-emulator-only'));
});
