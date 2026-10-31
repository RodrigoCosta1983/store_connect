"use strict";
const {spawnSync} = require("node:child_process"), fs = require("node:fs"), path = require("node:path");
const out = path.resolve(__dirname, "../../build/consolidacao-20261025");
async function main() {
for (const project of ["store-connect-app", "store-connect-hml"]) {
  const filter = 'timestamp>="2026-10-18T00:00:00Z" AND (resource.labels.service_name="listasaasinvoices" OR resource.labels.service_name="getasaasportalurl" OR resource.labels.service_name="getasaassubscriptionstatev1" OR resource.labels.function_name="listAsaasInvoices" OR resource.labels.function_name="getAsaasPortalUrl" OR resource.labels.function_name="getAsaasSubscriptionStateV1")';
  // Fixed args; raw entries live only in memory and are never logged or saved.
  const result = spawnSync("gcloud.cmd", ["auth", "print-access-token", `--project=${project}`, "--quiet"],
    {shell: true, encoding: "utf8", windowsHide: true});
  let report = {project, readSucceeded: false, count: 0, scope: "latest 200 matching entries since 2026-10-18; absence is not proof of no errors"};
  try {
    if (result.status !== 0) throw Error("read_failed");
    const response = await fetch("https://logging.googleapis.com/v2/entries:list", {
      method: "POST", signal: AbortSignal.timeout(30000),
      headers: {Authorization: `Bearer ${result.stdout.trim()}`, "Content-Type": "application/json"},
      body: JSON.stringify({resourceNames: [`projects/${project}`], filter, orderBy: "timestamp desc", pageSize: 200})});
    if (!response.ok) {report.httpStatus = response.status; throw Error("logging_read_failed");}
    const page = await response.json(), rows = page.entries || [];
    report.morePages = !!page.nextPageToken;
    report = {...report, readSucceeded: true, count: rows.length,
      evidence: rows.map(r => {
        const text = JSON.stringify(r.jsonPayload || r.textPayload || "");
        return {timestamp: r.timestamp, severity: r.severity,
          service: r.resource?.labels?.service_name || r.resource?.labels?.function_name,
          httpStatus: r.httpRequest?.status || null,
          signals: {upstream401: /(?:status code|status|statusCode)[^\d]{0,15}401/.test(text), upstream403: /(?:status code|status|statusCode)[^\d]{0,15}403/.test(text),
            notFound: /not-found|NOT_FOUND|not found/i.test(text), missingSubscription: /sem assinatura|no subscription|não possui.*assinatura/i.test(text),
            appCheck: /App.?Check|app-check/i.test(text), permission: /permission-denied|PERMISSION_DENIED/.test(text)}};
      })};
  } catch (_) {report.failure = "Read failed; no raw provider details exported";}
  fs.writeFileSync(path.join(out, `${project}-billing-logs.json`), JSON.stringify(report, null, 2));
  console.log(`${project}: logs read=${report.readSucceeded}, matching entries=${report.count}`);
}
}
main().catch(() => {console.error("Sanitized log inventory failed"); process.exitCode = 1;});
