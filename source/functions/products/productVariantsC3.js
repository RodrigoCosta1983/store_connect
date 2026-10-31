"use strict";
const {createStoreWriterAdmission} = require("../sales/storeWriterAdmission");

// Local Emulator-only F10-C3. No onCall, index export or commercial integration.
const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");
const {isDeepStrictEqual} = require("node:util");
const dto = require("../contracts/productVariantsV1");
const contract = require("./productMutationContract");
const {firestoreValue, localMutationSupport: core} = require("./productVariantsC1");
const {normalizeCod, codeRef, reservationOwner} = require("./productCodeReservation");
const {prepareVariantStock} = require("./productVariantStockC3");
const fail = (code, reason) => { throw new HttpsError(code, reason, {reason}); };
const stockOperation = "adjustVariantStockC3";
const archiveOperation = "archiveVariantC3";

function command(operation, raw) {
  const fields = ["schemaVersion", "requestId", "scope", "productId", "variantId",
    "expectedProductUpdateTime", "expectedVariantUpdateTime", "reason"];
  if (operation === stockOperation) fields.push("stockChange");
  contract.keys(raw, fields, "C3", fields);
  if (raw.schemaVersion !== 1) throw new TypeError("Invalid C3 version.");
  const input = {schemaVersion: 1, requestId: core.stableId(raw.requestId), scope: core.scopeOf(raw.scope),
    productId: core.stableId(raw.productId), variantId: core.stableId(raw.variantId),
    expectedProductUpdateTime: contract.expectedTime(raw.expectedProductUpdateTime),
    expectedVariantUpdateTime: contract.expectedTime(raw.expectedVariantUpdateTime)};
  if (input.requestId.length > 128) throw new TypeError("requestId too long.");
  if (typeof raw.reason !== "string" || !raw.reason.trim()) throw new TypeError("reason required.");
  input.reason = raw.reason.trim();
  if (operation === stockOperation) {
    // F9 owns all stock intent types, limits, lot operations and normalization.
    const normalized = contract.validateAdjustProductStock({schemaVersion: 1,
      requestId: input.requestId, productId: input.productId,
      expectedUpdateTime: input.expectedVariantUpdateTime, reason: input.reason, stockChange: raw.stockChange});
    input.stockChange = normalized.stockChange;
  }
  return core.canonical(input); // Snapshot before await; never retain caller maps.
}

async function checkCode(tx, store, data, owner) {
  if (!Object.hasOwn(data, "cod")) return;
  if (typeof data.cod !== "string") fail("failed-precondition", "invalid-current-cod");
  const cod = normalizeCod(data.cod);
  if (!cod || cod !== data.cod) fail("failed-precondition", "invalid-current-cod");
  const snapshot = await tx.get(codeRef(store, cod));
  if (!snapshot.exists || snapshot.data().cod !== cod ||
      !isDeepStrictEqual(reservationOwner(snapshot.data()), owner)) {
    fail("failed-precondition", "invalid-code-reservation");
  }
}

