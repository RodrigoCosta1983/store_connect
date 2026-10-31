"use strict";
const {spawnSync} = require("node:child_process"), fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "../.."), out = path.join(root, "build/consolidacao-20261025");
const guard = path.join(root, "functions/tests/financeiro/asaasA1OfflineGuard.cjs");
const files = ["functions/tests/financeiro/billingReadConsolidation.test.js", "tools/consolidacao-hml/plan.test.cjs",
  "functions/tests/financeiro/asaasConfig.test.js", "functions/tests/financeiro/asaasSecrets.test.js",
  "functions/tests/financeiro/asaasCompleteList.test.js", "functions/tests/financeiro/p264FinancialSafety.test.js"];
let pass = 0, fail = 0;
const results = [];
for (const file of files) {
  const r = spawnSync(process.execPath, ["--require", guard, file], {cwd: root, encoding: "utf8", windowsHide: true});
  fs.writeFileSync(path.join(out, `offline-${path.basename(file)}.log`), (r.stdout || "") + (r.stderr || ""));
  const p = +(r.stdout.match(/^# pass (\d+)/m)?.[1] || 0), f = +(r.stdout.match(/^# fail (\d+)/m)?.[1] || 0);
  pass += p; fail += f;
  results.push({file, exit: r.status, pass: p, fail: f});
  console.log(`${r.status === 0 ? "PASS" : "FAIL"}: ${file} (${p}/${p+f})`);
}
fs.writeFileSync(path.join(out, "offline-results.json"), JSON.stringify({pass, fail, results}, null, 2));
if (fail || results.some(r => r.exit !== 0)) process.exitCode = 1;
