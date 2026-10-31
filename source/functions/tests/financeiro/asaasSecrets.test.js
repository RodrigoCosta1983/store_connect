"use strict";

const assert = require("node:assert/strict");
const {test, after} = require("node:test");
const {mock} = require("node:test");
const Module = require("node:module");
const {FieldValue, Timestamp} = require("firebase-admin/firestore");
const {asaasApiKey, getAsaasApiKey, asaasWebhookToken} = require("../../financeiro/asaasSecrets");

// Nunca ler credenciais do ambiente ou carregar .env neste teste.
const originalValue = asaasApiKey.value;
const originalWebhookValue = asaasWebhookToken.value;
asaasWebhookToken.value = () => "synthetic-webhook-fixture";
const originalContext = Object.fromEntries(
    ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "ASAAS_CREDENTIAL_ENV"].map(
        (name) => [name, process.env[name]],
    ),
);
process.env.GCLOUD_PROJECT = "store-connect-hml";
delete process.env.GOOGLE_CLOUD_PROJECT;
process.env.ASAAS_CREDENTIAL_ENV = "sandbox";
const fixture = "asaas-unit-test-only";
let secretReads = 0;
let suppliedValue;
let providerError = false;
const operations = [];
const logs = [];

asaasApiKey.value = () => {
  secretReads++;
  if (providerError) throw new Error(fixture);
  return suppliedValue;
};

function forbiddenOperation(name) {
  return () => {
    operations.push(name);
    throw new Error("Operacao externa ou Firestore bloqueada pelo teste.");
  };
}

const firestore = Object.assign(() => ({
  // Billing reads authorize against Firestore before requiring a provider key.
  // Only synthetic GET fixtures are permitted; all writers remain forbidden.
  collection(name) {
    if (!["users", "stores"].includes(name)) return forbiddenOperation("firestore.collection")();
    return {doc: () => ({get: async () => ({exists: true, data: () => name === "users"
      ? {storeId: "store-unit-test", role: "admin"}
      : {ownerId: "owner-unit-test", asaasCustomerId: "synthetic-customer", asaasSubscriptionId: "synthetic-sub",
        asaasBindingEnvironment: "sandbox", asaasBindingProjectId: "store-connect-hml"}})})};
  },
  runTransaction: forbiddenOperation("firestore.transaction"),
  batch: forbiddenOperation("firestore.batch"),
}), {FieldValue, Timestamp});
const admin = {
  apps: [],
  initializeApp() { this.apps.push({}); },
  firestore,
  auth: forbiddenOperation("auth"),
  storage: forbiddenOperation("storage"),
};
const axios = Object.fromEntries(
    ["get", "post", "put", "patch", "delete"].map(
        (method) => [method, forbiddenOperation(`axios.${method}`)],
    ),
);

const originalLoad = Module._load;
mock.method(Module, "_load", function(request, parent, isMain) {
  if (request === "firebase-admin") return admin;
  if (request === "axios") return axios;
  return originalLoad.call(this, request, parent, isMain);
});
for (const method of ["log", "warn", "error"]) {
  mock.method(console, method, (...args) => logs.push(args));
}

// Usar os construtores reais do SDK para verificar metadados de deploy.
// Firestore, Auth, Storage e Axios sao substituidos antes de importar o index.
const originalAsaasEnv = process.env.ASAAS_ENV;
delete process.env.ASAAS_ENV;
const originalApiKeyEnv = process.env.ASAAS_API_KEY;
delete process.env.ASAAS_API_KEY;
const functions = require("../../index");
const discoveryReads = secretReads;
process.env.ASAAS_ENV = "sandbox";

