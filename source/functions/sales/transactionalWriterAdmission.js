"use strict";

const {HttpsError} = require("firebase-functions/v2/https");

// Backend composition primitive, not an authorization check or rollout policy.
// The trusted caller must resolve controlRef from the authorized store and supply
// a deterministic, side-effect-free policy. No path, modes, epoch schema, default
// allow or control writer is selected here. Call before queuing ANY writes.
async function requireTransactionalWriterAdmission(transaction, controlRef, admits) {
  if (!transaction || typeof transaction.get !== "function" ||
      !controlRef || typeof admits !== "function") {
    throw new TypeError("Transactional admission requires a control reference and policy.");
  }
  // This read MUST belong to the same Firestore transaction as the new effects.
  // Firestore retries rerun it and the policy; no cached admission is returned.
  const snapshot = await transaction.get(controlRef);
  if (!snapshot.exists || await admits(snapshot) !== true) {
    throw new HttpsError("failed-precondition", "Novas escritas suspensas pelo controle de admissão.",
      {reason: "writer-admission-denied"});
  }
}

module.exports = {requireTransactionalWriterAdmission};
