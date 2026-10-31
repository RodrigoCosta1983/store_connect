"use strict";
const {spawnSync} = require("node:child_process"), path = require("node:path"), fs = require("node:fs");
if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8188") throw Error("Loopback emulator only");
const root = path.resolve(__dirname, "../.."), out = path.join(root, "build/consolidacao-20261025");
const files = [
  "functions/tests/security/consolidationFinancialFields.test.mjs",
  "functions/tests/security/firestoreTaxonomyRules.test.mjs",
  "functions/tests/security/storeWriterAdmissionRules.test.mjs",
  "functions/tests/financeiro/subscriptionReview.emulator.test.js",
  "functions/tests/financeiro/p264FinancialAdmission.emulator.test.js",
  "functions/tests/financeiro/financialGates.emulator.test.js",
  "functions/tests/products/createProduct.emulator.test.js",
  "functions/tests/categories/upsertCategory.emulator.test.js",
  "functions/tests/categories/deleteCategory.emulator.test.js",
];
const results = [];
for (const file of files) {
  const result = spawnSync(process.execPath, [file], {cwd: root, env: {...process.env, GCLOUD_PROJECT: "demo-consolidation-hml", GOOGLE_CLOUD_PROJECT: "demo-consolidation-hml"}, encoding: "utf8", timeout: 180000, windowsHide: true});
  fs.writeFileSync(path.join(out, `${path.basename(file)}.log`), (result.stdout || "") + (result.stderr || ""));
  results.push({file, exit: result.status, error: result.error?.code || null});
  console.log(`${result.status === 0 ? "PASS" : "FAIL"}: ${file}`);
}
fs.writeFileSync(path.join(out, "emulator-results.json"), JSON.stringify(results, null, 2));
if (results.some(r => r.exit !== 0)) process.exitCode = 1;
