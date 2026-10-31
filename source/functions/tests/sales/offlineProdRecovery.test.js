"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const policy=require("../../sales/offlineSaleRecoveryPolicy");
const project="store-connect-app",id="synthetic-original",uid="synthetic-actor",storeId="synthetic-store";
const input={requestId:id,saleId:id,scope:{projectId:project,storeId,uid},expectedTotalCents:100};
test("PROD reader works without commercial flag; writer stays closed and crossed contexts fail",()=>{
 assert.equal(policy.productionDestination(project,{GCLOUD_PROJECT:project},true),true);
 assert.throws(()=>policy.productionDestination(project,{GCLOUD_PROJECT:project},false),e=>e.details.reason==="offline-production-writes-disabled");
 for(const env of [{GCLOUD_PROJECT:"store-connect-hml"},{GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:"other"},{GCLOUD_PROJECT:project,FIRESTORE_EMULATOR_HOST:"127.0.0.1:8197"}])assert.throws(()=>policy.productionDestination(project,env,true));
 assert.equal(policy.productionDestination(project,{GCLOUD_PROJECT:project,F9_COMMERCIAL_OFFLINE_PROJECT:project},false),true);
});
test("existing terminal receipt requires actor, scope, hash, IDs and amount; corrupt receipt never confirms",()=>{
 const saved={protocol:"syncOfflineSaleV1",storeId,actorUid:uid,requestHash:"hash",result:{status:"confirmed",requestId:id,saleId:id,totalCents:100}};
 const read=v=>policy.replayReceipt({data:()=>v},input,"hash",uid);
 assert.equal(read(saved).replayed,true);
 for(const change of [{storeId:"other"},{requestHash:"other"},{result:{...saved.result,totalCents:101}},{result:{...saved.result,requestId:"other"}},{result:{...saved.result,status:"not-recorded"}}])assert.equal(read({...saved,...change}).status,"identity-conflict");
 assert.throws(()=>read({...saved,actorUid:"other"}),e=>e.code==="permission-denied");
});
test("PROD new effects require exact backend attestation, never a client boolean or absent grant",async()=>{
 const valid={schemaVersion:1,enabled:true,priorExecutionResolved:true,projectId:project,storeId,actorUid:uid,requestId:id,saleId:id,requestHash:"hash",approvedBy:"synthetic-operator",evidenceSha256:"a".repeat(64)};
 const db={collection:n=>{assert.equal(n,policy.COLLECTION);return{doc:key=>({key})};}};
 for(const value of [null,{...valid,requestHash:"other"},{...valid,priorExecutionResolved:false},{...valid,actorUid:"other"}])await assert.rejects(policy.authorizeProductionRecovery({get:async()=>({exists:!!value,data:()=>value})},db,input,"hash",uid),e=>e.details.reason==="offline-recovery-authorization-required");
 await policy.authorizeProductionRecovery({get:async()=>({exists:true,data:()=>valid})},db,input,"hash",uid);
});
