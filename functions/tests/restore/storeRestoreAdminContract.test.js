"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const contract = require("../../backups/storeRestoreAdminContract");
const validate = contract.validateRestoreAdminRequest;
const hash = "a".repeat(64);
function fixture(intent = "DRY_RUN", mode = "MERGE_A1") {
  const request = {schemaVersion: 1, intent, mode,
    source: {storeId: "store-A", checksumSha256: "b".repeat(64)},
    targetStoreId: "store-B", requestedByUid: "admin-uid"};
  if (intent === "EXECUTE") {
    request.expectedPlanHash = hash;
    request.confirmation = {intent, targetStoreId: request.targetStoreId,
      mode, planHash: hash, confirmed: true};
    if (mode === "REPLACE") request.confirmation.destructiveActionAcknowledged = true;
  } else if (mode === "REPLACE") request.destructiveActionAcknowledged = true;
  return request;
}
function rejects(value) {
  assert.throws(() => validate(value), (error) =>
    error instanceof contract.StoreRestoreAdminValidationError &&
    error.code === "INVALID_RESTORE_ADMIN_REQUEST" && error.message === error.code);
}
for (const intent of ["DRY_RUN", "EXECUTE"]) for (const mode of ["MERGE_A1", "REPLACE"]) {
  test(`${intent} ${mode} accepted`, () => {
    const input = fixture(intent, mode);
    assert.deepEqual(validate(input), {ok: true, request: input});
    const specific = intent === "DRY_RUN" ? contract.validateDryRunRequest : contract.validateExecuteRequest;
    assert.deepEqual(specific(input), validate(input));
  });
}
for (const [label, value] of [["null", null], ["array", []], ["string", "request"],
  ["number", 1], ["undefined", undefined], ["empty", {}]]) {
  test(`reject ${label}`, () => rejects(value));
}
for (const key of ["schemaVersion", "intent", "mode", "source", "targetStoreId", "requestedByUid",
  "expectedPlanHash", "confirmation"]) {
  test(`reject missing ${key}`, () => {
    const request = fixture("EXECUTE"); delete request[key]; rejects(request);
  });
}
for (const [key, values] of Object.entries({
  schemaVersion: [2, "1", null], intent: ["", "RUN", null, 1],
  mode: ["", "UNKNOWN", "MERGE_A2", "CREATE", null, 1],
  targetStoreId: ["", " ", " store-B", "store-B ", "a/b", ".", "..", "a\0b", 1, null],
  requestedByUid: ["", " ", " uid", "a/b", 1, null],
  source: [null, [], "store-A", {}],
  expectedPlanHash: ["", "a".repeat(63), "A".repeat(64), "z".repeat(64), 1, null],
  confirmation: [null, [], true, {}],
})) for (const [index, value] of values.entries()) {
  test(`reject ${key} invalid ${index}`, () => {
    const request = fixture("EXECUTE"); request[key] = value; rejects(request);
  });
}
for (const key of ["storeId", "checksumSha256"]) {
  for (const value of [undefined, "", " ", 1, null]) {
    test(`reject source ${key} ${String(value)}`, () => {
      const request = fixture();
      if (value === undefined) delete request.source[key]; else request.source[key] = value;
      rejects(request);
    });
  }
}
for (const [key, value] of [["intent", "DRY_RUN"], ["targetStoreId", "store-C"],
  ["mode", "REPLACE"], ["planHash", "c".repeat(64)], ["confirmed", false],
  ["confirmed", "true"], ["confirmed", 1]]) {
  test(`reject confirmation mismatch ${key} ${String(value)}`, () => {
    const request = fixture("EXECUTE"); request.confirmation[key] = value; rejects(request);
  });
}
for (const key of ["intent", "targetStoreId", "mode", "planHash", "confirmed"]) {
  test(`reject missing confirmation ${key}`, () => {
    const request = fixture("EXECUTE"); delete request.confirmation[key]; rejects(request);
  });
}
for (const intent of ["DRY_RUN", "EXECUTE"]) for (const value of [undefined, false, "true", 1, null]) {
  test(`REPLACE ${intent} rejects destructive acknowledgement ${String(value)}`, () => {
    const request = fixture(intent, "REPLACE");
    const holder = intent === "EXECUTE" ? request.confirmation : request;
    if (value === undefined) delete holder.destructiveActionAcknowledged;
    else holder.destructiveActionAcknowledged = value;
    rejects(request);
  });
}
test("same-store rejected by operational R1G boundary", () => {
  const request = fixture(); request.targetStoreId = request.source.storeId; rejects(request);
});
test("MERGE_A1 cannot escalate to REPLACE by changing mode", () => {
  const request = fixture("EXECUTE"); request.mode = "REPLACE"; rejects(request);
});
test("REPLACE confirmation cannot move to store C", () => {
  const request = fixture("EXECUTE", "REPLACE"); request.targetStoreId = "store-C"; rejects(request);
});
test("plan X cannot authorize plan Y", () => {
  const request = fixture("EXECUTE"); request.expectedPlanHash = "d".repeat(64); rejects(request);
});
test("intent-specific validators reject opposite intent", () => {
  assert.throws(() => contract.validateDryRunRequest(fixture("EXECUTE")), contract.StoreRestoreAdminValidationError);
  assert.throws(() => contract.validateExecuteRequest(fixture()), contract.StoreRestoreAdminValidationError);
});
for (const location of ["root", "source", "confirmation"]) for (const key of ["unknown", "metadata", "__proto__"]) {
  test(`unknown ${location} ${key} rejected`, () => {
    const request = fixture("EXECUTE");
    const holder = location === "root" ? request : request[location];
    Object.defineProperty(holder, key, {value: true, enumerable: true}); rejects(request);
  });
}
test("DRY_RUN rejects execution fields", () => {
  const request = fixture(); request.expectedPlanHash = hash; rejects(request);
});
test("MERGE_A1 rejects destructive semantics", () => {
  const request = fixture("EXECUTE"); request.confirmation.destructiveActionAcknowledged = true; rejects(request);
});
for (const location of ["root", "source", "confirmation"]) {
  test(`accessor ${location} rejected without invocation`, () => {
    const request = fixture("EXECUTE"); const holder = location === "root" ? request : request[location];
    const key = location === "root" ? "intent" : location === "source" ? "storeId" : "confirmed";
    Object.defineProperty(holder, key, {get() { assert.fail("accessor invoked"); }, enumerable: true});
    rejects(request);
  });
  test(`symbol ${location} rejected`, () => {
    const request = fixture("EXECUTE"); (location === "root" ? request : request[location])[Symbol("extra")] = true;
    rejects(request);
  });
}
test("custom prototype rejected", () => {
  const request = fixture(); Object.setPrototypeOf(request, {admin: true}); rejects(request);
});
test("non-enumerable extra rejected", () => {
  const request = fixture(); Object.defineProperty(request, "execute", {value: true}); rejects(request);
});
test("reflection failure returns controlled error", () => {
  const {proxy, revoke} = Proxy.revocable({}, {}); revoke(); rejects(proxy);
});
test("deterministic, frozen input preserved, output detached", () => {
  const request = fixture("EXECUTE", "REPLACE"); const before = JSON.stringify(request);
  Object.freeze(request.source); Object.freeze(request.confirmation); Object.freeze(request);
  const first = validate(request); assert.deepEqual(first, validate(request));
  first.request.source.storeId = "changed"; first.request.confirmation.targetStoreId = "changed";
  assert.equal(JSON.stringify(request), before);
});
test("import and invocation require zero dependencies or ambient clock/randomness", () => {
  const path = require.resolve("../../backups/storeRestoreAdminContract");
  const cached = require.cache[path]; const originalLoad = Module._load;
  const now = Date.now; const random = Math.random; const timer = global.setTimeout;
  try {
    delete require.cache[path];
    Module._load = function(id, ...args) {
      if (id !== path) assert.fail("unexpected dependency");
      return originalLoad.call(this, id, ...args);
    };
    Date.now = Math.random = global.setTimeout = () => assert.fail("ambient effect");
    assert.equal(require(path).validateExecuteRequest(fixture("EXECUTE")).ok, true);
  } finally {
    Module._load = originalLoad; Date.now = now; Math.random = random; global.setTimeout = timer;
    require.cache[path] = cached;
  }
});
