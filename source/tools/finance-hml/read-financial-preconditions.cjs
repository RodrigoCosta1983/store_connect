"use strict";
// Fixed HML target; Google reads only. accounts:lookup is an administrative
// read RPC, not sign-in, enablement or account creation. Never export raw data.
const fs = require("node:fs"), path = require("node:path"), {spawnSync} = require("node:child_process");
const {STORE} = require("../consolidacao-hml/plan.cjs");
const root = path.resolve(__dirname, "../.."), project = "store-connect-hml";
const out = path.join(root, "build/hml-asaas-20261026");
function safeEnv(text) {
  const found = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(ASAAS_ENV|ASAAS_CREDENTIAL_ENV)\s*=\s*([\w"'-]+)\s*$/);
    if (match) found[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return {ASAAS_ENV_is_sandbox: found.ASAAS_ENV === "sandbox", ASAAS_CREDENTIAL_ENV_is_sandbox: found.ASAAS_CREDENTIAL_ENV === "sandbox"};
}
async function main() {
  fs.mkdirSync(out, {recursive: true});
  const auth = spawnSync("gcloud.cmd", ["auth", "print-access-token", "--project=" + project, "--quiet"], {shell: true, encoding: "utf8", windowsHide: true, timeout: 30000});
  if (auth.status !== 0 || !auth.stdout.trim()) throw Error("Google metadata authentication unavailable");
  let token = auth.stdout.trim();
  async function read(url, body) {
    // No arbitrary host or endpoint supplied by caller/CLI.
    const response = await fetch(url, {method: body ? "POST" : "GET", signal: AbortSignal.timeout(20000),
      headers: {Authorization: "Bearer " + token, "Content-Type": "application/json", "x-goog-user-project": project},
      body: body ? JSON.stringify(body) : undefined});
    return {http: response.status, body: response.ok ? await response.json() : null};
  }
  const report = {project, generatedAt: new Date().toISOString(), effects: "Google read-only; no provider call"};
  try {
    const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
    const fields = ["ownerId", "subscriptionStatus", "subscriptionType", "asaasCustomerId", "asaasSubscriptionId", "asaasBindingEnvironment", "asaasBindingProjectId"];
    const store = await read(`${base}/stores/${STORE}?` + fields.map(f => "mask.fieldPaths=" + f).join("&"));
    const values = store.body?.fields || {}, owner = values.ownerId?.stringValue;
    report.store = {http: store.http, present: !!store.body?.name, ownerPresent: !!owner,
      status: values.subscriptionStatus?.stringValue || null, type: values.subscriptionType?.stringValue || null,
      hasCustomerBinding: !!values.asaasCustomerId?.stringValue, hasSubscriptionBinding: !!values.asaasSubscriptionId?.stringValue,
      bindingOriginPresent: !!values.asaasBindingEnvironment || !!values.asaasBindingProjectId};
    if (owner) {
      const user = await read(`${base}/users/${encodeURIComponent(owner)}?mask.fieldPaths=storeId&mask.fieldPaths=role&mask.fieldPaths=accessStatus`);
      const data = user.body?.fields || {};
      report.ownerProfile = {http: user.http, present: !!user.body?.name, sameStore: data.storeId?.stringValue === STORE,
        admin: data.role?.stringValue === "admin", revoked: data.accessStatus?.stringValue === "revoked"};
      const account = await read(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup?fields=users(localId,disabled)`, {localId: [owner]});
      const users = account.body?.users;
      report.auth = {http: account.http, foundExactlyOneMatchingOwner: Array.isArray(users) && users.length === 1 && users[0].localId === owner,
        disabled: Array.isArray(users) && users.length === 1 ? users[0].disabled === true : null};
    }
    for (const name of ["ASAAS_API_KEY", "ASAAS_WEBHOOK_TOKEN"]) {
      const secret = await read(`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${name}/versions?pageSize=100`);
      const versions = secret.body?.versions;
      report[name] = {http: secret.http, metadataReadable: Array.isArray(versions), complete: Array.isArray(versions) && !secret.body?.nextPageToken,
        enabledVersions: Array.isArray(versions) ? versions.filter(v => v.state === "ENABLED").length : null,
        valueRead: false, validityVerified: false};
    }
    const bootstrap = await read(`https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/us-central1/functions/bootstrapStore`);
    report.bootstrap = {http: bootstrap.http, codebase: bootstrap.body?.labels?.["firebase-functions-codebase"] || null,
      generation: bootstrap.body?.environment || null};
    const appCheck = await read("https://firebaseappcheck.googleapis.com/v1/projects/324469869942/apps/1:324469869942:android:4482c313ccd8c0e9ae7e57/playIntegrityConfig");
    report.appCheckPlayIntegrity = {http: appCheck.http, configReadable: !!appCheck.body?.name, deviceAttestationVerified: false};
    const release = await read(`https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore`);
    report.rules = {http: release.http, sourceReadable: false, equivalentToLocal: null};
    if (release.body?.rulesetName) {
      const rules = await read("https://firebaserules.googleapis.com/v1/" + release.body.rulesetName);
      const files = rules.body?.source?.files;
      report.rules.sourceHttp = rules.http;
      report.rules.sourceReadable = Array.isArray(files);
      if (files?.length === 1) report.rules.equivalentToLocal = files[0].content === fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
    }
    const common = path.join(root, "functions/.env"), hml = path.join(root, "functions/.env.store-connect-hml");
    report.localEnv = {projectFilePresent: fs.existsSync(hml), mergedSafeFlags: safeEnv([common, hml].filter(fs.existsSync).map(p => fs.readFileSync(p, "utf8")).join("\n"))};
    report.storeAlias = "Loja Modelo HML";
    fs.writeFileSync(path.join(out, "preconditions.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { token = ""; auth.stdout = ""; }
}
if (require.main === module) main().catch(() => { console.error("HML metadata read incomplete; no raw payload exported"); process.exitCode = 1; });
module.exports = {safeEnv};
