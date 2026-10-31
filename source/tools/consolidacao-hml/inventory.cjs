"use strict";
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "../.."), out = path.join(root, "build/consolidacao-20261025");
function read(file) {
  const buf = fs.readFileSync(path.join(out, file));
  return JSON.parse(buf.toString(buf[0] === 255 && buf[1] === 254 ? "utf16le" : "utf8").replace(/^\uFEFF/, ""));
}
function type(e) {return ["callable", "https", "schedule", "event", "blocking", "taskQueue"].find(t => e[`${t}Trigger`] != null) || "unknown";}
const local = require("../../functions/index.js");
const bootstrap = require("../../functions-bootstrap/index.js");
const prod = read("prod-functions.json"), hml = read("hml-functions.json");
if (prod.status !== "success" || hml.status !== "success" || !Array.isArray(prod.result) || !Array.isArray(hml.result)) throw Error("invalid_inventory");
for (const inventory of [prod, hml]) if (inventory.result.some(f => !f.id || !f.region || !f.platform)) throw Error("unnamed_function_inventory_rejected");
function remote(f) {return f ? {name: f.id, region: f.region, generation: f.platform, state: f.state, trigger: type(f),
  secrets: (f.secretEnvironmentVariables || []).map(v => v.key), codeVersionVerified: false} : null;}
const names = [...new Set([...Object.keys(local), ...Object.keys(bootstrap), ...prod.result.map(f => f.id), ...hml.result.map(f => f.id)])].sort();
const rows = names.map(name => {
  const fn = local[name] || bootstrap[name], e = fn?.__endpoint;
  const p = prod.result.find(f => f.id === name), h = hml.result.find(f => f.id === name);
  const trigger = e ? type(e) : type(p || h || {});
  const modules = fn ? Object.values(require.cache).filter(m => m.filename.startsWith(root) && !m.filename.includes("node_modules") &&
    m.exports && typeof m.exports === "object" && Object.values(m.exports).includes(fn)).map(m => path.relative(root, m.filename).replace(/\\/g, "/")) : [];
  const sources = modules.filter(m => !/^(functions|functions-bootstrap)\/index.js$/.test(m));
  const sourceModules = sources.length ? sources : modules;
  const moduleDependencies = [...new Set(sourceModules.flatMap(file => [...fs.readFileSync(path.join(root, file), "utf8")
    .matchAll(/require\(["']([^"']+)["']\)/g)].map(match => match[1])))];
  const auth = /^(createProduct|upsertCategory|setProductCategories|deleteCategory)$/.test(name)
    ? "Auth + users/{uid}.storeId + normalized operational role + accessStatus; transactional storeWriterAdmission required; see module tests"
    : /^(listAsaasInvoices|getAsaasPortalUrl|getAsaasSubscriptionStateV1|createAsaasSubscription|changeAsaasPlan)$/.test(name)
      ? "Auth + ownerId + users/{uid}.storeId + admin + accessStatus; provider operations additionally require binding admission"
      : /^(getPublicCatalog|submitPublicCatalogSelection)$/.test(name)
        ? "Public catalog contract: server resolves store/catalog and validates token/state; never trust public totals"
        : "Handler-specific authorization review required before selecting for HML";
  let gate = "REVIEW_MODULE_AUTH_AND_DEPENDENCIES";
  if (/asaas|Overdue|expireTrials/i.test(name)) gate = "FINANCIAL_DISABLED_PENDING_SANDBOX_REVIEW";
  else if (trigger === "schedule" || trigger === "event") gate = "DO_NOT_ACTIVATE_TRIGGER_AUTOMATICALLY";
  else if (/Focus|Ncm|Nfce|Certificado|ext-/.test(name)) gate = "EXTERNAL_INTEGRATION_EXCLUDED";
  else if (["createProduct", "upsertCategory", "setProductCategories", "getProductEditState"].includes(name)) gate = "FIRST_WAVE_AFTER_EMULATOR_AUTH_VALIDATION";
  if (name === "getAsaasSubscriptionStateV1") gate = "FIRESTORE_READ_ONLY_CONFIG_AND_APPCHECK_REQUIRED";
  return {name, local: e ? {codebase: bootstrap[name] ? "bootstrap" : "default", generation: e.platform,
    regions: e.region || ["us-central1"], trigger, enforceAppCheck: e.callableTrigger?.enforceAppCheck === true,
    secrets: (e.secretEnvironmentVariables || []).map(v => v.key), authentication: trigger === "callable" ? "Module auth contract; see source/tests" : "Trigger specific"} : null,
    prod: remote(p), hml: remote(h), hmlStatus: !h ? "ABSENT" : !e ? "REMOTE_ONLY" : "PRESENT_CODE_PARITY_NOT_PROVEN",
    gate, authorizationContract: auth, sourceModules, moduleDependencies,
    dependencies: /Asaas|asaas/.test(name) ? ["Auth owner/admin", "App Check", "Firestore", "ASAAS_ENV=sandbox", "ASAAS_CREDENTIAL_ENV=sandbox", "Per-store binding admission", ...(e?.secretEnvironmentVariables || []).map(v => v.key)] : ["Module contract", "Firestore/Auth", "HML resource and role validation"]};
});
fs.writeFileSync(path.join(out, "function-matrix.json"), JSON.stringify({generatedAt: new Date().toISOString(),
  prodCount: prod.result.length, hmlCount: hml.result.length, localCount: Object.keys(local).length + Object.keys(bootstrap).length,
  note: "ACTIVE is infrastructure state, not functional verification or code parity. Runtime metadata loaded without invocation.", rows}, null, 2));
console.log(`Functions PROD=${prod.result.length}; HML=${hml.result.length}; local=${Object.keys(local).length + Object.keys(bootstrap).length}; union=${rows.length}`);
