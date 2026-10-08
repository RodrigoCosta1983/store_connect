"use strict";

// R1D only, separate from R1A/B/C and catalog/retention runners.
const {spawnSync} = require("node:child_process");
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1",
  require.resolve("./restoreToExistingStore.emulator.test"),
], {stdio: "inherit"});
if (result.error) console.error("RESTORE_EXISTING_STORE_TEST_RUNNER_FAILED");
process.exitCode = result.error || result.status === null ? 1 : result.status;
