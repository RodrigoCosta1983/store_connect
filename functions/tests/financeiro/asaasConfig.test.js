"use strict";

const assert = require("node:assert/strict");
const {test, after} = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {resolveAsaasConfig} = require("../../financeiro/asaasConfig");
const originalEnv = process.env.ASAAS_ENV;

after(() => {
  if (originalEnv === undefined) delete process.env.ASAAS_ENV;
  else process.env.ASAAS_ENV = originalEnv;
});

for (const [environment, baseUrl] of [
  ["sandbox", "https://api-sandbox.asaas.com/v3"],
  ["production", "https://api.asaas.com/v3"],
]) {
  test(`resolve ${environment} com URL canonica`, () => {
    process.env.ASAAS_ENV = environment;
    assert.deepEqual(resolveAsaasConfig(), {environment, baseUrl});
    assert.ok(Object.isFrozen(resolveAsaasConfig()));
  });
}

for (const value of [undefined, "", "foo", "Sandbox", " sandbox ", "PRODUCTION", "production "]) {
  test(`rejeita configuracao ${JSON.stringify(value)} sem fallback ou detalhes`, () => {
    if (value === undefined) delete process.env.ASAAS_ENV;
    else process.env.ASAAS_ENV = value;
    assert.throws(resolveAsaasConfig, (error) => {
      assert.equal(error.message, "Invalid or missing ASAAS_ENV");
      assert.equal(error.cause, undefined);
      assert.equal(error.details, undefined);
      return true;
    });
  });
}

// Executa os modulos com dependencias isoladas: nenhuma API ou banco acessivel.
function loadIsolated(file, resolver) {
  const exports = {};
  const module = {exports};
  const forbidden = () => { throw new Error("External operation forbidden"); };
  const admin = {apps: [{}], initializeApp() {}, firestore: () => ({})};
  const sdk = new Proxy({}, {get: () => () => ({})});
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    exports, module, console: {log() {}},
    require(name) {
      if (name.endsWith("/asaasConfig")) return {resolveAsaasConfig: resolver};
      if (name === "firebase-admin") return admin;
      if (name === "axios") return new Proxy({}, {get: () => forbidden});
      if (name.startsWith("firebase-functions")) return sdk;
      return {};
    },
  }, {filename: file});
  return module.exports;
}

for (const relative of [
  "index.js", "financeiro/faturas.js", "financeiro/asaasWebhook.js",
  "financeiro/subscriptionPricing.js", "financeiro/reconcileAsaasBilling.js",
]) {
  test(`${relative} carrega sem resolver configuracao Asaas`, () => {
    let calls = 0;
    loadIsolated(path.resolve(__dirname, "../..", relative), () => {
      calls++;
      throw new Error("Invalid or missing ASAAS_ENV");
    });
    assert.equal(calls, 0);
  });
}

for (const environment of ["sandbox", "production"]) {
  test(`subscriptionPricing usa ambiente validado ${environment}`, () => {
    process.env.ASAAS_ENV = environment;
    let calls = 0;
    const pricing = loadIsolated(path.resolve(__dirname, "../../financeiro/subscriptionPricing.js"), () => {
      calls++;
      return resolveAsaasConfig();
    });
    assert.equal(calls, 0);
    assert.equal(pricing.SUBSCRIPTION_PRICE_POLICY.updatePendingPayments, environment === "sandbox");
    assert.equal(calls, 1);
  });
}
