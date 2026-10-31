"use strict";

// Pure decision. Provider evidence must be fetched read-only by the caller.
function mayRecoverInactive(store, billing) {
  if (store.subscriptionStatus !== "inactive") return true;
  return ["overdue", "trial_expired"].includes(store.subscriptionInactiveReason) &&
    billing.officialSubscriptionActive === true && billing.hasSettledPayment === true && !billing.hasOverdue;
}
function overdueDecision(daysLate) {
  if (!Number.isInteger(daysLate) || daysLate < 0) return "needs_review";
  return daysLate >= 4 ? "inactive" : daysLate >= 1 ? "overdue" : "current";
}
module.exports = {mayRecoverInactive, overdueDecision};
