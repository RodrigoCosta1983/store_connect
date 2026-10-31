"use strict";
const admin = require("firebase-admin");
const {FieldValue} = require("firebase-admin/firestore");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {isDeepStrictEqual: equal} = require("node:util");
const {localMutationSupport: core, firestoreValue} = require("../products/productVariantsC1");
const v1 = require("./variantSaleV1"), v2 = require("./variantCommercialV2");
const contract = require("./saleV2Contract");
const shared = require("./commercialOperationContext");
const fail = (reason, code = "failed-precondition") => { throw new HttpsError(code, reason, {reason}); };
async function inspect(request) {
  const db = admin.firestore(); v1.environment(db);
  const input = core.validate(() => {
    contract.keys(request.data, ["command", "reviewerScope", "evidenceId"]);
    return {command: request.data.command?.schemaVersion === 4 ? v2.parse(request.data.command) : v1.parse(request.data.command),
      reviewerScope: core.scopeOf(request.data.reviewerScope), evidenceId: core.stableId(request.data.evidenceId)};
  });
  const c = input.command, reviewer = input.reviewerScope;
  if (input.evidenceId.length > 128 || reviewer.projectId !== c.scope.projectId || reviewer.storeId !== c.scope.storeId) fail("evidence-scope-denied", "permission-denied");
  return db.runTransaction(async tx => {
    const {store, role} = await shared.authorize(tx, db, request.auth, reviewer);
    if (!["admin", "gerente"].includes(role)) fail("evidence-review-role-required", "permission-denied");
    const refs = ["variant-sale-v1-", "variant-commercial-v2-", "sale-v2-", "deferred-sale-v1-", "offline-sale-v1-"]
      .map(prefix => store.collection("auditLogs").doc(prefix + contract.hash(c.saleId)));
    const observations = [];
    for (const ref of refs) observations.push(await tx.get(ref));
    const sale = await tx.get(store.collection("sales").doc(c.saleId));
    const expectedProtocol = c.schemaVersion === 4 ? v2.protocol : "confirmVariantSaleV1";
    const ownIndex = c.schemaVersion === 4 ? 1 : 0, own = observations[ownIndex], proof = own.data();
    const ownMatches = own.exists && proof.protocol === expectedProtocol && proof.actorUid === c.scope.uid && equal(proof.command, c);
    const reservationsMatch = observations.every((s, i) => i === ownIndex ||
      (c.schemaVersion === 3 && i === 1 && !s.exists) ||
      s.exists && s.data().protocol === "f10-sale-identity-reservation-v1" && s.data().actorUid === c.scope.uid &&
      s.data().storeId === store.id && s.data().saleId === c.saleId && s.data().receiptPath === own.ref.path);
    const data = sale.data();
    const saleMatches = sale.exists && data.commercialProtocol === expectedProtocol && data.storeId === store.id &&
      data.createdBy === c.scope.uid && data.totalCents === c.expectedTotalCents && Array.isArray(data.products) &&
      data.products.length === c.items.length && c.items.every(item => {
        const matches = data.products.filter(row => row.productId === item.productId && (row.variantId ?? null) === (item.variantId ?? null));
        return matches.length === 1 && matches[0].quantity === item.quantity && matches[0].unitPriceCents === item.expectedUnitPriceCents &&
          matches[0].subtotalCents === item.quantity * item.expectedUnitPriceCents;
      });
    let status = "blocked", reason = "absence-is-not-proof", result = null;
    if (ownMatches && reservationsMatch && proof.result?.status === "confirmed" && saleMatches &&
        proof.result.saleId === c.saleId && proof.result.totalCents === c.expectedTotalCents) {
      status = "conclusive"; reason = "matching-atomic-confirmation"; result = proof.result;
    } else if (ownMatches && reservationsMatch && proof.result?.status === "rejected" && !sale.exists && proof.result.saleId === c.saleId) {
      status = "conclusive"; reason = "matching-sealed-rejection"; result = proof.result;
    } else if (observations.some(s => s.exists) || sale.exists) reason = "identity-evidence-conflict";
    const records = [...observations, sale].map(s => ({path: s.ref.path, exists: s.exists,
      updateTime: s.exists ? firestoreValue(s.updateTime) : null,
      contentHash: s.exists ? core.hash(core.canonical(firestoreValue(s.data()))) : null}));
    const evidence = {schemaVersion: 1, status, reason, saleId: c.saleId, scope: c.scope,
      reviewerUid: reviewer.uid, command: c, records, result};
    const ref = store.collection("auditLogs").doc("f10-sale-evidence-" + core.hash([reviewer.uid, c.saleId, input.evidenceId]));
    const old = await tx.get(ref);
    if (old.exists) {
      if (!equal(old.data().evidence.command, c) || old.data().evidence.reviewerUid !== reviewer.uid) fail("evidence-identity-conflict");
      return {...old.data().evidence, evidencePath: ref.path, evidenceHash: old.data().evidenceHash};
    }
    const evidenceHash = core.hash(core.canonical(evidence));
    // Evidence creation never modifies sales, stock, reservations or admission.
    tx.create(ref, {operation: "inspectVariantSaleEvidenceV1", actorUid: reviewer.uid, role, evidence, evidenceHash,
      createdAt: FieldValue.serverTimestamp()});
    return {...evidence, evidencePath: ref.path, evidenceHash};
  });
}
module.exports = {inspectVariantSaleEvidenceV1: onCall({region: "us-central1", enforceAppCheck: true, timeoutSeconds: 60}, r => {
  if (!r.auth?.uid) fail("authentication-required", "unauthenticated");
  return inspect(r);
})};
