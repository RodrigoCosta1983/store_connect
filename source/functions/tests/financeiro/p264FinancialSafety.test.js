"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {HttpsError} = require("firebase-functions/v2/https");
const admission = require("../../financeiro/storeFinancialAdmission");
const origin = require("../../financeiro/asaasBindingOrigin");
const financeDir = path.join(__dirname, "../../financeiro");
const index = fs.readFileSync(path.join(__dirname, "../../index.js"), "utf8");
const quiet = {log() {}, warn() {}, error() {}};
const sandbox = {environment: "sandbox", projectId: "store-connect-hml", operationsEnabled: true};
const production = {environment: "production", projectId: "store-connect-app", operationsEnabled: false};
const bound = (config) => ({asaasSubscriptionId: "synthetic-sub", asaasCustomerId: "synthetic-customer",
  asaasBindingEnvironment: config.environment, asaasBindingProjectId: config.projectId});
const grant = (operation) => ({schemaVersion: 1, enabled: true, storeId: "store-a",
  environment: "production", projectId: "store-connect-app", operations: [operation]});

function load(file, deps, globals = {}) {
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(path.join(financeDir, file), "utf8"), {
    module, exports: module.exports, console: quiet,
    require(name) { if (Object.hasOwn(deps, name)) return deps[name]; throw Error(`Unexpected dependency: ${name}`); },
    ...globals,
  });
  return module.exports;
}
function admissionContext(config = production, storeData = bound(config), backendGrant) {
  const reads = [];
  const ref = {get: async () => {reads.push("get"); return {exists: !!backendGrant, data: () => backendGrant};}};
  return {reads, db: {collection(name) {
    reads.push(name); assert.equal(name, "asaasFinancialAdmission");
    return {doc(id) {assert.equal(id, "store-a"); return ref;}};
  }}, storeId: "store-a", storeData, config, operation: "subscription.create"};
}

