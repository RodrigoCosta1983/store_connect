"use strict";
const {test, after} = require("node:test"), assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process"), path = require("node:path");
process.env.GCLOUD_PROJECT = "demo-store-connect-android04";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8194";
const index = require("../../index");
const admin = require("firebase-admin");
after(async () => { await Promise.all(admin.apps.map(app => app.delete())); });
const groups = {
  confirmSaleV2: ["confirmCommercialSaleV2", "getCommercialSaleMutationResultV1"],
  receiveDebtPaymentV1: ["receiveDebtPaymentV1", "getDebtPaymentResultV1"],
  createDeferredSaleV1: ["createDeferredSaleV1", "getDeferredSaleResultV1"],
  createManualCashV1: ["createManualCashV1", "getManualCashResultV1"],
  syncOfflineSaleV1: ["syncOfflineSaleV1", "getOfflineSaleResultV1"],
};
test("real deploy index exports existing Gen2 callables; App Check enforcement is exercised over HTTP", () => {
  for (const [file, names] of Object.entries(groups)) for (const name of names) {
    assert.equal(index[name], require("../../sales/" + file)[name], name);
    assert.equal(index[name].__endpoint.platform, "gcfv2", name);
    // SDK 7 enforces App Check in its runtime closure, not in this manifest.
    assert.ok(index[name].__endpoint.callableTrigger, name);
  }
  for (const name of ["confirmSaleV2", "getSaleMutationResultV1", "transitionStoreWriterAdmission", "transitionHmlStoreWriterAdmission", "createLocalAdmittedSaleHandlers"]) {
    assert.equal(index[name], undefined, name);
  }
});
for (const [project, scenario] of [
  ["store-connect-hml", "valid"], ["store-connect-hml", "missing"], ["store-connect-hml", "wrong-flag"],
  ["store-connect-hml", "wrong-runtime"], ["store-connect-hml", "mixed"], ["store-connect-hml", "emulator"],
  ["store-connect-app", "valid"], ["store-connect-app", "emulator"], ["demo-store-connect-android04", "emulator"],
]) test("destination matrix: " + project + "/" + scenario, () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "fixtures/commercial10DestinationProbe.cjs"), project, scenario],
    {encoding: "utf8", timeout: 20000});
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
test("administrative HML manager refuses PROD, foreign projects and mixed emulator targets before IO", async () => {
  const {transitionHmlStoreWriterAdmission} = require("../../sales/storeWriterAdmission");
  for (const projectId of ["store-connect-app", "foreign-project", "store-connect-hml"]) {
    await assert.rejects(transitionHmlStoreWriterAdmission({projectId}, {}), e => e.details.reason === "admission-management-hml-only");
  }
});
test("offline admission plan requires HML, stable identity, epoch, explicit review and no placeholders", () => {
  const {parsePlan} = require("../../../scripts/f9-commercial-hml-admission.cjs");
  const plan = {projectId: "store-connect-hml", operatorUid: "trusted-operator", command: {
    storeId: "hml-test", requestId: "stable", expectedEpoch: 2, mode: "authoritative", reason: "Reviewed HML evidence", evidenceId: "reviewed"}};
  assert.deepEqual(parsePlan(plan), plan);
  const initial = {...plan, command: {storeId: "new-synthetic-hml-store", requestId: "explicit-init", expectedEpoch: 0,
    mode: "legacy", reason: "Explicitly reviewed initialization of a new synthetic HML store"}};
  assert.deepEqual(parsePlan(initial), initial);
  for (const bad of [{...plan, projectId: "store-connect-app"}, {...plan, operatorUid: "REPLACE_WITH_UID"},
    {...plan, command: {...plan.command, expectedEpoch: 0}}, {...plan, command: {...plan.command, evidenceId: undefined}}]) {
    assert.throws(() => parsePlan(bad));
  }
});
test("trusted HML management gate reaches the shared core without any remote IO in this probe", async () => {
  const {transitionHmlStoreWriterAdmission} = require("../../sales/storeWriterAdmission");
  const prior = {project: process.env.GCLOUD_PROJECT, host: process.env.FIRESTORE_EMULATOR_HOST, emulator: process.env.FUNCTIONS_EMULATOR};
  process.env.GCLOUD_PROJECT = "store-connect-hml"; delete process.env.FIRESTORE_EMULATOR_HOST; delete process.env.FUNCTIONS_EMULATOR;
  const marker = new Error("Reached shared transaction boundary, no SDK client initialized");
  try {
    await assert.rejects(transitionHmlStoreWriterAdmission({projectId: "store-connect-hml", runTransaction: () => { throw marker; }},
      {auth: {uid: "trusted"}, data: {storeId: "synthetic", requestId: "stable", expectedEpoch: 2,
        mode: "authoritative", reason: "Reviewed", evidenceId: "proof"}}), error => error === marker);
  } finally {
    for (const [key, value] of [["GCLOUD_PROJECT", prior.project], ["FIRESTORE_EMULATOR_HOST", prior.host], ["FUNCTIONS_EMULATOR", prior.emulator]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
