"use strict";

const {defineSecret} = require("firebase-functions/params");
const {HttpsError} = require("firebase-functions/v2/https");

const asaasApiKey = defineSecret("ASAAS_API_KEY");

// Ler somente durante a invocacao, nunca na descoberta/deploy das Functions.
function getAsaasApiKey() {
  try {
    const value = asaasApiKey.value();

    if (typeof value === "string" && value.trim()) {
      return value;
    }
  } catch (_) {
    // Nao propagar detalhes do provedor nem o valor da credencial.
  }

  throw new HttpsError(
      "failed-precondition",
      "Credencial Asaas indisponível.",
  );
}

module.exports = {asaasApiKey, getAsaasApiKey};
