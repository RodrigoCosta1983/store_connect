"use strict";
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {Timestamp, FieldValue} = require("firebase-admin/firestore");
const contract = require("./saleV2Contract");
const shared = require("./commercialOperationContext");
const {createStoreWriterAdmission} = require("./storeWriterAdmission");
const {evaluateProductEligibility} = require("../contracts/productEligibilityC5");
function parse(raw) {
  try {
    contract.keys(raw, ["schemaVersion", "requestId", "saleId", "scope", "items", "expectedTotalCents",
      "customerId", "notes", "installmentCount", "firstDueDate", "utcOffsetMinutes"]);
    contract.keys(raw.scope, ["projectId", "uid", "storeId"]);
    if (raw.schemaVersion !== 1 || contract.id(raw.requestId) !== contract.id(raw.saleId) ||
        !Array.isArray(raw.items) || !raw.items.length || raw.items.length > 100 ||
        !Number.isInteger(raw.installmentCount) || raw.installmentCount < 1 || raw.installmentCount > 12 ||
        !Number.isInteger(raw.utcOffsetMinutes) || Math.abs(raw.utcOffsetMinutes) > 840 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(raw.firstDueDate) ||
        typeof raw.notes !== "string" || raw.notes.length > 2048) throw new TypeError();
    const seen = new Set(); let sum = 0;
    const items = raw.items.map(item => {
      contract.keys(item, ["productId", "quantity", "expectedUnitPriceCents"]);
      const productId = contract.id(item.productId);
      if (seen.has(productId)) throw new TypeError(); seen.add(productId);
      const quantity = contract.integer(item.quantity, true), expectedUnitPriceCents = contract.integer(item.expectedUnitPriceCents);
      sum = contract.integer(sum + contract.integer(quantity * expectedUnitPriceCents));
      return {productId, quantity, expectedUnitPriceCents};
    }).sort((a,b) => a.productId < b.productId ? -1 : 1);
    if (sum !== raw.expectedTotalCents || sum <= 0 || sum > 100000000000) throw new TypeError();
    const input = {schemaVersion: 1, requestId: raw.requestId, saleId: raw.saleId,
      scope: {projectId: contract.id(raw.scope.projectId), uid: contract.id(raw.scope.uid), storeId: contract.id(raw.scope.storeId)},
      items, expectedTotalCents: sum, customerId: contract.id(raw.customerId), notes: raw.notes,
      installmentCount: raw.installmentCount, firstDueDate: raw.firstDueDate, utcOffsetMinutes: raw.utcOffsetMinutes};
    plan(input); return input;
  } catch (e) { if (e instanceof TypeError || e instanceof RangeError) shared.fail("invalid-deferred-command", "invalid-argument"); throw e; }
}
function plan(input) {
  const [year,month,day] = input.firstDueDate.split("-").map(Number);
  const date = new Date(Date.UTC(year,month-1,day));
  if (year < 2000 || year > 2101 || date.getUTCMonth() !== month-1 || date.getUTCDate() !== day) throw new TypeError();
  const base = Math.round(input.expectedTotalCents / input.installmentCount);
  return Array.from({length: input.installmentCount}, (_, i) => {
    const amount = i === input.installmentCount-1 ? input.expectedTotalCents-base*i : base;
    if (amount <= 0) throw new TypeError("Plano sem parcelas positivas.");
    const target = new Date(Date.UTC(year,month-1+i,1));
    const last = new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
    const due = Date.UTC(target.getUTCFullYear(),target.getUTCMonth(),Math.min(day,last))-input.utcOffsetMinutes*60000;
    return {number: i+1, amount: amount/100, paidAmount: 0, isPaid: false,
      dueDate: Timestamp.fromMillis(due), paidAt: null};
  });
}
async function execute(request, queryOnly = false) {
  shared.destination("F9_COMMERCIAL_FIADO_PROJECT");
  if (!request.auth?.uid) shared.fail("authentication-required", "unauthenticated");
  const input = parse(request.data), requestHash = contract.hash(input), db = admin.firestore();
  const admission = createStoreWriterAdmission(db, "createDeferredSaleV1", request.auth.uid);
  return db.runTransaction(async tx => {
    const {store,data,role} = await shared.authorize(tx,db,request.auth,input.scope);
    const receiptRef = store.collection("auditLogs").doc("deferred-sale-v1-"+contract.hash(input.saleId));
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) return shared.replay(receipt,"createDeferredSaleV1",input,requestHash,request.auth.uid);
    const saleRef = store.collection("sales").doc(input.saleId), existing = await tx.get(saleRef);
    if (existing.exists) return {status:"identity-conflict",requestId:input.requestId};
    if (queryOnly) return {status:"not-recorded",requestId:input.requestId,definitive:false};
    await admission(tx,store.id);
    if (!["active","trial","overdue"].includes(data.subscriptionStatus ?? "trial")) shared.fail("subscription-ineligible");
    let customerName, result; const prepared = [];
    try {
      const customer = await tx.get(store.collection("customers").doc(input.customerId));
      if (!customer.exists || typeof customer.data().name !== "string" || !customer.data().name.trim()) shared.fail("customer-unavailable");
      customerName = customer.data().name;
      for (const item of input.items) {
        const ref = store.collection("products").doc(item.productId), snapshot = await tx.get(ref);
        const commercial = await tx.get(ref.collection("commercialProfiles").doc("current"));
        if (!snapshot.exists) shared.fail("product-unavailable");
        const product = snapshot.data();
        for (const operation of ["read","sale"]) {
          const fields = operation === "read" ? shared.structuralFields :
            [...shared.structuralFields,"isArchived","price","costPrice"];
          const eligibility = evaluateProductEligibility({protocol:"legacyV2",operation,
            scope:{projectId:input.scope.projectId,storeId:store.id}, identity:{productId:ref.id,variantId:null},
            entity:shared.eligibilitySnapshot(snapshot,fields),commercial:shared.eligibilitySnapshot(commercial)});
          if (eligibility.status !== "compatible") shared.fail("product-ineligible");
        }
        if (product.isArchived === true || typeof product.name !== "string" || !product.name.trim()) shared.fail("product-unavailable");
        let cents; try {cents = contract.priceCents(product.price);} catch (_) {shared.fail("invalid-current-price");}
        if (cents !== item.expectedUnitPriceCents) shared.fail("price-conflict");
        prepared.push({ref,patch:shared.stock(product,item.quantity), historical:{productId:item.productId,
          name:product.name,price:cents/100,quantity:item.quantity}});
      }
      result = {status:"confirmed",requestId:input.requestId,saleId:input.saleId,
        totalCents:input.expectedTotalCents,replayed:false};
    } catch(e) {
      if (!(e instanceof HttpsError) || e.code !== "failed-precondition") throw e;
      result = {status:"rejected",requestId:input.requestId,reason:e.details.reason,replayed:false};
    }
    if (result.status === "confirmed") {
      const installments = plan(input);
      for (const entry of prepared) tx.update(entry.ref,entry.patch);
      tx.create(saleRef,{totalAmount:input.expectedTotalCents/100,products:prepared.map(row=>row.historical),
        createdAt:FieldValue.serverTimestamp(),storeId:store.id,notes:input.notes,paymentMethod:"A prazo",
        isPaid:false,totalPaidAmount:0,paidAmount:0,dueDate:installments[0].dueDate,
        installmentCount:installments.length,installments,customerId:input.customerId,customerName,
        localSaleId:input.saleId,syncOrigin:"online",deferredCalendar:{firstDueDate:input.firstDueDate,utcOffsetMinutes:input.utcOffsetMinutes}});
    }
    tx.create(receiptRef,{protocol:"createDeferredSaleV1",actorUid:request.auth.uid,role,storeId:store.id,
      requestHash,command:input,result,createdAt:FieldValue.serverTimestamp()});
    return result;
  });
}
module.exports={planDeferredInstallments:plan,createDeferredSaleV1:onCall(shared.options,r=>execute(r)),
  getDeferredSaleResultV1:onCall(shared.options,r=>execute(r,true))};
