"use strict";
// Only Google metadata/document reads. No Admin writer, Asaas SDK or apply path.
const fs = require("node:fs"), path = require("node:path"), {spawnSync} = require("node:child_process");
const {SOURCE, TARGET, STORE, hash, planStore} = require("./plan.cjs");
const out = path.resolve(__dirname, "../../build/consolidacao-20261025");
function cli(args) {
  const r = spawnSync("gcloud.cmd", [...args, "--quiet"], {shell: true, encoding: "utf8", windowsHide: true});
  if (r.status !== 0) throw Error("gcloud_read_failed");
  return r.stdout.trim();
}
async function collect() {
  const projects = {};
  for (const project of [SOURCE, TARGET]) {
    const token = cli(["auth", "print-access-token", `--project=${project}`]);
    const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
    async function read(url, body) {
      // POST listCollectionIds is a read RPC, never a document mutation.
      const res = await fetch(url, {method: body ? "POST" : "GET", signal: AbortSignal.timeout(30000),
        headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"}, body: body ? JSON.stringify(body) : undefined});
      if (!res.ok) throw Error(`read_failed_${project}_${res.status}`);
      return res.json();
    }
    async function pages(url, key, body) {
      let next = "", rows = [], seen = new Set();
      for (let n = 0; n < 100; n++) {
        const value = await read(body ? url : `${url}${url.includes("?") ? "&" : "?"}pageSize=100${next ? `&pageToken=${encodeURIComponent(next)}` : ""}`,
          body ? {...body, pageSize: 100, ...(next ? {pageToken: next} : {})} : undefined);
        rows.push(...(value[key] || []));
        next = value.nextPageToken;
        if (!next) return rows;
        if (seen.has(next)) throw Error("repeated_page_token");
        seen.add(next);
      }
      throw Error("pagination_limit_no_partial_result");
    }
    const docs = [], counts = {};
    async function tree(relative, depth = 0) {
      if (depth > 12 || docs.length > 5000) throw Error("tree_limit_no_partial_result");
      const collections = await pages(`${base}/${relative}:listCollectionIds`, "collectionIds", {});
      for (const name of collections.sort()) {
        const collection = `${relative}/${name}`;
        const children = await pages(`${base}/${collection}?showMissing=true`, "documents");
        counts[collection] = children.filter(d => d.updateTime).length;
        for (const child of children) {
          const relativePath = child.name.split("/documents/")[1];
          if (child.updateTime) docs.push({path: relativePath, fields: child.fields || {}, updateTime: child.updateTime});
          await tree(relativePath, depth + 1);
        }
      }
    }
    const root = await read(`${base}/stores/${STORE}`);
    docs.push({path: `stores/${STORE}`, fields: root.fields, updateTime: root.updateTime});
    await tree(`stores/${STORE}`);
    const ownerId = root.fields.ownerId?.stringValue;
    const user = ownerId ? await read(`${base}/users/${ownerId}`) : {};
    const owner = {uid: ownerId, storeId: user.fields?.storeId?.stringValue, role: user.fields?.role?.stringValue,
      accessStatus: user.fields?.accessStatus?.stringValue};
    const archiveRoot = `hmlMigrationArchives/${STORE}`;
    let archive = [];
    if (project === TARGET) archive = await pages(`${base}/${archiveRoot}/historicalDocuments?mask.fieldPaths=sourceRelativePath&mask.fieldPaths=collectionType&mask.fieldPaths=contentHash&mask.fieldPaths=sourceProject&mask.fieldPaths=operational&mask.fieldPaths=version`, "documents");
    let archiveComparison = null;
    if (project === TARGET) {
      const relative = archive.map(d => d.fields?.sourceRelativePath?.stringValue || "");
      const paths = relative.map(p => p.startsWith(`stores/${STORE}/`) ? p : `stores/${STORE}/${p}`);
      const archived = new Set(paths);
      const sourceHistory = projects[SOURCE].docs.filter(d => d.path !== `stores/${STORE}` && !/^stores\/[^/]+\/(products|categories)\//.test(d.path));
      archiveComparison = {sourceHistoricalDocumentsNow: sourceHistory.length,
        sourceDocumentsCoveredByArchivePath: sourceHistory.filter(d => archived.has(d.path)).length,
        sourceDocumentKeysNotInArchive: sourceHistory.filter(d => !archived.has(d.path)).map(d => hash(d.path)),
        duplicateArchivePaths: paths.length - archived.size,
        validSourceProjectEntries: archive.filter(d => d.fields?.sourceProject?.stringValue === SOURCE).length,
        nonOperationalEntries: archive.filter(d => d.fields?.operational?.booleanValue === false).length,
        contentHashShapeValidEntries: archive.filter(d => /^[a-f0-9]{64}$/i.test(d.fields?.contentHash?.stringValue || "")).length,
        cryptographicContentAndManifestVerified: false};
    }
    projects[project] = {docs, owner};
    const summary = {project, rootFields: Object.keys(root.fields || {}).sort(), rootUpdateTime: root.updateTime,
      ownerGuard: owner.role === "admin" && owner.storeId === STORE && owner.accessStatus !== "revoked",
      documents: docs.length, collections: Object.entries(counts).map(([p, count]) => ({collection: p.split("/").length === 3 ? p : hash(p), count})),
      archiveCount: archive.length, archiveMetadataFields: [...new Set(archive.flatMap(d => Object.keys(d.fields || {})))],
      archiveComparison,
      archiveManifestVerified: false, archivePolicy: "Nao restaurar; metadados nao comprovam consentimento/proveniencia/manifesto",
      bindingsPresent: {customer: !!root.fields.asaasCustomerId, subscription: !!root.fields.asaasSubscriptionId},
      entitlement: {status: root.fields.subscriptionStatus?.stringValue, type: root.fields.subscriptionType?.stringValue}};
    fs.writeFileSync(path.join(out, `${project}-store-summary.json`), JSON.stringify(summary, null, 2));
    console.log(`${project}: ${docs.length} documents, ${Object.keys(counts).length} collections, archive=${archive.length}`);
  }
  const plan = planStore({source: projects[SOURCE].docs, target: projects[TARGET].docs, owner: projects[TARGET].owner});
  fs.writeFileSync(path.join(out, "migration-dry-run.json"), JSON.stringify(plan, null, 2));
  console.log(`DRY_RUN: ${plan.entries.length} documents; apply=false; no remote writes`);
}
if (require.main === module) {
  if (process.argv.length !== 2) throw Error("No arguments allowed; apply not implemented");
  collect().catch(() => {console.error("READ_ONLY_COLLECTION_FAILED: incomplete, no raw payload exported"); process.exitCode = 1;});
}
