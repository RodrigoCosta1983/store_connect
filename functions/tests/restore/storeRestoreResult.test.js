"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const {buildStoreRestoreResult: result} = require("../../backups/storeRestoreResult");
const {buildStoreRestorePlan: build} = require("../../backups/storeRestorePlanner");
const {compareStoreRestoreState: verify} = require("../../backups/storeRestoreVerifier");
const {COLLECTION_NAMES, SETTING_NAMES} = require("../../backups/storeSnapshotContract");
const {hash} = require("../../backups/storeRestoreTransform");
function fixture(mode = "MERGE_A1", existing = false) {
  const baselineState = {storeSettings: {}, collections: Object.fromEntries(COLLECTION_NAMES.map((n) =>
    [n, existing ? [{id: "old", data: {name: "old"}}, {id: "doc", data: {name: "different"}}] : []]))};
  const snapshot = {snapshotVersion: 1, metadata: {storeId: "result-A"},
    storeSettings: Object.fromEntries(SETTING_NAMES.map((k) => [k, null])),
    collections: Object.fromEntries(COLLECTION_NAMES.map((n) => [n, [{id: "doc", data: {name: "expected"}}]]))};
  const plan = build({snapshot, sourceStoreId: "result-A", targetStoreId: "result-B", targetState: baselineState, mode});
  const actualState = JSON.parse(JSON.stringify(plan.desiredState));
  if (existing && mode === "MERGE_A1") for (const n of COLLECTION_NAMES) actualState.collections[n].push(baselineState.collections[n][0]);
  const writes = plan.plannedCounts.totals.create + plan.plannedCounts.totals.overwrite + plan.plannedCounts.totals.delete + 1;
  return {plan, execution: {writes, batches: 1}, verification: verify({plan, baselineState, actualState}), baselineState, actualState};
}
const args = (f) => ({plan: f.plan, execution: f.execution, verification: f.verification});
function rehash(plan) { const {planHash, ...body} = plan; plan.planHash = hash(body); }

