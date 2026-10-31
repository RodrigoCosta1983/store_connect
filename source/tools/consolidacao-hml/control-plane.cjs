"use strict";
const {spawnSync} = require("node:child_process"), fs = require("node:fs"), path = require("node:path");
const {STORE, hash} = require("./plan.cjs");
const out = path.resolve(__dirname, "../../build/consolidacao-20261025");
async function main() {
  for (const project of ["store-connect-app", "store-connect-hml"]) {
    const r = spawnSync("gcloud.cmd", ["auth", "print-access-token", `--project=${project}`, "--quiet"], {shell: true, encoding: "utf8", windowsHide: true});
    if (r.status !== 0) throw Error("auth_read_failed");
    async function get(url, body) {
      const response = await fetch(url, {method: body ? "POST" : "GET", signal: AbortSignal.timeout(30000),
        headers: {Authorization: `Bearer ${r.stdout.trim()}`, "Content-Type": "application/json"}, body: body ? JSON.stringify(body) : undefined});
      if (!response.ok) return {httpStatus: response.status};
      return response.json();
    }
    const report = {project}, base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
    const release = await get(`https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore`);
    if (release.rulesetName) {
      const rules = await get(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
      report.firestoreRules = {read: !!rules.source, files: (rules.source?.files || []).map(f => ({name: f.name, sha256: hash(f.content)}))};
      if (rules.source?.files?.length === 1) fs.writeFileSync(path.join(out, `${project}-published.rules`), rules.source.files[0].content);
    } else report.firestoreRules = {read: false, httpStatus: release.httpStatus};
    const admission = await get(`${base}/storeWriterAdmission/${STORE}`);
    report.writerAdmission = {present: !!admission.name, httpStatus: admission.httpStatus || 200,
      mode: admission.fields?.mode?.stringValue || null, schemaVersion: admission.fields?.schemaVersion?.integerValue || null};
    if (project === "store-connect-hml") {
      const archive = await get(`${base}/hmlMigrationArchives/${STORE}`);
      const collections = await get(`${base}/hmlMigrationArchives/${STORE}:listCollectionIds`, {pageSize: 100});
      const sample = await get(`${base}/hmlMigrationArchives/${STORE}/historicalDocuments?pageSize=1`);
      report.archive = {rootPresent: !!archive.name, rootFieldNames: Object.keys(archive.fields || {}),
        collections: collections.collectionIds || [], collectionsComplete: !collections.nextPageToken,
        sampleFieldNames: Object.keys(sample.documents?.[0]?.fields || {}),
        verifiedManifest: false, reason: "Field names/counts alone do not establish provenance, consent or restore approval"};
    }
    fs.writeFileSync(path.join(out, `${project}-control-plane.json`), JSON.stringify(report, null, 2));
    console.log(`${project}: published rules read=${report.firestoreRules.read}, writerAdmission=${report.writerAdmission.present}`);
  }
}
main().catch(() => {console.error("Control plane read incomplete; no raw payload exported"); process.exitCode = 1;});