async function mutate(db, operation, request) {
  core.environment(db);
  const input = core.validate(() => command(operation, request.data));
  const admitWriter = createStoreWriterAdmission(db, operation, request.auth?.uid);
  return db.runTransaction(async (tx) => {
    const store = await core.authorize(tx, db, request.auth, input.scope);
    if (operation === archiveOperation) {
      // F9 archival permission is admin-only, rechecked even on replay.
      const user = await tx.get(db.collection("users").doc(input.scope.uid));
      if (user.data().role.trim().toLowerCase() !== "admin") fail("permission-denied", "archive-admin-required");
    }
    // Same identity barrier as C1/C2 in BOTH directions; no parallel namespace.
    const receipt = store.collection("auditLogs").doc("f10-c1-" + core.hash([input.scope.uid, input.requestId]));
    const saved = await tx.get(receipt);
    if (saved.exists) {
      if (saved.data().operation !== operation || !isDeepStrictEqual(saved.data().command, input)) {
        fail("already-exists", "request-identity-conflict");
      }
      return {...saved.data().result, replayed: true};
    }
    await admitWriter(tx, store.id);
    const parentRef = store.collection("products").doc(input.productId);
    const variantRef = parentRef.collection("variants").doc(input.variantId);
    const parentSnapshot = await tx.get(parentRef);
    const variantSnapshot = await tx.get(variantRef);
    if (!parentSnapshot.exists || !variantSnapshot.exists) fail("not-found", "entity-not-found");
    if (!isDeepStrictEqual(contract.expectedTime(firestoreValue(parentSnapshot.updateTime)), input.expectedProductUpdateTime) ||
        !isDeepStrictEqual(contract.expectedTime(firestoreValue(variantSnapshot.updateTime)), input.expectedVariantUpdateTime)) {
      fail("aborted", "variant-version-conflict");
    }
    let parent, variant;
    try {
      // Validate only structural authority used by this operation. Do not
      // deserialize/rewrite unrelated metadata or future commercial leaves.
      const p = parentSnapshot.data(), v = variantSnapshot.data();
      parent = new dto.VariantParentDto(input.productId, {productKind: p.productKind,
        variantSchemaVersion: p.variantSchemaVersion, attributeDefinitions: p.attributeDefinitions});
      variant = new dto.VariantDto(input.variantId, {variantSchemaVersion: v.variantSchemaVersion,
        productId: v.productId, attributes: v.attributes}, parent);
    } catch (_) { fail("failed-precondition", "invalid-current-variant"); }
    if (parentSnapshot.data().isArchived !== false) {
      fail("failed-precondition", "parent-unavailable");
    }
    if (typeof variantSnapshot.data().isArchived !== "boolean") fail("failed-precondition", "invalid-archive-state");
    if (!variant.combination.pairs.length || variant.combination.pairs.length !== parent.attributeDefinitions.length) {
      fail("failed-precondition", "invalid-current-combination");
    }
    const combination = await tx.get(parentRef.collection("variantCombinations").doc(core.hash(variant.combination.key)));
    if (!combination.exists || combination.data().productId !== input.productId ||
        combination.data().variantId !== input.variantId || combination.data().combinationKey !== variant.combination.key ||
        combination.data().schemaVersion !== 1) fail("failed-precondition", "invalid-combination-reservation");
    await checkCode(tx, store, parentSnapshot.data(), {ownerType: "product", productId: input.productId, variantId: null});
    await checkCode(tx, store, variantSnapshot.data(), {ownerType: "variant", productId: input.productId, variantId: input.variantId});

    let fields, audit;
    if (operation === stockOperation) {
      const prepared = prepareVariantStock(input, variantSnapshot);
      fields = prepared.fields; audit = prepared.audit;
    } else {
      // Validate current stock with F9 without changing it, including archived
      // variants. No repair or inventory conversion is implicit in archiving.
      const raw = variantSnapshot.data();
      prepareVariantStock({reason: input.reason, stockChange: raw.lotes?.length ?
        {kind: "editLots", operations: []} : {kind: "setManualQuantity", quantity: raw.quantidade}},
      {data: () => ({...raw, isArchived: false})});
      fields = raw.isArchived ? [] : [[["isArchived"], true]];
      audit = {reason: input.reason, before: {isArchived: raw.isArchived}, after: {isArchived: true}};
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    if (fields.length) {
      const updates = fields.flatMap(([path, value]) => [new admin.firestore.FieldPath(...path), value]);
      tx.update(variantRef, ...updates, new admin.firestore.FieldPath("updatedAt"), now);
    }
    const result = {schemaVersion: 1, productId: input.productId, variantId: input.variantId,
      requestId: input.requestId, status: operation === stockOperation ? "adjusted" : "archived",
      changed: fields.length > 0, replayed: false};
    tx.create(receipt, {schemaVersion: 1, operation, command: input, result,
      audit, createdAt: now});
    return result;
  });
}
module.exports = {adjustVariantStockC3: (db, request) => mutate(db, stockOperation, request),
  archiveVariantC3: (db, request) => mutate(db, archiveOperation, request),
  localReadSupport: {command}};
