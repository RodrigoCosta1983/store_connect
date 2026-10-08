"use strict";

class StoreRestoreAdminValidationError extends Error {
  constructor() {
    super("INVALID_RESTORE_ADMIN_REQUEST");
    this.name = "StoreRestoreAdminValidationError";
    this.code = "INVALID_RESTORE_ADMIN_REQUEST";
  }
}
function check(condition) {
  if (!condition) throw new StoreRestoreAdminValidationError();
}
// Inspect descriptors before reading: accessors are never invoked.
function exact(value, keys) {
  check(value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const ownKeys = Reflect.ownKeys(value);
  check(ownKeys.length === keys.length && keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable && Object.hasOwn(descriptor, "value");
  }));
}
// R1 segment identity rules plus strict administrative whitespace rejection.
function validId(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim() &&
    !value.includes("/") && !value.includes("\0") && value !== "." && value !== "..";
}
function validHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function validateRequest(input) {
  // Read discriminants only after checking their descriptors.
  check(input !== null && typeof input === "object" && !Array.isArray(input));
  for (const key of ["intent", "mode"]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    check(descriptor && Object.hasOwn(descriptor, "value"));
  }
  const {intent, mode} = input;
  check(["DRY_RUN", "EXECUTE"].includes(intent));
  check(["MERGE_A1", "REPLACE"].includes(mode));
  const keys = ["schemaVersion", "intent", "mode", "source", "targetStoreId", "requestedByUid"];
  if (intent === "EXECUTE") keys.push("expectedPlanHash", "confirmation");
  else if (mode === "REPLACE") keys.push("destructiveActionAcknowledged");
  exact(input, keys);
  check(input.schemaVersion === 1);
  exact(input.source, ["storeId", "checksumSha256"]);
  check(validId(input.source.storeId) && validHash(input.source.checksumSha256));
  check(validId(input.targetStoreId) && validId(input.requestedByUid));
  check(input.source.storeId !== input.targetStoreId);
  const request = {schemaVersion: 1, intent, mode,
    source: {storeId: input.source.storeId, checksumSha256: input.source.checksumSha256},
    targetStoreId: input.targetStoreId, requestedByUid: input.requestedByUid};
  if (intent === "DRY_RUN" && mode === "REPLACE") {
    check(input.destructiveActionAcknowledged === true);
    request.destructiveActionAcknowledged = true;
  }
  if (intent === "EXECUTE") {
    check(validHash(input.expectedPlanHash));
    const confirmationKeys = ["intent", "targetStoreId", "mode", "planHash", "confirmed"];
    if (mode === "REPLACE") confirmationKeys.push("destructiveActionAcknowledged");
    exact(input.confirmation, confirmationKeys);
    const confirmation = input.confirmation;
    check(confirmation.intent === "EXECUTE" && confirmation.confirmed === true &&
      confirmation.targetStoreId === input.targetStoreId && confirmation.mode === mode &&
      confirmation.planHash === input.expectedPlanHash);
    if (mode === "REPLACE") check(confirmation.destructiveActionAcknowledged === true);
    request.expectedPlanHash = input.expectedPlanHash;
    request.confirmation = {intent: "EXECUTE", targetStoreId: input.targetStoreId,
      mode, planHash: input.expectedPlanHash, confirmed: true};
    if (mode === "REPLACE") request.confirmation.destructiveActionAcknowledged = true;
  }
  return {ok: true, request};
}
function validateRestoreAdminRequest(input) {
  try {
    return validateRequest(input);
  } catch (_) {
    // Reflection failures also fail closed without forwarding arbitrary errors.
    throw new StoreRestoreAdminValidationError();
  }
}
function validateDryRunRequest(input) {
  const result = validateRestoreAdminRequest(input);
  check(result.request.intent === "DRY_RUN");
  return result;
}
function validateExecuteRequest(input) {
  const result = validateRestoreAdminRequest(input);
  check(result.request.intent === "EXECUTE");
  return result;
}

module.exports = {StoreRestoreAdminValidationError, validateRestoreAdminRequest,
  validateDryRunRequest, validateExecuteRequest};
