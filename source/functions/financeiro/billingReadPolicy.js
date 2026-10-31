"use strict";
// Entitlement is not proof of an Asaas payment or binding.
function billingReadState(store) {
  if (!store.asaasCustomerId && !store.asaasSubscriptionId) return "unbound";
  if (!store.asaasCustomerId || !store.asaasSubscriptionId) return "incomplete";
  return "bound";
}
function billingReadFailure(error) {
  const status = error.response?.status;
  if (status === 401) return {code: "failed-precondition", reason: "upstream_unauthorized"};
  if (status === 403) return {code: "permission-denied", reason: "upstream_forbidden"};
  if (status === 404) return {code: "failed-precondition", reason: "upstream_resource_missing"};
  return {code: "unavailable", reason: "upstream_unavailable"};
}
module.exports = {billingReadState, billingReadFailure};
