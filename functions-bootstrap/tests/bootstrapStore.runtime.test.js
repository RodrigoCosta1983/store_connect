"use strict";

const assert = require("node:assert/strict");
const {test} = require("node:test");
const {spawnSync} = require("node:child_process");
const path = require("node:path");

for (const project of ["store-connect-hml", "store-connect-app"]) {
  test(`bootstrap runtime identity follows current project: ${project}`, () => {
    // Import only: never invoke the callable, read credentials, or access Firestore.
    const result = spawnSync(process.execPath, ["-e", `
      const assert = require("node:assert/strict");
      const exports = require("./index");
      assert.deepEqual(Object.keys(exports), ["bootstrapStore"]);
      const bootstrap = exports.bootstrapStore;
      const fs = require("node:fs");
      const path = require("node:path");
      const sdkEntry = require.resolve("firebase-functions/v2/https");
      assert.ok(sdkEntry.startsWith(path.join(process.cwd(), "node_modules") + path.sep));
      assert.equal(JSON.parse(fs.readFileSync("node_modules/firebase-functions/package.json", "utf8")).version, "7.0.6");
      assert.equal(require("./package.json").engines.node, "22");
      assert.ok(require.resolve("firebase-admin").startsWith(path.join(process.cwd(), "node_modules") + path.sep));
      assert.equal(JSON.parse(fs.readFileSync("node_modules/firebase-admin/package.json", "utf8")).version, "13.7.0");
      assert.equal(bootstrap.__endpoint.serviceAccountEmail, "storeconnect-bootstrap@");
      assert.equal(bootstrap.__trigger.serviceAccountEmail,
        "storeconnect-bootstrap@" + process.env.GCLOUD_PROJECT + ".iam.gserviceaccount.com");
      assert.equal(bootstrap.__endpoint.platform, "gcfv2");
      assert.equal(bootstrap.__endpoint.availableMemoryMb, 256);
      assert.equal(bootstrap.__endpoint.timeoutSeconds, 30);
      assert.ok(bootstrap.__endpoint.callableTrigger);
      assert.deepEqual(bootstrap.__endpoint.secretEnvironmentVariables || [], []);
    `], {
      cwd: path.resolve(__dirname, ".."),
      env: {...process.env, GCLOUD_PROJECT: project, ASAAS_ENV: "", ASAAS_API_KEY: ""},
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  });
}
