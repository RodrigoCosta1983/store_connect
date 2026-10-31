"use strict";
// Fixed HML metadata only. POSTs below are IAM read/analysis RPCs, never grants.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),{spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,"../.."), out=path.join(root,"build/hml-asaas-20261026"), project="store-connect-hml";
const {SELECTED}=require("./prepare-financial-candidate.cjs");
const fingerprint=value=>crypto.createHash("sha256").update(value).digest("hex").slice(0,16);
const masked=email=>email?email.slice(0,2)+"***@"+(email.split("@")[1]||"").slice(0,1)+"***":null;
function cli(args){const r=spawnSync("gcloud.cmd",args,{shell:true,encoding:"utf8",windowsHide:true,timeout:30000});if(r.status!==0)throw Error("Metadata CLI unavailable");return r.stdout.trim();}
async function main(){
 let token=cli(["auth","print-access-token","--project="+project,"--quiet"]);
 const report={project,generatedAt:new Date().toISOString(),writesExecuted:false,providerCalls:0};
 async function read(url,body){const r=await fetch(url,{method:body?"POST":"GET",signal:AbortSignal.timeout(20000),headers:{Authorization:"Bearer "+token,"x-goog-user-project":project,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});return{http:r.status,data:r.ok?await r.json():null};}
 function matching(policy,member){return(policy?.bindings||[]).filter(b=>b.members?.includes(member)).map(b=>({role:b.role,conditional:!!b.condition}));}
 try{
  const meta=await read(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`);if(meta.http!==200||!/^\d+$/.test(meta.data?.projectNumber||""))throw Error("HML project metadata unavailable");
  const number=meta.data.projectNumber, runtime=number+"-compute@developer.gserviceaccount.com", member="serviceAccount:"+runtime;
  report.projectNumber=number;report.runtime={expectedGen2Default:true,identity:masked(runtime),fingerprint:fingerprint(runtime)};
  const sa=await read(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${encodeURIComponent(runtime)}`);
  report.runtime.accountMetadataHttp=sa.http;report.runtime.exists=sa.http===200;report.runtime.disabled=sa.http===200?sa.data.disabled===true:null;
  const actAs=await read(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${encodeURIComponent(runtime)}:testIamPermissions`,{permissions:["iam.serviceAccounts.actAs"]});
  report.deployerRuntimeActAs={http:actAs.http,granted:actAs.http===200&&actAs.data.permissions?.includes("iam.serviceAccounts.actAs")===true};
  const projectPolicy=await read(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:getIamPolicy`,{options:{requestedPolicyVersion:3}});
  report.runtime.projectPolicyHttp=projectPolicy.http;report.runtime.projectBindings=matching(projectPolicy.data,member);
  report.secrets={};
  for(const name of ["ASAAS_API_KEY","ASAAS_WEBHOOK_TOKEN"]){
   // Direct metadata GET avoids treating an omitted empty versions[] as absent.
   const v1=await read(`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${name}/versions/1`);
   const latest=await read(`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${name}/versions/latest`);
   const policy=await read(`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${name}:getIamPolicy?options.requestedPolicyVersion=3`);
   const bindings=matching(policy.data,member), inherited=report.runtime.projectBindings;
   const proof=await read("https://policytroubleshooter.googleapis.com/v1/iam:troubleshoot",{accessTuple:{principal:runtime,fullResourceName:`//secretmanager.googleapis.com/projects/${number}/secrets/${name}`,permission:"secretmanager.versions.access"}});
   report.secrets[name]={v1:{http:v1.http,state:v1.data?.state||null},latest:{http:latest.http,version:latest.data?.name?.split("/").pop()||null,state:latest.data?.state||null},
    secretPolicyHttp:policy.http,runtimeSecretBindings:bindings,unconditionalSecretAccessor:bindings.concat(inherited).some(b=>b.role==="roles/secretmanager.secretAccessor"&&!b.conditional),
    effectiveAccessAnalysis:{http:proof.http,access:proof.data?.access||null,errorCount:proof.data?.errors?.length||0},valueAccessed:false,providerValidityVerified:false};
  }
  const permissions=["firebase.projects.get","cloudfunctions.functions.get","cloudfunctions.functions.list","cloudfunctions.functions.create","cloudfunctions.functions.update","cloudfunctions.functions.setIamPolicy","cloudfunctions.operations.get","run.services.get","run.services.setIamPolicy","cloudbuild.builds.create","cloudbuild.builds.get","artifactregistry.repositories.get","serviceusage.services.get","serviceusage.services.use","secretmanager.secrets.get","secretmanager.secrets.getIamPolicy","secretmanager.versions.get"];
  const permitted=await read(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:testIamPermissions`,{permissions});
  report.deployerPermissions={http:permitted.http,granted:permitted.data?.permissions||[],missing:permitted.http===200?permissions.filter(p=>!permitted.data.permissions?.includes(p)):null};
  report.services={};for(const service of ["cloudfunctions.googleapis.com","cloudbuild.googleapis.com","artifactregistry.googleapis.com","run.googleapis.com","secretmanager.googleapis.com"]){const r=await read(`https://serviceusage.googleapis.com/v1/projects/${project}/services/${service}`);report.services[service]={http:r.http,state:r.data?.state||null};}
  report.functions={};
  for(const name of ["bootstrapStore",...SELECTED]){const r=await read(`https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/us-central1/functions/${name}`);report.functions[name]={http:r.http,present:r.http===200,generation:r.data?.environment||null,codebase:r.data?.labels?.["firebase-functions-codebase"]||null,runtime:r.data?.buildConfig?.runtime||null,region:"us-central1",state:r.data?.state||null};}
  const release=await read(`https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore`);report.rules={releaseHttp:release.http};
  if(release.data?.rulesetName?.startsWith(`projects/${project}/rulesets/`)){const r=await read("https://firebaserules.googleapis.com/v1/"+release.data.rulesetName);report.rules.sourceHttp=r.http;if(r.data?.source?.files?.length===1)report.rules.sha256=crypto.createHash("sha256").update(r.data.source.files[0].content).digest("hex").toUpperCase();}
  fs.writeFileSync(path.join(out,"seven-functions-metadata.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
 }finally{token="";}
}
if(require.main===module)main().catch(()=>{console.error("HML metadata incomplete; no raw payload/identity exported");process.exitCode=1;});
