"use strict";
// Local snapshot only. No Firebase CLI, provider, network, secret or document IO.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "../.."), source = path.join(root, "functions");
const destination = path.join(root, "build/hml-asaas-20261026/candidate-v2");
const SELECTED = Object.freeze(["getAsaasSubscriptionStateV1", "listAsaasInvoices", "getAsaasPortalUrl",
  "createAsaasSubscription", "asaasWebhook", "reconcileAsaasSubscriptionV1", "reviewAsaasSubscriptionAttemptV1"]);
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
function wrapper() {
  return '"use strict";\n' +
    '// HML-only packaging; domain handlers are preserved verbatim in app-index.js.\n' +
    'if (process.env.GCLOUD_PROJECT !== "store-connect-hml" ||\n' +
    '    (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT !== "store-connect-hml")) {\n' +
    '  throw new Error("Financial candidate is restricted to store-connect-hml");\n}\n' +
    'const original = require("./app-index.js");\n' +
    SELECTED.map(name => `if (typeof original.${name} !== "function") throw new Error("Missing selected financial export");\nexports.${name} = original.${name};`).join("\n") + '\n';
}
function prepare() {
  if (fs.existsSync(destination)) throw Error("Candidate already exists; never overwrite a frozen snapshot");
  const files = new Set();
  function visit(file) {
    if (!file.startsWith(source + path.sep) || !/\.js$/.test(file)) throw Error("Dependency outside runtime JS tree");
    if (files.has(file)) return;
    files.add(file);
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/require\(\s*["']([^"']+)["']\s*,?\s*\)/g)) {
      if (!match[1].startsWith(".")) continue;
      visit(require.resolve(path.resolve(path.dirname(file), match[1])));
    }
  }
  visit(path.join(source, "index.js"));
  fs.mkdirSync(path.join(destination, "functions"), {recursive: true});
  const manifest = {project: "store-connect-hml", region: "us-central1", codebase: "default",
    selectedExports: SELECTED, authorization: "NOT_AUTHORIZED_FOR_DEPLOY", originals: [], files: []};
  function write(relative, buffer) {
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, buffer);
    manifest.files.push({path: relative.replace(/\\/g,"/"), bytes: Buffer.byteLength(buffer), sha256: digest(buffer)});
  }
  for (const file of [...files].sort()) {
    const relative = path.relative(source, file), buffer = fs.readFileSync(file);
    write("functions/" + (relative === "index.js" ? "app-index.js" : relative), buffer);
    manifest.originals.push({path: "functions/" + relative.replace(/\\/g,"/"), sha256: digest(buffer)});
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
  delete pkg.scripts; // No generic npm deploy or unrelated lifecycle scripts.
  write("functions/package.json", JSON.stringify(pkg, null, 2) + "\n");
  write("functions/package-lock.json", fs.readFileSync(path.join(source, "package-lock.json")));
  write("functions/index.js", wrapper());
  write("functions/.env.example", "# Copy only after human approval; no secret values belong here.\nASAAS_ENV=sandbox\nASAAS_CREDENTIAL_ENV=sandbox\n");
  write("scripts/check-bootstrap-codebase-migration.js", fs.readFileSync(path.join(root, "scripts/check-bootstrap-codebase-migration.js")));
  write("firebase.hml-finance.candidate.json", JSON.stringify({functions: [{source: "functions", codebase: "default", runtime: "nodejs22",
    ignore: ["node_modules", ".git", "firebase-debug.log", "firebase-debug.*.log", "*.local", "tests/**", ".env.example"],
    predeploy: ["node scripts/check-bootstrap-codebase-migration.js"]}]}, null, 2) + "\n");
  const client = ["lib/services/subscription_billing_access.dart", "lib/screens/subscription_screen.dart", "lib/screens/finance/invoices_screen.dart"];
  manifest.clientFiles = client.map(file => ({path: file, sha256: digest(fs.readFileSync(path.join(root, file)))}));
  manifest.files.sort((a,b) => a.path.localeCompare(b.path));
  manifest.contentSha256 = digest(JSON.stringify(manifest.files));
  fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({candidate: destination, selectedExports: SELECTED, files: manifest.files.length, contentSha256: manifest.contentSha256, deploy: "NOT_EXECUTED"}, null, 2));
}
if (require.main === module) prepare();
module.exports = {SELECTED, wrapper};
