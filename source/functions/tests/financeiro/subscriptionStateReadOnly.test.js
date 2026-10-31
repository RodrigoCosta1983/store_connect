"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readSubscriptionState} = require("../../financeiro/subscriptionAttempt");
function read(store = {}, user = {}, attempt = null, operationsEnabled = false) {
  const db = {collection(name) {
    assert.ok(["users", "stores", "asaasSubscriptionAttempts"].includes(name));
    return {doc() {return {async get() {
      const value = name === "users" ? {role: "admin", storeId: "pilot", ...user}
        : name === "stores" ? {ownerId: "owner", ...store} : attempt;
      return {exists: value !== null, data: () => value};
    }}}};
  }}; // No write, transaction, secret or provider API exists in this fixture.
  return readSubscriptionState({db, config: {projectId: "store-connect-app", environment: "production", operationsEnabled},
    request: {auth: {uid: "owner"}, data: {storeId: "pilot"}}});
}
test("trial has no paid binding and PROD cannot contract", async () => {
  const state = await read({subscriptionStatus: "trial"});
  assert.equal(state.billingState, "no_subscription");
  assert.equal(state.canStart, false);
  assert.equal(state.authority, "firestore_only");
});
test("active business entitlement does not prove an Asaas subscription", async () => {
  assert.equal((await read({subscriptionStatus: "active", subscriptionType: "business"})).billingState, "no_subscription");
});
for (const store of [{asaasCustomerId: "synthetic"}, {asaasCustomerId: "synthetic", asaasSubscriptionId: "synthetic"}]) {
  test("existing or incomplete binding never enables a new attempt", async () => {
    assert.equal((await read(store, {}, null, true)).canStart, false);
  });
}
for (const reason of ["trial_expired", "overdue", "cancelled", "unknown"]) {
  test(`inactive reason remains distinct: ${reason}`, async () => {
    assert.equal((await read({subscriptionStatus: "inactive", subscriptionInactiveReason: reason})).inactiveReason, reason);
  });
}
for (const user of [{role: "gerente"}, {storeId: "other"}, {accessStatus: "revoked"}]) {
  test("read rejects unauthorized membership", async () => {
    await assert.rejects(read({}, user), {code: "permission-denied"});
  });
}
test("read rejects another owner and preserves inconclusive attempt", async () => {
  await assert.rejects(read({ownerId: "other"}), {code: "permission-denied"});
  const state = await read({}, {}, {status: "needs_review", command: {requestId: "synthetic"}}, true);
  assert.equal(state.canStart, false);
  assert.equal(state.attemptStatus, "needs_review");
});
