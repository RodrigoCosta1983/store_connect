"use strict";
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8188") throw Error("Only loopback Emulator 8188 is allowed");
const {initializeApp, deleteApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const app = initializeApp({projectId: `demo-store-connect-financial-${process.pid}`}, "financial-gates");
const db = getFirestore(app);
const {runSubscriptionAttempt, readSubscriptionState, attemptRef} = require("../../financeiro/subscriptionAttempt");
const {createAsaasWebhookLedger} = require("../../financeiro/asaasWebhookLedger");
const {createAsaasWebhookLocalProcessor, computeLocalPlan} = require("../../financeiro/asaasWebhookLocalProcessor");
const {createDurableWebhookHandler, billingReader} = require("../../financeiro/asaasDurableWebhook");
const {overdueDecision} = require("../../financeiro/financialStatusPolicy");
const {reconcileFinancialState} = require("../../financeiro/reconcileFinancialState");
const config = {environment: "sandbox", projectId: "store-connect-hml", operationsEnabled: true, baseUrl: "https://synthetic.invalid"};
let serial = 0;
after(async () => {await db.terminate(); await deleteApp(app);});
async function fixture(extra = {}) {
  const storeId = `synthetic-${++serial}`, uid = `owner-${serial}`;
  const store = {ownerId: uid, subscriptionStatus: "inactive", subscriptionType: "pro", ...extra};
  await db.collection("users").doc(uid).set({role: "admin", storeId});
  await db.collection("stores").doc(storeId).set(store);
  const request = {auth: {uid}, data: {storeId, schemaVersion: 1, consentToContract: true, requestId: "a".repeat(32), cpfCnpj: "00000000000"}};
  return {storeId, uid, request, run: execute => runSubscriptionAttempt({db, FieldValue, config, request, execute})};
}
test("durable creation: concurrent same command executes once; completed response survives replay/restart", async () => {
  const f = await fixture(); let writes = 0;
  const execute = async () => {writes++; return {success: true, subscriptionId: "synthetic-sub"};};
  const outcomes = await Promise.allSettled([f.run(execute), f.run(execute), f.run(execute)]);
  assert.ok(outcomes.some(x => x.status === "fulfilled")); assert.equal(writes, 1);
  assert.equal((await f.run(execute)).success, true); assert.equal(writes, 1);
  const record = (await attemptRef(db, config, f.storeId).get()).data();
  assert.equal(record.status, "completed"); assert.equal(record.command.requestId, f.request.data.requestId);
});
test("provider accepted then timeout: same ID, new ID and process restart cannot send again", async () => {
  const f = await fixture(); let accepted = 0;
  const execute = async () => {accepted++; throw Error("synthetic lost response");};
  await assert.rejects(f.run(execute), {code: "failed-precondition"});
  await assert.rejects(f.run(execute), {code: "failed-precondition"});
  f.request.data.requestId = "b".repeat(32);
  await assert.rejects(f.run(execute), {code: "failed-precondition"});
  assert.equal(accepted, 1);
  assert.equal((await attemptRef(db, config, f.storeId).get()).data().status, "needs_review");
});
test("trial read has no attempt, customer, subscription creation or provider call; no private identifiers", async () => {
  const f = await fixture({subscriptionStatus: "trial", subscriptionType: "free"});
  const state = await readSubscriptionState({db, config, request: f.request});
  assert.equal(state.attemptStatus, "none"); assert.equal(state.subscriptionStatus, "trial");
  assert.equal((await attemptRef(db, config, f.storeId).get()).exists, false);
  for (const field of ["asaasCustomerId", "asaasSubscriptionId", "document", "paymentUrl"]) assert.equal(Object.hasOwn(state, field), false);
});
test("auth, cross-store, explicit consent and changed frozen command fail closed", async () => {
  const f = await fixture(); let calls = 0; const execute = async () => {calls++; return {success: true};};
  const original = f.request.auth.uid;
  f.request.auth.uid = "foreign"; await assert.rejects(f.run(execute), {code: "permission-denied"});
  f.request.auth.uid = original; f.request.data.consentToContract = false;
  await assert.rejects(f.run(execute), {code: "failed-precondition"});
  f.request.data.consentToContract = true; await f.run(execute);
  f.request.data.cpfCnpj = "11111111111"; await assert.rejects(f.run(execute), {code: "failed-precondition"});
  assert.equal(calls, 1);
});
test("Sandbox IDs cannot enter PROD even with simulated future global activation", async () => {
  const f = await fixture({asaasCustomerId: "synthetic-customer", asaasBindingEnvironment: "sandbox", asaasBindingProjectId: "store-connect-hml"});
  let calls = 0;
  await assert.rejects(runSubscriptionAttempt({db, FieldValue, request: f.request,
    config: {environment: "production", projectId: "store-connect-app", operationsEnabled: true}, execute: async () => {calls++;}}), {code: "failed-precondition"});
  assert.equal(calls, 0);
});
function event(id, sub, storeId, kind = "PAYMENT_RECEIVED") {
  return {id, event: kind, payment: {id: `pay-${id}`, subscription: sub, externalReference: storeId, status: "RECEIVED"}};
}
async function bound(extra = {}) {
  const f = await fixture({subscriptionStatus: "pending", asaasCustomerId: `customer-${serial + 1}`, asaasSubscriptionId: `sub-${serial + 1}`,
    asaasBindingEnvironment: config.environment, asaasBindingProjectId: config.projectId, ...extra});
  const store = (await db.collection("stores").doc(f.storeId).get()).data();
  return {...f, store};
}
const paid = {hasOverdue: false, nextDueDate: "2026-11-24", overdueDueDate: null, officialSubscriptionActive: true, hasSettledPayment: true};
test("durable webhook: duplicate event persists once, updates atomically; changed body conflicts", async () => {
  const f = await bound(), ledger = createAsaasWebhookLedger({db, FieldValue, config});
  const raw = event(`evt-${serial}`, f.store.asaasSubscriptionId, f.storeId);
  const saved = await ledger.persist(raw), duplicate = await ledger.persist(raw);
  assert.equal(duplicate.outcome, "duplicate");
  const processor = createAsaasWebhookLocalProcessor({db, FieldValue, config, ledger, readBillingState: async () => paid});
  assert.equal((await processor.process(saved.eventKey)).outcome, "done");
  assert.equal((await processor.process(saved.eventKey)).outcome, "done");
  assert.equal((await db.collection("stores").doc(f.storeId).get()).data().subscriptionStatus, "active");
  const changed = {...raw, payment: {...raw.payment, status: "OVERDUE"}};
  assert.equal((await ledger.persist(changed)).outcome, "conflict");
});
test("late overdue after payment uses current read, never stale event state", async () => {
  const f = await bound({subscriptionStatus: "active"}), ledger = createAsaasWebhookLedger({db, FieldValue, config});
  const saved = await ledger.persist(event(`evt-${serial}`, f.store.asaasSubscriptionId, f.storeId, "PAYMENT_OVERDUE"));
  const processor = createAsaasWebhookLocalProcessor({db, FieldValue, config, ledger, readBillingState: async () => paid});
  assert.equal((await processor.process(saved.eventKey)).resultCode, "ignored_stale_overdue");
  assert.equal((await db.collection("stores").doc(f.storeId).get()).data().subscriptionStatus, "active");
});
for (const reason of [undefined, "cancelled", "overdue", "trial_expired"]) test(`inactive ${reason || "unknown"}: only known recovery with current settled proof`, async () => {
  const f = await bound({subscriptionStatus: "inactive", ...(reason ? {subscriptionInactiveReason: reason} : {})});
  const ledger = createAsaasWebhookLedger({db, FieldValue, config});
  const saved = await ledger.persist(event(`evt-${serial}`, f.store.asaasSubscriptionId, f.storeId));
  const processor = createAsaasWebhookLocalProcessor({db, FieldValue, config, ledger, readBillingState: async () => paid});
  const result = await processor.process(saved.eventKey);
  const permitted = reason === "overdue" || reason === "trial_expired";
  assert.equal(result.outcome, permitted ? "done" : "retry_scheduled");
  assert.equal((await db.collection("stores").doc(f.storeId).get()).data().subscriptionStatus, permitted ? "active" : "inactive");
});
test("unpaid/remaining debt cannot reactivate inactive; D1-D3 tolerance, D4 block", () => {
  const store = {subscriptionStatus: "inactive", subscriptionInactiveReason: "overdue"};
  for (const billing of [{...paid, hasSettledPayment: false}, {...paid, hasOverdue: true, overdueDueDate: "2026-10-20"}]) {
    assert.ok(computeLocalPlan({store, billing, eventType: "PAYMENT_RECEIVED", FieldValue}).deferCode);
  }
  for (const day of [1,2,3]) assert.equal(overdueDecision(day), "overdue");
  assert.equal(overdueDecision(4), "inactive"); assert.equal(overdueDecision(null), "needs_review");
});
test("event for other reference cannot update official store", async () => {
  const f = await bound(), ledger = createAsaasWebhookLedger({db, FieldValue, config});
  const saved = await ledger.persist(event(`evt-${serial}`, f.store.asaasSubscriptionId, "foreign-store"));
  const processor = createAsaasWebhookLocalProcessor({db, FieldValue, config, ledger, readBillingState: async () => {throw Error("must not read");}});
  assert.equal((await processor.process(saved.eventKey)).reason, "event_reference_mismatch");
  assert.equal((await db.collection("stores").doc(f.storeId).get()).data().subscriptionStatus, "pending");
});
function response() {return {code: null, status(code) {this.code = code; return this;}, send(body) {this.body = body; return this;}};}
test("ingress auth rejects before persistence; valid token returns 200 only after durable completion", async () => {
  const f = await bound(), raw = event(`evt-${serial}`, f.store.asaasSubscriptionId, f.storeId);
  const dependencies = {db, FieldValue, configuration: () => config, reader: async () => paid};
  const denied = response();
  await createDurableWebhookHandler({...dependencies, authenticate: () => 401})({method: "POST", body: raw}, denied);
  assert.equal(denied.code, 401);
  const handler = createDurableWebhookHandler({...dependencies, authenticate: () => 200});
  const first = response(); await handler({method: "POST", body: raw}, first); assert.equal(first.code, 200);
  const again = response(); await handler({method: "POST", body: raw}, again); assert.equal(again.code, 200);
  const prod = response(); await createDurableWebhookHandler({...dependencies, authenticate: () => 200,
    configuration: () => ({environment: "production", operationsEnabled: false})})({method: "POST", body: raw}, prod);
  assert.equal(prod.code, 503);
});
test("read adapter rejects foreign binding, pagination ambiguity and forged settlement", async () => {
  const store = {asaasCustomerId: "synthetic-customer"};
  let foreign = true, paginated = false;
  const get = async (url, options) => url.includes("/subscriptions/") ? {data: {id: "synthetic-sub", customer: store.asaasCustomerId,
    externalReference: foreign ? "foreign-store" : "synthetic-store", status: "ACTIVE"}} :
      {data: {data: [], hasMore: paginated, totalCount: paginated ? 1 : 0, offset: options.params.offset, limit: options.params.limit}};
  const read = billingReader({get, config, headers: {}});
  await assert.rejects(read("synthetic-sub", {eventType: "PAYMENT_RECEIVED"}, store, "synthetic-store"), /binding/);
  foreign = false; paginated = true;
  await assert.rejects(read("synthetic-sub", {eventType: "PAYMENT_RECEIVED"}, store, "synthetic-store"), {code: "asaas_list_inconclusive"});
  paginated = false;
  assert.equal((await read("synthetic-sub", {eventType: "PAYMENT_RECEIVED"}, store, "synthetic-store")).hasSettledPayment, false);
});
test("missing webhook: directed recovery commits audit once, preserves events and blocks unknown inactive", async () => {
  const f = await bound({subscriptionStatus: "inactive", subscriptionInactiveReason: "overdue"});
  const input = {db, FieldValue, config, request: f.request, readBillingState: async () => paid};
  assert.equal((await reconcileFinancialState(input)).status, "confirmed");
  assert.equal((await reconcileFinancialState(input)).status, "confirmed");
  assert.equal((await db.collection("stores").doc(f.storeId).get()).data().subscriptionStatus, "active");
  const unknown = await bound({subscriptionStatus: "inactive"});
  await assert.rejects(reconcileFinancialState({...input, request: unknown.request}), {code: "failed-precondition"});
  assert.equal((await db.collection("stores").doc(unknown.storeId).get()).data().subscriptionStatus, "inactive");
});
test("actual trial expiration persists reason/audit with no financial identity or provider", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../../financeiro/expireTrials.js"), "utf8");
  const context = {require, module: {exports: {}}, console: {log() {}, warn() {}, error() {}}};
  vm.runInNewContext(source + '\nmodule.exports.localExpire = expireStoreIfNeeded;', context);
  const f = await fixture({subscriptionStatus: "trial", subscriptionType: "free", trialEndDate: new Date(Date.now() - 1000)});
  const ref = db.collection("stores").doc(f.storeId);
  // Firestore checks native Promise identity; bridge the VM realm only, keeping
  // the actual Emulator transaction and all reads/writes unchanged.
  const bridge = {runTransaction: fn => db.runTransaction(async tx => await fn(tx))};
  const result = await context.module.exports.localExpire({db: bridge, storeRef: ref, nowMillis: Date.now()});
  assert.equal(result.expired, true);
  const store = (await ref.get()).data();
  assert.equal(store.subscriptionInactiveReason, "trial_expired"); assert.equal(store.subscriptionStatus, "inactive");
  assert.equal(store.asaasCustomerId, undefined); assert.equal(store.asaasSubscriptionId, undefined);
  assert.equal((await ref.collection("auditLogs").get()).size, 1);
});
test("cancelled event preserves identity; stale deletion without current proof remains pending", () => {
  const store = {subscriptionStatus: "active", asaasSubscriptionId: "synthetic-sub"};
  assert.ok(computeLocalPlan({eventType: "SUBSCRIPTION_DELETED", store, billing: {...paid}, FieldValue}).deferCode);
  const plan = computeLocalPlan({eventType: "SUBSCRIPTION_DELETED", store, billing: {...paid, officialSubscriptionDeleted: true}, FieldValue});
  assert.equal(plan.update.subscriptionInactiveReason, "cancelled");
  assert.equal(Object.hasOwn(plan.update, "asaasSubscriptionId"), false);
});
