"use strict";
const admin = require("firebase-admin");
const {POLICY_REVISION} = require("../../../sales/storeWriterAdmission");
// Explicit seed for isolated Emulator fixtures. Never imported by application.
async function seedAdmission(db, storeId, mode = "authoritative", epoch = 1) {
  if (!/^demo-/.test(db.projectId || "") ||
      !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) {
    throw new Error("Admission fixture requires demo/loopback");
  }
  await db.collection("storeWriterAdmission").doc(storeId).set({schemaVersion: 1,
    mode, epoch, policyRevision: POLICY_REVISION, changedBy: "synthetic-fixture-operator",
    changedAt: admin.firestore.Timestamp.now(), lastTransitionId: "synthetic-fixture"});
}
module.exports = {seedAdmission};
