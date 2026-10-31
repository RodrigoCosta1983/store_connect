"use strict";
// Only Google HML metadata/source GETs. No secret access, provider or deploy API.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), {spawnSync} = require("node:child_process");
const root = path.resolve(__dirname, "../.."), out = path.join(root,"build/hml-asaas-20261026");
const SOURCE_HASH = "B87798E6DF1723FEC437BA96CD2D4E91FCC1B64DE2DE189A6D5EFB790EC1768B";
const SNAPSHOT_HASH = "25fe47bfcc5b78ca26677b57535ac07ba70b98d527b81d7ea8d2a7f09de1143b";
const FIELDS = Object.freeze(["asaasBindingEnvironment", "asaasBindingProjectId", "overdueSince", "overdueDueDate", "blockedAt",
  "subscriptionInactiveReason", "pendingPlanChange", "pendingPlanChangeRequestedAt", "subscriptionCreationStatus", "subscriptionCreationStartedAt"]);
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase();
function verifySnapshot() {
  const folder = path.join(out,"candidate-v2"), file = path.join(folder,"manifest.json"), bytes = fs.readFileSync(file), manifest = JSON.parse(bytes);
  if (manifest.files.length !== 114 || hash(JSON.stringify(manifest.files)).toLowerCase() !== SNAPSHOT_HASH) throw Error("Frozen financial manifest mismatch");
  for (const item of manifest.files) if (hash(fs.readFileSync(path.join(folder,item.path))).toLowerCase() !== item.sha256.toLowerCase()) throw Error("Frozen financial file mismatch");
  return {files:114, manifestSha256:hash(bytes), contentSha256:SNAPSHOT_HASH, intact:true};
}
function derive(source) {
  if (hash(source) !== SOURCE_HASH) throw Error("Captured HML source digest mismatch; stop");
  const text = source.toString("utf8"), newline = text.includes("\r\n") ? "\r\n" : "\n";
  const start = text.indexOf("match /stores/{storeId} {"), end = text.indexOf("// 4. Subcoleções", start);
  if (start < 0 || end < 0) throw Error("Unexpected HML store rule boundary");
  const section = text.slice(start,end), anchor = "          'asaasSubscriptionId'," + newline;
  if (section.split(anchor).length !== 2 || FIELDS.some(f=>section.includes("'"+f+"'"))) throw Error("Protection layout already changed; stop");
  const insertion = FIELDS.map(f=>"          '"+f+"',"+newline).join("");
  const candidate = text.slice(0,start) + section.replace(anchor,anchor+insertion) + text.slice(end);
  if (candidate.replace(anchor+insertion,anchor) !== text) throw Error("Unexpected change beyond reserved fields");
  return {candidate, insertion};
}
async function main() {
  const source = fs.readFileSync(path.join(out,"published-hml.rules"));
  if (hash(source) !== SOURCE_HASH) throw Error("Captured HML source unavailable or divergent");
  const snapshot = verifySnapshot(), auth = spawnSync("gcloud.cmd",["auth","print-access-token","--project=store-connect-hml","--quiet"],{shell:true,encoding:"utf8",windowsHide:true,timeout:30000});
  if (auth.status !== 0 || !auth.stdout.trim()) throw Error("HML metadata authentication unavailable");
  let token = auth.stdout.trim();
  const metadata = {project:"store-connect-hml",generatedAt:new Date().toISOString(),sourceSha256:SOURCE_HASH,snapshot};
  async function get(url) {
    const response = await fetch(url,{method:"GET",headers:{Authorization:"Bearer "+token,"x-goog-user-project":"store-connect-hml"},signal:AbortSignal.timeout(20000)});
    return {http:response.status,body:response.ok?await response.json():null};
  }
  try {
    const release = await get("https://firebaserules.googleapis.com/v1/projects/store-connect-hml/releases/cloud.firestore");
    if (release.http !== 200 || !release.body?.rulesetName?.startsWith("projects/store-connect-hml/rulesets/")) throw Error("Remote HML Rules unavailable; stop");
    const rules = await get("https://firebaserules.googleapis.com/v1/"+release.body.rulesetName);
    if (rules.http !== 200 || rules.body?.source?.files?.length !== 1 || typeof rules.body.source.files[0].content !== "string") throw Error("Remote HML Rules unavailable; stop");
    metadata.remoteSourceSha256=hash(rules.body.source.files[0].content);
    metadata.remoteMatchesCaptured=metadata.remoteSourceSha256===SOURCE_HASH;
    if (!metadata.remoteMatchesCaptured) throw Error("Remote HML Rules changed; stop before generating diff");
    for (const name of ["ASAAS_API_KEY","ASAAS_WEBHOOK_TOKEN"]) {
      const result=await get(`https://secretmanager.googleapis.com/v1/projects/store-connect-hml/secrets/${name}/versions?pageSize=100`);
      const versions=result.body?.versions;
      metadata[name]={http:result.http,metadataReadable:Array.isArray(versions),complete:Array.isArray(versions)&&!result.body.nextPageToken,
        enabledVersions:Array.isArray(versions)?versions.filter(v=>v.state==="ENABLED").length:null,valueRead:false};
    }
    const {candidate}=derive(source), target=path.join(out,"firestore.hml-financial.candidate.rules");
    if (fs.existsSync(target)) throw Error("Separate Rules candidate already exists; do not overwrite");
    fs.writeFileSync(target,candidate);
    metadata.candidate={path:path.relative(root,target).replace(/\\/g,"/"),sha256:hash(candidate),addedFields:FIELDS,otherBytesPreserved:true};
    fs.writeFileSync(path.join(out,"rules-preflight.json"),JSON.stringify(metadata,null,2)+"\n");
    fs.writeFileSync(path.join(out,"firebase.rules-only.emulator.json"),JSON.stringify({firestore:{rules:"firestore.hml-financial.candidate.rules"},emulators:{firestore:{host:"127.0.0.1",port:8189},ui:{enabled:false},singleProjectMode:false}},null,2)+"\n");
    console.log(JSON.stringify(metadata,null,2));
  } finally {token="";auth.stdout="";}
}
if (require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={FIELDS,SOURCE_HASH,SNAPSHOT_HASH,hash,derive,verifySnapshot};
