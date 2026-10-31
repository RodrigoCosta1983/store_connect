"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const PROJECT = "store-connect-app";
const BASE_URL = "https://api.asaas.com/v3";
function fail(reason, code = "failed-precondition") {
  throw new HttpsError(code, "Operacao financeira indisponivel ou nao autorizada.", {reason});
}
function resolveProductionConfig(env = process.env) {
  if (env.GCLOUD_PROJECT !== PROJECT || env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_CLOUD_PROJECT !== PROJECT ||
      env.ASAAS_ENV !== "production" || env.ASAAS_CREDENTIAL_ENV !== "production" ||
      env.ASAAS_BASE_URL && env.ASAAS_BASE_URL !== BASE_URL ||
      env.FUNCTIONS_EMULATOR || env.FIRESTORE_EMULATOR_HOST) fail("financial_environment_inconsistent");
  const mode = env.ASAAS_PROD_MODE || "disabled";
  const reads = env.ASAAS_PROD_READS || "disabled";
  if (!["disabled", "pilot"].includes(mode) || !["disabled", "enabled"].includes(reads)) fail("financial_rollout_invalid");
  const pilotStoreId = env.ASAAS_PROD_PILOT_STORE_ID || "";
  if ((mode === "pilot" || reads === "enabled") &&
      (!/^[A-Za-z0-9_-]{1,128}$/.test(pilotStoreId) || mode === "pilot" && reads !== "enabled")) fail("financial_pilot_not_configured");
  return Object.freeze({projectId: PROJECT, environment: "production", baseUrl: BASE_URL,
    operationsEnabled: mode === "pilot", readsEnabled: reads === "enabled", pilotStoreId});
}
function readBoundSecret(secret, webhook = false) {
  let value;
  try { value = secret.value(); } catch (_) { fail("credential_unavailable"); }
  if (typeof value !== "string" || !value || value !== value.trim() || /[\r\n]/.test(value) ||
      webhook && (value.length < 32 || value.length > 255 || /\s/.test(value))) fail("credential_unavailable");
  return value;
}
module.exports = {PROJECT, BASE_URL, fail, resolveProductionConfig, readBoundSecret};
