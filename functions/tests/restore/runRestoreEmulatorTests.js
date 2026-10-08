"use strict";

// R1C only: run under emulators:exec with the isolated demo project.
const {spawnSync} = require("node:child_process");
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1",
  require.resolve("./storeSnapshotDecoder.test"),
  require.resolve("./restoreToEmptyStore.emulator.test"),
], {stdio: "inherit"});
if (result.error) console.error("RESTORE_EMULATOR_TEST_RUNNER_FAILED");
process.exitCode = result.error || result.status === null ? 1 : result.status;
