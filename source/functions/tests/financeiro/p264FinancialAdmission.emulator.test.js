"use strict";

const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8188") {
  throw Error("P2.6.4 requires loopback Firestore Emulator on port 8188");
}
// Explicit host/port below; do not discover unrelated emulators via hub.
delete process.env.FIREBASE_EMULATOR_HUB;
const {initializeTestEnvironment, assertFails, assertSucceeds} = require("@firebase/rules-unit-testing");
const {doc, setDoc, getDoc, updateDoc, deleteDoc} = require("firebase/firestore");
const projectId = "demo-store-connect-p264";
const {checkStoreFinancialAdmission} = require("../../financeiro/storeFinancialAdmission");
let env;
const ready = initializeTestEnvironment({projectId, firestore: {host: "127.0.0.1", port: 8188,
  rules: fs.readFileSync(path.join(__dirname, "../../../firestore.rules"), "utf8")}}).then(async value => {
  env = value;
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "users/owner"), {storeId: "store-a", role: "admin"});
    await setDoc(doc(db, "stores/store-a"), {ownerId: "owner"});
    await setDoc(doc(db, "asaasFinancialAdmission/store-a"), {
      schemaVersion: 1, enabled: true, storeId: "store-a", environment: "production",
      projectId: "store-connect-app", operations: ["subscription.create"],
    });
  });
});
after(async () => {await ready; await env.cleanup();});
for (const identity of ["owner", "foreign-owner", null]) {
  test(`Rules deny root grant create/update/delete/read for ${identity || "unauthenticated"}`, async () => {
    await ready;
    const db = identity ? env.authenticatedContext(identity).firestore() : env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "asaasFinancialAdmission/store-a")));
    await assertFails(setDoc(doc(db, "asaasFinancialAdmission/new-store"), {enabled: true}));
    await assertFails(updateDoc(doc(db, "asaasFinancialAdmission/store-a"), {enabled: false}));
    await assertFails(deleteDoc(doc(db, "asaasFinancialAdmission/store-a")));
  });
}
test("store wildcard shadow does not authorize financial operation", async () => {
  await ready;
  const db = env.authenticatedContext("owner").firestore();
  // Existing generic subcollection allow is deliberately not changed. The backend
  // only reads the independent root, so this client-created shadow has no effect.
  await assertSucceeds(setDoc(doc(db, "stores/store-a/asaasFinancialAdmission/store-a"), {enabled: true}));
  const reads = [];
  const backend = {collection(name) {
    reads.push(name);
    return {doc(id) {return {get: async () => ({exists: false})};}};
  }};
  const result = await checkStoreFinancialAdmission({db: backend, storeId: "store-a", storeData: {},
    operation: "subscription.create", config: {environment: "production", projectId: "store-connect-app", operationsEnabled: true}});
  assert.equal(result.allowed, false);
  assert.deepEqual(reads, ["asaasFinancialAdmission"]);
});
test("financial attempt/event/reconciliation roots deny client read and write", async () => {
  await ready;
  const db = env.authenticatedContext("owner").firestore();
  for (const root of ["asaasSubscriptionAttempts", "asaasSubscriptionExecutionReceipts", "asaasWebhookEvents", "asaasFinancialReconciliations"]) {
    await assertFails(getDoc(doc(db, `${root}/synthetic-record`)));
    await assertFails(setDoc(doc(db, `${root}/synthetic-record`), {status: "completed"}));
  }
});
test("privileged synthetic root grant, absence and revocation are read from Emulator", async () => {
  await ready;
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const backend = {collection(name) {return {doc(id) {return {get: async () => {
      const snap = await getDoc(doc(db, `${name}/${id}`));
      return {exists: snap.exists(), data: () => snap.data()};
    }};}};}};
    const command = {db: backend, storeId: "store-a", storeData: {}, operation: "subscription.create",
      config: {environment: "production", projectId: "store-connect-app", operationsEnabled: true}};
    assert.equal((await checkStoreFinancialAdmission(command)).allowed, true);
    await updateDoc(doc(db, "asaasFinancialAdmission/store-a"), {enabled: false});
    assert.equal((await checkStoreFinancialAdmission(command)).allowed, false);
    await deleteDoc(doc(db, "asaasFinancialAdmission/store-a"));
    assert.equal((await checkStoreFinancialAdmission(command)).allowed, false);
  });
});
