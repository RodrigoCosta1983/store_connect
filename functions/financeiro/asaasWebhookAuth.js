"use strict";

const {createHash, timingSafeEqual} = require("node:crypto");
const {getAsaasWebhookToken} = require("./asaasSecrets");

// Somente autentica: nao possui Admin, HTTP, logs ou fallback para a API key.
function authenticateAsaasWebhook(request) {
  let expected;
  try {
    expected = getAsaasWebhookToken();
  } catch (_) {
    return 503;
  }

  let supplied;
  try {
    supplied = request.get("asaas-access-token");
  } catch (_) {
    return 401;
  }
  if (typeof supplied !== "string" || !supplied) return 401;

  // Hashes de tamanho fixo evitam comparacao textual/retorno por comprimento.
  const digest = (value) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(expected), digest(supplied)) ? 200 : 401;
}

module.exports = {authenticateAsaasWebhook};
