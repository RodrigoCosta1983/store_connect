"use strict";

// Isolated pure suite; deliberately not connected to catalog/retention runners.
const {spawnSync} = require("node:child_process");
const result = spawnSync(process.execPath, [
  "--test", require.resolve("./storeSnapshotParser.test"),
  require.resolve("./storeRestorePlanner.test"),
  require.resolve("./storeRestoreTransform.test"),
], {stdio: "inherit"});
if (result.error) {
  console.error("RESTORE_TEST_RUNNER_FAILED");
  process.exitCode = 1;
} else {
  process.exitCode = result.status === null ? 1 : result.status;
}
