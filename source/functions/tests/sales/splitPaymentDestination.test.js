"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict"), Module = require("node:module"), path = require("node:path");
const file = path.resolve(__dirname, "../../sales/syncOfflineSaleV1.js");
const sdk = Module.createRequire(file)("firebase-functions/v2/https");
let project = "store-connect-app", accesses = 0;
const boundary = new Error("Synthetic persistence boundary");
const callableOptions = new WeakMap();
const load = Module._load;
Module._load = function(name, ...args) {
  if (name === "firebase-admin") return {app: () => ({options:{projectId:project}}), firestore: () => {accesses++;throw boundary;}};
  if (name === "firebase-functions/v2/https") return {...sdk, onCall: (options, handler) => {
    callableOptions.set(handler, options);return handler;
  }};
  return load.call(this,name,...args);
};
const source = new Module(file, module);source.filename = file;source.paths = Module._nodeModulePaths(path.dirname(file));
source._compile(require("node:fs").readFileSync(file,"utf8"),file);Module._load = load;
const handlers = source.exports;
for (const fn of Object.values(handlers)) assert.equal(callableOptions.get(fn).enforceAppCheck, true);
function environment() {
  accesses=0;process.env.GCLOUD_PROJECT=project;delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.FIRESTORE_EMULATOR_HOST;delete process.env.FUNCTIONS_EMULATOR;
  delete process.env.F9_SPLIT_PAYMENTS_PROJECT;delete process.env.F9_COMMERCIAL_OFFLINE_PROJECT;
}
const request = () => ({auth:{uid:"u",token:{}},data:{schemaVersion:1,requestId:"sale",saleId:"sale",
  scope:{projectId:project,uid:"u",storeId:"s"},items:[{productId:"p",quantity:1,expectedUnitPriceCents:10000}],
  expectedTotalCents:10000,paymentMethod:"Misto",notes:"",customerId:null,createdAtMs:1,
  payments:[{method:"Dinheiro",amountCents:5000},{method:"Cartão de crédito",amountCents:5000}]}});

test("new PROD split services require their explicit project flag before data access", async () => {
  environment();for(const name of ["syncSplitPaymentSaleV1","getSplitPaymentSaleResultV1"])
    await assert.rejects(handlers[name](request()),e=>e.details.reason==="split-payments-disabled");
  assert.equal(accesses,0);
});
test("explicit split flag enables only the new family; old PROD offline recovery remains gated", async () => {
  environment();process.env.F9_SPLIT_PAYMENTS_PROJECT=project;
  await assert.rejects(handlers.syncSplitPaymentSaleV1(request()),e=>e===boundary);
  await assert.rejects(handlers.syncOfflineSaleV1(request()),e=>e.details.reason==="offline-production-writes-disabled");
  assert.equal(accesses,1);
});
test("HML split destination requires matching HML configuration", async () => {
  project="store-connect-hml";environment();process.env.F9_SPLIT_PAYMENTS_PROJECT="store-connect-app";
  await assert.rejects(handlers.syncSplitPaymentSaleV1(request()),e=>e.details.reason==="split-payments-disabled");
  process.env.F9_SPLIT_PAYMENTS_PROJECT=project;
  await assert.rejects(handlers.getSplitPaymentSaleResultV1(request()),e=>e===boundary);
  assert.equal(accesses,1);project="store-connect-app";
});
test("real project with emulator state or other project configuration cannot open split writes", async () => {
  environment();process.env.F9_SPLIT_PAYMENTS_PROJECT=project;process.env.FUNCTIONS_EMULATOR="true";
  process.env.FIRESTORE_EMULATOR_HOST="127.0.0.1:8213";
  await assert.rejects(handlers.syncSplitPaymentSaleV1(request()),e=>e.details.reason==="split-payments-disabled");
  assert.equal(accesses,0);
});
test("a demo destination is usable only on loopback and requires authentication", async () => {
  project="demo-split";environment();process.env.FUNCTIONS_EMULATOR="true";process.env.FIRESTORE_EMULATOR_HOST="remote.invalid:8213";
  await assert.rejects(handlers.syncSplitPaymentSaleV1(request()),e=>e.details.reason==="split-payments-disabled");
  process.env.FIRESTORE_EMULATOR_HOST="127.0.0.1:8213";
  await assert.rejects(handlers.syncSplitPaymentSaleV1({...request(),auth:null}),e=>e.code==="unauthenticated");
  assert.equal(accesses,0);project="store-connect-app";
});
