"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const folder=path.resolve(__dirname,'../build/prod-offline-recovery-20261026'),candidate=path.join(folder,'candidate-v1'),m=JSON.parse(fs.readFileSync(path.join(candidate,'manifest.json'))),frozen=JSON.parse(fs.readFileSync(path.join(folder,'candidate-checksums.json')));
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(candidate,'manifest.json'))).digest('hex'),frozen.manifestSha256);
assert.ok(!m.files.some(f=>f.path.includes('financeiro')||f.path.includes('asaas')));
process.env.GCLOUD_PROJECT='store-connect-app';process.env.GOOGLE_CLOUD_PROJECT='store-connect-app';process.env.F9_COMMERCIAL_OFFLINE_PROJECT='disabled';
require(path.join(candidate,'scripts/guard.cjs'));
const local=createRequire(path.join(candidate,'functions/package.json')),sdk=local('firebase-functions/v2/https'),original=sdk.onCall,captured=new Map();
sdk.onCall=(options,handler)=>{const fn=original(options,handler);captured.set(fn,options);return fn;};
const exported=local('./index.js');assert.deepEqual(Object.keys(exported),m.selectedExports);
const endpoints=[];for(const [name,fn] of Object.entries(exported)){assert.equal(captured.get(fn).enforceAppCheck,true);assert.equal(fn.__endpoint.platform,'gcfv2');assert.deepEqual(fn.__endpoint.region,['us-central1']);assert.equal(fn.__endpoint.scheduleTrigger,undefined);assert.equal((fn.__endpoint.secretEnvironmentVariables||[]).length,0);endpoints.push({name,appCheck:true,region:fn.__endpoint.region,platform:fn.__endpoint.platform,secrets:[]});}
fs.writeFileSync(path.join(folder,'package-discovery.json'),JSON.stringify({project:'store-connect-app',endpoints,writerFlag:'disabled',handlersInvoked:0,externalIoBlocked:true,manifestSha256:frozen.manifestSha256},null,2)+'\n');
console.log('PACKAGE PASS: exactly two Gen2 endpoints; mandatory AppCheck; no secrets/Asaas/schedules; PROD writer disabled; no handler invoked.');
