"use strict";

const assert = require("node:assert/strict");
const {test} = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sdk = require("firebase-functions/v2/https");
const crypto = require("node:crypto");

const apiFixture = "synthetic-api-only-a1";
const tokenFixture = "synthetic-webhook-only-a1";
const validEnv = {
  ASAAS_ENV: "sandbox", GCLOUD_PROJECT: "store-connect-hml",
  ASAAS_CREDENTIAL_ENV: "sandbox",
};

function load(relative, dependencies = {}, globals = {}) {
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../financeiro", relative), "utf8"), {
    module, exports: module.exports,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error("Unexpected dependency in offline fixture");
    },
    ...globals,
  });
  return module.exports;
}

function fixture(env = validEnv, values = {}) {
  const reads = [];
  const writes = [];
  const effects = [];
  const logs = [];
  const config = load("asaasConfig.js", {}, {process: {env: {...env}}});
  const supplied = {ASAAS_API_KEY: apiFixture, ASAAS_WEBHOOK_TOKEN: tokenFixture, ...values};
  const secrets = load("asaasSecrets.js", {
    "./asaasConfig": config,
    "firebase-functions/v2/https": sdk,
    "firebase-functions/params": {defineSecret(name) {
      return {name, value() {
        reads.push(name);
        const value = supplied[name];
        if (value instanceof Error) throw value;
        return value;
      }};
    }},
  });
  const auth = load("asaasWebhookAuth.js", {
    "node:crypto": crypto, "./asaasSecrets": secrets,
  });
  const forbidden = () => { effects.push("unexpected-IO"); throw new Error("Forbidden fixture operation"); };
  const store = {asaasSubscriptionId: "synthetic-subscription",
    asaasBindingEnvironment: "sandbox", asaasBindingProjectId: "store-connect-hml"};
  const storeRef = {
    get: async () => ({exists: true, updateTime: "synthetic-version", data: () => store}),
    update: async (data) => { writes.push(data); },
  };
  const db = {collection(name) {
    effects.push("firestore");
    assert.equal(name, "stores");
    return {
      where: () => ({limit: () => ({get: async () => ({empty: false, docs: [{id: "synthetic-store"}]})})}),
      doc: () => storeRef,
    };
  }};
  const fieldDelete = () => "synthetic-delete-sentinel";
  const admin = {firestore: Object.assign(() => db, {FieldValue: {delete: fieldDelete}})};
  const webhook = load("asaasWebhook.js", {
    "firebase-functions/v2/https": sdk,
    "firebase-admin": admin,
    axios: new Proxy({}, {get: () => forbidden}),
    "./asaasSecrets": secrets,
    "./asaasConfig": config,
    "./asaasWebhookAuth": auth,
    "./asaasBindingOrigin": require("../../financeiro/asaasBindingOrigin"),
    "./storeFinancialAdmission": require("../../financeiro/storeFinancialAdmission"),
    "./subscriptionPricing": {SUBSCRIPTION_PLANS: {pro: {price: 39.90}}},
  }, {console: Object.fromEntries(["log", "warn", "error"].map((key) => [key, (...args) => logs.push(args)]))});
  function request(token = tokenFixture) {
    return {
      method: "POST", get(name) { assert.equal(name, "asaas-access-token"); return token; },
      body: {event: "SUBSCRIPTION_DELETED", subscription: {id: "synthetic-subscription"}},
    };
  }
  async function invoke(req = request()) {
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      send(body) { this.body = body; return this; },
      json(body) { this.body = body; return this; },
    };
    await webhook.asaasWebhook(req, response);
    assert.ok(!JSON.stringify([logs, response.body]).includes(tokenFixture));
    assert.ok(!JSON.stringify([logs, response.body]).includes(apiFixture));
    return response;
  }
  return {config, secrets, auth, webhook, reads, writes, effects, logs, request, invoke};
}

