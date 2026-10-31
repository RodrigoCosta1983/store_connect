"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
for (const file of [
  "createProduct.emulator.test.js",
  "productCodeAtomic.emulator.test.js",
  "../security/productCodeRules.test.mjs",
]) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: "inherit", env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
