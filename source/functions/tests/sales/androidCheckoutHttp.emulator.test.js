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
async function call(name, command, token) {
  const headers = {"Content-Type": "application/json"};
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
test("real Auth Emulator token -> callable V2 concurrent/retry -> one sale, stock debit and receipt", async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({length: 5}, () => call("confirmSaleV2", f.command, f.credentials.idToken)));
  for (const response of results) {assert.equal(response.status, 200); assert.equal(response.body.result.status, "confirmed");}
  await state(f, 1);
});
test("response discarded after server commit: lookup with original authenticated command recovers same sale", async () => {
  const f = await fixture();
  await call("confirmSaleV2", f.command, f.credentials.idToken); // deliberately discard result
  const recovered = await call("getSaleMutationResultV1", f.command, f.credentials.idToken);
  assert.equal(recovered.body.result.status, "confirmed");
  assert.equal(recovered.body.result.saleId, f.command.saleId);
  await state(f, 1);
});
test("same identity divergent payload returns conflict without changing original stock/sale", async () => {
  const f = await fixture(); await call("confirmSaleV2", f.command, f.credentials.idToken);
  const result = await call("confirmSaleV2", {...f.command, notes: "divergent"}, f.credentials.idToken);
  assert.equal(result.body.result.status, "identity-conflict"); await state(f, 1);
});
test("missing token or another real authenticated user cannot send/query store's intent", async () => {
  const f = await fixture(), other = await auth();
  const noAuth = await call("confirmSaleV2", f.command);
  assert.equal(noAuth.status, 401);
  const foreign = await call("confirmSaleV2", f.command, other.idToken);
  assert.equal(foreign.status, 403);
  const lookup = await call("getSaleMutationResultV1", f.command, other.idToken);
  assert.equal(lookup.status, 403); await state(f, 0);
});
test("not-recorded lookup and membership change never create effects", async () => {
  const f = await fixture();
  const lookup = await call("getSaleMutationResultV1", f.command, f.credentials.idToken);
  assert.equal(lookup.body.result.status, "not-recorded"); assert.equal(lookup.body.result.definitive, false);
  await db.collection("users").doc(f.credentials.localId).update({storeId: "different-store"});
  const send = await call("confirmSaleV2", f.command, f.credentials.idToken);
  assert.equal(send.status, 403); await state(f, 0);
});