after(() => {
  if (originalAsaasEnv === undefined) delete process.env.ASAAS_ENV;
  else process.env.ASAAS_ENV = originalAsaasEnv;
  if (originalApiKeyEnv === undefined) delete process.env.ASAAS_API_KEY;
  else process.env.ASAAS_API_KEY = originalApiKeyEnv;
  asaasApiKey.value = originalValue;
  asaasWebhookToken.value = originalWebhookValue;
  for (const [name, value] of Object.entries(originalContext)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  mock.restoreAll();
});

function assertSafeError(error) {
  assert.equal(error.code, "failed-precondition");
  assert.equal(error.message, "Credencial Asaas indisponível.");
  assert.deepEqual(error.details, {reason: "credential_unavailable"});
  assert.ok(!String(error.stack).includes(fixture));
  return true;
}

test("descoberta e bindings: somente as sete Functions recebem ASAAS_API_KEY", () => {
  assert.equal(discoveryReads, 0);
  const expected = [
    "createAsaasSubscription",
    "changeAsaasPlan",
    "listAsaasInvoices",
    "getAsaasPortalUrl",
    "asaasWebhook",
    "syncAsaasSubscriptionPrices",
    "reconcileAsaasBilling",
    "reconcileAsaasSubscriptionV1",
    "reviewAsaasSubscriptionAttemptV1",
  ].sort();
  const actual = [];
  let unrelatedFunctions = 0;

  for (const [name, fn] of Object.entries(functions)) {
    assert.ok(fn.__endpoint, `Metadados ausentes: ${name}`);
    const bindings = fn.__endpoint.secretEnvironmentVariables || [];
    if (bindings.some((binding) => binding.key === "ASAAS_API_KEY")) {
      actual.push(name);
      assert.equal(bindings.filter((binding) => binding.key === "ASAAS_API_KEY").length, 1);
    } else {
      unrelatedFunctions++;
    }
  }

  assert.deepEqual(actual.sort(), expected);
  assert.ok(unrelatedFunctions > 0);
});

test("binding v2 do token independente existe somente no webhook", () => {
  const actual = Object.entries(functions).filter(([, fn]) =>
    (fn.__endpoint.secretEnvironmentVariables || []).some((binding) =>
      binding.key === "ASAAS_WEBHOOK_TOKEN"),
  ).map(([name]) => name);
  assert.deepEqual(actual, ["asaasWebhook"]);
  assert.deepEqual(functions.asaasWebhook.__endpoint.secretEnvironmentVariables.map((binding) => binding.key).sort(),
      ["ASAAS_API_KEY", "ASAAS_WEBHOOK_TOKEN"]);
  assert.equal(discoveryReads, 0);
});

test("PROD bloqueia todos consumidores financeiros antes de secret/IO", async () => {
  const readsBefore = secretReads;
  suppliedValue = fixture;
  process.env.ASAAS_ENV = "production";
  process.env.ASAAS_CREDENTIAL_ENV = "production";
  process.env.GCLOUD_PROJECT = "store-connect-app";
  try {
    for (const name of ["createAsaasSubscription", "changeAsaasPlan", "listAsaasInvoices",
      "getAsaasPortalUrl", "syncAsaasSubscriptionPrices", "reconcileAsaasBilling"]) {
      await assert.rejects(functions[name].run({auth: {uid: "owner-unit-test"},
        data: {storeId: "store-unit-test", plan: "pro"}}),
      (error) => name === "syncAsaasSubscriptionPrices"
        ? error.message === "A2/01: sincronizacao de precos bloqueada fora do Sandbox"
        : name === "reconcileAsaasBilling"
          ? error.message === "Asaas reconciliation operations disabled"
          : error.code === "failed-precondition");
    }
    assert.equal(secretReads, readsBefore);
    assert.deepEqual(operations, []);
  } finally {
    process.env.ASAAS_ENV = "sandbox";
    process.env.ASAAS_CREDENTIAL_ENV = "sandbox";
    process.env.GCLOUD_PROJECT = "store-connect-hml";
  }
});

test("contexto cruzado bloqueia todos consumidores antes de secret/IO", async () => {
  const readsBefore = secretReads;
  process.env.ASAAS_CREDENTIAL_ENV = "production";
  try {
    for (const name of ["createAsaasSubscription", "changeAsaasPlan", "listAsaasInvoices",
      "getAsaasPortalUrl", "syncAsaasSubscriptionPrices", "reconcileAsaasBilling"]) {
      await assert.rejects(functions[name].run({auth: {uid: "owner-unit-test"},
        data: {storeId: "store-unit-test", plan: "pro"}}), /Unauthorized Asaas configuration/);
    }
    assert.equal(secretReads, readsBefore);
    assert.deepEqual(operations, []);
  } finally {
    process.env.ASAAS_CREDENTIAL_ENV = "sandbox";
  }
});

test("helper rejeita credencial ausente, vazia, whitespace ou tipo invalido", () => {
  providerError = false;
  for (const value of [undefined, null, "", "   ", 123, {}]) {
    suppliedValue = value;
    assert.throws(getAsaasApiKey, assertSafeError);
  }
});

test("helper aceita somente a credencial ficticia fornecida pelo mock", () => {
  suppliedValue = fixture;
  assert.ok(getAsaasApiKey() === fixture);
  assert.ok(!JSON.stringify(logs).includes(fixture));
});

test("erro do provedor nao vaza valor, causa ou detalhes", () => {
  providerError = true;
  assert.throws(getAsaasApiKey, assertSafeError);
  assert.ok(!JSON.stringify(logs).includes(fixture));
  providerError = false;
});

test("callables vinculadas falham sem credencial antes de escrita ou Asaas; consultas autorizam por GET", async () => {
  suppliedValue = undefined;
  providerError = false;
  const request = {
    auth: {uid: "owner-unit-test"},
    data: {storeId: "store-unit-test", plan: "pro"},
  };

  for (const name of [
    "createAsaasSubscription", "changeAsaasPlan",
    "listAsaasInvoices", "getAsaasPortalUrl",
  ]) {
    await assert.rejects(functions[name].run(request), assertSafeError);
  }
  assert.deepEqual(operations, []);
});

test("webhook sem credencial retorna 503 para retry sem efeitos ou sucesso artificial", async () => {
  suppliedValue = undefined;
  const request = {
    method: "POST",
    get: () => "synthetic-webhook-fixture",
    body: {event: "SUBSCRIPTION_DELETED", subscription: {
      id: "sub-unit-test", externalReference: "store-unit-test",
    }},
  };
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    json(body) { this.body = body; return this; },
  };

  await functions.asaasWebhook(request, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body, "Service Unavailable");
  assert.deepEqual(operations, []);
  assert.ok(!JSON.stringify(logs).includes(fixture));
});

