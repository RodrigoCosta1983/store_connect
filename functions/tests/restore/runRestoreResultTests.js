"use strict";

const {spawnSync} = require("node:child_process");
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1",
  require.resolve("./storeRestoreResult.test"),
  require.resolve("./restoreResultFlow.emulator.test"),
], {stdio: "inherit"});
if (result.error) console.error("RESTORE_RESULT_TEST_RUNNER_FAILED");
process.exitCode = result.error || result.status === null ? 1 : result.status;
