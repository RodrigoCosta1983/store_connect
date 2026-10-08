"use strict";

const {validateRestoreAdminRequest} = require("./storeRestoreAdminContract");
const {authorizeRestoreAdminRequest} = require("./storeRestoreAdminAuthorization");

const PROJECT_ID = "demo-store-connect-restore";
const HOSTS = ["127.0.0.1:8080", "localhost:8080", "[::1]:8080"];
function guard(projectId) {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!HOSTS.includes(host)) throw new Error("INVALID_EMULATOR_HOST");
  if (projectId !== PROJECT_ID) throw new Error("INVALID_EMULATOR_PROJECT");
  return host;
}

async function authorizeRestoreAdminInEmulator({request, authenticatedRequester, projectId} = {}) {
  const host = guard(projectId);
  const preflight = authorizeRestoreAdminRequest(request, {
    authenticatedRequester, userProfile: null, targetStore: null,
  });
  if (preflight.reasonCode !== "PROFILE_NOT_FOUND") return preflight;
  // Detach both inputs before any await, preserving all R2A fields without rehashing.
  const validatedRequest = validateRestoreAdminRequest(request).request;
  const auth = {uid: authenticatedRequester.uid, disabled: authenticatedRequester.disabled};
  // No injected client, default app, credentials or ambient project can select production.
  let db;
  let decision;
  try {
    const {Firestore} = require("firebase-admin/firestore");
    db = new Firestore({projectId, host, ssl: false});
    if (guard(projectId) !== host) throw new Error("INVALID_EMULATOR_HOST");
    const [user, store] = await Promise.all([
      db.doc("users/" + auth.uid).get(),
      db.doc("stores/" + validatedRequest.targetStoreId).get(),
    ]);
    if (guard(projectId) !== host) throw new Error("INVALID_EMULATOR_HOST");
    decision = authorizeRestoreAdminRequest(validatedRequest, {
      authenticatedRequester: auth,
      userProfile: user.exists ? {uid: user.id, data: user.data()} : null,
      targetStore: {id: store.id, exists: store.exists, data: store.exists ? store.data() : null},
    });
  } catch (_) {
    decision = {...preflight, reasonCode: "AUTHORIZATION_READ_FAILED"};
  } finally {
    if (db) {
      try { await db.terminate(); } catch (_) {
        decision = {...preflight, reasonCode: "AUTHORIZATION_READ_FAILED"};
      }
    }
  }
  return decision;
}

module.exports = {authorizeRestoreAdminInEmulator};
