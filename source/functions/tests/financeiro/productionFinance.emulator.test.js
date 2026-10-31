"use strict";

const {test, after} = require("node:test"), assert = require("node:assert/strict");
const {randomBytes} = require("node:crypto");
if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8188") throw Error("Only loopback Emulator 8188 allowed");
const {initializeApp, deleteApp} = require("firebase-admin/app"), {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {HttpsError} = require("firebase-functions/v2/https");
const {resolveProductionConfig, readBoundSecret, BASE_URL} = require("../../financeiro/prod/asaasProductionConfig");
const {createProductionFinance, civilDay} = require("../../financeiro/prod/productionFinance");
const {createAsaasWebhookLedger} = require("../../financeiro/asaasWebhookLedger");
const app = initializeApp({projectId: `demo-asaas-prod-local-${process.pid}`}, "production-finance-local");
const db = getFirestore(app);after(async () => {await db.terminate();await deleteApp(app);});
const baseEnv = {GCLOUD_PROJECT: "store-connect-app", GOOGLE_CLOUD_PROJECT: "store-connect-app", ASAAS_ENV: "production", ASAAS_CREDENTIAL_ENV: "production"};
test("PROD canonical URL; operations disabled by default; no sandbox fallback", () => {
  const c = resolveProductionConfig(baseEnv);assert.equal(c.baseUrl, "https://api.asaas.com/v3");assert.equal(c.operationsEnabled, false);assert.equal(c.readsEnabled, false);assert.ok(Object.isFrozen(c));
});
for (const extra of [{ASAAS_ENV: "sandbox"}, {ASAAS_ENV: undefined}, {ASAAS_CREDENTIAL_ENV: "sandbox"}, {GCLOUD_PROJECT: "store-connect-hml"},
  {GOOGLE_CLOUD_PROJECT: "other"}, {ASAAS_BASE_URL: "https://api-sandbox.asaas.com/v3"}, {ASAAS_PROD_MODE: "enabled"},
  {ASAAS_PROD_MODE: "pilot"}, {ASAAS_PROD_READS: "enabled"}, {FIRESTORE_EMULATOR_HOST: "127.0.0.1:8188"}]) {
  test("invalid production configuration rejected: " + Object.keys(extra).join(","), () => assert.throws(() => resolveProductionConfig({...baseEnv, ...extra}), {code: "failed-precondition"}));
}
for (const value of [undefined, "", " \n", "key\nvalue"]) test("missing/unavailable secret is controlled", () => assert.throws(() => readBoundSecret({value: () => value}), {code: "failed-precondition"}));
test("Secret Manager exception and invalid webhook token do not expose cause", () => {
  assert.throws(() => readBoundSecret({value: () => {throw Error("synthetic private details");}}), e => e.details.reason === "credential_unavailable" && !JSON.stringify(e).includes("private"));
  assert.throws(() => readBoundSecret({value: () => "short"}, true), {code: "failed-precondition"});
});
let serial = 0;
async function fixture(extra = {}, options = {}) {
  const number = ++serial, id = "synthetic-pilot-" + number, uid = "synthetic-owner-" + number;
  let clock = Date.UTC(2026, 9, 27, 15), keyReads = 0, databaseReads = 0;
  const config = {...resolveProductionConfig({...baseEnv, ASAAS_PROD_MODE: "pilot", ASAAS_PROD_READS: "enabled", ASAAS_PROD_PILOT_STORE_ID: id}), ...options.config};
  const store = {ownerId: uid, name: "Synthetic local test", document: String(11144477000 + number), subscriptionStatus: "inactive",
    subscriptionInactiveReason: "trial_expired", subscriptionType: "free", ...extra};
  await db.collection("users").doc(uid).set({role: "admin", storeId: id, email: "synthetic@example.invalid"});
  await db.collection("stores").doc(id).set(store);
  const grantRef = db.collection("asaasFinancialAdmission").doc(id);
  await grantRef.set({schemaVersion: 1, enabled: true, projectId: "store-connect-app", environment: "production", storeId: id, actorUid: uid,
    operations: ["subscription.create", "subscription.read", "subscription.webhook", "subscription.reconcile", "subscription.overdue", "subscription.trial-expire"],
    approvedBy: "synthetic-operator", evidenceSha256: "a".repeat(64), expiresAt: new Date(clock + 7 * 86400000)});
  const calls = [], token = randomBytes(24).toString("hex");
  const remote = {customerPosts: 0, subscriptionPosts: 0, failureStage: null, invoices: [], foundCustomers: [], foundSubscriptions: [], statusError: null, afterGet: null};
  const customerId = "synthetic-customer-" + number, subscriptionId = "synthetic-sub-" + number;
  const sub = () => ({id: subscriptionId, customer: customerId, externalReference: id, status: "ACTIVE", value: 39.90, cycle: "MONTHLY", nextDueDate: "2026-11-27"});
  const page = (data, params) => ({data: {data, hasMore: false, totalCount: data.length, offset: params.offset, limit: params.limit}});
  const transport = {async request(request) {
    assert.ok(request.url.startsWith(BASE_URL + "/"));assert.equal(request.timeout, 15000);assert.equal(request.maxRedirects, 0);
    const resource = new URL(request.url).pathname.slice(3);calls.push({method: request.method, resource});
    if (remote.statusError) {const e = Error("synthetic private error");e.response = {status: remote.statusError, data: {private: "must-never-escape"}};throw e;}
    if (request.method === "GET") {
      if (resource === "/customers") return page(remote.foundCustomers, request.params);
      if (resource === "/subscriptions") return page(remote.foundSubscriptions, request.params);
      if (resource === "/subscriptions/" + subscriptionId) return {data: sub()};
      if (resource === "/payments") {if (remote.afterGet) await remote.afterGet();return page(remote.invoices, request.params);}
    }
    if (request.method === "POST" && resource === "/customers") {remote.customerPosts++;if (remote.failureStage === "customer") throw Object.assign(Error("synthetic accepted then timeout"), {code: "ECONNABORTED"});return {data: {id: customerId, cpfCnpj: store.document, externalReference: id}};}
    if (request.method === "POST" && resource === "/subscriptions") {remote.subscriptionPosts++;assert.equal(request.data.billingType, "UNDEFINED");assert.equal(request.data.value, 39.90);if (remote.failureStage === "subscription") throw Object.assign(Error("synthetic accepted then timeout"), {code: "ECONNABORTED"});return {data: sub()};}
    throw Error("unexpected mock provider call");
  }};
  const engine = createProductionFinance({db: () => {databaseReads++;return db;}, FieldValue, configuration: () => config,
    apiKey: () => {keyReads++;if (options.missingKey) throw new HttpsError("failed-precondition", "Credential unavailable", {reason: "credential_unavailable"});return "synthetic-test-only-not-a-real-key";},
    webhookToken: () => {if (options.missingWebhookSecret) throw new HttpsError("failed-precondition", "Unavailable");return token;}, transport, now: () => clock});
  const request = {auth: {uid}, data: {storeId: id, schemaVersion: 1, requestId: "a".repeat(32), consentToContract: true, cpfCnpj: store.document,
    plan: "pro", acceptedPriceCents: 3990, cycle: "MONTHLY", quoteVersion: "prod-pro-v1", acceptedFirstDueDate: civilDay(clock)}};
  const slot = db.collection("asaasSubscriptionAttempts").doc(require("node:crypto").createHash("sha256").update(JSON.stringify([config.projectId, config.environment, id])).digest("hex"));
  const bind = async () => db.collection("stores").doc(id).update({asaasCustomerId: customerId, asaasSubscriptionId: subscriptionId, asaasBindingEnvironment: "production", asaasBindingProjectId: "store-connect-app", subscriptionStatus: "pending"});
  const payment = (status = "CONFIRMED", dueDate = "2026-10-27") => ({id: "synthetic-payment-" + number, customer: customerId, subscription: subscriptionId, externalReference: id, value: 39.90, dueDate, status, invoiceUrl: "https://www.asaas.com/i/synthetic-local-only"});
  const raw = (event = "PAYMENT_CONFIRMED") => ({id: "synthetic-event-" + number, event, payment: {id: payment().id, subscription: subscriptionId, externalReference: id}});
  const deliver = async (body = raw(), supplied = token) => {let status;const response = {status(code) {status=code;return this;},send() {return {status};}};return engine.webhook({method: "POST", get: () => supplied, body}, response);};
  const eventKey = event => createAsaasWebhookLedger({db, FieldValue, config, now: () => clock}).eventKeyForId(event.id);
  return {id, uid, request, config, store, engine, calls, remote, slot, bind, payment, raw, deliver, eventKey, grantRef,
    get keyReads() {return keyReads;},get databaseReads() {return databaseReads;},advance: ms => {clock += ms;},get clock() {return clock;}};
}
test("disabled rollout blocks writes before credentials/provider; state and empty invoice read remain independent", async () => {
  const f=await fixture({}, {config: {operationsEnabled:false,readsEnabled:false}});assert.equal((await f.engine.state(f.request)).canStart,false);
  assert.deepEqual((await f.engine.invoices(f.request)).invoices,[]);await assert.rejects(f.engine.create(f.request),{code:"failed-precondition"});
  assert.equal(f.keyReads,0);assert.equal(f.calls.length,0);assert.equal((await f.slot.get()).exists,false);
});
test("missing key does not reserve a creation or call provider",async()=>{const f=await fixture({}, {missingKey:true});await assert.rejects(f.engine.create(f.request),e=>e.details.reason==="credential_unavailable");assert.equal((await f.slot.get()).exists,false);assert.equal(f.calls.length,0);});
test("trial query/expiry never creates financial identities; early termination requires separate express consent",async()=>{
  const f=await fixture({subscriptionStatus:"trial",trialEndDate:new Date(Date.UTC(2026,10,2,15))});assert.equal((await f.engine.state(f.request)).requiresTrialEndConsent,true);
  assert.equal((await f.engine.expireTrial()).status,"unchanged");await assert.rejects(f.engine.create(f.request),e=>e.details.reason==="trial_requires_explicit_termination");
  assert.equal(f.calls.length,0);assert.equal((await f.slot.get()).exists,false);f.request.data.endTrialEarly=true;assert.equal((await f.engine.create(f.request)).success,true);assert.equal(f.remote.subscriptionPosts,1);
});
test("expired trial only changes local status/audit, never creates customer/subscription",async()=>{const f=await fixture({subscriptionStatus:"trial",trialEndDate:new Date(Date.UTC(2026,9,26,15))});assert.equal((await f.engine.expireTrial()).status,"expired");const s=(await db.collection("stores").doc(f.id).get()).data();assert.equal(s.subscriptionInactiveReason,"trial_expired");assert.equal(s.asaasCustomerId,undefined);assert.equal((await f.engine.expireTrial()).status,"unchanged");assert.equal(f.calls.length,0);});
for(const change of [{consentToContract:false},{acceptedPriceCents:1},{plan:"business"},{quoteVersion:"unapproved"}])test("missing/changed express commercial consent is rejected: "+Object.keys(change),async()=>{const f=await fixture();Object.assign(f.request.data,change);await assert.rejects(f.engine.create(f.request),{code:"failed-precondition"});assert.equal(f.calls.length,0);});
test("owner authorization and missing/expired/per-store admission fail closed",async()=>{const f=await fixture();const foreign={...f.request,auth:{uid:"other-owner"}};await assert.rejects(f.engine.create(foreign),{code:"permission-denied"});await f.grantRef.update({enabled:false});await assert.rejects(f.engine.create(f.request),{code:"failed-precondition"});await f.grantRef.update({enabled:true,expiresAt:new Date(0)});await assert.rejects(f.engine.create(f.request),{code:"failed-precondition"});assert.equal(f.calls.length,0);});
test("concurrent requests create at most one customer/subscription; completed replay survives next day",async()=>{const f=await fixture();const result=await Promise.allSettled([f.engine.create(f.request),f.engine.create(f.request),f.engine.create(f.request)]);assert.ok(result.some(r=>r.status==="fulfilled"));assert.equal(f.remote.customerPosts,1);assert.equal(f.remote.subscriptionPosts,1);f.advance(86400000);assert.equal((await f.engine.create(f.request)).success,true);assert.equal(f.remote.subscriptionPosts,1);assert.equal((await f.slot.get()).data().status,"completed");});
for(const stage of ["customer","subscription"])test("accepted provider write followed by timeout is never retried: "+stage,async()=>{const f=await fixture();f.remote.failureStage=stage;await assert.rejects(f.engine.create(f.request),e=>e.details.reason==="financial_attempt_needs_review");assert.equal((await f.slot.get()).data().status,"needs_review");await assert.rejects(f.engine.create(f.request),{code:"failed-precondition"});f.request.data.requestId="b".repeat(32);await assert.rejects(f.engine.create(f.request),{code:"failed-precondition"});assert.equal(f.remote.customerPosts,1);assert.equal(f.remote.subscriptionPosts,stage==="subscription"?1:0);});
test("existing remote customer is not adopted or duplicated",async()=>{const f=await fixture();f.remote.foundCustomers=[{id:"synthetic-existing"}];await assert.rejects(f.engine.create(f.request),{code:"failed-precondition"});assert.equal(f.remote.customerPosts,0);assert.equal(f.remote.subscriptionPosts,0);});
test("Sandbox origin cannot enter the production pilot",async()=>{const f=await fixture({asaasCustomerId:"synthetic-sandbox",asaasBindingEnvironment:"sandbox",asaasBindingProjectId:"store-connect-hml"});await assert.rejects(f.engine.create(f.request),{code:"failed-precondition"});assert.equal(f.calls.length,0);});
test("webhook missing/invalid token rejected before database access; missing secret returns 503",async()=>{const f=await fixture();assert.equal((await f.deliver(undefined,"")).status,401);assert.equal((await f.deliver(undefined,"invalid")).status,401);assert.equal(f.databaseReads,0);const unavailable=await fixture({}, {missingWebhookSecret:true});assert.equal((await unavailable.deliver()).status,503);assert.equal(unavailable.databaseReads,0);});
test("webhook ACK follows durable persistence only; duplicate event cannot reapply entitlement",async()=>{
  const f=await fixture();await f.bind();f.remote.invoices=[f.payment()];const raw=f.raw();assert.equal((await f.deliver(raw)).status,200);assert.equal(f.calls.length,0);
  assert.equal((await f.engine.processEvent(f.eventKey(raw))).status,"done");const before=await db.collection("stores").doc(f.id).get();assert.equal(before.data().subscriptionStatus,"active");
  const count=f.calls.length;assert.equal((await f.deliver(raw)).status,200);assert.equal((await f.engine.processEvent(f.eventKey(raw))).status,"done");assert.equal(f.calls.length,count);assert.ok((await db.collection("stores").doc(f.id).get()).updateTime.isEqual(before.updateTime));
  assert.equal((await f.deliver({...raw,payment:{...raw.payment,status:"CHANGED"}})).status,409);
});
for(const reason of ["overdue","trial_expired","cancelled","manual",undefined])test("payment only recovers permitted inactivity reason: "+(reason||"unknown"),async()=>{const f=await fixture();await f.bind();await db.collection("stores").doc(f.id).update({subscriptionStatus:"inactive",...(reason?{subscriptionInactiveReason:reason}:{subscriptionInactiveReason:FieldValue.delete()})});f.remote.invoices=[f.payment()];const raw=f.raw();await f.deliver(raw);if(["overdue","trial_expired"].includes(reason))assert.equal((await f.engine.processEvent(f.eventKey(raw))).status,"done");else await assert.rejects(f.engine.processEvent(f.eventKey(raw)),{code:"failed-precondition"});assert.equal((await db.collection("stores").doc(f.id).get()).data().subscriptionStatus,["overdue","trial_expired"].includes(reason)?"active":"inactive");});
for(const day of [0,1,2,3,4,5])test("civil due-date tolerance D"+day,async()=>{const f=await fixture();await f.bind();await db.collection("stores").doc(f.id).update({subscriptionStatus:"active"});const due=civilDay(f.clock-day*86400000);f.remote.invoices=[f.payment("OVERDUE",due)];await f.engine.reconcile();const s=(await db.collection("stores").doc(f.id).get()).data();assert.equal(s.subscriptionStatus,day===0?"active":day>=4?"inactive":"overdue");if(day>=4)assert.equal(s.subscriptionInactiveReason,"overdue");assert.ok(f.calls.every(c=>c.method==="GET"));});
test("grant revoked during provider read prevents the entitlement commit",async()=>{const f=await fixture();await f.bind();f.remote.invoices=[f.payment()];f.remote.afterGet=()=>f.grantRef.update({enabled:false});const raw=f.raw();await f.deliver(raw);await assert.rejects(f.engine.processEvent(f.eventKey(raw)),{code:"failed-precondition"});assert.equal((await db.collection("stores").doc(f.id).get()).data().subscriptionStatus,"pending");});
test("financial reads work with creation disabled, without any POST or attempt",async()=>{const f=await fixture({}, {config:{operationsEnabled:false,readsEnabled:true}});await f.bind();f.remote.invoices=[f.payment("PENDING")];const invoices=await f.engine.invoices(f.request);assert.equal(invoices.invoices.length,1);assert.ok((await f.engine.invoices(f.request,true)).portalUrl.startsWith("https://www.asaas.com/"));assert.ok(f.calls.every(c=>c.method==="GET"));assert.equal((await f.slot.get()).exists,false);});
for(const status of [401,403,429,500])test("read upstream "+status+" produces controlled error without response payload",async()=>{const f=await fixture();await f.bind();f.remote.statusError=status;await assert.rejects(f.engine.invoices(f.request),e=>e.details.upstreamStatus===status&&!JSON.stringify(e).includes("must-never-escape"));assert.ok(f.calls.every(c=>c.method==="GET"));});
test("foreign and Sandbox billing URLs are not returned to the PROD app",async()=>{const f=await fixture();await f.bind();f.remote.invoices=[{...f.payment("PENDING"),invoiceUrl:"https://sandbox.asaas.com/i/synthetic"}];await assert.rejects(f.engine.invoices(f.request),e=>e.details.reason==="invalid_billing_url");});
for(const day of [0,1,3,4,5])test("delayed webhook preserves civil-day tolerance D"+day,async()=>{const f=await fixture();await f.bind();await db.collection("stores").doc(f.id).update({subscriptionStatus:"active"});f.remote.invoices=[f.payment("OVERDUE",civilDay(f.clock-day*86400000))];const raw=f.raw("PAYMENT_OVERDUE");await f.deliver(raw);await f.engine.processEvent(f.eventKey(raw));assert.equal((await db.collection("stores").doc(f.id).get()).data().subscriptionStatus,day===0?"active":day>=4?"inactive":"overdue");});
test("partial pagination cannot authorize creation",async()=>{const f=await fixture();const remote=f.remote;remote.foundCustomers=Array.from({length:101},(_,n)=>({id:"existing-"+n}));await assert.rejects(f.engine.create(f.request));assert.equal(remote.customerPosts,0);assert.equal(remote.subscriptionPosts,0);});
