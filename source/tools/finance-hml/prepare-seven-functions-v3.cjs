"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const root=path.resolve(__dirname,"../.."), folder=path.join(root,"build/hml-asaas-20261026"), source=path.join(folder,"candidate-v2"), target=path.join(folder,"candidate-v3");
const {verifySnapshot,SNAPSHOT_HASH}=require("./prepare-hml-financial-rules.cjs");
const {SELECTED}=require("./prepare-financial-candidate.cjs");
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
function main(){
 const parent=verifySnapshot(); if(fs.existsSync(target))throw Error("candidate-v3 already exists; do not overwrite");
 const metadata=JSON.parse(fs.readFileSync(path.join(folder,"seven-functions-metadata.json")));
 if(metadata.project!=="store-connect-hml"||!/^\d+$/.test(metadata.projectNumber)||!metadata.runtime.exists||metadata.runtime.disabled)throw Error("Runtime HML identity not established");
 const original=JSON.parse(fs.readFileSync(path.join(source,"manifest.json")));
 for(const item of original.files){const dest=path.join(target,item.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(source,item.path),dest);}
 const wrapper=fs.readFileSync(path.join(target,"functions/index.js"),"utf8");
 const anchor='const original = require("./app-index.js");';
 const explicit='// Explicitly pin the documented Gen2 default identity; never select PROD.\n'+
  'require("firebase-functions/v2").setGlobalOptions({region:"us-central1",\n'+
  '  serviceAccount:"'+metadata.projectNumber+'"+"-compute@"+"developer.gserviceaccount.com"});\n';
 if(wrapper.split(anchor).length!==2)throw Error("Unexpected frozen wrapper");
 fs.writeFileSync(path.join(target,"functions/index.js"),wrapper.replace(anchor,explicit+anchor));
 fs.writeFileSync(path.join(target,"functions/.env.store-connect-hml"),"ASAAS_ENV=sandbox\nASAAS_CREDENTIAL_ENV=sandbox\n");
 const configPath=path.join(target,"firebase.hml-finance.candidate.json"), config=JSON.parse(fs.readFileSync(configPath));
 config.functions[0].predeploy.unshift("node scripts/validate-seven-package.cjs");
 fs.writeFileSync(configPath,JSON.stringify(config,null,2)+"\n");
 const guard='"use strict";\nconst fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict");\n'+
  'assert.equal(process.env.GCLOUD_PROJECT,"store-connect-hml","Only HML preparation/deploy is permitted");\n'+
  'const root=path.resolve(__dirname,".."),manifest=JSON.parse(fs.readFileSync(path.join(root,"manifest.json")));\n'+
  'const hash=b=>crypto.createHash("sha256").update(b).digest("hex");\n'+
  'assert.equal(manifest.parentContentSha256,"'+SNAPSHOT_HASH+'");\n'+
  'assert.deepEqual(manifest.selectedExports,'+JSON.stringify(SELECTED)+');\n'+
  'assert.equal(hash(JSON.stringify(manifest.files)),manifest.contentSha256);\n'+
  'for(const item of manifest.files)assert.equal(hash(fs.readFileSync(path.join(root,item.path))),item.sha256,item.path);\n'+
  'assert.equal(fs.readFileSync(path.join(root,"functions/.env.store-connect-hml"),"utf8"),"ASAAS_ENV=sandbox\\nASAAS_CREDENTIAL_ENV=sandbox\\n");\n'+
  'console.log("Seven-function HML package: PASS; no remote write/deploy performed by this guard");\n';
 fs.writeFileSync(path.join(target,"scripts/validate-seven-package.cjs"),guard);
 const manifest={project:"store-connect-hml",codebase:"default",runtime:"nodejs22",region:"us-central1",selectedExports:SELECTED,
  parentManifestSha256:parent.manifestSha256,parentContentSha256:SNAPSHOT_HASH,runtimeIdentityFingerprint:metadata.runtime.fingerprint,
  authorization:"PREPARATION_ONLY_NO_DEPLOY",changedFromV2:["functions/index.js","firebase.hml-finance.candidate.json"],
  addedFromV2:["functions/.env.store-connect-hml","scripts/validate-seven-package.cjs"],files:[]};
 const relative=[...original.files.map(f=>f.path),...manifest.addedFromV2].sort((a,b)=>a.localeCompare(b));
 for(const file of relative){const bytes=fs.readFileSync(path.join(target,file));manifest.files.push({path:file,bytes:bytes.length,sha256:hash(bytes)});}
 manifest.contentSha256=hash(JSON.stringify(manifest.files));
 fs.writeFileSync(path.join(target,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");
 const only=SELECTED.map(name=>"functions:default:"+name).join(",");
 const command="firebase.cmd deploy --project store-connect-hml --config build/hml-asaas-20261026/candidate-v3/firebase.hml-finance.candidate.json --only "+only+" --non-interactive";
 fs.writeFileSync(path.join(folder,"seven-functions-command-NOT-EXECUTED.txt"),"NÃO EXECUTADO — exige nova autorização e gates de IAM.\n"+command+"\n");
 console.log(JSON.stringify({candidate:target,files:manifest.files.length,parentIntact:verifySnapshot().intact,contentSha256:manifest.contentSha256,manifestSha256:hash(fs.readFileSync(path.join(target,"manifest.json"))),commandGeneratedNotExecuted:true},null,2));
}
if(require.main===module)main();
