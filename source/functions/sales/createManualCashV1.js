"use strict";
const {onCall} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {Timestamp,FieldValue} = require("firebase-admin/firestore");
const contract = require("./saleV2Contract");
const shared = require("./commercialOperationContext");
const {createStoreWriterAdmission} = require("./storeWriterAdmission");
function parse(raw) {
  try {
    contract.keys(raw,["schemaVersion","requestId","scope","amountCents","type","category","reason","occurredAtMs"]);
    contract.keys(raw.scope,["projectId","uid","storeId"]);
    if (raw.schemaVersion !== 1 || !["Entrada","Saída"].includes(raw.type) ||
        contract.integer(raw.amountCents,true) > 100000000000 ||
        typeof raw.category !== "string" || !raw.category.trim() || raw.category.length > 120 ||
        typeof raw.reason !== "string" || !raw.reason.trim() || raw.reason.length > 2048 ||
        !Number.isSafeInteger(raw.occurredAtMs) || raw.occurredAtMs < 946684800000 || raw.occurredAtMs > 4165516800000) throw new TypeError();
    return {schemaVersion:1,requestId:contract.id(raw.requestId),scope:{projectId:contract.id(raw.scope.projectId),
      uid:contract.id(raw.scope.uid),storeId:contract.id(raw.scope.storeId)},amountCents:raw.amountCents,type:raw.type,
    category:raw.category.trim(),reason:raw.reason.trim(),occurredAtMs:raw.occurredAtMs};
  } catch(e) {if(e instanceof TypeError)shared.fail("invalid-manual-cash-command","invalid-argument");throw e;}
}
async function execute(request,queryOnly=false) {
  shared.destination("F9_COMMERCIAL_CASH_PROJECT");
  if(!request.auth?.uid)shared.fail("authentication-required","unauthenticated");
  const input=parse(request.data), requestHash=contract.hash(input),db=admin.firestore();
  const admission=createStoreWriterAdmission(db,"createManualCashV1",request.auth.uid);
  return db.runTransaction(async tx=>{
    const {store,data,role}=await shared.authorize(tx,db,request.auth,input.scope);
    const id="manual-cash-v1-"+contract.hash(input.requestId), receiptRef=store.collection("auditLogs").doc(id);
    const receipt=await tx.get(receiptRef);
    if(receipt.exists)return shared.replay(receipt,"createManualCashV1",input,requestHash,request.auth.uid);
    if(queryOnly)return {status:"not-recorded",requestId:input.requestId,definitive:false};
    await admission(tx,store.id);
    if(!["active","trial","overdue"].includes(data.subscriptionStatus??"trial"))shared.fail("subscription-ineligible");
    const result={status:"confirmed",requestId:input.requestId,cashFlowId:id,replayed:false};
    tx.create(store.collection("cash_flow").doc(id),{description:input.reason,amount:input.amountCents/100,type:input.type,
      createdAt:FieldValue.serverTimestamp(),category:input.category,reason:input.reason,
      operatorUid:request.auth.uid,occurredAt:Timestamp.fromMillis(input.occurredAtMs),source:"manual"});
    tx.create(receiptRef,{protocol:"createManualCashV1",actorUid:request.auth.uid,role,storeId:store.id,
      requestHash,command:input,result,createdAt:FieldValue.serverTimestamp()});
    return result;
  });
}
module.exports={createManualCashV1:onCall(shared.options,r=>execute(r)),
  getManualCashResultV1:onCall(shared.options,r=>execute(r,true))};
