"use strict";

const {spawnSync} = require("node:child_process");
const result = spawnSync(process.execPath, ["--test",
  require.resolve("./storeRestoreAdminContract.test"),
], {stdio: "inherit"});
if (result.error) console.error("RESTORE_ADMIN_CONTRACT_TEST_RUNNER_FAILED");
process.exitCode = result.error || result.status === null ? 1 : result.status;
