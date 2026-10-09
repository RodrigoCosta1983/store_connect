"use strict";

const assert = require("node:assert/strict");
const {test, after} = require("node:test");
const {mock} = require("node:test");
const Module = require("node:module");
const {FieldValue, Timestamp} = require("firebase-admin/firestore");
const {asaasApiKey, getAsaasApiKey} = require("../../financeiro/asaasSecrets");

// Nunca ler credenciais do ambiente ou carregar .env neste teste.
const originalValue = asaasApiKey.value;
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
  collection: forbiddenOperation("firestore.collection"),
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
const functions = require("../../index");
const discoveryReads = secretReads;

after(() => {
  asaasApiKey.value = originalValue;
  mock.restoreAll();
});

function assertSafeError(error) {
  assert.equal(error.code, "failed-precondition");
  assert.equal(error.message, "Credencial Asaas indisponível.");
  assert.equal(error.details, undefined);
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

test("callables falham antes de Firestore/Asaas sem credencial", async () => {
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

test("webhook sem credencial retorna 500 sem efeitos ou sucesso artificial", async () => {
  suppliedValue = undefined;
  const request = {
    method: "POST",
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
  assert.equal(response.statusCode, 500);
  assert.equal(response.body, "Erro interno");
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
