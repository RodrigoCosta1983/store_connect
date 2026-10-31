"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
for (const file of ["productEditState.emulator.test.js", "productMutationV2.emulator.test.js", "updateProductIntegrity.emulator.test.js",
  "runProductCodTests.js", "../restore/productCodeRestoreSafety.emulator.test.js"]) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: "inherit", env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
