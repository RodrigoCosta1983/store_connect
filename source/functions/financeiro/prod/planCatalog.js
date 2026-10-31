"use strict";
// First controlled PROD pilot: same Pro price as the existing subscriptionPricing catalog.
// No automatic repricing or Business plan mutation is included in this composition.
const SUBSCRIPTION_PLANS = Object.freeze({pro: Object.freeze({price: 39.90, name: "Store Connect Pro"})});
module.exports = {SUBSCRIPTION_PLANS};
