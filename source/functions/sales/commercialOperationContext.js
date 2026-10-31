"use strict";
const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");
const {saleTransactionPrimitives} = require("./confirmSaleV2");
const fail = (reason, code = "failed-precondition") => {
  throw new HttpsError(code, "Operação não confirmada: " + reason, {reason});
};
function destination(configuration) {
  const project = admin.app().options.projectId;
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    if (/^demo-/.test(project) && process.env.GCLOUD_PROJECT === project &&
      /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) return;
  } else if (project === "store-connect-hml" &&
      process.env.GCLOUD_PROJECT === project && !process.env.FIRESTORE_EMULATOR_HOST &&
      process.env[configuration] === project) return;
  fail("commercial-operation-disabled");
}
function replay(snapshot, protocol, input, hash, uid) {
  const saved = snapshot.data();
  if (saved.actorUid !== uid) fail("result-access-denied", "permission-denied");
  if (saved.protocol !== protocol || saved.requestHash !== hash) return {status: "identity-conflict", requestId: input.requestId};
  return {...saved.result, replayed: true};
}
module.exports = {...saleTransactionPrimitives, fail, destination, replay,
  options: {timeoutSeconds: 60, memory: "256MiB", enforceAppCheck: true}};
