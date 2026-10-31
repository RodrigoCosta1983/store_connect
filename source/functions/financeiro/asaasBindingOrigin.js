"use strict";

// A2/02b: exige origem explicita nos vinculos Asaas. Sem inferir ambiente
// apenas pela aparencia de um ID ou pelo projeto Firebase.
const PROJECT_BY_ENVIRONMENT = Object.freeze({
  sandbox: "store-connect-hml",
  production: "store-connect-app",
});

function classifyAsaasBindingOrigin(storeData, config) {
  const data = storeData || {};
  const environment = config?.environment;
  const projectId = config?.projectId;

  if (PROJECT_BY_ENVIRONMENT[environment] !== projectId) {
    return {allowed: false, reason: "invalid_runtime_context"};
  }

  const customerId = data.asaasCustomerId;
  const subscriptionId = data.asaasSubscriptionId;
  const isPresent = (value) => value !== null && value !== undefined &&
    String(value).trim() !== "";
  const hasCustomer = isPresent(customerId);
  const hasSubscription = isPresent(subscriptionId);
  if ((hasCustomer && typeof customerId !== "string") ||
      (hasSubscription && typeof subscriptionId !== "string")) {
    return {allowed: false, reason: "invalid_financial_id"};
  }

  const originEnv = data.asaasBindingEnvironment;
  const originProject = data.asaasBindingProjectId;
  const originPresent = originEnv !== undefined && originEnv !== null ||
    originProject !== undefined && originProject !== null;

  if (!originPresent) {
    if (hasCustomer || hasSubscription) {
      return {allowed: false, reason: "legacy_origin_unverified"};
    }
    return {allowed: true, kind: "new_unbound"};
  }

  if (originEnv !== environment || originProject !== projectId) {
    return {allowed: false, reason: "origin_mismatch_or_incomplete"};
  }

  return {
    allowed: true,
    kind: hasCustomer || hasSubscription ? "verified_binding" : "empty_binding",
  };
}

function stampAsaasBindingOrigin(config) {
  if (PROJECT_BY_ENVIRONMENT[config?.environment] !== config?.projectId) {
    throw new Error("Invalid Asaas binding context");
  }
  return {
    asaasBindingEnvironment: config.environment,
    asaasBindingProjectId: config.projectId,
  };
}

module.exports = {
  classifyAsaasBindingOrigin,
  stampAsaasBindingOrigin,
};
