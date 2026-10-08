"use strict";

const {spawnSync} = require("node:child_process");
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1",
  require.resolve("./storeRestoreAdminAuthorization.test"),
  require.resolve("./storeRestoreAdminAuthorization.emulator.test"),
], {stdio: "inherit"});
if (result.error) console.error("RESTORE_ADMIN_AUTHORIZATION_TEST_RUNNER_FAILED");
process.exitCode = result.error || result.status === null ? 1 : result.status;
