"use strict";
const {test,after}=require("node:test"),fs=require("node:fs"),path=require("node:path");
const {initializeTestEnvironment,assertFails}=require("@firebase/rules-unit-testing");
const {doc,setDoc,updateDoc}=require("firebase/firestore");
if(process.env.FIRESTORE_EMULATOR_HOST!=="127.0.0.1:8188")throw Error("Loopback emulator required");
let environment;
test("client cannot grant production admission, change attempts/receipts or override commercial identity/status",async()=>{
 environment=await initializeTestEnvironment({projectId:"demo-asaas-rules-"+process.pid,firestore:{host:"127.0.0.1",port:8188,rules:fs.readFileSync(path.resolve(__dirname,"../../../firestore.rules"),"utf8")}});
 await environment.withSecurityRulesDisabled(async context=>{const db=context.firestore();await setDoc(doc(db,"users/synthetic-owner"),{role:"admin",storeId:"synthetic-pilot",accessStatus:"active"});await setDoc(doc(db,"stores/synthetic-pilot"),{ownerId:"synthetic-owner",subscriptionStatus:"active",subscriptionType:"pro",name:"Synthetic"});});
 const db=environment.authenticatedContext("synthetic-owner").firestore();
 for(const collection of ["asaasFinancialAdmission","asaasSubscriptionAttempts","asaasSubscriptionExecutionReceipts","asaasFinancialReconciliations","asaasWebhookEvents","cpfs_cadastrados"]){await assertFails(setDoc(doc(db,collection+"/synthetic-pilot"),{enabled:true,status:"completed"}));}
 for(const change of [{asaasCustomerId:"synthetic-provider"},{asaasSubscriptionId:"synthetic-sub"},{asaasBindingEnvironment:"production"},{asaasBindingProjectId:"store-connect-app"},{subscriptionStatus:"inactive"},{subscriptionInactiveReason:"overdue"},{document:"00000000000"},{ownerId:"other-owner"}])await assertFails(updateDoc(doc(db,"stores/synthetic-pilot"),change));
});
after(async()=>{if(environment)await environment.cleanup();});
