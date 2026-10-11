"use strict";

// Centraliza ambiente e endpoint. A futura validacao projeto x ambiente
// pertence aqui, depois da criacao/migracao do Firebase HML.
// P5.1.1-B will split Sandbox and Production secret names after HML setup.
function resolveAsaasConfig() {
  const environment = process.env.ASAAS_ENV;
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("Invalid or missing ASAAS_ENV");
  }

  return Object.freeze({
    environment,
    baseUrl: environment === "sandbox"
      ? "https://api-sandbox.asaas.com/v3"
      : "https://api.asaas.com/v3",
  });
}

module.exports = {resolveAsaasConfig};
