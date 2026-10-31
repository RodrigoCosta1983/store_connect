"use strict";
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const project = "demo-store-connect-android04";
assert.equal(process.env.GCLOUD_PROJECT, project);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8194");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9194");
const admin = require("firebase-admin");
admin.initializeApp({projectId: project});
const db = admin.firestore();
const {seedAdmission} = require("./fixtures/storeWriterAdmissionFixture.cjs");
after(async () => {await db.terminate(); await admin.app().delete();});
async function auth() {
  const email = `synthetic-${crypto.randomUUID()}@example.invalid`;
  const response = await fetch("http://127.0.0.1:9194/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-only", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({email, password: "synthetic-password-only", returnSecureToken: true}),
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function fixture() {
  const credentials = await auth();
  const uid = credentials.localId, storeId = `store-${uid}`;
  const store = db.collection("stores").doc(storeId);
  await Promise.all([db.collection("users").doc(uid).create({storeId, role: "admin"}),
    store.create({ownerId: uid, subscriptionStatus: "active"}),
    store.collection("products").doc("p").create({name: "Synthetic", price: 0.29, quantidade: 5, lotes: []})]);
  await seedAdmission(db, storeId);
  const id = crypto.randomUUID();
  const command = {schemaVersion: 2, requestId: id, saleId: id,
    scope: {projectId: project, uid, storeId}, origin: "online", saleKind: "instant",
    items: [{productId: "p", quantity: 1, expectedUnitPriceCents: 29}],
    expectedTotalCents: 29, paymentMethod: "PIX"};
  return {credentials, command, store};
}
async function call(name, command, token, includeAppCheck = true) {
  // Official Functions Emulator accepts unsigned synthetic App Check JWTs.
  // No runtime option, verifier or deployed handler is overridden by this test.
  const appCheck = [Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url'),
    Buffer.from(JSON.stringify({sub:"synthetic-app",iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),""].join(".");
  const headers = {"Content-Type": "application/json", "X-Firebase-AppCheck": appCheck};
  if (!includeAppCheck) delete headers["X-Firebase-AppCheck"];
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`http://127.0.0.1:5194/${project}/us-central1/${name}`, {
    method: "POST", headers, body: JSON.stringify({data: command}),
  });
  return {status: response.status, body: await response.json()};
}
async function state(f, count) {
  const [products, sales, receipts, cash] = await Promise.all([
    f.store.collection("products").doc("p").get(), f.store.collection("sales").get(),
    f.store.collection("auditLogs").get(), f.store.collection("cash_flow").get()]);
  assert.equal(products.data().quantidade, 5 - count);
  assert.equal(sales.size, count); assert.equal(receipts.size, count); assert.equal(cash.size, 0);
}

test("commercial callable concurrent requests seal one sale and one debit",async()=>{
  const f=await fixture();
  const replies=await Promise.all(Array.from({length:4},()=>call("confirmCommercialSaleV2",f.command,f.credentials.idToken)));
  for(const r of replies){assert.equal(r.status,200);assert.equal(r.body.result.saleId,f.command.saleId);}
  await state(f,1);
});
test("commercial lookup recovers original after draining and subscription block",async()=>{
  const f=await fixture();await call("confirmCommercialSaleV2",f.command,f.credentials.idToken);
  await db.collection("storeWriterAdmission").doc(f.store.id).update({mode:"draining",epoch:2});
  await f.store.update({subscriptionStatus:"blocked"});
  const r=await call("getCommercialSaleMutationResultV1",f.command,f.credentials.idToken);
  assert.equal(r.status,200);assert.equal(r.body.result.status,"confirmed");await state(f,1);
});
test("commercial admission absent or legacy is nonterminal with no effects",async()=>{
  const f=await fixture();await db.collection("storeWriterAdmission").doc(f.store.id).delete();
  const r=await call("confirmCommercialSaleV2",f.command,f.credentials.idToken);
  assert.equal(r.status,400);await state(f,0);
  const q=await call("getCommercialSaleMutationResultV1",f.command,f.credentials.idToken);
  assert.equal(q.body.result.status,"not-recorded");
});
test("commercial callable preserves auth and membership barriers",async()=>{
  const f=await fixture();
  assert.equal((await call("confirmCommercialSaleV2",f.command,f.credentials.idToken,false)).status,401);
  assert.equal((await call("confirmCommercialSaleV2",f.command)).status,401);
  await call("confirmCommercialSaleV2",f.command,f.credentials.idToken);
  await db.collection("users").doc(f.credentials.localId).update({accessStatus:"revoked"});
  assert.equal((await call("getCommercialSaleMutationResultV1",f.command,f.credentials.idToken)).status,403);
  await state(f,1);
});
test("commercial price conflict seals rejection with no stock debit",async()=>{
  const f=await fixture();await f.store.collection("products").doc("p").update({price:0.30});
  const r=await call("confirmCommercialSaleV2",f.command,f.credentials.idToken);
  assert.equal(r.body.result.status,"rejected");assert.equal(r.body.result.reason,"price-conflict");
  assert.equal((await f.store.collection("products").doc("p").get()).data().quantidade,5);
  assert.equal((await f.store.collection("sales").get()).size,0);
});
