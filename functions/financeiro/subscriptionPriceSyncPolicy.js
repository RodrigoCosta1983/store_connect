"use strict";

const {resolveAsaasConfig} = require("./asaasConfig");
const {syncAsaasSubscriptionPrice} = require("./subscriptionPricing");

// Callers recovering an existing subscription must not invoke the Sandbox-only
// writer in PROD. A deliberate skip is explicit; genuine Sandbox errors propagate.
async function syncExistingSubscriptionPrice(options) {
  const config = resolveAsaasConfig();
  if (config.environment === "production") {
    return {skipped: true, updated: false, reason: "production_price_sync_disabled"};
  }
  return syncAsaasSubscriptionPrice(options);
}

module.exports = {syncExistingSubscriptionPrice};