for (const mode of ["MERGE_A1", "REPLACE"]) for (const existing of [false, true]) test(`SUCCESS ${mode} existing=${existing}`, () => {
  const f = fixture(mode, existing); const r = result(args(f));
  assert.equal(r.status, "SUCCESS"); assert.equal(r.mode, mode);
  assert.equal(r.plan.planHash, f.plan.planHash); assert.equal(r.plan.desiredStateHash, f.plan.desiredStateHash);
  assert.equal(r.summary.plannedOperations, f.execution.writes);
  assert.equal(r.summary.materializedOperations, f.execution.writes);
  for (const [key, action] of [["created", "create"], ["updated", "overwrite"], ["deleted", "delete"], ["preserved", "preserve"]]) {
    assert.equal(r.summary[key], f.plan.plannedCounts.totals[action]);
  }
  assert.equal(r.summary.matchedDocuments, f.verification.summary.matchedDocuments);
});
for (const label of ["before execution", "second chunk"]) test("EXECUTION_FAILED " + label, () => {
  const f = fixture(); const r = result({plan: f.plan, executionError: new Error("secret credential token")});
  assert.equal(r.status, "EXECUTION_FAILED"); assert.equal(r.execution.completed, false);
  assert.equal(r.execution.writes, null); assert.equal(r.summary.created, null);
  assert.equal(r.summary.materializedOperations, null); assert.equal(r.verification, null);
  assert.ok(!JSON.stringify(r).includes("secret")); assert.ok(!Object.hasOwn(r.execution, "rollback"));
});
for (const [label, mutate, key] of [
  ["missing", (s) => { s.collections.products = []; }, "missingDocuments"],
  ["mismatch", (s) => { s.collections.products[0].data.name = "secret"; }, "mismatchedDocuments"],
  ["residual", (s) => { s.collections.products.push({id: "secret-token", data: {password: "secret"}}); }, "unexpectedDocuments"],
]) test("VERIFICATION_FAILED " + label, () => {
  const f = fixture("REPLACE"); mutate(f.actualState);
  f.verification = verify(f); const r = result(args(f));
  assert.equal(r.status, "VERIFICATION_FAILED"); assert.equal(r.summary[key], 1);
  assert.equal(r.verification.divergenceCount, f.verification.mismatches.length);
  assert.ok(!JSON.stringify(r).includes("secret"));
});
const invalid = [
  ["missing plan", (a) => { delete a.plan; }],
  ["missing verifier", (a) => { delete a.verification; }],
  ["missing execution", (a) => { delete a.execution; }],
  ["unknown mode", (a) => { a.plan.mode = "CREATE"; rehash(a.plan); }],
  ["negative plan count", (a) => { a.plan.plannedCounts.totals.create = -1; rehash(a.plan); }],
  ["negative writes", (a) => { a.execution.writes = -1; }],
  ["NaN writes", (a) => { a.execution.writes = NaN; }],
  ["fractional batches", (a) => { a.execution.batches = 1.5; }],
  ["wrong write count", (a) => { a.execution.writes++; }],
  ["zero batches", (a) => { a.execution.batches = 0; }],
  ["negative verifier count", (a) => { a.verification.summary.matchedDocuments = -1; }],
  ["contradictory status", (a) => { a.status = "EXECUTION_FAILED"; }],
  ["unknown status", (a) => { a.status = "DONE"; }],
  ["execution and error", (a) => { a.executionError = new Error("failure"); }],
  ["invalid error", (a) => { delete a.execution; a.executionError = "failure"; }],
  ["verifier missing summary", (a) => { delete a.verification.summary; }],
  ["verifier ok contradicts issues", (a) => { a.verification.ok = false; }],
  ["verifier forged issue", (a) => { a.verification.mismatches.push({type: "UNKNOWN"}); }],
  ["verifier wrong totals", (a) => { a.verification.summary.actualDocuments++; }],
  ["forged plan hash", (a) => { a.plan.planHash = "0".repeat(64); }],
  ["incomplete plan", (a) => { delete a.plan.settings; rehash(a.plan); }],
  ["action count mismatch", (a) => { a.plan.collections.products.create = []; rehash(a.plan); }],
  ["unexpected input", (a) => { a.credentials = "secret"; }],
];
for (const [label, mutate] of invalid) test("invalid " + label, () => {
  const a = args(fixture()); mutate(a); assert.throws(() => result(a));
});
test("failure cannot claim SUCCESS even with passing verification", () => {
  const f = fixture(); const a = {plan: f.plan, executionError: new Error("failed"), verification: f.verification};
  assert.equal(result(a).status, "EXECUTION_FAILED"); assert.throws(() => result({...a, status: "SUCCESS"}));
});
test("same inputs deterministic and immutable", () => {
  const a = args(fixture()); const before = JSON.stringify(a);
  assert.deepEqual(result(a), result(a)); assert.equal(JSON.stringify(a), before);
});
test("property and mismatch order irrelevant; no document values emitted", () => {
  const f = fixture("REPLACE"); f.actualState.collections.products[0].data = {password: "secret", name: "wrong"};
  f.verification = verify(f); const a = args(f); const expected = JSON.stringify(result(a));
  a.verification.mismatches.reverse();
  a.verification.summary = Object.fromEntries(Object.entries(a.verification.summary).reverse());
  a.plan = Object.fromEntries(Object.entries(a.plan).reverse());
  assert.equal(JSON.stringify(result(a)), expected); assert.ok(!expected.includes("secret"));
});
test("zero-operation executor result", () => {
  const f = fixture(); const plan = build({snapshot: {snapshotVersion: 1, metadata: {storeId: "result-A"},
    ...f.plan.desiredState}, sourceStoreId: "result-A", targetStoreId: "result-B", targetState: f.actualState, mode: "MERGE_A1"});
  const verification = verify({plan, baselineState: f.actualState, actualState: f.actualState});
  assert.equal(result({plan, execution: {writes: 0, batches: 0}, verification}).status, "SUCCESS");
});
test("pure imports and calls forbid Firebase, I/O, timers, random and clock", () => {
  const Module = require("node:module"); const originalLoad = Module._load;
  const allowed = ["./storeSnapshotContract", "./storeRestoreTransform", "./storeSnapshotParser", "crypto", "node:crypto", "node:zlib", "zlib", "node:buffer", "buffer", "node:util", "util"];
  const a = args(fixture()); const patches = [];
  function patch(o, k) { const original = o[k]; patches.push(() => { o[k] = original; }); o[k] = () => { throw new Error("FORBIDDEN_EFFECT"); }; }
  const path = require.resolve("../../backups/storeRestoreResult"); delete require.cache[path];
  try {
    Module._load = function(id, ...rest) { assert.ok(id === path || allowed.includes(id), id); return originalLoad.call(this, id, ...rest); };
    for (const key of ["setTimeout", "setInterval", "fetch"]) patch(global, key);
    patch(Date, "now"); patch(Math, "random");
    const pure = require(path).buildStoreRestoreResult;
    assert.equal(pure(a).status, "SUCCESS");
  } finally { Module._load = originalLoad; patches.reverse().forEach((p) => p()); }
});

test("reject incomplete R1E divergence structure", () => {
  const f = fixture("REPLACE");
  f.actualState.collections.products[0].data.name = "wrong";
  f.verification = verify(f);
  delete f.verification.mismatches[0].documentId;
  assert.throws(() => result(args(f)));
});

test("REPLACE rejects unaccounted actual documents even with ok=true", () => {
  const f = fixture("REPLACE");
  f.verification.collections.products.actualDocuments++;
  f.verification.summary.actualDocuments++;
  assert.throws(() => result(args(f)));
});

test("MERGE_A1 accepts R1E observed extras outside its integrity promise", () => {
  const f = fixture();
  f.actualState.collections.products.push({id: "new-extra", data: {name: "extra"}});
  f.verification = verify(f);
  const r = result(args(f));
  assert.equal(r.status, "SUCCESS");
  assert.equal(r.summary.verifiedDocuments, f.verification.summary.actualDocuments);
  assert.equal(r.summary.unexpectedDocuments, 0);
});
