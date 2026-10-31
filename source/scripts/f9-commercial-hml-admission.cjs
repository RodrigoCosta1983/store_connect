"use strict";
// Defaults to an OFFLINE plan. --apply is an explicit, later remote operation.
// No operator grant, drain evidence, initial store or readiness is fabricated.
const fs = require("node:fs");
function parsePlan(raw) {
  const keys = (value, allowed) => value && !Array.isArray(value) &&
    typeof value === "object" && Object.keys(value).every(k => allowed.includes(k));
  const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !value.startsWith("REPLACE_");
  if (!keys(raw, ["projectId", "operatorUid", "command"]) || raw.projectId !== "store-connect-hml" ||
      !id(raw.operatorUid) || !keys(raw.command, ["storeId", "requestId", "expectedEpoch", "mode", "reason", "evidenceId"])) {
    throw new Error("Invalid explicit HML transition plan.");
  }
  const c = raw.command;
  if (!id(c.storeId) || !id(c.requestId) || !Number.isSafeInteger(c.expectedEpoch) || c.expectedEpoch < 0 ||
      !["legacy", "draining", "authoritative"].includes(c.mode) ||
      (c.mode === "legacy") !== (c.expectedEpoch === 0) ||
      typeof c.reason !== "string" || !c.reason.trim() || c.reason.startsWith("REPLACE_") || c.reason.length > 1024 ||
      c.mode === "authoritative" && !id(c.evidenceId) || c.evidenceId !== undefined && !id(c.evidenceId)) {
    throw new Error("Plan must identify an existing HML store/epoch, stable transition and reviewed evidence.");
  }
  return JSON.parse(JSON.stringify(raw));
}
async function run(args) {
  if (args.length < 1 || args.length > 2 || args.length === 2 && args[1] !== "--apply") {
    throw new Error("Usage: node scripts/f9-commercial-hml-admission.cjs <reviewed-plan.json> [--apply]");
  }
  const plan = parsePlan(JSON.parse(fs.readFileSync(args[0], "utf8")));
  if (args[1] !== "--apply") {
    console.log(JSON.stringify({status: "offline-plan-only", ...plan,
      checksPending: ["remote operator grant", "current control/epoch", "existing store", "reviewed drain evidence"]}, null, 2));
    return;
  }
  if (process.env.GCLOUD_PROJECT !== plan.projectId || process.env.FIRESTORE_EMULATOR_HOST ||
      process.env.FUNCTIONS_EMULATOR === "true") throw new Error("Explicit HML target required; no emulator or PROD apply.");
  const admin = require("../functions/node_modules/firebase-admin");
  const app = admin.initializeApp({projectId: plan.projectId});
  try {
    const {transitionHmlStoreWriterAdmission} = require("../functions/sales/storeWriterAdmission");
    const result = await transitionHmlStoreWriterAdmission(admin.firestore(app),
      {auth: {uid: plan.operatorUid}, data: plan.command});
    console.log(JSON.stringify(result));
  } finally { await app.delete(); }
}
if (require.main === module) run(process.argv.slice(2)).catch(error => {
  console.error("HML admission stopped: " + (error.details?.reason || error.code || "invalid-plan-or-environment"));
  process.exitCode = 1;
});
module.exports = {parsePlan, run};
