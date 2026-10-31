"use strict";

const {createHash} = require("node:crypto");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {createStoreWriterAdmission} = require("../sales/storeWriterAdmission");
const {validateUpdateProductInput} = require("./updateProductContract");
const {normalizeCod, prepareCodeChange} = require("./productCodeReservation");
const {evaluateProductEligibility} = require("../contracts/productEligibilityC5");
const {hasProductVariantStructure} = require("./productVariantStructureC5");

const roles = new Set(["admin", "gerente", "operador", "caixa", "vendedor"]);
const text = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

const updateProduct = onCall({timeoutSeconds: 30, memory: "256MiB"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "É necessário estar autenticado.");
  let input;
  try {
    // Own presence must not disappear through the frozen enumerable-key normalizer.
    if (request.data && (Object.hasOwn(request.data, "variantId") ||
        (request.data.product && Object.hasOwn(request.data.product, "variantId")))) {
      throw new TypeError("variantId não é aceito pela edição legada.");
    }
    input = validateUpdateProductInput(request.data);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      throw new HttpsError("invalid-argument", error.message);
    }
    throw error;
  }
  const {productId, requestId, product, codSupplied} = input;
  let lots;
  try {
    lots = product.lotes.map((lot) => ({
      quantidade: lot.quantidade, validade: admin.firestore.Timestamp.fromMillis(lot.validadeMs),
    }));
  } catch (_) {
    throw new HttpsError("invalid-argument", "Um lote possui validade inválida.");
  }
  const db = admin.firestore();
  const uid = request.auth.uid;
  const requestHash = hash(canonical({productId, product, codSupplied}));
  const admitWriter = createStoreWriterAdmission(db, "updateProduct", uid);
  return db.runTransaction(async (transaction) => {
    const profile = await transaction.get(db.collection("users").doc(uid));
    const user = profile.data();
    if (!profile.exists || !roles.has(text(user.role)) || text(user.accessStatus) === "revoked") {
      throw new HttpsError("permission-denied", "Usuário não autorizado a editar produtos.");
    }
    const storeId = user.storeId;
    if (typeof storeId !== "string" || !storeId || storeId.trim() !== storeId || storeId.includes("/")) {
      throw new HttpsError("permission-denied", "Perfil do usuário não possui loja válida.");
    }
    const storeRef = db.collection("stores").doc(storeId);
    if (!(await transaction.get(storeRef)).exists) {
      throw new HttpsError("not-found", "Loja não encontrada.");
    }
    const receiptRef = storeRef.collection("auditLogs").doc(hash(["updateProduct", storeId, uid, requestId]));
    const receipt = await transaction.get(receiptRef);
    if (receipt.exists) {
      const saved = receipt.data();
      if (saved.action !== "product_updated" || saved.entityId !== productId ||
          saved.storeId !== storeId || saved.performedBy?.uid !== uid || saved.requestHash !== requestHash) {
        throw new HttpsError("already-exists", "Este requestId já foi utilizado com outro conteúdo.",
          {reason: "request-id-reused"});
      }
      return {success: true, productId, replayed: true};
    }
    await admitWriter(transaction, storeId);
    const productRef = storeRef.collection("products").doc(productId);
    const snapshot = await transaction.get(productRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Produto não encontrado.");
    const current = snapshot.data();
    const commercial = await transaction.get(productRef.collection("commercialProfiles").doc("current"));
    // Exact C5 cadastral dependencies only: unrelated SDK metadata and invalid
    // legacy price/stock/fiscal remain available to the historical V1 writer.
    const fields = ["productKind", "variantSchemaVersion", "productId", "variantId",
      "attributes", "attributeDefinitions", "priceCents", "costCents", "commercial", "commercialProfiles"];
    const data = Object.fromEntries(fields.filter(key => Object.hasOwn(current, key)).map(key => [key, current[key]]));
    const time = value => ({seconds: String(value.seconds), nanoseconds: value.nanoseconds});
    let eligibility;
    try {
      eligibility = evaluateProductEligibility({protocol: "legacyV1", operation: "cadastral",
        scope: {projectId: admin.app().options.projectId, storeId},
        identity: {productId, variantId: null},
        entity: {exists: true, data, updateTime: time(snapshot.updateTime)},
        commercial: commercial.exists ? {exists: true, data: commercial.data(), updateTime: time(commercial.updateTime)} : {exists: false}});
    } catch (error) {
      if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
      throw new HttpsError("failed-precondition", "Produto incompatível com a edição legada.",
        {reason: "invalid-eligibility-snapshot"});
    }
    if (eligibility.status !== "compatible") {
      throw new HttpsError("failed-precondition", "Produto incompatível com a edição legada.",
        {reason: eligibility.reason});
    }
    if (await hasProductVariantStructure(transaction, productRef)) {
      throw new HttpsError("failed-precondition", "Produto incompatível com a edição legada.",
        {reason: "variant-structure-not-supported"});
    }
    const newCod = codSupplied ? (product.cod || "") : normalizeCod(current.cod);
    if (current.isArchived === true && newCod !== normalizeCod(current.cod)) {
      throw new HttpsError("failed-precondition", "O COD de produto arquivado deve ser preservado.",
        {reason: "archived-product-cod-immutable"});
    }
    const applyCodeChange = await prepareCodeChange(transaction, storeRef, productId, current.cod, newCod);
    const persisted = {...product, lotes: lots, name_lowercase: product.name.toLowerCase()};
    persisted.cod = newCod || admin.firestore.FieldValue.delete();
    if (product.fiscal) {
      // Matches the former operational update rules: no new subscription gate.
      persisted.fiscal = {...product.fiscal, updatedAt: admin.firestore.FieldValue.serverTimestamp()};
    }
    applyCodeChange();
    transaction.update(productRef, persisted);
    transaction.create(receiptRef, {
      action: "product_updated", entityType: "product", entityId: productId, storeId,
      performedBy: {uid, role: text(user.role)}, requestHash,
      before: {cod: normalizeCod(current.cod)}, after: {cod: newCod},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {success: true, productId, replayed: false};
  });
});

module.exports = {updateProduct};
