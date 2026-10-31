"use strict";

// Test-process bridge ONLY: no HTTP endpoint, callable registration or index.
const assert = require("node:assert/strict");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
assert.match(process.env.GCLOUD_PROJECT || "", /^demo-/);
const admin = require("firebase-admin");
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
const {seedAdmission} = require("./storeWriterAdmissionFixture.cjs");
const {createLocalAdmittedSaleHandlers} = require("../../../sales/confirmSaleV2");

async function main(input) {
  const {storeId, uid} = input;
  assert.match(storeId, /^[a-zA-Z0-9-]+$/); assert.match(uid, /^[a-zA-Z0-9-]+$/);
  const store = db.collection("stores").doc(storeId);
  const user = db.collection("users").doc(uid);
  const control = db.collection("localIdentityTestFixtures").doc(storeId);
  const product = store.collection("products").doc("p");
  const handlers = createLocalAdmittedSaleHandlers({
    controlForStore: authorizedStore => {
      assert.equal(authorizedStore.path, store.path);
      return control;
    },
    admits: snapshot => snapshot.data().fixtureOpen === true,
  });
  switch (input.operation) {
    case "seed":
      await seedAdmission(db, storeId);
      await Promise.all([store.create({ownerId: uid, subscriptionStatus: "active"}),
        user.create({storeId, role: "admin"}),
        product.create({name: "Synthetic", price: 0.29, quantidade: 5, lotes: []}),
        control.create({fixtureOpen: true})]);
      return {seeded: true};
    case "send": return handlers.confirmSaleV2({auth: {uid}, data: input.command});
    case "lookup": return handlers.getSaleMutationResultV1({auth: {uid}, data: input.command});
    case "close": await control.update({fixtureOpen: false}); return {closed: true};
    case "revoke": await user.update({accessStatus: "revoked"}); return {revoked: true};
    case "state": {
      const [p, sales, receipts, cash] = await Promise.all([product.get(),
        store.collection("sales").get(), store.collection("auditLogs").get(), store.collection("cash_flow").get()]);
      return {quantity: p.data().quantidade, sales: sales.docs.map(doc => ({id: doc.id, ...doc.data()})),
        receiptCount: receipts.size, cashCount: cash.size,
        unpaidCount: sales.docs.filter(doc => doc.data().isPaid !== true).length,
        installmentCount: sales.docs.reduce((sum, doc) => sum + (doc.data().installments || []).length, 0)};
    }
    default: throw new Error("Unknown test operation");
  }
}
main(JSON.parse(process.argv[2])).then(result => process.stdout.write(JSON.stringify({result})),
  error => process.stdout.write(JSON.stringify({error: {code: error.code || "test-bridge-error",
    reason: error.details?.reason || null, message: error.message}})))
  .finally(() => db.terminate());
