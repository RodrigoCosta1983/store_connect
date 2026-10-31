"use strict";

const {defineSecret} = require("firebase-functions/params");
const {HttpsError} = require("firebase-functions/v2/https");
const {resolveAsaasConfig} = require("./asaasConfig");

// Mesmo nome, namespaces Firebase separados e validados antes de .value().
// Nao vincular ambos os ambientes a uma mesma Function.
const asaasApiKey = defineSecret("ASAAS_API_KEY");
const asaasWebhookToken = defineSecret("ASAAS_WEBHOOK_TOKEN");

// Ler somente durante a invocacao, nunca na descoberta/deploy das Functions.
function getAsaasApiKey() {
  const config = resolveAsaasConfig();
  if (!config.operationsEnabled) {
    throw new HttpsError("failed-precondition", "Operações Asaas PROD bloqueadas no A1.");
  }
  return readSecret(asaasApiKey);
}

function getAsaasWebhookToken() {
  resolveAsaasConfig();
  return readSecret(asaasWebhookToken);
}

function readSecret(secret) {
  try {
    const value = secret.value();

    if (typeof value === "string" && value.trim()) {
      return value;
    }
  } catch (_) {
    // Nao propagar detalhes do provedor nem o valor da credencial.
  }

  throw new HttpsError(
      "failed-precondition",
      "Credencial Asaas indisponível.",
      {reason: "credential_unavailable"},
  );
}

module.exports = {
  asaasApiKey, getAsaasApiKey, asaasWebhookToken, getAsaasWebhookToken,
};
