"use strict";

// IDs canonicos documentados em PROD_VS_HML_OPERATING_MODEL.md.
// Secrets homonimos pertencem a namespaces de projetos distintos, nunca ao app.
function resolveAsaasConfig() {
  const environment = process.env.ASAAS_ENV;
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("Invalid or missing ASAAS_ENV");
  }

  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId ||
      (process.env.GCLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT &&
       process.env.GCLOUD_PROJECT !== process.env.GOOGLE_CLOUD_PROJECT) ||
      !((projectId === "store-connect-hml" && environment === "sandbox") ||
        (projectId === "store-connect-app" && environment === "production")) ||
      process.env.ASAAS_CREDENTIAL_ENV !== environment) {
    throw new Error("Unauthorized Asaas configuration");
  }

  return Object.freeze({
    environment,
    projectId,
    // A1 nunca libera PROD. Uma variavel ou uma key nao remove este bloqueio.
    operationsEnabled: environment === "sandbox",
    baseUrl: environment === "sandbox"
      ? "https://api-sandbox.asaas.com/v3"
      : "https://api.asaas.com/v3",
  });
}

module.exports = {resolveAsaasConfig};