for (const environment of ["sandbox", "production"]) {
  test(`canonical ${environment} resolves endpoint without implicit PROD operations`, () => {
    const value = fixture({...validEnv, ASAAS_ENV: environment, ASAAS_CREDENTIAL_ENV: environment,
      GCLOUD_PROJECT: environment === "sandbox" ? "store-connect-hml" : "store-connect-app"});
    const result = value.config.resolveAsaasConfig();
    assert.equal(result.baseUrl, environment === "sandbox"
      ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3");
    assert.equal(result.operationsEnabled, environment === "sandbox");
    assert.ok(Object.isFrozen(result));
    assert.equal(value.reads.length, 0);
  });
}

for (const override of [
  {ASAAS_ENV: undefined}, {ASAAS_ENV: "unknown"}, {ASAAS_ENV: "Production"},
  {GCLOUD_PROJECT: undefined}, {GCLOUD_PROJECT: "unknown-project"},
  {GCLOUD_PROJECT: "store-connect-app"},
  {ASAAS_ENV: "production", ASAAS_CREDENTIAL_ENV: "production"},
  {GOOGLE_CLOUD_PROJECT: "store-connect-app"},
  {ASAAS_CREDENTIAL_ENV: undefined}, {ASAAS_CREDENTIAL_ENV: "production"},
]) {
  test(`invalid context is blocked: ${JSON.stringify(override)}`, async () => {
    const value = fixture({...validEnv, ...override});
    assert.throws(value.config.resolveAsaasConfig);
    assert.throws(value.secrets.getAsaasApiKey);
    const response = await value.invoke();
    assert.equal(response.statusCode, 503);
    assert.equal(value.reads.length, 0);
    assert.equal(value.effects.length, 0);
    assert.equal(value.writes.length, 0);
  });
}

test("Google project alias works only when unambiguous", () => {
  const value = fixture({...validEnv, GCLOUD_PROJECT: undefined, GOOGLE_CLOUD_PROJECT: "store-connect-hml"});
  assert.equal(value.config.resolveAsaasConfig().projectId, "store-connect-hml");
});

for (const [label, token] of [
  ["missing", undefined], ["empty", ""], ["wrong", "synthetic-wrong"],
  ["API key substitution", apiFixture], ["duplicate header", [tokenFixture, tokenFixture]],
  ["whitespace", " " + tokenFixture], ["short", "x"],
]) {
  test(`webhook rejects ${label} before body, API key, Firestore or HTTP`, async () => {
    const value = fixture();
    const request = value.request();
    request.get = () => token;
    Object.defineProperty(request, "body", {get() { throw new Error("Body accessed before authentication"); }});
    const response = await value.invoke(request);
    assert.equal(response.statusCode, 401);
    assert.deepEqual(value.reads, ["ASAAS_WEBHOOK_TOKEN"]);
    assert.equal(value.effects.length, 0);
    assert.equal(value.writes.length, 0);
    assert.equal(value.logs.length, 0);
  });
}

for (const [label, secret] of [
  ["missing", undefined], ["empty", ""], ["blank", "   "],
  ["invalid type", 123], ["provider error", new Error(tokenFixture)],
]) {
  test(`webhook blocks ${label} secret without fallback`, async () => {
    const value = fixture(validEnv, {ASAAS_WEBHOOK_TOKEN: secret});
    const response = await value.invoke();
    assert.equal(response.statusCode, 503);
    assert.deepEqual(value.reads, ["ASAAS_WEBHOOK_TOKEN"]);
    assert.equal(value.effects.length, 0);
    assert.equal(value.writes.length, 0);
    assert.equal(value.logs.length, 0);
  });
}

test("correct webhook token authenticates without reading API key", () => {
  const value = fixture();
  assert.equal(value.auth.authenticateAsaasWebhook(value.request()), 200);
  assert.deepEqual(value.reads, ["ASAAS_WEBHOOK_TOKEN"]);
});

test("non-POST preserves 405 without reading either secret", async () => {
  const value = fixture();
  const request = value.request();
  request.method = "GET";
  const response = await value.invoke(request);
  assert.equal(response.statusCode, 405);
  assert.equal(value.reads.length, 0);
  assert.equal(value.effects.length, 0);
});

test("unreadable token header rejects without exposing error contents", async () => {
  const value = fixture();
  const request = value.request();
  request.get = () => { throw new Error(tokenFixture); };
  const response = await value.invoke(request);
  assert.equal(response.statusCode, 401);
  assert.equal(value.logs.length, 0);
  assert.equal(value.effects.length, 0);
});

test("legitimate Sandbox event preserves existing processing", async () => {
  const value = fixture();
  const response = await value.invoke();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "subscription_deleted");
  assert.equal(value.writes.length, 1);
  assert.equal(value.writes[0].subscriptionStatus, "inactive");
  assert.deepEqual(value.reads, ["ASAAS_WEBHOOK_TOKEN", "ASAAS_API_KEY"]);
});

test("missing API key after valid authentication still blocks effects", async () => {
  const value = fixture(validEnv, {ASAAS_API_KEY: undefined});
  const response = await value.invoke();
  assert.equal(response.statusCode, 503);
  assert.equal(value.effects.length, 0);
  assert.equal(value.writes.length, 0);
});

test("PROD remains blocked with keys, valid token and arbitrary activation variable", async () => {
  const value = fixture({...validEnv, ASAAS_ENV: "production", ASAAS_CREDENTIAL_ENV: "production",
    GCLOUD_PROJECT: "store-connect-app", ASAAS_PRODUCTION_ENABLED: "true"});
  assert.throws(value.secrets.getAsaasApiKey, (error) => error.code === "failed-precondition");
  const response = await value.invoke();
  assert.equal(response.statusCode, 503);
  assert.deepEqual(value.reads, ["ASAAS_WEBHOOK_TOKEN"]);
  assert.equal(value.effects.length, 0);
  assert.equal(value.writes.length, 0);
});

test("auth uses fixed-size digest timingSafeEqual, not string equality", () => {
  let comparisons = 0;
  const auth = load("asaasWebhookAuth.js", {
    "./asaasSecrets": {getAsaasWebhookToken: () => tokenFixture},
    "node:crypto": {...crypto, timingSafeEqual(left, right) {
      comparisons++;
      assert.equal(left.length, 32);
      assert.equal(right.length, 32);
      return crypto.timingSafeEqual(left, right);
    }},
  });
  assert.equal(auth.authenticateAsaasWebhook({get: () => "x"}), 401);
  assert.equal(auth.authenticateAsaasWebhook({get: () => tokenFixture}), 200);
  assert.equal(comparisons, 2);
});
