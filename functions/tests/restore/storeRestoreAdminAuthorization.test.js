"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {authorizeRestoreAdminRequest: authorize} = require("../../backups/storeRestoreAdminAuthorization");

function fixture(intent = "DRY_RUN", mode = "MERGE_A1") {
  const request = {schemaVersion: 1, intent, mode,
    source: {storeId: "source", checksumSha256: "a".repeat(64)},
    targetStoreId: "target", requestedByUid: "admin"};
  if (intent === "EXECUTE") {
    request.expectedPlanHash = "b".repeat(64);
    request.confirmation = {intent, targetStoreId: "target", mode,
      planHash: request.expectedPlanHash, confirmed: true};
    if (mode === "REPLACE") request.confirmation.destructiveActionAcknowledged = true;
  } else if (mode === "REPLACE") request.destructiveActionAcknowledged = true;
  const context = {authenticatedRequester: {uid: "admin", disabled: false},
    userProfile: {uid: "admin", data: {storeId: "target", role: "admin", accessStatus: "active"}},
    targetStore: {id: "target", exists: true, data: {ownerId: "admin"}}};
  return {request, context};
}
function expectReason(f, reasonCode) {
  assert.equal(authorize(f.request, f.context).reasonCode, reasonCode);
  assert.equal(authorize(f.request, f.context).authorized, reasonCode === "AUTHORIZED");
}
for (const intent of ["DRY_RUN", "EXECUTE"]) for (const mode of ["MERGE_A1", "REPLACE"]) {
  test(`${intent} ${mode}: canonical admin authorized`, () => expectReason(fixture(intent, mode), "AUTHORIZED"));
}
const denied = [
  ["missing requester", (f) => { f.context.authenticatedRequester = null; }, "UNAUTHENTICATED"],
  ["missing auth uid", (f) => { delete f.context.authenticatedRequester.uid; }, "INVALID_AUTHORIZATION_CONTEXT"],
  ["empty auth uid", (f) => { f.context.authenticatedRequester.uid = ""; }, "INVALID_AUTHORIZATION_CONTEXT"],
  ["invalid auth uid", (f) => { f.context.authenticatedRequester.uid = "a/b"; }, "INVALID_AUTHORIZATION_CONTEXT"],
  ["requester mismatch", (f) => { f.context.authenticatedRequester.uid = "other"; }, "REQUESTER_MISMATCH"],
  ["disabled Auth user", (f) => { f.context.authenticatedRequester.disabled = true; }, "REQUESTER_DISABLED"],
  ["missing Auth disabled flag", (f) => { delete f.context.authenticatedRequester.disabled; }, "INVALID_AUTHORIZATION_CONTEXT"],
  ["invalid Auth disabled flag", (f) => { f.context.authenticatedRequester.disabled = "false"; }, "INVALID_AUTHORIZATION_CONTEXT"],
  ["missing profile", (f) => { f.context.userProfile = null; }, "PROFILE_NOT_FOUND"],
  ["profile uid mismatch", (f) => { f.context.userProfile.uid = "other"; }, "INVALID_AUTHORIZATION_CONTEXT"],
  ["missing membership", (f) => { delete f.context.userProfile.data.storeId; }, "NOT_STORE_MEMBER"],
  ["empty membership", (f) => { f.context.userProfile.data.storeId = ""; }, "NOT_STORE_MEMBER"],
  ["membership identity not trimmed", (f) => { f.context.userProfile.data.storeId = " target "; }, "NOT_STORE_MEMBER"],
  ["membership malformed", (f) => { f.context.userProfile.data.storeId = 5; }, "NOT_STORE_MEMBER"],
  ["cross-store", (f) => { f.context.userProfile.data.storeId = "store-B"; }, "NOT_STORE_MEMBER"],
  ["admin only on source", (f) => { f.context.userProfile.data.storeId = f.request.source.storeId; }, "NOT_STORE_MEMBER"],
  ["operator", (f) => { f.context.userProfile.data.role = "operador"; }, "INSUFFICIENT_PERMISSION"],
  ["manager", (f) => { f.context.userProfile.data.role = "gerente"; }, "INSUFFICIENT_PERMISSION"],
  ["owner role is not admin", (f) => { f.context.userProfile.data.role = "owner"; }, "INSUFFICIENT_PERMISSION"],
  ["unknown role", (f) => { f.context.userProfile.data.role = "superadmin"; }, "INSUFFICIENT_PERMISSION"],
  ["missing role", (f) => { delete f.context.userProfile.data.role; }, "INVALID_AUTHORIZATION_CONTEXT"],
  ["object role", (f) => { f.context.userProfile.data.role = {admin: true}; }, "INVALID_AUTHORIZATION_CONTEXT"],
  ["empty role", (f) => { f.context.userProfile.data.role = " "; }, "INVALID_AUTHORIZATION_CONTEXT"],
  ["revoked membership", (f) => { f.context.userProfile.data.accessStatus = " REVOKED "; }, "ACCESS_REVOKED"],
  ["unknown status", (f) => { f.context.userProfile.data.accessStatus = "inactive"; }, "INVALID_AUTHORIZATION_CONTEXT"],
  ["null status", (f) => { f.context.userProfile.data.accessStatus = null; }, "INVALID_AUTHORIZATION_CONTEXT"],
  ["empty status", (f) => { f.context.userProfile.data.accessStatus = ""; }, "INVALID_AUTHORIZATION_CONTEXT"],
  ["missing store", (f) => { f.context.targetStore = null; }, "STORE_NOT_FOUND"],
  ["nonexistent store", (f) => { f.context.targetStore.exists = false; }, "STORE_NOT_FOUND"],
  ["wrong loaded store", (f) => { f.context.targetStore.id = "store-B"; }, "INVALID_AUTHORIZATION_CONTEXT"],
  ["nonboolean existence", (f) => { f.context.targetStore.exists = "true"; }, "INVALID_AUTHORIZATION_CONTEXT"],
  ["malformed profile", (f) => { f.context.userProfile.data = []; }, "INVALID_AUTHORIZATION_CONTEXT"],
  ["malformed store", (f) => { f.context.targetStore.data = null; }, "INVALID_AUTHORIZATION_CONTEXT"],
  ["context role spoof", (f) => { f.context.role = "admin"; }, "INVALID_AUTHORIZATION_CONTEXT"],
];
for (const [label, change, reason] of denied) test(`deny ${label}`, () => {
  const f = fixture(); change(f); expectReason(f, reason);
});
for (const key of ["schemaVersion", "intent", "mode", "source", "targetStoreId", "requestedByUid", "expectedPlanHash", "confirmation"]) {
  test(`R2A rejects missing ${key}`, () => {
    const f = fixture("EXECUTE"); delete f.request[key]; expectReason(f, "INVALID_REQUEST");
  });
}
for (const key of ["role", "capability", "ownerId", "authenticatedUid"]) test(`payload ${key} spoof rejected`, () => {
  const f = fixture(); f.request[key] = "admin"; expectReason(f, "INVALID_REQUEST");
});
for (const mode of ["CREATE", "MERGE_A2", "unknown"]) test(`R2A rejects ${mode}`, () => {
  const f = fixture(); f.request.mode = mode; expectReason(f, "INVALID_REQUEST");
});
for (const intent of ["DRY_RUN", "EXECUTE"]) {
  test(`${intent}: REPLACE nonowner admin denied`, () => {
    const f = fixture(intent, "REPLACE"); f.context.targetStore.data.ownerId = "other";
    expectReason(f, "STORE_OWNER_REQUIRED");
  });
  test(`${intent}: REPLACE missing owner denied`, () => {
    const f = fixture(intent, "REPLACE"); delete f.context.targetStore.data.ownerId;
    expectReason(f, "STORE_OWNER_REQUIRED");
  });
  test(`${intent}: REPLACE requires destructive confirmation`, () => {
    const f = fixture(intent, "REPLACE");
    (intent === "EXECUTE" ? f.request.confirmation : f.request).destructiveActionAcknowledged = false;
    expectReason(f, "INVALID_REQUEST");
  });
}
test("MERGE_A1 nonowner admin follows canonical backup policy", () => {
  const f = fixture(); f.context.targetStore.data.ownerId = "other"; expectReason(f, "AUTHORIZED");
});
test("canonical role normalization and legacy absent accessStatus", () => {
  const f = fixture(); f.context.userProfile.data.role = " ADMIN "; delete f.context.userProfile.data.accessStatus;
  expectReason(f, "AUTHORIZED");
});
test("authorization re-evaluated after revocation, no eternal EXECUTE grant", () => {
  const f = fixture("EXECUTE"); expectReason(f, "AUTHORIZED");
  f.context.userProfile.data.accessStatus = "revoked"; expectReason(f, "ACCESS_REVOKED");
});
test("EXECUTE confirmation mismatch remains R2A invalid", () => {
  const f = fixture("EXECUTE"); f.request.confirmation.planHash = "c".repeat(64); expectReason(f, "INVALID_REQUEST");
});
test("no identity inferred from profile or store", () => {
  const f = fixture(); f.request.targetStoreId = ""; expectReason(f, "INVALID_REQUEST");
});
test("accessors rejected without invocation", () => {
  const f = fixture(); Object.defineProperty(f.context.userProfile.data, "role", {
    enumerable: true, get() { assert.fail("getter invoked"); },
  }); expectReason(f, "INVALID_AUTHORIZATION_CONTEXT");
});
test("custom prototype and reflection failures fail closed", () => {
  const f = fixture(); Object.setPrototypeOf(f.context.userProfile.data, {role: "admin"});
  expectReason(f, "INVALID_AUTHORIZATION_CONTEXT");
  const {proxy, revoke} = Proxy.revocable({}, {}); revoke(); f.context = proxy;
  expectReason(f, "INVALID_AUTHORIZATION_CONTEXT");
});
test("frozen inputs unchanged, deterministic output contains no documents", () => {
  const f = fixture("EXECUTE", "REPLACE"); const before = JSON.stringify(f);
  function freeze(v) { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } }
  freeze(f); const result = authorize(f.request, f.context);
  assert.deepEqual(result, authorize(f.request, f.context));
  assert.deepEqual(Object.keys(result).sort(), ["authorized", "reasonCode", "requesterUid", "targetStoreId"]);
  result.targetStoreId = "changed"; assert.equal(JSON.stringify(f), before);
});
test("isolated import and invocation: only R2A dependency, no Firebase/env/clock/random/I/O", () => {
  const contractSource = fs.readFileSync(require.resolve("../../backups/storeRestoreAdminContract"), "utf8");
  const policySource = fs.readFileSync(require.resolve("../../backups/storeRestoreAdminAuthorization"), "utf8");
  const ambient = () => { throw new Error("ambient access prohibited"); };
  function sandbox(requireDependency) {
    const box = {module: {exports: {}}, require: requireDependency,
      Date: class extends Date { static now() { return ambient(); } },
      Math: Object.assign(Object.create(Math), {random: ambient}),
      setTimeout: ambient, setInterval: ambient, fetch: ambient, crypto: {randomUUID: ambient}};
    Object.defineProperty(box, "process", {get: ambient});
    return box;
  }
  const box = sandbox(ambient); const realm = vm.createContext(box);
  vm.runInContext("(function(module, require) {" + contractSource + "\n})(module, require)", realm);
  const contract = box.module.exports; box.module = {exports: {}};
  box.require = (id) => { assert.equal(id, "./storeRestoreAdminContract"); return contract; };
  vm.runInContext("(function(module, require) {" + policySource + "\n})(module, require)", realm);
  // Use data objects from the same realm as the isolated validator.
  box.fixtureJson = JSON.stringify(fixture("EXECUTE", "REPLACE"));
  assert.equal(vm.runInContext("const f = JSON.parse(fixtureJson); module.exports.authorizeRestoreAdminRequest(f.request, f.context).authorized", realm), true);
});
