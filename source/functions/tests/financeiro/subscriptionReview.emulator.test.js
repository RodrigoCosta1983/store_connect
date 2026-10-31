"use strict";
const {test,after} = require("node:test");
const assert = require("node:assert/strict");
if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8188") throw Error("Loopback Emulator 8188 required");
const {initializeApp,deleteApp} = require("firebase-admin/app");
const {getFirestore,FieldValue} = require("firebase-admin/firestore");
const app = initializeApp({projectId:`demo-subscription-review-${process.pid}`},"review");
const db = getFirestore(app);
const {runSubscriptionAttempt,attemptRef,RECEIPTS} = require("../../financeiro/subscriptionAttempt");
const {reviewSubscriptionAttempt} = require("../../financeiro/reviewSubscriptionAttempt");
const config = {environment:"sandbox",projectId:"store-connect-hml",operationsEnabled:true};
let serial = 0;
after(async () => {await db.terminate(); await deleteApp(app);});
async function fixture(withReceipt = true) {
  const id = `store-${++serial}`, uid = `owner-${serial}`;
  const storeRef = db.collection("stores").doc(id);
  await db.collection("users").doc(uid).set({storeId:id,role:"admin"});
  await storeRef.set({ownerId:uid,asaasCustomerId:"customer",asaasSubscriptionId:"sub",
    asaasBindingEnvironment:"sandbox",asaasBindingProjectId:"store-connect-hml",subscriptionStatus:"pending"});
  const request = {auth:{uid},data:{storeId:id,requestId:"a".repeat(32),schemaVersion:1,consentToContract:true,cpfCnpj:"00000000000"}};
  let transactions = 0, sends = 0;
  const brokenCompletion = {collection: (...args) => db.collection(...args),runTransaction: async fn => {
    transactions++;
    if (transactions === 3 && withReceipt) throw Error("synthetic failure after receipt");
    return db.runTransaction(fn);
  }};
  await assert.rejects(runSubscriptionAttempt({db:brokenCompletion,FieldValue,config,request,execute:async () => {
    sends++;
    if (!withReceipt) throw Error("synthetic provider lost response");
    return {success:true,subscriptionId:"sub",paymentUrl:null};
  }}),{code:"failed-precondition"});
  let evidenceReads = 0;
  const official = {customer:{id:"customer",cpfCnpj:"00000000000",externalReference:id},
    subscription:{id:"sub",customer:"customer",externalReference:id,status:"ACTIVE"}};
  const readOfficial = async () => {evidenceReads++; return official;};
  return {id,uid,storeRef,request,official,readOfficial,get evidenceReads(){return evidenceReads;},get sends(){return sends;},
    review: overrides => reviewSubscriptionAttempt({db,FieldValue,config,request,readOfficial,...overrides})};
}
test("only execution receipt + official proof can conclude; slot/result are preserved and replay cannot POST", async () => {
  const f = await fixture();
  assert.equal((await f.review()).status,"completed");
  assert.equal((await f.review()).status,"completed");
  const record = (await attemptRef(db,config,f.id).get()).data();
  assert.equal(record.command.requestId,f.request.data.requestId); assert.equal(record.result.subscriptionId,"sub");
  assert.equal(record.review.conclusion,"execution_receipt_and_official_binding");
  const replay = await runSubscriptionAttempt({db,FieldValue,config,request:f.request,execute:async () => {throw Error("must not resend");}});
  assert.equal(replay.success,true); assert.equal(f.sends,1); assert.equal(f.evidenceReads,1);
  assert.equal((await f.storeRef.get()).data().subscriptionStatus,"pending");
});
test("provider objects/store IDs alone never backfill a missing execution receipt", async () => {
  const f = await fixture(false);
  await assert.rejects(f.review(),{code:"failed-precondition"}); assert.equal(f.evidenceReads,0);
  assert.equal((await attemptRef(db,config,f.id).get()).data().status,"needs_review");
});
test("foreign reference or document mismatch keeps the attempt blocked", async () => {
  const f = await fixture(); f.official.subscription.externalReference = "foreign";
  await assert.rejects(f.review(),{code:"failed-precondition"});
  f.official.subscription.externalReference = f.id; f.official.customer.cpfCnpj = "11111111111";
  await assert.rejects(f.review(),{code:"failed-precondition"});
  assert.equal((await attemptRef(db,config,f.id).get()).data().status,"needs_review");
});
test("concurrent store change during evidence read aborts without reactivation or slot replacement", async () => {
  const f = await fixture();
  await assert.rejects(f.review({readOfficial:async () => {await f.storeRef.update({nextDueDate:"2026-12-01"});return f.official;}}),{code:"aborted"});
  assert.equal((await attemptRef(db,config,f.id).get()).data().status,"needs_review");
});
test("foreign operator, changed request ID, PROD and absent consent evidence cannot resolve", async () => {
  const f = await fixture(), oldUid = f.request.auth.uid;
  f.request.auth.uid = "foreign"; await assert.rejects(f.review(),{code:"permission-denied"});
  f.request.auth.uid = oldUid; f.request.data.requestId = "b".repeat(32); await assert.rejects(f.review(),{code:"failed-precondition"});
  f.request.data.requestId = "a".repeat(32);
  await assert.rejects(f.review({config:{environment:"production",projectId:"store-connect-app",operationsEnabled:false}}),{code:"failed-precondition"});
  await attemptRef(db,config,f.id).update({"command.consentToContract":false});
  await assert.rejects(f.review(),{code:"failed-precondition"});
  assert.equal(f.evidenceReads,0);
});
test("in_progress with no durable execution proof has no timeout unlock", async () => {
  const f = await fixture(false), ref = attemptRef(db,config,f.id);
  await ref.update({status:"in_progress"});
  await assert.rejects(f.review(),{code:"failed-precondition"});
  assert.equal((await ref.get()).data().status,"in_progress");
  assert.equal((await db.collection(RECEIPTS).get()).docs.some(d => d.data().command.storeId === f.id),false);
});