for (const [name, data] of [
  ["Sandbox legacy in PROD", bound(sandbox)],
  ["unknown origin", {asaasSubscriptionId: "synthetic-sub"}],
  ["other project", {...bound(production), asaasBindingProjectId: "foreign-project"}],
  ["partial origin", {asaasSubscriptionId: "synthetic-sub", asaasBindingEnvironment: "production"}],
]) {
  test(`${name}: no billing admission even with future global activation and backend grant`, async () => {
    const ctx = admissionContext({...production, operationsEnabled: true}, data, grant("subscription.create"));
    assert.equal((await admission.checkStoreFinancialAdmission(ctx)).allowed, false);
    assert.equal(ctx.reads.length, 0);
    await assert.rejects(admission.assertStoreFinancialAdmission(ctx), {code: "failed-precondition"});
  });
}
test("canonical config never activates PROD, irrespective of client/environment activation input", () => {
  const mod = load("asaasConfig.js", {}, {process: {env: {
    ASAAS_ENV: "production", ASAAS_CREDENTIAL_ENV: "production", GCLOUD_PROJECT: "store-connect-app",
    ASAAS_PRODUCTION_ENABLED: "true",
  }}});
  assert.equal(mod.resolveAsaasConfig().operationsEnabled, false);
});
test("actual global PROD gate dominates valid per-store grant", async () => {
  const ctx = admissionContext(production, bound(production), grant("subscription.create"));
  const result = await admission.checkStoreFinancialAdmission(ctx);
  assert.equal(result.reason, "operations_disabled");
  assert.equal(ctx.reads.length, 0);
});
test("admission rejects missing, malformed or crossed runtime independently of resolver", async () => {
  for (const config of [undefined, {}, {operationsEnabled: true}, {...sandbox, projectId: "store-connect-app"}]) {
    const ctx = admissionContext(production, {});
    ctx.config = config;
    assert.equal((await admission.checkStoreFinancialAdmission(ctx)).reason, "invalid_runtime_context");
    assert.equal(ctx.reads.length, 0);
  }
});
// Simulated future global config: this is dependency injection, not a production switch.
for (const [name, value] of [
  ["missing", undefined], ["disabled", {...grant("subscription.create"), enabled: false}],
  ["wrong store", {...grant("subscription.create"), storeId: "store-b"}],
  ["wrong environment", {...grant("subscription.create"), environment: "sandbox"}],
  ["wrong project", {...grant("subscription.create"), projectId: "foreign-project"}],
  ["wrong operation", grant("subscription.webhook")],
  ["malformed schema", {...grant("subscription.create"), schemaVersion: 2}],
]) {
  test(`PROD denies ${name} backend admission`, async () => {
    const ctx = admissionContext({...production, operationsEnabled: true}, bound(production), value);
    assert.equal((await admission.checkStoreFinancialAdmission(ctx)).allowed, false);
  });
}
test("active status, existing IDs and client supplied grant cannot replace root grant", async () => {
  const ctx = admissionContext({...production, operationsEnabled: true}, {
    ...bound(production), subscriptionStatus: "active", financialAdmission: grant("subscription.create"),
  });
  ctx.clientGrant = grant("subscription.create");
  assert.equal((await admission.checkStoreFinancialAdmission(ctx)).allowed, false);
});
test("grant permits only the store and operation explicitly admitted in simulated future PROD", async () => {
  const ctx = admissionContext({...production, operationsEnabled: true}, bound(production), grant("subscription.create"));
  assert.equal((await admission.checkStoreFinancialAdmission(ctx)).allowed, true);
  ctx.operation = "subscription.change-plan";
  assert.equal((await admission.checkStoreFinancialAdmission(ctx)).allowed, false);
});
test("transactional caller reads backend grant through same transaction", async () => {
  const ctx = admissionContext({...production, operationsEnabled: true}, bound(production));
  let reads = 0;
  ctx.transaction = {get: async () => {reads++; return {exists: true, data: () => grant("subscription.create")};}};
  assert.equal((await admission.checkStoreFinancialAdmission(ctx)).allowed, true);
  assert.equal(reads, 1);
  assert.ok(!ctx.reads.includes("get"));
});
test("revocation is observed by next admission and read failure propagates without fallback", async () => {
  const ctx = admissionContext({...production, operationsEnabled: true}, bound(production));
  let enabled = true;
  ctx.transaction = {get: async () => ({exists: true, data: () => ({...grant("subscription.create"), enabled})})};
  assert.equal((await admission.checkStoreFinancialAdmission(ctx)).allowed, true);
  enabled = false;
  assert.equal((await admission.checkStoreFinancialAdmission(ctx)).allowed, false);
  ctx.transaction.get = async () => {throw Error("synthetic storage failure");};
  await assert.rejects(admission.checkStoreFinancialAdmission(ctx), /synthetic storage failure/);
});
test("HML bound store and new unbound signup retain existing admission without root reads", async () => {
  for (const data of [bound(sandbox), {}]) {
    const ctx = admissionContext(sandbox, data);
    assert.equal((await admission.checkStoreFinancialAdmission(ctx)).allowed, true);
    assert.equal(ctx.reads.length, 0);
  }
});
test("unbound store cannot be automatically blocked or reconciled", async () => {
  for (const operation of ["subscription.overdue", "subscription.reconcile", "subscription.webhook"]) {
    const ctx = admissionContext(sandbox, {});
    ctx.operation = operation;
    assert.equal((await admission.checkStoreFinancialAdmission(ctx)).allowed, false);
  }
});

function syncPolicy(config, sync) {
  return load("subscriptionPriceSyncPolicy.js", {
    "./asaasConfig": {resolveAsaasConfig: () => config},
    "./subscriptionPricing": {syncAsaasSubscriptionPrice: sync},
  });
}
test("PROD caller explicitly skips price writer, even in simulated future activation", async () => {
  for (const operationsEnabled of [false, true]) {
    const policy = syncPolicy({...production, operationsEnabled}, () => {throw Error("price writer invoked");});
    const result = await policy.syncExistingSubscriptionPrice({storeId: "store-a"});
    assert.equal(result.skipped, true);
    assert.equal(result.updated, false);
  }
});
test("HML forwards exact sync options/result and does not hide financial errors", async () => {
  const options = {storeId: "store-a", subscriptionId: "synthetic-sub", plan: "pro"};
  const expected = {updated: true, oldPrice: 15.90, newPrice: 39.90};
  const policy = syncPolicy(sandbox, async (received) => {assert.equal(received, options); return expected;});
  assert.equal(await policy.syncExistingSubscriptionPrice(options), expected);
  const failing = syncPolicy(sandbox, async () => {throw Error("synthetic financial failure");});
  await assert.rejects(failing.syncExistingSubscriptionPrice(options), /synthetic financial failure/);
});
test("actual direct and bulk price writers reject PROD before credentials, database or HTTP", async () => {
  const forbidden = () => {throw Error("forbidden external effect");};
  const pricing = load("subscriptionPricing.js", {
    "firebase-admin": new Proxy({}, {get: forbidden}),
    axios: new Proxy({}, {get: forbidden}),
    "./asaasSecrets": {getAsaasApiKey: forbidden},
    "./asaasConfig": {resolveAsaasConfig: () => production},
  });
  await assert.rejects(pricing.syncAsaasSubscriptionPrice({storeId: "store-a", subscriptionId: "synthetic-sub", plan: "pro"}), /bloqueada fora do Sandbox/);
  await assert.rejects(pricing.syncAllAsaasSubscriptionPrices(), /bloqueada fora do Sandbox/);
  assert.equal(pricing.SUBSCRIPTION_PLANS.pro.price, 39.90);
  assert.equal(pricing.SUBSCRIPTION_PLANS.business.price, 99.90);
});

