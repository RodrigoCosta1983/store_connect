"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "../.."), build = path.join(root,"build/hml-asaas-20261026"), candidate = path.join(build,"candidate-v2");
const {SELECTED, wrapper} = require("./prepare-financial-candidate.cjs");
const {safeEnv} = require("./read-financial-preconditions.cjs");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
test("wrapper passes exactly seven original financial handlers through; no cron/bootstrap/F9/F10", () => {
  const original = Object.fromEntries([...SELECTED, "bootstrapStore", "expireTrials", "confirmSaleV2"].map(name => [name, () => {}]));
  const exports = {};
  vm.runInNewContext(wrapper(), {exports, process: {env: {GCLOUD_PROJECT:"store-connect-hml"}}, require(name) {assert.equal(name,"./app-index.js"); return original;}});
  assert.deepEqual(Object.keys(exports), [...SELECTED]);
  for (const name of SELECTED) assert.equal(exports[name],original[name]);
});
test("wrong/missing/mixed project is rejected before importing any handlers", () => {
  for (const env of [{}, {GCLOUD_PROJECT:"store-connect-app"}, {GCLOUD_PROJECT:"store-connect-hml",GOOGLE_CLOUD_PROJECT:"store-connect-app"}]) {
    assert.throws(() => vm.runInNewContext(wrapper(), {exports:{},process:{env},require(){throw Error("must not import");}}), /restricted to store-connect-hml/);
  }
});
test("every frozen source matches current runtime source and every packaged byte matches manifest", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(candidate,"manifest.json")));
  for (const item of manifest.originals) assert.equal(hash(fs.readFileSync(path.join(root,item.path))),item.sha256,item.path);
  for (const item of manifest.files) {
    assert.equal(hash(fs.readFileSync(path.join(candidate,item.path))),item.sha256,item.path);
    assert.ok(!/node_modules|tests\/|\.env\.(?!example$)|\.local$/.test(item.path),item.path);
  }
  assert.equal(hash(JSON.stringify(manifest.files)),manifest.contentSha256);
  assert.deepEqual(fs.readFileSync(path.join(candidate,"functions/package-lock.json")),fs.readFileSync(path.join(root,"functions/package-lock.json")));
});
test("deployment config contains only default financial source, existing bootstrap predeploy guard and no other services", () => {
  const config = JSON.parse(fs.readFileSync(path.join(candidate,"firebase.hml-finance.candidate.json")));
  assert.deepEqual(Object.keys(config),["functions"]);
  assert.equal(config.functions.length,1); assert.equal(config.functions[0].codebase,"default");
  assert.deepEqual(config.functions[0].predeploy,["node scripts/check-bootstrap-codebase-migration.js"]);
  const pkg = JSON.parse(fs.readFileSync(path.join(candidate,"functions/package.json")));
  assert.equal(pkg.main,"index.js"); assert.equal(pkg.engines.node,"22"); assert.equal(pkg.scripts,undefined);
});
test("safe config projection emits only Sandbox booleans and never secret/unknown values", () => {
  assert.deepEqual(safeEnv('ASAAS_ENV="sandbox"\nASAAS_CREDENTIAL_ENV=sandbox\nASAAS_API_KEY=synthetic-do-not-export'),
    {ASAAS_ENV_is_sandbox:true,ASAAS_CREDENTIAL_ENV_is_sandbox:true});
  assert.equal(JSON.stringify(safeEnv("ASAAS_ENV=production\nUNKNOWN=private")).includes("private"),false);
});
test("actual candidate discovers only selected Gen2 HTTP/callable exports with no IO", () => {
  const previous = {...process.env};
  try {
    process.env.GCLOUD_PROJECT="store-connect-hml"; process.env.GOOGLE_CLOUD_PROJECT="store-connect-hml";
    process.env.NODE_PATH=path.join(root,"functions/node_modules"); require("node:module").Module._initPaths();
    const exports = require(path.join(candidate,"functions/index.js"));
    assert.deepEqual(Object.keys(exports),[...SELECTED]);
    for (const [name,fn] of Object.entries(exports)) {
      assert.equal(fn.__endpoint.platform,"gcfv2",name);
      assert.equal(fn.__endpoint.scheduleTrigger,undefined,name);
      assert.ok(fn.__endpoint.callableTrigger || fn.__endpoint.httpsTrigger,name);
    }
    const secrets = fn => (fn.__endpoint.secretEnvironmentVariables || []).map(x => x.key).sort();
    assert.deepEqual(secrets(exports.getAsaasSubscriptionStateV1),[]);
    assert.deepEqual(secrets(exports.asaasWebhook),["ASAAS_API_KEY","ASAAS_WEBHOOK_TOKEN"]);
    for (const name of SELECTED.filter(n=>!['getAsaasSubscriptionStateV1','asaasWebhook'].includes(n))) assert.deepEqual(secrets(exports[name]),["ASAAS_API_KEY"]);
  } finally {
    for (const name of ["GCLOUD_PROJECT","GOOGLE_CLOUD_PROJECT","NODE_PATH"]) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name]=previous[name];
    }
    require("node:module").Module._initPaths();
  }
});
test("official OpenAPI list envelopes contain the typed pagination fields used by the parser", () => {
  for (const slug of ["listar-assinaturas","listar-cobrancas","listar-cobrancas-de-uma-assinatura"]) {
    const markdown = fs.readFileSync(path.join(build,slug+".md"),"utf8");
    const block = markdown.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    assert.ok(block,"OpenAPI JSON block: "+slug);
    const api = JSON.parse(block[1]);
    const schema = Object.values(api.components.schemas).find(s=>s.properties?.hasMore && s.properties?.totalCount && s.properties?.data);
    assert.ok(schema,"list schema: "+slug);
    for (const [field,type] of Object.entries({hasMore:"boolean",totalCount:"integer",limit:"integer",offset:"integer",data:"array"})) assert.equal(schema.properties[field].type,type,slug+":"+field);
  }
});
test("documented full-page offsets and typed envelopes are accepted without authorizing any provider POST", async () => {
  const {readCompleteAsaasList} = require(path.join(candidate,"functions/financeiro/asaasCompleteList"));
  const offsets=[];
  const rows = await readCompleteAsaasList({url:"https://synthetic.invalid/list",pageSize:2,headers:{},get:async (_,options)=>{
    const offset=options.params.offset; offsets.push(offset);
    return {data:{object:"list",hasMore:offset===0,totalCount:3,limit:2,offset,data:offset===0?[{id:"synthetic-a"},{id:"synthetic-b"}]:[{id:"synthetic-c"}]}};
  }});
  assert.deepEqual(offsets,[0,2]); assert.equal(rows.length,3);
});
