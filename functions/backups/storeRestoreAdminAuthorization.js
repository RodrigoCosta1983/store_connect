"use strict";

const {validateRestoreAdminRequest} = require("./storeRestoreAdminContract");

// Context comes from the trusted caller, never from the administrative payload.
function dataMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error();
  }
  return value;
}
function exact(value, keys) {
  dataMap(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new Error();
}
function validId(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim() &&
    !value.includes("/") && !value.includes("\0") && value !== "." && value !== "..";
}

function authorizeRestoreAdminRequest(input, context) {
  let request;
  try { request = validateRestoreAdminRequest(input).request; } catch (_) {
    return {authorized: false, reasonCode: "INVALID_REQUEST", targetStoreId: null, requesterUid: null};
  }
  let requesterUid = null;
  const decision = (reasonCode) => ({authorized: reasonCode === "AUTHORIZED", reasonCode,
    targetStoreId: request.targetStoreId, requesterUid});
  try {
    exact(context, ["authenticatedRequester", "userProfile", "targetStore"]);
    if (context.authenticatedRequester === null) return decision("UNAUTHENTICATED");
    exact(context.authenticatedRequester, ["uid", "disabled"]);
    const auth = context.authenticatedRequester;
    if (!validId(auth.uid) || typeof auth.disabled !== "boolean") return decision("INVALID_AUTHORIZATION_CONTEXT");
    requesterUid = auth.uid;
    if (auth.uid !== request.requestedByUid) return decision("REQUESTER_MISMATCH");
    if (auth.disabled) return decision("REQUESTER_DISABLED");
    if (context.userProfile === null) return decision("PROFILE_NOT_FOUND");
    exact(context.userProfile, ["uid", "data"]);
    if (context.userProfile.uid !== auth.uid) return decision("INVALID_AUTHORIZATION_CONTEXT");
    const profile = dataMap(context.userProfile.data);
    if (!Object.hasOwn(profile, "storeId") || !validId(profile.storeId)) return decision("NOT_STORE_MEMBER");
    if (profile.storeId !== request.targetStoreId) return decision("NOT_STORE_MEMBER");
    if (typeof profile.role !== "string" || !profile.role.trim()) return decision("INVALID_AUTHORIZATION_CONTEXT");
    // Match existing backend role normalization, without normalizing identities.
    if (profile.role.trim().toLowerCase() !== "admin") return decision("INSUFFICIENT_PERMISSION");
    // Legacy profiles omit accessStatus; existing administrative operations accept them.
    if (Object.hasOwn(profile, "accessStatus")) {
      if (typeof profile.accessStatus !== "string") return decision("INVALID_AUTHORIZATION_CONTEXT");
      const status = profile.accessStatus.trim().toLowerCase();
      if (status === "revoked") return decision("ACCESS_REVOKED");
      if (status !== "active") return decision("INVALID_AUTHORIZATION_CONTEXT");
    }
    if (context.targetStore === null) return decision("STORE_NOT_FOUND");
    exact(context.targetStore, ["id", "exists", "data"]);
    const store = context.targetStore;
    if (store.id !== request.targetStoreId || typeof store.exists !== "boolean") return decision("INVALID_AUTHORIZATION_CONTEXT");
    if (!store.exists) return decision("STORE_NOT_FOUND");
    const storeData = dataMap(store.data);
    // Existing subscription administration requires both admin membership and ownership.
    if (request.mode === "REPLACE" && (!Object.hasOwn(storeData, "ownerId") ||
        !validId(storeData.ownerId) || storeData.ownerId !== auth.uid)) return decision("STORE_OWNER_REQUIRED");
    return decision("AUTHORIZED");
  } catch (_) {
    return decision("INVALID_AUTHORIZATION_CONTEXT");
  }
}

module.exports = {authorizeRestoreAdminRequest};