async function runOverdue(config, stores) {
  const writes = [];
  let commits = 0;
  const db = {
    collection(name) {
      assert.equal(name, "stores");
      return {where: () => ({get: async () => ({empty: stores.length === 0,
        docs: stores.map((data, n) => ({id: `synthetic-${n}`, ref: {id: n}, data: () => data}))})})};
    },
    batch: () => ({update(ref, value) {writes.push({ref, value});}, commit: async () => {commits++;}}),
  };
  const admin = {firestore: Object.assign(() => db, {FieldValue: {serverTimestamp: () => "synthetic-time"}})};
  class FixedDate extends Date {
    constructor(...args) {super(...(args.length ? args : ["2026-10-20T15:00:00Z"]));}
  }
  const context = {exports: {}, admin, console: quiet, Date: FixedDate,
    onSchedule: (_options, handler) => handler,
    resolveAsaasConfig: () => config, checkStoreFinancialAdmission: admission.checkStoreFinancialAdmission};
  vm.runInNewContext(index.slice(index.indexOf("exports.checkOverdueSubscriptions ="),
    index.indexOf("exports.onProductDelete =")), context);
  await context.exports.checkOverdueSubscriptions();
  return {writes, commits};
}
for (const [name, data] of [
  ["Sandbox in PROD", bound(sandbox)], ["unknown", {asaasSubscriptionId: "synthetic-sub"}],
  ["foreign project", {...bound(production), asaasBindingProjectId: "foreign-project"}],
  ["correct PROD still globally disabled", bound(production)],
]) {
  test(`actual overdue cron skips ${name} without blocking`, async () => {
    const result = await runOverdue(production, [{...data, overdueDueDate: "2026-10-16"}]);
    assert.equal(result.writes.length, 0);
    assert.equal(result.commits, 0);
  });
}
test("actual HML overdue cron preserves days 0-3; blocks day 4 and later exactly once per candidate", async () => {
  const dates = ["2026-10-20", "2026-10-19", "2026-10-18", "2026-10-17", "2026-10-16", "2026-10-15"];
  const result = await runOverdue(sandbox, dates.map(overdueDueDate => ({...bound(sandbox), overdueDueDate})));
  assert.equal(result.writes.length, 2);
  assert.equal(result.commits, 1);
  assert.equal(result.writes[0].ref.id, 4);
  assert.equal(result.writes[1].ref.id, 5);
  for (const {value} of result.writes) {
    assert.equal(value.subscriptionStatus, "inactive");
    assert.equal(value.subscriptionInactiveReason, "overdue");
    assert.deepEqual(Object.keys(value).sort(), ["blockedAt", "subscriptionInactiveReason", "subscriptionStatus"]);
  }
});
test("actual HML overdue cron skips missing origin and invalid dates", async () => {
  const result = await runOverdue(sandbox, [
    {asaasSubscriptionId: "synthetic-sub", overdueDueDate: "2026-10-16"},
    {...bound(sandbox), overdueDueDate: "invalid"}, {...bound(sandbox)},
  ]);
  assert.equal(result.writes.length, 0);
});

