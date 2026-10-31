"use strict";
// Local files only: no Firebase initialization, login, remote lookup or deploy.
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const variables = ["CHECKOUT", "RECEIVABLES", "FIADO", "CASH", "OFFLINE"].map(p => `F9_COMMERCIAL_${p}_PROJECT`);
function commercialEnv(file) {
  const result = {};
  if (!fs.existsSync(file)) return result;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*(F9_COMMERCIAL_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) {
      if (Object.hasOwn(result, match[1])) throw new Error("Duplicate commercial environment variable.");
      result[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return result;
}
function inspect() {
  const read = p => fs.readFileSync(path.join(root, p), "utf8");
  const env = commercialEnv(path.join(root, "functions/.env.store-connect-hml"));
  if (variables.some(key => env[key] !== "store-connect-hml") || Object.keys(env).some(key => !variables.includes(key))) {
    throw new Error("The five commercial flags must explicitly target HML in its project-specific env file.");
  }
  for (const p of ["functions/.env", "functions/.env.store-connect-app"]) {
    if (Object.keys(commercialEnv(path.join(root, p))).length) throw new Error("Commercial flags must not be configured in shared/PROD env files.");
  }
  const firebase = JSON.parse(read("firebase.json"));
  if (!firebase.functions.some(f => f.source === "functions" && f.codebase === "default" && f.runtime === "nodejs22")) {
    throw new Error("Unexpected Functions codebase/runtime.");
  }
  const config = JSON.parse(read("android/app/src/hml/google-services.json"));
  if (config.project_info.project_id !== "store-connect-hml" || config.client.length !== 1) throw new Error("Android HML project mismatch.");
  const client = config.client[0], options = read("lib/firebase/firebase_options_hml.dart").split("static const web")[0];
  const appId = /appId:\s*'([^']+)'/.exec(options)?.[1];
  if (client.client_info.mobilesdk_app_id !== appId) throw new Error("Native/Dart HML app identity mismatch.");
  const packageName = client.client_info.android_client_info.package_name;
  const gradle = read("android/app/build.gradle.kts");
  if (!gradle.includes('applicationId = "com.storeeconnect.app"')) throw new Error("PROD package changed.");
  const hmlFlavor = /create\("hml"\)\s*\{([^}]+)\}/.exec(gradle)?.[1];
  if (/applicationId\s*=\s*"([^"]+)"/.exec(hmlFlavor || "")?.[1] !== packageName) throw new Error("HML Gradle/Firebase package mismatch.");
  const profiles = ["checkout", "offline"].map(p => JSON.parse(read(`config/f9-commercial-hml-${p}.json`)));
  if (profiles[0].COMMERCIAL_CHECKOUT_V2 !== true || profiles[1].COMMERCIAL_CHECKOUT_V2 !== false ||
      profiles.some(p => p.USE_FIREBASE_EMULATORS !== false)) throw new Error("Invalid explicit HML profiles.");
  return {status: "local-preparation-verified", projectId: "store-connect-hml", region: "us-central1",
    commercialVariables: variables, codebase: "default", androidFlavor: "hml", entrypoint: "lib/main_hml.dart",
    packageName, separatePackageReady: packageName !== "com.storeeconnect.app",
    remoteChecksPerformed: false, deployPerformed: false,
    blockers: packageName === "com.storeeconnect.app" ? ["HML currently shares the PROD package; separate Firebase/OAuth/certificate registration and install approval required"] : []};
}
if (require.main === module) {
  try {
    if (process.argv.slice(2).some(arg => arg !== "--require-separate-package")) throw new Error("Unsupported preflight option.");
    const result = inspect(); console.log(JSON.stringify(result, null, 2));
    if (process.argv.includes("--require-separate-package") && !result.separatePackageReady) process.exitCode = 2;
  } catch (error) { console.error("HML local preflight stopped: " + error.message); process.exitCode = 1; }
}
module.exports = {inspect, commercialEnv, variables};
