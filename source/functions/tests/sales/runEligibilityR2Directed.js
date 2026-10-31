"use strict";
// Avoid cmd.exe interpreting regex alternation as shell pipelines.
const {spawnSync} = require("node:child_process");
const {join} = require("node:path");
const result = spawnSync(process.execPath, ["--test", "--test-reporter=spec",
  "--test-name-pattern=R2|NaN.price|Infinity.price|known.confirmed|nonterminal.domain",
  join(__dirname, "confirmSaleV2.emulator.test.js")], {stdio: "inherit"});
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
