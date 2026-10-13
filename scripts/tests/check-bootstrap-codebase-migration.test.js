"use strict";
const assert = require("node:assert/strict");
const {test} = require("node:test");
const {checkMigration} = require("../check-bootstrap-codebase-migration");
const projectId = "store-connect-hml";
const base = {name: "projects/" + projectId + "/locations/us-central1/functions/bootstrapStore", environment: "GEN_2"};
for (const [label, metadata, allow] of [
  ["absent", null, true],
  ["bootstrap", {...base, labels: {"firebase-functions-codebase": "bootstrap"}}, true],
  ["default", {...base, labels: {"firebase-functions-codebase": "default"}}, false],
  ["legacy", base, false],
  ["unknown owner", {...base, labels: {"firebase-functions-codebase": "other"}}, false],
  ["invalid metadata", {}, false],
  ["wrong project", {...base, name: "projects/other-project/locations/us-central1/functions/bootstrapStore"}, false],
]) {
  test(label, async () => assert.equal((await checkMigration({projectId, lookup: async () => metadata})).allow, allow));
}
test("lookup failure blocks", async () => {
  await assert.rejects(checkMigration({projectId, lookup: async () => {throw new Error("offline");}}));
});
test("missing project blocks before lookup", async () => {
  let called = false;
  await assert.rejects(checkMigration({lookup: async () => {called = true;}}));
  assert.equal(called, false);
});