test("schedulers rejeitam ausencia antes de consultar lojas ou Asaas", async () => {
  suppliedValue = undefined;
  for (const name of ["syncAsaasSubscriptionPrices", "reconcileAsaasBilling"]) {
    await assert.rejects(functions[name].run({}), assertSafeError);
  }
  assert.deepEqual(operations, []);
});


test("default carrega sem credencial e nao exporta bootstrapStore", () => {
  assert.equal(functions.bootstrapStore, undefined);
  assert.equal(discoveryReads, 0);
});

for (const environment of [undefined, "invalid"]) {
  test(`fluxos financeiros rejeitam ambiente ${environment} antes de efeitos`, async () => {
    if (environment === undefined) delete process.env.ASAAS_ENV;
    else process.env.ASAAS_ENV = environment;
    const readsBefore = secretReads;
    try {
      const request = {auth: {uid: "owner-unit-test"}, data: {storeId: "store-unit-test", plan: "pro"}};
      for (const name of ["createAsaasSubscription", "changeAsaasPlan", "listAsaasInvoices", "getAsaasPortalUrl", "syncAsaasSubscriptionPrices", "reconcileAsaasBilling"]) {
        await assert.rejects(functions[name].run(request), /Invalid or missing ASAAS_ENV/);
      }
      const response = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        send(body) { this.body = body; return this; },
      };
      await functions.asaasWebhook({method: "POST", get: () => "synthetic-webhook-fixture", body: {}}, response);
      assert.equal(response.statusCode, 503);
      assert.equal(response.body, "Service Unavailable");
      assert.equal(secretReads, readsBefore);
      assert.deepEqual(operations, []);
    } finally {
      process.env.ASAAS_ENV = "sandbox";
    }
  });
}


for (const environment of ["sandbox"]) {
  test(`portal usa URL central e credencial do helper em ${environment}`, async () => {
    const originalFirestore = admin.firestore;
    const originalGet = axios.get;
    let observed = false;
    process.env.ASAAS_ENV = environment;
    suppliedValue = fixture;
    admin.firestore = () => ({collection: (name) => ({doc: () => ({get: async () => ({
      exists: true,
      data: () => name === "users"
        ? {storeId: "store-unit-test", role: "admin", accessStatus: "active"}
        : {ownerId: "owner-unit-test", asaasSubscriptionId: "sub-unit-test", asaasCustomerId: "customer-unit-test",
          asaasBindingEnvironment: "sandbox", asaasBindingProjectId: "store-connect-hml"},
    })})})});
    axios.get = async (url, options) => {
      if (url.endsWith('/subscriptions/sub-unit-test')) return {data: {id: 'sub-unit-test', customer: 'customer-unit-test', externalReference: 'store-unit-test'}};
      assert.equal(url, require("../../financeiro/asaasConfig").resolveAsaasConfig().baseUrl + "/payments");
      assert.ok(options.headers.access_token === fixture);
      assert.equal(options.params.subscription, "sub-unit-test");
      observed = true;
      throw new Error("Stop after verifying mocked request");
    };
    try {
      await assert.rejects(functions.getAsaasPortalUrl.run({
        auth: {uid: "owner-unit-test"}, data: {storeId: "store-unit-test"},
      }));
      assert.equal(observed, true);
    } finally {
      admin.firestore = originalFirestore;
      axios.get = originalGet;
      process.env.ASAAS_ENV = "sandbox";
    }
  });
}
