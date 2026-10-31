"use strict";
const assert = require("node:assert/strict");
const [project, scenario] = process.argv.slice(2);
assert.ok(["store-connect-hml", "store-connect-app", "demo-store-connect-android04"].includes(project));
process.env.GCLOUD_PROJECT = project;
delete process.env.FUNCTIONS_EMULATOR; delete process.env.FIRESTORE_EMULATOR_HOST;
const flags = ["CHECKOUT", "RECEIVABLES", "FIADO", "CASH", "OFFLINE"];
for (const flag of flags) {
  const key = "F9_COMMERCIAL_" + flag + "_PROJECT";
  delete process.env[key];
  if (scenario !== "missing") process.env[key] = scenario === "wrong-flag" ? "wrong-project" : project;
}
if (scenario === "wrong-runtime") process.env.GCLOUD_PROJECT = "wrong-project";
if (scenario === "emulator") { process.env.FUNCTIONS_EMULATOR = "true"; process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8194"; }
if (scenario === "mixed") process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8194";
global.fetch = async () => { throw new Error("Remote IO forbidden in destination probe."); };
const admin = require("firebase-admin"); admin.initializeApp({projectId: project});
const groups = [
  ["confirmSaleV2", ["confirmCommercialSaleV2", "getCommercialSaleMutationResultV1"]],
  ["receiveDebtPaymentV1", ["receiveDebtPaymentV1", "getDebtPaymentResultV1"]],
  ["createDeferredSaleV1", ["createDeferredSaleV1", "getDeferredSaleResultV1"]],
  ["createManualCashV1", ["createManualCashV1", "getManualCashResultV1"]],
  ["syncOfflineSaleV1", ["syncOfflineSaleV1", "getOfflineSaleResultV1"]],
];
(async () => {
  const expected = project === "store-connect-hml" && scenario === "valid" ||
    project.startsWith("demo-") && scenario === "emulator" ? "unauthenticated" : "failed-precondition";
  for (const [file, names] of groups) for (const name of names) {
    await assert.rejects(require("../../../sales/" + file)[name].run({}), e => e.code === expected, name);
  }
  await admin.app().delete(); console.log("PASS: 10 handlers, " + project + ", " + scenario + ", " + expected);
})().catch(e => { console.error(e); process.exitCode = 1; });
