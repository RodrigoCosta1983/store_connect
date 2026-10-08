"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const {COLLECTION_NAMES, SETTING_NAMES} = require("../../backups/storeSnapshotContract");
const {buildStoreRestorePlan: build} = require("../../backups/storeRestorePlanner");
const {hash, canonicalStringify} = require("../../backups/storeRestoreTransform");
function input(mode = "MERGE_A1") {
  const state = () => ({storeSettings: Object.fromEntries(SETTING_NAMES.map((n) => [n, null])),
    collections: Object.fromEntries(COLLECTION_NAMES.map((n) => [n, []]))});
  return {snapshot: {snapshotVersion: 1, metadata: {storeId: "A"}, ...state()},
    sourceStoreId: "A", targetStoreId: "A", targetState: state(), mode};
}
const doc = (id, data = {}) => ({id, data});
function rejects(change, code) {
  const i = input(); change(i);
  assert.throws(() => build(i), (e) => e.code === code && e.message === code && e.cause === undefined);
}
for (const mode of ["MERGE_A1", "REPLACE"]) {
  test(mode + " empty destination", () => {
    const i = input(mode); i.snapshot.collections.products = [doc("new")];
    const p = build(i); assert.deepEqual(p.collections.products.create, ["new"]);
    assert.equal(p.plannedCounts.totals.create, 1);
    assert.equal(p.plannedCounts.settings.unchanged, 7);
  });
  test(mode + " complete diff and counts across all collections", () => {
    const i = input(mode);
    for (const n of COLLECTION_NAMES) {
      i.snapshot.collections[n] = [doc("same", {x: 1}), doc("new"), doc("changed", {x: 2})];
      i.targetState.collections[n] = [doc("extra"), doc("changed", {old: true}), doc("same", {x: 1})];
    }
    const before = canonicalStringify(i); const p = build(i);
    assert.equal(canonicalStringify(i), before);
    for (const n of COLLECTION_NAMES) {
      assert.deepEqual(p.collections[n], {create: ["new"], overwrite: ["changed"],
        delete: mode === "REPLACE" ? ["extra"] : [], unchanged: ["same"],
        preserve: mode === "MERGE_A1" ? ["extra"] : []});
      for (const action of Object.keys(p.collections[n])) {
        assert.equal(p.plannedCounts.collections[n][action], p.collections[n][action].length);
      }
    }
    assert.deepEqual(p.plannedCounts.totals, {create: 5, overwrite: 5,
      delete: mode === "REPLACE" ? 5 : 0, unchanged: 5, preserve: mode === "MERGE_A1" ? 5 : 0});
    assert.deepEqual(p.desiredState.collections.products.find((d) => d.id === "changed").data, {x: 2});
  });
}
for (const mode of [undefined, null, "MERGE_A2", "", "merge_a1"]) test("invalid mode " + String(mode), () => {
  rejects((i) => { i.mode = mode; }, "INVALID_MODE");
});
for (const field of ["sourceStoreId", "targetStoreId"]) for (const value of ["", ".", "..", "a/b", "a\0b", null, 1]) {
  test("invalid ID " + field + " " + String(value), () => rejects((i) => { i[field] = value; }, "INVALID_STORE_ID"));
}
test("same and cross store modeled explicitly", () => {
  assert.equal(build(input()).crossStore, false);
  const i = input(); i.targetStoreId = "B";
  assert.equal(build(i).crossStore, true);
});
test("missing collection rejected", () => rejects((i) => { delete i.targetState.collections.sales; }, "INVALID_TARGET_COLLECTION"));
test("extra collection rejected", () => rejects((i) => { i.targetState.collections.extra = []; }, "INVALID_TARGET_COLLECTION"));
test("duplicate target ID rejected", () => rejects((i) => { i.targetState.collections.products = [doc("d"), doc("d")]; }, "DUPLICATE_TARGET_ID"));
test("target envelopes exact", () => rejects((i) => { i.targetState.collections.products = [{id: "d", data: {}, extra: 1}]; }, "INVALID_TARGET_STATE"));
test("snapshot minimal invariants", () => {
  rejects((i) => { i.snapshot.snapshotVersion = 2; }, "INVALID_SNAPSHOT_CONTRACT");
  rejects((i) => { delete i.snapshot.storeSettings.name; }, "INVALID_SNAPSHOT_CONTRACT");
  rejects((i) => { i.snapshot.collections.products = [doc("d"), doc("d")]; }, "INVALID_SNAPSHOT_CONTRACT");
});
test("input order and map key order produce identical plan and hashes", () => {
  const i = input();
  i.snapshot.collections.products = [doc("z", {b: 2, a: {z: 1, a: 2}}), doc("a")];
  i.targetState.collections.products = [doc("z", {a: {a: 2, z: 1}, b: 2}), doc("extra")];
  const first = build(i);
  i.snapshot.collections.products.reverse(); i.targetState.collections.products.reverse();
  i.snapshot.collections.products[1].data = {a: {a: 2, z: 1}, b: 2};
  assert.deepEqual(build(i), first);
  assert.deepEqual(first.collections.products.unchanged, ["z"]);
});
test("business array order differs", () => {
  const i = input(); i.snapshot.collections.products = [doc("d", {values: [1, 2]})];
  i.targetState.collections.products = [doc("d", {values: [2, 1]})];
  assert.deepEqual(build(i).collections.products.overwrite, ["d"]);
});
test("settings null retained and absence differs from null; root whitelist enforced", () => {
  const i = input("REPLACE"); delete i.targetState.storeSettings.name;
  i.targetState.storeSettings.phone = "synthetic";
  const p = build(i);
  assert.deepEqual(p.settings.set, ["name", "phone"]);
  assert.equal(p.desiredState.storeSettings.phone, null);
  assert.equal(p.settings.v1NormalizedNulls, true);
  assert.equal(p.settings.strategy, "ROOT_FIELD_UPDATES");
  assert.deepEqual(Object.keys(p.desiredState.storeSettings).sort(), [...SETTING_NAMES].sort());
  assert.equal(p.plannedCounts.settings.set + p.plannedCounts.settings.unchanged, 7);
  for (const key of ["ownerId", "subscription", "Asaas", "perfilFiscal", "createdAt", "permissions"]) {
    rejects((x) => { x.targetState.storeSettings[key] = null; }, "INVALID_TARGET_STATE");
  }
});
test("blockers return informative plan without unsafe payload in issues", () => {
  const i = input(); i.targetStoreId = "B";
  i.snapshot.collections.sales = [doc("d", {fiscal: {private: "synthetic"}, storeId: "C"})];
  const p = build(i); assert.equal(p.blockers.length, 2);
  assert.equal(JSON.stringify(p.blockers).includes("synthetic"), false);
  assert.deepEqual(p.collections.sales.create, ["d"]);
});
test("hashes deterministic, mode/source/target/document/baseline semantically bound", () => {
  const i = input(); const p = build(i);
  for (const key of ["baselineHash", "desiredStateHash", "planHash"]) {
    assert.match(p[key], /^[a-f0-9]{64}$/); assert.equal(build(i)[key], p[key]);
  }
  const {planHash, ...withoutHash} = p;
  assert.equal(hash(withoutHash), planHash);
  assert.notEqual(hash({...withoutHash, planHash: "arbitrary"}), planHash);
  i.mode = "REPLACE"; assert.notEqual(build(i).planHash, p.planHash);
  i.mode = "MERGE_A1"; i.targetStoreId = "B"; assert.notEqual(build(i).planHash, p.planHash);
  i.targetStoreId = "A"; i.sourceStoreId = "C"; i.snapshot.metadata.storeId = "C";
  assert.notEqual(build(i).planHash, p.planHash);
  i.sourceStoreId = "A"; i.snapshot.metadata.storeId = "A";
  i.targetState.collections.products = [doc("extra")];
  assert.notEqual(build(i).baselineHash, p.baselineHash); assert.notEqual(build(i).planHash, p.planHash);
  i.targetState.collections.products = []; i.snapshot.collections.products = [doc("new")];
  assert.notEqual(build(i).desiredStateHash, p.desiredStateHash); assert.notEqual(build(i).planHash, p.planHash);
  assert.equal(build({...input(), policy: {version: 1}}).planHash, p.planHash);
});
test("non-JSON target values, dangerous keys, cycles and malformed markers rejected", () => {
  for (const value of [undefined, Infinity, new Date(), {__storeConnectType: "future"},
    {__storeConnectType: "documentReference", path: "stores/A/products"}, JSON.parse('{"__proto__":1}')]) {
    rejects((i) => { i.targetState.collections.products = [doc("d", {value})]; }, "INVALID_TARGET_STATE");
  }
  rejects((i) => { const cycle = {}; cycle.x = cycle; i.targetState.collections.products = [doc("d", cycle)]; }, "INVALID_TARGET_STATE");
});
test("imports and invocation use only pure modules, no I/O timers or process mutation", () => {
  const Module = require("node:module");
  const paths = [require.resolve("../../backups/storeRestorePlanner"), require.resolve("../../backups/storeRestoreTransform")];
  const allowed = new Set([...paths, "./storeSnapshotContract", "./storeRestoreTransform", "node:crypto"]);
  const originalLoad = Module._load;
  const savedEnv = {...process.env}; const handles = process._getActiveHandles().slice();
  const slots = [[global, "setTimeout"], [global, "setInterval"], [global, "setImmediate"],
    [global, "fetch"], [process, "exit"], [process, "getBuiltinModule"]];
  const saved = slots.map(([obj, key]) => obj[key]);
  try {
    Module._load = function(request, ...args) {
      assert.ok(allowed.has(request), "UNEXPECTED_IMPORT");
      return originalLoad.call(this, request, ...args);
    };
    slots.forEach(([obj, key]) => { obj[key] = () => { throw new Error("PURE_MODULE_SIDE_EFFECT"); }; });
    paths.forEach((p) => { delete require.cache[p]; });
    const planner = require(paths[0]); require(paths[1]);
    planner.buildStoreRestorePlan(input());
    assert.deepEqual({...process.env}, savedEnv);
    assert.deepEqual(process._getActiveHandles(), handles);
  } finally {
    Module._load = originalLoad;
    slots.forEach(([obj, key], index) => { obj[key] = saved[index]; });
  }
});
