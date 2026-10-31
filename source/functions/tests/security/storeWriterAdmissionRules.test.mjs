import fs from "node:fs";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test, before, after} from "node:test";
import {initializeTestEnvironment, assertFails, assertSucceeds} from "@firebase/rules-unit-testing";
import {doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction, Timestamp} from "firebase/firestore";
const endpoint = process.env.FIRESTORE_EMULATOR_HOST || "";
assert.match(endpoint, /^(127\.0\.0\.1|localhost):\d+$/);
const [host, port] = endpoint.split(":");
const time = Timestamp.fromMillis(1792500000000);
let env;
before(async () => { env = await initializeTestEnvironment({projectId: "demo-admission-rules-03",
  firestore: {host, port: Number(port), rules: fs.readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8")}}); });
after(async () => { if (env) await env.cleanup(); });
const control = mode => ({schemaVersion: 1, mode, epoch: 1, policyRevision: "f9-commercial-admission-1",
  changedBy: "synthetic-operator", changedAt: time, lastTransitionId: "synthetic"});
const sale = storeId => ({storeId, totalAmount: 10, isPaid: false, createdAt: time,
  localSaleId: "original", syncOrigin: "online", products: [{productId: "p", quantity: 1, price: 10}]});
const cash = () => ({description: "Synthetic receipt", amount: 4, type: "Entrada", createdAt: time});
async function fixture(mode) {
  const storeId = randomUUID(), uid = randomUUID();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, `users/${uid}`), {storeId, role: "admin", accessStatus: "active"});
    await setDoc(doc(db, `stores/${storeId}`), {ownerId: uid});
    await setDoc(doc(db, `stores/${storeId}/products/p`), {name: "Synthetic", price: 10, quantidade: 5});
    await setDoc(doc(db, `stores/${storeId}/sales/debt`), {...sale(storeId), fiscal: {keep: true}});
    if (mode) await setDoc(doc(db, `storeWriterAdmission/${storeId}`), control(mode));
  });
  return {storeId, uid, db: env.authenticatedContext(uid).firestore()};
}
async function adminWrite(path, data) {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), path), data));
}
async function saved(path) {
  let value; await env.withSecurityRulesDisabled(async context => {
    const snapshot = await getDoc(doc(context.firestore(), path)); value = snapshot.exists() ? snapshot.data() : null;
  }); return value;
}
for (const mode of [undefined, "legacy", "draining", "authoritative", "invalid"]) {
  test(`direct sale/stock/receivables/cash admission is explicit [${mode}]`, async () => {
    const f = await fixture(mode), prefix = `stores/${f.storeId}`;
    const check = mode === "legacy" ? assertSucceeds : assertFails;
    await check(setDoc(doc(f.db, `${prefix}/sales/new`), sale(f.storeId)));
    await check(updateDoc(doc(f.db, `${prefix}/products/p`), {quantidade: 4}));
    await check(updateDoc(doc(f.db, `${prefix}/sales/debt`), {paidAmount: 4, isPaid: false}));
    await check(setDoc(doc(f.db, `${prefix}/cash_flow/manual`), cash()));
    // Reads are preserved for review/recovery in every mode.
    await assertSucceeds(getDoc(doc(f.db, `${prefix}/sales/debt`)));
  });
}
test("no app admin, other-store user or anonymous caller can write control/operator/evidence or nested audit", async () => {
  const f = await fixture("legacy");
  for (const db of [f.db, env.unauthenticatedContext().firestore(), env.authenticatedContext("foreign").firestore()]) {
    for (const path of [`storeWriterAdmission/${f.storeId}`, `storeWriterAdmission/${f.storeId}/changes/new`,
      `writerAdmissionOperators/${f.uid}`, `writerAdmissionEvidence/new`,
      `stores/${f.storeId}/storeWriterAdmission/control`, `stores/${f.storeId}/writerAdmissionOperators/operator`,
      `stores/${f.storeId}/writerAdmissionEvidence/proof`]) {
      await assertFails(setDoc(doc(db, path), control("authoritative")));
      await assertFails(getDoc(doc(db, path)));
      await assertFails(deleteDoc(doc(db, path)));
    }
  }
});
test("legacy payments remain atomic and preserve financial/fiscal history; commercial forgery denied", async () => {
  const f = await fixture("legacy"), prefix = `stores/${f.storeId}`;
  await assertSucceeds(runTransaction(f.db, async transaction => {
    await transaction.get(doc(f.db, `${prefix}/sales/debt`));
    transaction.update(doc(f.db, `${prefix}/sales/debt`), {paidAmount: 4, totalPaidAmount: 4,
      installments: [{number: 1, amount: 10, paidAmount: 4, paidAt: null, isPaid: false, dueDate: time}]});
    transaction.set(doc(f.db, `${prefix}/cash_flow/receipt`), cash());
  }));
  assert.deepEqual((await saved(`${prefix}/sales/debt`)).fiscal, {keep: true});
  for (const data of [{totalAmount: 999}, {products: []}, {paymentMethod: "forged"}, {fiscal: {forged: true}}]) {
    await assertFails(updateDoc(doc(f.db, `${prefix}/sales/debt`), data));
  }
  await assertFails(updateDoc(doc(f.db, `${prefix}/cash_flow/receipt`), {amount: 99}));
});
test("queued old batch assembled in legacy cannot commit sale or stock after closure", async () => {
  const f = await fixture("legacy"), prefix = `stores/${f.storeId}`;
  const batch = writeBatch(f.db);
  batch.update(doc(f.db, `${prefix}/products/p`), {quantidade: 4});
  batch.set(doc(f.db, `${prefix}/sales/queued`), sale(f.storeId));
  await adminWrite(`storeWriterAdmission/${f.storeId}`, {...control("draining"), epoch: 2});
  await assertFails(batch.commit());
  assert.equal((await saved(`${prefix}/products/p`)).quantidade, 5);
  assert.equal(await saved(`${prefix}/sales/queued`), null);
});
test("closed receipt transaction does not partially mark debt paid or create cash", async () => {
  const f = await fixture("draining"), prefix = `stores/${f.storeId}`;
  await assertFails(runTransaction(f.db, async transaction => {
    await transaction.get(doc(f.db, `${prefix}/sales/debt`));
    transaction.update(doc(f.db, `${prefix}/sales/debt`), {isPaid: true});
    transaction.set(doc(f.db, `${prefix}/cash_flow/blocked`), cash());
  }));
  assert.equal((await saved(`${prefix}/sales/debt`)).isPaid, false);
  assert.equal(await saved(`${prefix}/cash_flow/blocked`), null);
});
test("wrong policy, malformed epoch and incomplete metadata never default to legacy", async () => {
  const f = await fixture("legacy");
  for (const data of [{...control("legacy"), epoch: "1"}, {...control("legacy"), epoch: 0},
    {...control("legacy"), policyRevision: "obsolete"}, {schemaVersion: 1, mode: "legacy", epoch: 1}]) {
    await adminWrite(`storeWriterAdmission/${f.storeId}`, data);
    await assertFails(setDoc(doc(f.db, `stores/${f.storeId}/sales/invalid`), sale(f.storeId)));
  }
});
test("RESIDUAL: legacy split settlement can be partial across a cut and requires reconciliation before readiness", async () => {
  const f = await fixture("legacy"), prefix = `stores/${f.storeId}`;
  await assertSucceeds(updateDoc(doc(f.db, `${prefix}/sales/debt`), {isPaid: true}));
  await adminWrite(`storeWriterAdmission/${f.storeId}`, {...control("draining"), epoch: 2});
  await assertFails(setDoc(doc(f.db, `${prefix}/cash_flow/split`), cash()));
  assert.equal((await saved(`${prefix}/sales/debt`)).isPaid, true);
  assert.equal(await saved(`${prefix}/cash_flow/split`), null);
});
