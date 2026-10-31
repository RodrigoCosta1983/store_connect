"use strict";
const {test, after} = require("node:test"), assert = require("node:assert/strict"), {randomUUID} = require("node:crypto");
const {admin, db, fixture, call, state} = require("./fixtures/commercial08Fixture.cjs");
after(async () => { await db.terminate(); await admin.app().delete(); });
async function setup() {
  const f = await fixture();
  await db.collection("storeWriterAdmission").doc(f.store.id).update({mode: "authoritative"});
  const identity = () => {const id = randomUUID(); return {requestId: id, saleId: id};};
  const base = {scope: f.scope, items: f.deferred.items, expectedTotalCents: 10000, paymentMethod: "Dinheiro", notes: "HML preparation"};
  f.commands = [
    ["confirmCommercialSaleV2", "getCommercialSaleMutationResultV1", {schemaVersion: 2, ...identity(), ...base, origin: "online", saleKind: "instant"}],
    ["createDeferredSaleV1", "getDeferredSaleResultV1", f.deferred],
    ["receiveDebtPaymentV1", "getDebtPaymentResultV1", {schemaVersion: 1, requestId: randomUUID(), scope: f.scope, customerId: "c", saleId: null, amountCents: 2500}],
    ["createManualCashV1", "getManualCashResultV1", f.cash],
    ["syncOfflineSaleV1", "getOfflineSaleResultV1", {schemaVersion: 1, ...identity(), ...base, customerId: null, createdAtMs: Date.now()}],
  ];
  return f;
}
test("all ten endpoints loaded through real index require Auth and runtime App Check", async () => {
  const f = await setup();
  for (const [send, query, command] of f.commands) for (const name of [send, query]) {
    assert.equal((await call(f, name, command, {auth: false})).status, 401, name + " Auth");
    assert.equal((await call(f, name, command, {appCheck: false})).status, 401, name + " App Check");
  }
  const s = await state(f); assert.equal(s.sales.length, 0); assert.equal(s.cash.length, 0); assert.equal(s.product.quantidade, 5);
});
test("integrated V2, deferred, receivable, manual cash and offline share authoritative store with unique effects and receipts", async () => {
  const f = await setup();
  // Credit must exist before its first payment. All retry identities are fixed.
  for (const index of [0, 1, 3, 4, 2]) {
    const [send, , command] = f.commands[index];
    const replies = await Promise.all(Array.from({length: 3}, () => call(f, send, command)));
    for (const r of replies) { assert.equal(r.status, 200); assert.equal(r.body.result.status, "confirmed"); }
  }
  const partial = await state(f);
  assert.equal(partial.sales.find(s => s.id === f.deferred.saleId).totalPaidAmount, 25);
  const settlement = {schemaVersion: 1, requestId: randomUUID(), scope: f.scope,
    customerId: null, saleId: f.deferred.saleId, amountCents: 7500};
  assert.equal((await call(f, "receiveDebtPaymentV1", settlement)).body.result.status, "confirmed");
  f.commands.push(["receiveDebtPaymentV1", "getDebtPaymentResultV1", settlement]);
  const before = await state(f);
  assert.equal(before.sales.length, 3); assert.equal(before.product.quantidade, 2);
  assert.equal(before.cash.length, 3); assert.equal(before.receipts, 6);
  assert.equal(before.sales.find(s => s.id === f.deferred.saleId).totalPaidAmount, 100);
  assert.equal(before.sales.find(s => s.id === f.deferred.saleId).isPaid, true);
  await f.store.update({subscriptionStatus: "blocked"});
  await db.collection("storeWriterAdmission").doc(f.store.id).update({mode: "draining", epoch: 2});
  for (const [send, query, command] of f.commands) {
    assert.equal((await call(f, query, command)).body.result.status, "confirmed", query);
    assert.equal((await call(f, send, command)).body.result.status, "confirmed", send);
  }
  assert.deepEqual(await state(f), before);
});
test("every protocol rejects foreign store and revoked actor; private result lookup cannot adopt another identity", async () => {
  const f = await setup(), other = await setup();
  for (const [send, query, command] of f.commands) for (const name of [send, query]) {
    assert.equal((await call(f, name, {...command, scope: other.scope})).status, 403, name);
  }
  await db.collection("users").doc(f.scope.uid).update({accessStatus: "revoked"});
  for (const [send, query, command] of f.commands) for (const name of [send, query]) {
    assert.equal((await call(f, name, command)).status, 403, name);
  }
  const s = await state(f); assert.equal(s.sales.length, 0); assert.equal(s.receipts, 0);
});
test("incorrect or missing admission blocks all new effects without sealing their identities", async () => {
  for (const mode of ["draining", "missing"]) {
    const f = await setup(), ref = db.collection("storeWriterAdmission").doc(f.store.id);
    if (mode === "missing") await ref.delete(); else await ref.update({mode});
    for (const [send, query, command] of f.commands) {
      const r = await call(f, send, command);
      assert.equal(r.status, 400, send); assert.equal(r.body.error.details.reason, "writer-admission-denied");
      assert.equal((await call(f, query, command)).body.result.status, "not-recorded", query);
    }
    const s = await state(f); assert.equal(s.sales.length, 0); assert.equal(s.cash.length, 0); assert.equal(s.receipts, 0); assert.equal(s.product.quantidade, 5);
  }
});
