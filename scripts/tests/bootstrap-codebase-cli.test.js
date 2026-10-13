"use strict";
const assert = require("node:assert/strict");
const {test} = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const {EventEmitter} = require("node:events");
const root = path.resolve(__dirname, "../..");
const executable = cp.execFileSync(process.platform === "win32" ? "where.exe" : "which",
  [process.platform === "win32" ? "firebase.cmd" : "firebase"], {encoding: "utf8"}).trim().split(/\r?\n/)[0];
const cli = path.join(path.dirname(fs.realpathSync(executable)), "node_modules/firebase-tools");
const helper = require(path.join(cli, "lib/deploy/functions/functionsDeployHelper"));
const backend = require(path.join(cli, "lib/deploy/functions/backend"));
const planner = require(path.join(cli, "lib/deploy/functions/release/planner"));
const config = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8"));
const configs = require(path.join(cli, "lib/functions/projectConfig")).normalizeAndValidate(config.functions);

test("selectors discover only bootstrap source", () => {
  for (const only of ["functions:bootstrap", "functions:bootstrap:bootstrapStore"]) {
    const filters = helper.getEndpointFilters({only}, configs);
    assert.deepEqual(helper.targetCodebases(configs, filters), ["bootstrap"]);
    assert.equal(helper.endpointMatchesAnyFilter({id: "bootstrapStore", codebase: "bootstrap"}, filters), true);
    assert.equal(helper.endpointMatchesAnyFilter({id: "createAsaasSubscription", codebase: "default"}, filters), false);
  }
});

test("SDK manifest and CLI parser contain one callable, no secret/schedule params", async () => {
  const sdk = path.join(root, "functions-bootstrap/node_modules/firebase-functions/lib");
  const stack = await require(path.join(sdk, "runtime/loader")).loadStack(path.join(root, "functions-bootstrap"));
  const wire = require(path.join(sdk, "runtime/manifest")).stackToWire(stack);
  const build = require(path.join(cli, "lib/deploy/functions/runtimes/discovery")).yamlToBuild(wire, "store-connect-hml", "us-central1", "nodejs22");
  assert.deepEqual(Object.keys(build.endpoints), ["bootstrapStore"]);
  assert.equal((build.params || []).length, 0);
  assert.deepEqual(build.endpoints.bootstrapStore.secretEnvironmentVariables || [], []);
  assert.equal(build.endpoints.bootstrapStore.scheduleTrigger, undefined);
  const imported = Object.keys(require.cache).filter(p => p.startsWith(path.join(root, "functions") + path.sep));
  assert.deepEqual(imported, []);
});

test("bootstrap deploy skips default hook; default hook receives target project", async () => {
  const original = cp.spawn;
  const calls = [];
  cp.spawn = (command, args, options) => {
    calls.push({command, options});
    const child = new EventEmitter();
    process.nextTick(() => child.emit("exit", 0));
    return child;
  };
  try {
    const hook = require(path.join(cli, "lib/deploy/lifecycleHooks")).lifecycleHooks("functions", "predeploy");
    const options = {projectId: "store-connect-hml", projectRoot: root,
      config: {projectDir: root, get: () => configs, path: p => path.resolve(root, p)}};
    await hook({}, {...options, only: "functions:bootstrap:bootstrapStore"});
    assert.equal(calls.length, 0);
    await hook({}, {...options, only: "functions:default"});
    assert.equal(calls.length, 1);
    assert.ok(calls[0].command.includes("check-bootstrap-codebase-migration.js"));
    assert.equal(calls[0].options.env.GCLOUD_PROJECT, "store-connect-hml");
  } finally { cp.spawn = original; }
});

test("planner creates only HML bootstrap and migrates PROD by update", () => {
  const remote = {id: "bootstrapStore", project: "store-connect-app", region: "us-central1",
    platform: "gcfv2", runtime: "nodejs22", codebase: "default", httpsTrigger: {}, labels: {"deployment-tool": "cli-firebase"}};
  const desired = {...remote, codebase: "bootstrap"};
  const hml = planner.calculateChangesets({bootstrapStore: {...desired, project: "store-connect-hml"}}, {}, () => "case", false).case;
  assert.deepEqual(hml.endpointsToCreate.map(e => e.id), ["bootstrapStore"]);
  assert.equal(hml.endpointsToDelete.length, 0);
  const grouped = helper.groupEndpointsByCodebase({bootstrap: backend.of(desired)}, [remote]);
  const prod = planner.calculateChangesets({bootstrapStore: desired}, grouped.bootstrap.endpoints["us-central1"], () => "case", false).case;
  assert.equal(prod.endpointsToUpdate.length, 1);
  assert.equal(prod.endpointsToCreate.length, 0);
  assert.equal(prod.endpointsToDelete.length, 0);
  const later = helper.groupEndpointsByCodebase({default: backend.empty()}, [desired]);
  assert.equal(backend.allEndpoints(later.default).length, 0);
});
