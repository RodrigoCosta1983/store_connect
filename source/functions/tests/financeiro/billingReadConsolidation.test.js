"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs");
const {HttpsError} = require("firebase-functions/v2/https");
const policy = require("../../financeiro/billingReadPolicy");
function fixture({store = {}, role = "admin", userStore = "pilot", owner = "owner", status, missingStore = false, operationsEnabled = true, secretMissing = false} = {}) {
  const effects = [];
  const module = {exports: {}};
  const deps = {
    "firebase-functions/v2/https": {HttpsError, onCall: (_, handler) => handler},
    "firebase-admin": {firestore: () => ({collection: name => ({doc: () => ({get: async () => name === "users"
      ? {exists: true, data: () => ({role, storeId: userStore})}
      : {exists: !missingStore, data: () => ({ownerId: owner, ...store})}})})})},
    axios: {get: async () => {effects.push("http"); if (status) throw {response: {status, data: {secret: "DO_NOT_EXPORT"}}};
      return {data: {id: "sub", customer: "customer", externalReference: "pilot"}};}},
    "./asaasSecrets": {asaasApiKey: {}, getAsaasApiKey: () => {effects.push("secret"); if (secretMissing) throw new HttpsError("failed-precondition", "Credencial indisponivel", {reason: "credential_unavailable"}); return "synthetic";}},
    "./asaasConfig": {resolveAsaasConfig: () => ({operationsEnabled, baseUrl: "https://invalid.local"})},
    "./storeFinancialAdmission": {assertStoreFinancialAdmission: async () => {}},
    "./asaasCompleteList": {completeListResponse: async () => ({data: {data: [], hasMore: false}})},
    "./billingReadPolicy": policy,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../../financeiro/faturas"), "utf8"),
    {module, exports: module.exports, require: name => {assert.ok(Object.hasOwn(deps, name), name); return deps[name];},
      console: {error() {throw Error("Sensitive logging forbidden");}}});
  return {handlers: module.exports, effects, request: {auth: {uid: "owner"}, data: {storeId: "pilot"}}};
}
test("authorized unbound store returns no invoices without config/secret/provider", async () => {
  const x = fixture(); const r = await x.handlers.listAsaasInvoices(x.request);
  assert.equal(r.billingState, "no_subscription"); assert.equal(r.invoices.length, 0); assert.deepEqual(x.effects, []);
});
test("portal without binding is a domain precondition, never missing Function or Asaas GET", async () => {
  const x = fixture(); await assert.rejects(x.handlers.getAsaasPortalUrl(x.request), e => e.code === "failed-precondition" && e.details.reason === "no_subscription");
  assert.deepEqual(x.effects, []);
});
for (const params of [{role: "gerente"}, {role: "operador"}, {role: "vendedor"}, {userStore: "other"}, {owner: "other"}]) {
  test(`unauthorized scope ${JSON.stringify(params)} cannot observe empty state`, async () => {
    const x = fixture(params);
    for (const handler of Object.values(x.handlers)) await assert.rejects(handler(x.request), {code: "permission-denied"});
    assert.deepEqual(x.effects, []);
  });
}
test("missing Firestore store differs from missing callable through its domain message", async () => {
  const x = fixture({missingStore: true});
  await assert.rejects(x.handlers.listAsaasInvoices(x.request), e => e.code === "not-found" && /Loja/.test(e.message));
  assert.deepEqual(x.effects, []);
});
test("partial binding fails closed with no credentials or HTTP", async () => {
  const x = fixture({store: {asaasCustomerId: "customer"}});
  await assert.rejects(x.handlers.listAsaasInvoices(x.request), e => e.details.reason === "incomplete_binding");
  assert.deepEqual(x.effects, []);
});
test("missing payload, invalid store and absent Auth never reach provider", async () => {
  const x = fixture();
  for (const handler of Object.values(x.handlers)) {
    await assert.rejects(handler({data: {storeId: "pilot"}}), {code: "unauthenticated"});
    for (const data of [undefined, {}, {storeId: "other/path"}, {storeId: 9}]) {
      await assert.rejects(handler({auth: {uid: "owner"}, data}), {code: "invalid-argument"});
    }
  }
  assert.deepEqual(x.effects, []);
});
for (const [status, reason] of [[401, "upstream_unauthorized"], [403, "upstream_forbidden"], [404, "upstream_resource_missing"], [500, "upstream_unavailable"]]) {
  test(`Asaas ${status} stays distinct and sanitized for both reads`, async () => {
    const x = fixture({store: {asaasCustomerId: "customer", asaasSubscriptionId: "sub"}, status});
    for (const handler of Object.values(x.handlers)) await assert.rejects(handler(x.request), e => e.details.reason === reason && !JSON.stringify(e).includes("DO_NOT_EXPORT"));
  });
}
test("PROD disabled operations still authorize and read unbound state without secret or HTTP", async () => {
  const x = fixture({operationsEnabled: false, store: {subscriptionStatus: "trial"}});
  assert.equal((await x.handlers.listAsaasInvoices(x.request)).billingState, "no_subscription");
  await assert.rejects(x.handlers.getAsaasPortalUrl(x.request), e => e.details.reason === "no_subscription");
  assert.deepEqual(x.effects, []);
});
test("PROD provider guard follows ownership and incomplete binding, never hides them", async () => {
  for (const [params, code, reason] of [[{role: "operador"}, "permission-denied", null],
    [{store: {asaasCustomerId: "customer"}}, "failed-precondition", "incomplete_binding"]]) {
    const x = fixture({...params, operationsEnabled: false});
    await assert.rejects(x.handlers.listAsaasInvoices(x.request), e => e.code === code && (!reason || e.details.reason === reason));
    assert.deepEqual(x.effects, []);
  }
});
test("PROD complete binding stays blocked before admission, secrets and provider", async () => {
  const x = fixture({operationsEnabled: false, store: {asaasCustomerId: "customer", asaasSubscriptionId: "sub"}});
  for (const handler of Object.values(x.handlers)) await assert.rejects(handler(x.request), e => e.details.reason === "provider_operations_disabled");
  assert.deepEqual(x.effects, []);
});
test("missing credential never reaches provider, is not no_subscription", async () => {
  const x = fixture({secretMissing: true, store: {asaasCustomerId: "customer", asaasSubscriptionId: "sub"}});
  await assert.rejects(x.handlers.listAsaasInvoices(x.request), e => e.details.reason === "credential_unavailable");
  assert.deepEqual(x.effects, ["secret"]);
});
