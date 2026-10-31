"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),folder=path.join(root,'build/prod-final-20261026'),candidate=path.join(folder,'candidate-v1');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),m=JSON.parse(fs.readFileSync(path.join(candidate,'manifest.json'))),frozen=JSON.parse(fs.readFileSync(path.join(folder,'candidate-checksums.json')));
assert.equal(hash(fs.readFileSync(path.join(candidate,'manifest.json'))),frozen.manifestSha256);process.env.GCLOUD_PROJECT='store-connect-app';process.env.GOOGLE_CLOUD_PROJECT='store-connect-app';process.env.ASAAS_ENV='production';process.env.ASAAS_CREDENTIAL_ENV='production';delete process.env.NODE_PATH;
require(path.join(candidate,'scripts/validate-prod-package.cjs'));
const local=createRequire(path.join(candidate,'functions/package.json')),sdk=local('firebase-functions/v2/https'),captured=new Map();
for(const key of ['onCall','onRequest']){const original=sdk[key];sdk[key]=(...args)=>{const fn=original(...args);captured.set(fn,typeof args[0]==='object'?args[0]:{});return fn;};}
for(const name of ['firebase-functions','firebase-admin','axios'])assert.ok(local.resolve(name).startsWith(path.join(candidate,'functions/node_modules')));
const exportsFound=local('./index.js');assert.deepEqual(Object.keys(exportsFound),m.selectedExports);
const discovery=[];for(const [name,fn] of Object.entries(exportsFound)){const e=fn.__endpoint;assert.equal(e.platform,'gcfv2');assert.deepEqual(e.region,['us-central1']);assert.equal(hash(e.serviceAccountEmail||e.serviceAccount).slice(0,16),m.runtimeIdentityFingerprint);assert.equal(e.scheduleTrigger,undefined);if(name!=='asaasWebhook')assert.equal(captured.get(fn).enforceAppCheck,true);discovery.push({name,appCheck:name!=='asaasWebhook',secrets:(e.secretEnvironmentVariables||[]).map(s=>s.key),platform:e.platform,region:e.region});}
const vm=require('node:vm'),wrapper=fs.readFileSync(path.join(candidate,'functions/index.js'),'utf8');
for(const env of [{GCLOUD_PROJECT:'store-connect-hml'},{GCLOUD_PROJECT:'store-connect-app',ASAAS_ENV:'sandbox',ASAAS_CREDENTIAL_ENV:'sandbox'}])assert.throws(()=>vm.runInNewContext(wrapper,{process:{env},exports:{},require(){throw Error('must not import');}}),/PROD/);
const config=local('./financeiro/asaasConfig.js').resolveAsaasConfig();assert.equal(config.operationsEnabled,false);assert.equal(config.environment,'production');assert.equal(config.projectId,'store-connect-app');
fs.writeFileSync(path.join(folder,'prod-discovery.json'),JSON.stringify({discovery,config:{projectId:config.projectId,environment:config.environment,operationsEnabled:config.operationsEnabled},immutableContentSha256:m.contentSha256},null,2)+'\n');
console.log('PASS PROD exact seven exports, AppCheck, runtime, Sandbox rejection by wrapper, immutable files, clean dependencies and operationsEnabled=false. No handler invoked.');
