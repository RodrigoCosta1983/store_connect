"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const project='store-connect-app',folder=path.resolve(__dirname,'../../build/prod-final-20261026'),m=JSON.parse(fs.readFileSync(path.join(folder,'prod-metadata.json'))),email=m.projectNumber+'-compute@developer.gserviceaccount.com';
assert.equal(crypto.createHash('sha256').update(email).digest('hex').slice(0,16),'fbfc64a2e0ccf114');
const x=spawnSync('gcloud.cmd',['auth','print-access-token','--project='+project,'--quiet'],{shell:true,encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(x.status,0);let token=x.stdout.trim();
const r={project,remoteWrites:0,secretValueReads:0,time:new Date().toISOString()};
(async()=>{for(const [name,url] of [['webhookResource',`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/ASAAS_WEBHOOK_TOKEN`],['apiKeyPolicy',`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/ASAAS_API_KEY:getIamPolicy?options.requestedPolicyVersion=3`]]){
 const res=await fetch(url,{headers:{Authorization:'Bearer '+token,'x-goog-user-project':project},signal:AbortSignal.timeout(20000)}),data=await res.json().catch(()=>null);
 r[name]={http:res.status};if(name==='apiKeyPolicy'&&res.ok){r[name].directUnconditionalRuntimeAccessor=(data.bindings||[]).some(b=>b.role==='roles/secretmanager.secretAccessor'&&!b.condition&&b.members?.includes('serviceAccount:'+email));r[name].bindingCount=data.bindings?.length||0;}
 }} )().catch(()=>{r.error='PRECONDITIONS_INCOMPLETE';process.exitCode=1;}).finally(()=>{token='';fs.writeFileSync(path.join(folder,'prod-deploy-preconditions.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r));});
