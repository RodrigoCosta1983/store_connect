"use strict";
const {test,after}=require("node:test"),assert=require("node:assert/strict"),{randomUUID}=require("node:crypto");
const project="demo-store-connect-offline-recovery";
assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.FIRESTORE_EMULATOR_HOST,"127.0.0.1:8197");process.env.FUNCTIONS_EMULATOR="true";
const admin=require("firebase-admin");admin.initializeApp({projectId:project});const db=admin.firestore();
const {seedAdmission}=require("./fixtures/storeWriterAdmissionFixture.cjs"),api=require("../../sales/syncOfflineSaleV1");
after(async()=>{await db.terminate();await admin.app().delete();});
async function fixture(){const uid=randomUUID(),storeId=randomUUID(),id=randomUUID(),store=db.collection("stores").doc(storeId);
 await db.collection("users").doc(uid).set({role:"caixa",storeId});await store.set({subscriptionStatus:"active"});
 await store.collection("products").doc("p").set({name:"Synthetic",price:1,quantidade:3,lotes:[]});await seedAdmission(db,storeId,"legacy");
 const command={schemaVersion:1,requestId:id,saleId:id,scope:{projectId:project,storeId,uid},items:[{productId:"p",quantity:1,expectedUnitPriceCents:100}],expectedTotalCents:100,paymentMethod:"Dinheiro",notes:"",customerId:null,createdAtMs:1};
 return{uid,store,command};}
const run=(f,name,data=f.command)=>api[name].run({auth:{uid:f.uid},data});
async function state(f){const [sale,receipt,p]=await Promise.all([f.store.collection("sales").get(),f.store.collection("auditLogs").get(),f.store.collection("products").doc("p").get()]);return{sales:sale.size,receipts:receipt.size,stock:p.data().quantidade};}
test("known never-submitted fixture: read-only absent result does not create sale, receipt or stock change",async()=>{
 const f=await fixture();let options;const original=db.runTransaction;
 db.runTransaction=function(cb,opts){options=opts;return original.call(this,cb,opts);};
 try{const r=await run(f,"getOfflineSaleResultV1");assert.equal(r.status,"not-recorded");assert.equal(r.definitive,false);assert.equal(r.canAutoResend,false);assert.deepEqual(options,{readOnly:true});}finally{db.runTransaction=original;}
 assert.deepEqual(await state(f),{sales:0,receipts:0,stock:3});
});
test("lost network response AFTER commit: receipt recovery and concurrent same-ID retry debit stock once",async()=>{
 const f=await fixture();await assert.rejects((async()=>{await run(f,"syncOfflineSaleV1");throw Error("synthetic-response-lost");})(),/response-lost/);
 const r=await run(f,"getOfflineSaleResultV1");assert.equal(r.status,"confirmed");assert.equal(r.replayed,true);assert.equal(r.requestId,f.command.requestId);
 await Promise.all(Array.from({length:4},()=>run(f,"syncOfflineSaleV1")));assert.deepEqual(await state(f),{sales:1,receipts:1,stock:2});
});
test("fresh concurrent identical intents produce one atomic sale/receipt/debit",async()=>{
 const f=await fixture();const replies=await Promise.all(Array.from({length:4},()=>run(f,"syncOfflineSaleV1")));assert.ok(replies.every(r=>r.status==="confirmed"));assert.deepEqual(await state(f),{sales:1,receipts:1,stock:2});
});
test("existing sale without receipt is a conflict; query never invents an authoritative receipt",async()=>{
 const f=await fixture();await f.store.collection("sales").doc(f.command.saleId).create({synthetic:true});assert.equal((await run(f,"getOfflineSaleResultV1")).status,"identity-conflict");assert.deepEqual(await state(f),{sales:1,receipts:0,stock:3});
});
test("changed intent and revoked membership cannot recover a different authoritative result",async()=>{
 const f=await fixture();await run(f,"syncOfflineSaleV1");assert.equal((await run(f,"getOfflineSaleResultV1",{...f.command,notes:"different"})).status,"identity-conflict");
 await db.collection("users").doc(f.uid).update({accessStatus:"revoked"});await assert.rejects(run(f,"getOfflineSaleResultV1"),e=>e.code==="permission-denied");assert.deepEqual(await state(f),{sales:1,receipts:1,stock:2});
});
test("tenant context is refused before reading the original receipt",async()=>{
 const f=await fixture();await assert.rejects(api.getOfflineSaleResultV1.run({auth:{uid:f.uid,token:{firebase:{tenant:"synthetic"}}},data:f.command}),e=>e.code==="permission-denied");assert.deepEqual(await state(f),{sales:0,receipts:0,stock:3});
});