function callableFixture(config, data = bound(config), backendGrant, syncError) {
  const writes = [], http = [];
  const storeData = {ownerId: "owner", subscriptionType: "pro", ...data};
  const storeRef = {get: async () => ({exists: true, data: () => storeData}),
    collection: () => ({doc: () => ({id: "synthetic-audit"})}),
    update: async (value) => {writes.push(value);}};
  const db = {collection(name) {return {doc(id) {
    if (name === "stores") {assert.equal(id, "store-a"); return storeRef;}
    if (name === "asaasFinancialAdmission") return {get: async () => ({exists: !!backendGrant, data: () => backendGrant})};
    if (name === "users") return {get: async () => ({exists: true,
      data: () => ({storeId: "store-a", role: "admin", accessStatus: "active"})})};
    throw Error(`Unexpected collection ${name}`);
  }};}, runTransaction: async (callback) => callback({get: (ref) => ref.get(),
    update: () => {throw Error("Unexpected transaction write before admission");}})};
  const sync = syncPolicy(config, async () => {
    if (syncError) throw syncError;
    return {updated: false, oldPrice: 39.90, newPrice: 39.90};
  });
  const context = {exports: {}, console: quiet, HttpsError,
    runSubscriptionAttempt: require("../../financeiro/subscriptionAttempt").runSubscriptionAttempt,
    onCall: (_options, handler) => handler,
    admin: {firestore: Object.assign(() => db, {FieldValue: {serverTimestamp: () => "synthetic-time"}})},
    resolveAsaasConfig: () => config, getAsaasApiKey: () => "synthetic-mocked-key",
    asaasApiKey: {}, assertStoreFinancialAdmission: admission.assertStoreFinancialAdmission,
    assertAsaasBindingOrigin: (value, current) => {
      if (!origin.classifyAsaasBindingOrigin(value, current).allowed) throw new HttpsError("failed-precondition", "foreign binding");
    }, syncExistingSubscriptionPrice: sync.syncExistingSubscriptionPrice,
    SUBSCRIPTION_PLANS: {pro: {price: 39.90}, business: {price: 99.90, name: "Business"}},
    axios: {get: async (url) => {http.push({method: "GET", url}); return {data: {id: "synthetic-sub", nextDueDate: "2026-11-20"}};},
      put: async (url, value) => {http.push({method: "PUT", url, value}); return {data: {}};},
      post: () => {throw Error("Unexpected creation");}},
  };
  const changeStart = index.indexOf("exports.changeAsaasPlan =");
  vm.runInNewContext(index.slice(changeStart, index.indexOf("// 🛍️ CATÁLOGO INTELIGENTE", changeStart)), context);
  const createStart = index.indexOf("exports.createAsaasSubscription =");
  vm.runInNewContext(index.slice(createStart, index.indexOf("// STORE CONNECT - EXPORT: ARQUIVAMENTO", createStart)), context);
  return {context, writes, http, request: {auth: {uid: "owner"}, data: {storeId: "store-a", plan: "pro"}}};
}
test("actual create callable refuses non-admitted PROD store before lock, CPF, HTTP or mutation", async () => {
  const f = callableFixture({...production, operationsEnabled: true}, {});
  await assert.rejects(f.context.exports.createAsaasSubscription(f.request), {code: "failed-precondition"});
  assert.equal(f.writes.length, 0); assert.equal(f.http.length, 0);
});
test("actual plan callable denies non-admitted store and preserves ownership checks", async () => {
  const f = callableFixture({...production, operationsEnabled: true});
  await assert.rejects(f.context.exports.changeAsaasPlan(f.request), {code: "failed-precondition"});
  f.request.auth.uid = "foreign-user";
  await assert.rejects(f.context.exports.changeAsaasPlan(f.request), {code: "permission-denied"});
  assert.equal(f.writes.length, 0); assert.equal(f.http.length, 0);
});
test("actual same-plan PROD response explicitly says price unverified, never invokes price sync", async () => {
  const f = callableFixture({...production, operationsEnabled: true}, bound(production), grant("subscription.change-plan"));
  const result = await f.context.exports.changeAsaasPlan(f.request);
  assert.equal(result.alreadyOnPlan, true); assert.equal(result.priceVerified, false);
  assert.equal(result.priceUpdated, false); assert.equal(result.price, undefined);
  assert.equal(f.writes.length, 0); assert.equal(f.http.length, 0);
});
test("actual same-plan HML preserves price result and propagates financial failure", async () => {
  const f = callableFixture(sandbox);
  const result = await f.context.exports.changeAsaasPlan(f.request);
  assert.equal(result.price, 39.90); assert.equal(result.priceUpdated, false);
  const failing = callableFixture(sandbox, bound(sandbox), undefined, Error("synthetic sync failure"));
  await assert.rejects(failing.context.exports.changeAsaasPlan(failing.request), {code: "internal"});
  assert.equal(failing.writes.length, 0);
});
test("actual HML upgrade updates same subscription with official plan price, without pending payment sync", async () => {
  const f = callableFixture(sandbox);
  f.request.data.plan = "business";
  const result = await f.context.exports.changeAsaasPlan(f.request);
  assert.equal(result.newPlan, "business");
  assert.equal(f.http.length, 2);
  assert.equal(f.http[1].method, "PUT");
  assert.ok(f.http[1].url.endsWith("/subscriptions/synthetic-sub"));
  assert.equal(f.http[1].value.value, 99.90);
  assert.equal(f.http[1].value.updatePendingPayments, undefined);
  assert.equal(f.writes.length, 1);
});
