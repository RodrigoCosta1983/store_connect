import fs from "node:fs";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {test, before, after} from "node:test";
import {initializeTestEnvironment, assertFails, assertSucceeds} from "@firebase/rules-unit-testing";
import {doc, setDoc, getDoc, updateDoc, deleteField, setLogLevel} from "firebase/firestore";
const require = createRequire(import.meta.url);
const {FIELDS, SOURCE_HASH, hash, derive, verifySnapshot} = require("../../../tools/finance-hml/prepare-hml-financial-rules.cjs");
const folder = new URL("../../../build/hml-asaas-20261026/", import.meta.url);
const source = fs.readFileSync(new URL("published-hml.rules",folder));
const candidate = fs.readFileSync(new URL("firestore.hml-financial.candidate.rules",folder));
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,"127.0.0.1:8189","Dedicated loopback emulator only");
setLogLevel("silent");
const actors = ["owner","admin","operator","outsider"];
const internal = ["asaasSubscriptionAttempts","asaasSubscriptionExecutionReceipts","asaasWebhookEvents","asaasFinancialReconciliations","asaasFinancialAdmission"];
const financial = Object.fromEntries(FIELDS.map(field=>[field,"server-original"]));
let baseline, patched;
before(async () => {
  baseline = await initializeTestEnvironment({projectId:"demo-hml-financial-base-"+process.pid,
    firestore:{host:"127.0.0.1",port:8189,rules:source.toString("utf8")}});
  patched = await initializeTestEnvironment({projectId:"demo-hml-financial-patched-"+process.pid,
    firestore:{host:"127.0.0.1",port:8189,rules:candidate.toString("utf8")}});
  for (const env of [baseline,patched]) await env.withSecurityRulesDisabled(async context=>{
    const db = context.firestore();
    await setDoc(doc(db,"stores/pilot-empty"),{ownerId:"owner",name:"Synthetic",lowStockThreshold:10});
    await setDoc(doc(db,"stores/pilot-existing"),{ownerId:"owner",name:"Synthetic",lowStockThreshold:10,...financial});
    for (const actor of actors) await setDoc(doc(db,"users/"+actor),{
      role:actor==="operator"?"operador":"admin",storeId:actor==="outsider"?"other":"pilot-empty"});
    for (const collection of internal) await setDoc(doc(db,collection+"/synthetic"),{schemaVersion:1});
  });
});
after(async ()=>{for(const env of [baseline,patched]) if(env) await env.cleanup();});
async function ref(env,actor,store="pilot-empty") {
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),"users/"+actor),{
    role:actor==="operator"?"operador":"admin",storeId:actor==="outsider"?"other":store}));
  return doc(env.authenticatedContext(actor).firestore(),"stores/"+store);
}
async function existingRef(env,actor) {
  return ref(env,actor,"pilot-existing");
}
test("origin matches captured/live-confirmed source and patch adds only ten reserved names",()=>{
  assert.equal(hash(source),SOURCE_HASH);
  assert.equal(candidate.toString("utf8"),derive(source).candidate);
  const proof=JSON.parse(fs.readFileSync(new URL("rules-preflight.json",folder)));
  assert.equal(proof.remoteMatchesCaptured,true);
  assert.equal(proof.candidate.sha256,hash(candidate));
});
test("financial snapshot retains 114 files and its frozen content digest",()=>{
  assert.equal(verifySnapshot().intact,true);
});
for(const actor of actors) for(const field of FIELDS) for(const operation of ["add","change","remove"]) {
  test(`${actor}: cannot ${operation} reserved ${field}`,async()=>{
    const target=operation==="add"?await ref(patched,actor):await existingRef(patched,actor);
    await assertFails(updateDoc(target,{[field]:operation==="remove"?deleteField():"client-forged"}));
  });
}
for(const actor of ["owner","admin","operator"]) for(const field of ["name","lowStockThreshold"]) {
  test(`${actor}: operational ${field} remains allowed in source and candidate`,async()=>{
    for(const env of [baseline,patched]) await assertSucceeds(updateDoc(await ref(env,actor),{
      [field]:field==="name"?"Synthetic-"+actor:100+actors.indexOf(actor)}));
  });
}
for(const field of ["name","lowStockThreshold"]) test(`other-store operational ${field} stays denied`,async()=>{
  for(const env of [baseline,patched]) await assertFails(updateDoc(await ref(env,"outsider"),{[field]:field==="name"?"forged":500}));
});
for(const actor of ["owner","admin","operator"]) test(`${actor}: operational update retaining financial data stays allowed`,async()=>{
  for(const env of [baseline,patched]) await assertSucceeds(updateDoc(await existingRef(env,actor),{name:"Preserve-"+actor}));
});
for(const actor of actors) for(const collection of internal) test(`${actor}: internal root ${collection} retains read/write denial`,async()=>{
  for(const env of [baseline,patched]) {
    const target=doc(env.authenticatedContext(actor).firestore(),collection+"/synthetic");
    await assertFails(getDoc(target)); await assertFails(setDoc(target,{schemaVersion:2}));
  }
});
