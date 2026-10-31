"use strict";
const {HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

// Optional for existing clients; mandatory on commands created by the new
// ledger. Check in the SAME transaction that derives user/store, closing the
// race between a client-side scope check and a profile moving to another store.
function assertMutationScope(input, uid, storeId) {
  if (!input.scope) return;
  const projectId = admin.app().options.projectId || process.env.GCLOUD_PROJECT;
  if (input.scope.uid !== uid || input.scope.storeId !== storeId || input.scope.projectId !== projectId) {
    throw new HttpsError("permission-denied", "Escopo da tentativa mudou.", {reason: "mutation-scope-mismatch"});
  }
}
module.exports = {assertMutationScope};
