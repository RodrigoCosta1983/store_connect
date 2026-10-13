"use strict";

const {spawnSync} = require("node:child_process");

function validateProject(projectId) {
  if (typeof projectId !== "string" || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) {
    throw new Error("Deploy project is missing or invalid.");
  }
}

function evaluateMetadata(projectId, metadata) {
  validateProject(projectId);
  if (metadata === null) return {allow: true, reason: "Function absent"};
  const expectedName = "projects/" + projectId + "/locations/us-central1/functions/bootstrapStore";
  if (!metadata || metadata.name !== expectedName || metadata.environment !== "GEN_2") {
    return {allow: false, reason: "Function metadata is indeterminate"};
  }
  if (metadata.labels?.["firebase-functions-codebase"] === "bootstrap") {
    return {allow: true, reason: "Function belongs to bootstrap codebase"};
  }
  return {allow: false, reason: "Function ownership is legacy/default or unknown"};
}

async function lookupRemoteFunction(projectId) {
  validateProject(projectId);
  // Fixed command plus validated project ID; token never appears in output.
  const tokenResult = spawnSync(process.platform === "win32" ? "gcloud.cmd" : "gcloud",
    ["auth", "print-access-token", "--project=" + projectId],
    {encoding: "utf8", shell: process.platform === "win32", timeout: 30000});
  if (tokenResult.error || tokenResult.status !== 0 || !tokenResult.stdout.trim()) {
    throw new Error("Unable to authenticate read-only metadata lookup.");
  }
  const response = await fetch("https://cloudfunctions.googleapis.com/v2/projects/" + projectId +
    "/locations/us-central1/functions/bootstrapStore", {
    headers: {Authorization: "Bearer " + tokenResult.stdout.trim(), "x-goog-user-project": projectId},
    signal: AbortSignal.timeout(30000),
  });
  const metadata = await response.json();
  if (response.status === 404 && metadata.error?.status === "NOT_FOUND") return null;
  if (!response.ok) throw new Error("Read-only Function lookup failed.");
  return metadata;
}

async function checkMigration({projectId, lookup = lookupRemoteFunction}) {
  validateProject(projectId);
  return evaluateMetadata(projectId, await lookup(projectId));
}

if (require.main === module) {
  // Firebase CLI lifecycleHooks.getChildEnvironment supplies the actual target.
  checkMigration({projectId: process.env.GCLOUD_PROJECT}).then((result) => {
    console.log("Bootstrap migration guard: " + (result.allow ? "ALLOW" : "BLOCK") + " ? " + result.reason);
    if (!result.allow) process.exitCode = 1;
  }).catch(() => {
    console.error("Bootstrap migration guard: BLOCK ? project or remote metadata could not be verified.");
    process.exitCode = 1;
  });
}

module.exports = {checkMigration, evaluateMetadata};
