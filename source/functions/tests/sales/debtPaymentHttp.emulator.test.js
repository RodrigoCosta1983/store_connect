"use strict";
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {createHash, randomUUID} = require("node:crypto");
const project = "demo-store-connect-android04";
assert.equal(process.env.GCLOUD_PROJECT, project);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8194");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9194");
const admin = require("firebase-admin");
admin.initializeApp({projectId: project});
const db = admin.firestore();
const {seedAdmission} = require("./fixtures/storeWriterAdmissionFixture.cjs");
after(async () => {await db.terminate(); await admin.app().delete();});
const time = admin.firestore.Timestamp.fromMillis(100000);
async function fixture(parcelled = true) {
  const r = await fetch("http://127.0.0.1:9194/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-only", {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({
      email: `payment-${randomUUID()}@example.invalid`, password: "synthetic-only-password", returnSecureToken: true})});
  assert.equal(r.status, 200);
  const auth = await r.json(), uid = auth.localId, storeId = `payment-${uid}`;
  const store = db.collection("stores").doc(storeId);
  await db.collection("users").doc(uid).set({storeId, role: "caixa"});
  await store.set({subscriptionStatus: "active"});
  await seedAdmission(db, storeId, "legacy");
  const sale = store.collection("sales").doc("old-sale");
  await sale.set({customerId: "c", customerName: "Synthetic", paymentMethod: "Fiado", totalAmount: 100,
    isPaid: false, dueDate: time, createdAt: time, products: [], fiscalHistorical: "preserved",
    ...(parcelled ? {totalPaidAmount: 0, installmentCount: 2, installments: [
      {number: 1, amount: 40, paidAmount: 0, isPaid: false, dueDate: time, original: "keep"},
      {number: 2, amount: 60, paidAmount: 0, isPaid: false, dueDate: admin.firestore.Timestamp.fromMillis(200000)}]} : {})});
  const command = {schemaVersion: 1, requestId: randomUUID(), scope: {projectId: project, uid, storeId},
    customerId: "c", saleId: null, amountCents: 3000};
  return {auth, store, sale, command};
}
async function call(f, command = f.command, endpoint = "receiveDebtPaymentV1", appCheck = true, auth = true) {
  const jwt = [Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url"),
    Buffer.from(JSON.stringify({sub:"synthetic-app", iat:Math.floor(Date.now()/1000), exp:Math.floor(Date.now()/1000)+3600})).toString("base64url"), ""].join(".");
  const headers = {"Content-Type": "application/json"};
  if (auth) headers.Authorization = `Bearer ${f.auth.idToken}`;
  if (appCheck) headers["X-Firebase-AppCheck"] = jwt;
  const r = await fetch(`http://127.0.0.1:5194/${project}/us-central1/${endpoint}`, {
    method: "POST", headers, body: JSON.stringify({data: command})});
  return {status: r.status, body: await r.json()};
}
async function counts(f, cash, receipts) {
  assert.equal((await f.store.collection("cash_flow").get()).size, cash);
  assert.equal((await f.store.collection("auditLogs").get()).size, receipts);
  const data = (await f.sale.get()).data();
  assert.equal(data.fiscalHistorical, "preserved");
  assert.equal(data.paymentMethod, "Fiado");
  return data;
}
test("partial, independent partial and settlement preserve installments and historical metadata", async () => {
  const f = await fixture();
  assert.equal((await call(f)).body.result.status, "confirmed");
  let sale = await counts(f, 1, 1);
  assert.equal(sale.installments[0].paidAmount, 30); assert.equal(sale.totalPaidAmount, 30); assert.equal(sale.isPaid, false);
  const second = {...f.command, requestId: randomUUID(), amountCents: 3000};
  assert.equal((await call(f, second)).body.result.status, "confirmed");
  sale = await counts(f, 2, 2);
  assert.equal(sale.installments[0].paidAmount, 40); assert.equal(sale.installments[1].paidAmount, 20);
  assert.equal(sale.installments[0].original, "keep"); assert.ok(sale.installments[0].paidAt instanceof admin.firestore.Timestamp);
  assert.equal((await call(f, {...f.command, requestId: randomUUID(), amountCents: 4000})).body.result.status, "confirmed");
  sale = await counts(f, 3, 3); assert.equal(sale.isPaid, true); assert.equal(sale.totalPaidAmount, 100);
  assert.equal((await call(f)).body.result.replayed, true); await counts(f, 3, 3);
});
test("same identity concurrent and lost response recover original after draining and subscription block", async () => {
  const f = await fixture();
  const replies = await Promise.all(Array.from({length: 5}, () => call(f)));
  for (const r of replies) assert.equal(r.body.result.status, "confirmed");
  await db.collection("storeWriterAdmission").doc(f.store.id).update({mode: "draining", epoch: 2});
  await f.store.update({subscriptionStatus: "blocked"});
  const recovered = await call(f, f.command, "getDebtPaymentResultV1");
  assert.equal(recovered.body.result.amountCents, 3000); assert.equal(recovered.body.result.replayed, true);
  assert.equal((await counts(f, 1, 1)).totalPaidAmount, 30);
  assert.equal((await call(f, {...f.command, amountCents: 2000})).body.result.status, "identity-conflict");
});
test("cascading across historical sales uses due date and exact cents", async () => {
  const f = await fixture(false);
  await f.sale.update({totalAmount: 0.29, paidAmount: 0, dueDate: admin.firestore.Timestamp.fromMillis(200000)});
  const earlier = f.store.collection("sales").doc("earlier");
  await earlier.set({customerId: "c", paymentMethod: "A prazo", totalAmount: 0.11, paidAmount: 0,
    isPaid: false, dueDate: time, createdAt: time});
  const result = (await call(f, {...f.command, amountCents: 20})).body.result;
  assert.equal(result.status, "confirmed");
  assert.deepEqual(result.applied.map(row => row.amountCents), [11, 9]);
  assert.equal((await earlier.get()).data().isPaid, true);
  assert.equal((await f.sale.get()).data().paidAmount, 0.09);
  assert.equal(result.remainingDebtCents, 20); await counts(f, 1, 1);
});
test("different concurrent payments cannot overdraw current debt", async () => {
  const f = await fixture(false);
  const results = await Promise.all([1, 2].map(() => call(f, {...f.command, requestId: randomUUID(), amountCents: 7000})));
  assert.deepEqual(results.map(r => r.body.result.status).sort(), ["confirmed", "rejected"]);
  assert.equal((await counts(f, 1, 2)).paidAmount, 70);
});
test("cash failure before commit rolls back sale and receipt, then same command recovers", async () => {
  const f = await fixture(false);
  const digest = createHash("sha256").update(JSON.stringify(f.command.requestId)).digest("hex");
  const blocker = f.store.collection("cash_flow").doc("debt-payment-v1-" + digest);
  await blocker.create({syntheticBlocker: true});
  assert.notEqual((await call(f)).status, 200);
  assert.equal((await f.sale.get()).data().paidAmount, undefined);
  assert.equal((await f.store.collection("auditLogs").get()).size, 0);
  assert.equal((await call(f, f.command, "getDebtPaymentResultV1")).body.result.status, "not-recorded");
  await blocker.delete(); // Isolated synthetic fixture only.
  assert.equal((await call(f)).body.result.status, "confirmed");
  assert.equal((await counts(f, 1, 1)).paidAmount, 30);
});
test("legacy mark paid settles remaining balance atomically and never duplicates cash", async () => {
  const f = await fixture(false); await f.sale.update({paidAmount: 30});
  const cmd = {...f.command, saleId: f.sale.id, customerId: null, amountCents: 7000};
  assert.equal((await call(f, cmd)).body.result.status, "confirmed");
  assert.equal((await call(f, cmd)).body.result.status, "confirmed");
  const sale = await counts(f, 1, 1); assert.equal(sale.isPaid, true); assert.equal(sale.paidAmount, 100);
});
test("historical unparcelled totalPaidAmount remains consistent with paidAmount and summaries", async () => {
  const f = await fixture(false); await f.sale.update({totalPaidAmount: 30});
  assert.equal((await call(f)).body.result.status, "confirmed");
  const sale = await counts(f, 1, 1);
  assert.equal(sale.totalPaidAmount, 60); assert.equal(sale.paidAmount, 60); assert.equal(sale.isPaid, false);
});
test("invalid historical balance and excessive amount seal rejection with no financial writes", async () => {
  for (const patch of [{totalPaidAmount: 20}, {totalAmount: 99}, {installments: [{amount: -1}] }]) {
    const f = await fixture(); await f.sale.update(patch);
    assert.equal((await call(f)).body.result.status, "rejected"); await counts(f, 0, 1);
  }
  const f = await fixture(false);
  assert.equal((await call(f, {...f.command, amountCents: 10001})).body.result.status, "rejected"); await counts(f, 0, 1);
});
test("authorization, App Check, membership and admission remain enforced, including result access", async () => {
  const missing = await fixture();
  await db.collection("storeWriterAdmission").doc(missing.store.id).delete();
  assert.equal((await call(missing)).status, 400); await counts(missing, 0, 0);
  const f = await fixture();
  assert.equal((await call(f, f.command, undefined, false)).status, 401);
  assert.equal((await call(f, f.command, undefined, true, false)).status, 401);
  assert.equal((await call(f, {...f.command, scope: {...f.command.scope, storeId: "other"}})).status, 403);
  await db.collection("users").doc(f.auth.localId).update({role: "owner"});
  assert.equal((await call(f)).status, 403);
  await db.collection("users").doc(f.auth.localId).update({role: "caixa"});
  await db.collection("storeWriterAdmission").doc(f.store.id).update({mode: "draining"});
  assert.equal((await call(f)).status, 400); await counts(f, 0, 0);
  await db.collection("storeWriterAdmission").doc(f.store.id).update({mode: "authoritative"});
  assert.equal((await call(f)).body.result.status, "confirmed");
  await db.collection("users").doc(f.auth.localId).update({accessStatus: "revoked"});
  assert.equal((await call(f, f.command, "getDebtPaymentResultV1")).status, 403); await counts(f, 1, 1);
});
