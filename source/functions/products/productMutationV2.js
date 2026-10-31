"use strict";
const {createStoreWriterAdmission} = require("../sales/storeWriterAdmission");

const {createHash} = require("node:crypto");
const {isDeepStrictEqual} = require("node:util");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const contract = require("./productMutationContract");
const {normalizeCod, prepareCodeChange} = require("./productCodeReservation");
const {validateCategoryIds, projectLegacyCategories} = require("./productCategoryContract");
const {normalizeStoredParentCategoryId} = require("../categories/categoryHierarchyContract");
const {assertMutationScope} = require("./productMutationScope");
const {hasProductVariantStructure} = require("./productVariantStructureC5");
const options = {timeoutSeconds: 30, memory: "256MiB"};
const roles = new Set(["admin", "gerente", "operador", "caixa", "vendedor"]);
const text = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";
const time = (value) => ({seconds: String(value.seconds), nanoseconds: value.nanoseconds});
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Used only by adjustProductStockV1; never changes cadastral error handling.
class StockEligibilityBlocked extends HttpsError {
  constructor(reason) { super("failed-precondition", "Produto incompatível com ajuste legado.", {reason}); }
}
class CadastralEligibilityBlocked extends HttpsError {
  constructor(reason) { super("failed-precondition", "Produto incompatível com edição legada.", {reason}); }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
function fail(reason, message, code = "failed-precondition") {
  throw new HttpsError(code, message, {reason});
}
function validate(fn, input) {
  try { return fn(input); } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) throw new HttpsError("invalid-argument", error.message);
    throw error;
  }
}
async function authorize(transaction, db, auth) {
  if (!auth) throw new HttpsError("unauthenticated", "É necessário estar autenticado.");
  const profile = await transaction.get(db.collection("users").doc(auth.uid));
  const user = profile.data() || {};
  if (!profile.exists || !roles.has(text(user.role)) || text(user.accessStatus) === "revoked") {
    throw new HttpsError("permission-denied", "Usuário não autorizado.");
  }
  let storeId;
  try { storeId = contract.id(user.storeId, "storeId"); } catch (_) {
    throw new HttpsError("permission-denied", "Perfil sem loja válida.");
  }
  const storeRef = db.collection("stores").doc(storeId);
  if (!(await transaction.get(storeRef)).exists) throw new HttpsError("not-found", "Loja não encontrada.");
  return {storeRef, role: text(user.role)};
}
function receiptRef(store, uid, operation, requestId) {
  return store.collection("auditLogs").doc(digest([operation, store.id, uid, requestId]));
}
async function categories(transaction, store, current, ids) {
  try {
    if (contract.has(current, "categoryIds")) validateCategoryIds(current.categoryIds);
    for (const key of ["categoryId", "categoryName"]) {
      if (contract.has(current, key) && current[key] !== null && typeof current[key] !== "string") throw new TypeError();
    }
  } catch (_) { fail("invalid-current-taxonomy", "Taxonomia atual inválida."); }
  const data = new Map();
  for (const id of ids) {
    const snapshot = await transaction.get(store.collection("categories").doc(id));
    if (!snapshot.exists) fail("category-unavailable", "Categoria não disponível nesta loja.");
    data.set(id, snapshot.data());
  }
  try {
    const parents = new Set();
    for (const id of ids) {
      const parent = normalizeStoredParentCategoryId(data.get(id));
      if (parent === id) throw new TypeError();
      if (parent !== null) parents.add(parent);
    }
    for (const parent of parents) {
      if (!data.has(parent)) {
        const snapshot = await transaction.get(store.collection("categories").doc(parent));
        if (!snapshot.exists) throw new TypeError();
        data.set(parent, snapshot.data());
      }
      if (normalizeStoredParentCategoryId(data.get(parent)) !== null) throw new TypeError();
    }
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) fail("invalid-category-hierarchy", "Hierarquia inválida.");
    throw error;
  }
  try { return projectLegacyCategories(ids, data); } catch (_) {
    fail("invalid-category-data", "Dados canônicos da categoria inválidos.");
  }
}
async function cadastral(transaction, store, input, snapshot) {
  const current = snapshot.data();
  const changes = input.changes;
  const fields = [];
  const set = (path, value) => fields.push([path, value]);
  for (const [key, value] of Object.entries(changes.set)) {
    if (!isDeepStrictEqual(current[key], value)) set([key], value);
    if (key === "name" && current.name_lowercase !== value.toLowerCase()) set(["name_lowercase"], value.toLowerCase());
  }
  for (const key of changes.remove) {
    if (contract.has(current, key)) set([key], admin.firestore.FieldValue.delete());
  }
  const fiscal = changes.fiscal;
  if (fiscal && (Object.keys(fiscal.set).length || fiscal.remove.length)) {
    if (contract.has(current, "fiscal") &&
        (!current.fiscal || typeof current.fiscal !== "object" ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(current.fiscal)))) {
      fail("invalid-current-fiscal", "Mapa fiscal atual inválido.");
    }
    const oldFiscal = current.fiscal || {};
    let changed = false;
    for (const [key, value] of Object.entries(fiscal.set)) {
      if (!contract.has(oldFiscal, key) || !isDeepStrictEqual(oldFiscal[key], value)) {
        set(["fiscal", key], value); changed = true;
      }
    }
    for (const key of fiscal.remove) {
      if (contract.has(oldFiscal, key)) { set(["fiscal", key], admin.firestore.FieldValue.delete()); changed = true; }
    }
    if (changed) set(["fiscal", "updatedAt"], admin.firestore.FieldValue.serverTimestamp());
  }
  if (changes.categories) {
    const projection = await categories(transaction, store, current, changes.categories.ids);
    for (const [key, value] of Object.entries(projection)) {
      if (!contract.has(current, key) || !isDeepStrictEqual(current[key], value)) set([key], value);
    }
  }
  const oldCod = normalizeCod(current.cod);
  const newCod = contract.has(changes.set, "cod") ? changes.set.cod :
    (changes.remove.includes("cod") ? "" : oldCod);
  if (current.isArchived === true && oldCod !== newCod) fail("archived-product-cod-immutable", "COD arquivado é imutável.");
  // Also validates unchanged COD/legacy reservations; does not silently repair.
  const applyCodes = await prepareCodeChange(transaction, store, input.productId, current.cod, newCod);
  return {fields, applyCodes, audit: {before: {cod: oldCod}, after: {cod: newCod}}};
}
function stock(input, snapshot) {
  const current = snapshot.data();
  if (current.isArchived === true) fail("archived-product-stock-immutable", "Produto arquivado não admite ajuste.");
  const quantity = current.quantidade;
  const lots = contract.has(current, "lotes") ? current.lotes : [];
  const validQuantity = (n) => Number.isSafeInteger(n) && n >= 0;
  if (!validQuantity(quantity) || !Array.isArray(lots) || lots.some((lot) =>
    !lot || typeof lot !== "object" || Array.isArray(lot) || !validQuantity(lot.quantidade) ||
    !(lot.validade instanceof admin.firestore.Timestamp))) fail("invalid-current-stock", "Estoque atual inválido.");
  const total = (list) => {
    const sum = list.reduce((n, lot) => n + lot.quantidade, 0);
    if (!validQuantity(sum)) fail("invalid-stock-total", "Soma do estoque inválida.");
    return sum;
  };
  if (lots.length && total(lots) !== quantity) fail("invalid-current-stock", "Estoque e lotes divergentes.");
  const change = input.stockChange;
  const newLot = (lot) => ({quantidade: lot.quantidade,
    validade: admin.firestore.Timestamp.fromMillis(lot.validadeMs)});
  const result = {};
  if (change.kind === "setManualQuantity") {
    if (lots.length) fail("stock-mode-conflict", "Use ajuste explícito de lotes.");
    result.quantidade = change.quantity;
  } else if (change.kind === "convertToManual") {
    if (!lots.length) fail("stock-mode-conflict", "Produto já possui estoque manual.");
    result.quantidade = change.quantity; result.lotes = [];
  } else if (change.kind === "convertToLots") {
    if (lots.length) fail("stock-mode-conflict", "Produto já possui lotes.");
    result.lotes = change.lots.map(newLot); result.quantidade = total(result.lotes);
  } else {
    if (!lots.length) fail("stock-mode-conflict", "Produto não possui lotes.");
    const operations = new Map();
    const added = [];
    for (const op of change.operations) {
      if (op.op === "add") { added.push(newLot(op)); continue; }
      if (op.index >= lots.length) fail("invalid-lot-index", "Lote não encontrado no baseline.");
      operations.set(op.index, op);
    }
    result.lotes = lots.flatMap((lot, index) => {
      const op = operations.get(index);
      if (!op) return [lot];
      if (op.op === "remove") return [];
      const value = {...lot};
      if (contract.has(op.set, "quantidade")) value.quantidade = op.set.quantidade;
      if (contract.has(op.set, "validadeMs")) value.validade = admin.firestore.Timestamp.fromMillis(op.set.validadeMs);
      return [value];
    }).concat(added);
    if (!result.lotes.length) fail("stock-mode-conflict", "Remover todos os lotes exige conversão explícita.");
    result.quantidade = total(result.lotes);
  }
  const fields = Object.entries(result).filter(([key, value]) => !isDeepStrictEqual(current[key], value))
    .map(([key, value]) => [[key], value]);
  return {fields, applyCodes: () => {}, audit: {reason: input.reason,
    before: {quantidade: quantity, ...(contract.has(current, "lotes") ? {lotes: lots} : {})},
    after: {quantidade: result.quantidade, lotes: result.lotes || lots}}};
}
function mutation(operation, validator, prepare) {
  return onCall(options, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "É necessário estar autenticado.");
    const input = validate(validator, request.data);
    const requestHash = digest(canonical(input));
    const db = admin.firestore();
    const admitWriter = createStoreWriterAdmission(db, operation, request.auth.uid);
    const outcome = await db.runTransaction(async (transaction) => {
      const {storeRef, role} = await authorize(transaction, db, request.auth);
      assertMutationScope(input, request.auth.uid, storeRef.id);
      const ref = receiptRef(storeRef, request.auth.uid, operation, input.requestId);
      const receipt = await transaction.get(ref);
      if (receipt.exists) {
        const saved = receipt.data();
        if (saved.action !== operation || saved.entityId !== input.productId ||
            saved.storeId !== storeRef.id || saved.performedBy?.uid !== request.auth.uid ||
            saved.requestHash !== requestHash) fail("request-id-reused", "requestId já utilizado com outro conteúdo.", "already-exists");
        if (saved.outcome === "rejected") {
          if (!saved.error || !["aborted", "failed-precondition", "not-found", "already-exists", "invalid-argument"].includes(saved.error.code) ||
              typeof saved.error.reason !== "string") throw new HttpsError("internal", "Resultado persistido inválido.");
          return {rejection: saved.error};
        }
        return {...saved.result, replayed: true};
      }
      await admitWriter(transaction, storeRef.id);
      const productRef = storeRef.collection("products").doc(input.productId);
      let prepared;
      try {
        const snapshot = await transaction.get(productRef);
        if (!snapshot.exists) throw new HttpsError("not-found", "Produto não encontrado.");
        if (!isDeepStrictEqual(time(snapshot.updateTime), input.expectedUpdateTime)) {
          fail("product-version-conflict", "Produto mudou. Recarregue e revise a alteração.", "aborted");
        }
        prepared = await prepare(transaction, storeRef, input, snapshot);
      } catch (error) {
        if (operation === "adjustProductStockV1" && error instanceof StockEligibilityBlocked) throw error;
        if (operation === "updateProductV2" && error instanceof CadastralEligibilityBlocked) throw error;
        // New ledger commands opt into immutable terminal outcomes. Legacy
        // commands without scope retain their existing no-receipt-on-error
        // behavior. Authorization/hash/transport failures never enter here.
        if (!input.scope || !(error instanceof HttpsError) ||
            !["aborted", "failed-precondition", "not-found", "already-exists", "invalid-argument"].includes(error.code)) throw error;
        const rejection = {code: error.code,
          reason: typeof error.details?.reason === "string" ? error.details.reason : "command-rejected"};
        // prepare performs only reads. No product/reservation/stock write has
        // been queued; receipt creation serializes competing identical calls.
        transaction.create(ref, {action: operation, entityType: "product", entityId: input.productId,
          storeId: storeRef.id, schemaVersion: input.schemaVersion, requestHash,
          outcome: "rejected", error: rejection, performedBy: {uid: request.auth.uid, role},
          createdAt: admin.firestore.FieldValue.serverTimestamp()});
        return {rejection};
      }
      // All reads have finished. No external effects in this retryable callback.
      prepared.applyCodes();
      if (prepared.fields.length) {
        const updates = prepared.fields.flatMap(([path, value]) => [new admin.firestore.FieldPath(...path), value]);
        transaction.update(productRef, ...updates);
      }
      const result = {success: true, productId: input.productId, requestId: input.requestId,
        replayed: false, changed: prepared.fields.length > 0};
      transaction.create(ref, {action: operation, entityType: "product", entityId: input.productId,
        storeId: storeRef.id, schemaVersion: input.schemaVersion, requestHash, result,
        performedBy: {uid: request.auth.uid, role}, ...prepared.audit,
        createdAt: admin.firestore.FieldValue.serverTimestamp()});
      return result;
    });
    if (outcome.rejection) {
      throw new HttpsError(outcome.rejection.code, "Comando rejeitado. Recarregue e revise a alteração.",
        {reason: outcome.rejection.reason, persistedRejection: true});
    }
    return outcome;
  });
}
const updateProductV2 = mutation("updateProductV2", (data) => {
  if (data && Object.hasOwn(data, "variantId")) throw new TypeError("variantId não é aceito pela edição legada.");
  return contract.validateUpdateProductV2(data);
}, async (transaction, store, input, snapshot) => {
  const {evaluateProductEligibility} = require("../contracts/productEligibilityC5");
  const commercial = await transaction.get(snapshot.ref.collection("commercialProfiles").doc("current"));
  const current = snapshot.data();
  // All current C5-D/D1 cadastral dependencies; price/fiscal/SDK metadata are
  // deliberately outside this view and remain in the real F9 snapshot.
  const fields = ["productKind", "variantSchemaVersion", "productId", "variantId",
    "attributes", "attributeDefinitions", "priceCents", "costCents", "commercial", "commercialProfiles"];
  const data = Object.fromEntries(fields.filter(key => Object.hasOwn(current, key)).map(key => [key, current[key]]));
  let eligibility;
  try {
    eligibility = evaluateProductEligibility({protocol: "legacyV2", operation: "cadastral",
      scope: {projectId: admin.app().options.projectId, storeId: store.id},
      identity: {productId: snapshot.id, variantId: null},
      entity: {exists: true, data, updateTime: time(snapshot.updateTime)},
      commercial: commercial.exists ? {exists: true, data: commercial.data(), updateTime: time(commercial.updateTime)} : {exists: false}});
  } catch (error) {
    if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
    throw new CadastralEligibilityBlocked("invalid-eligibility-snapshot");
  }
  if (eligibility.status !== "compatible") throw new CadastralEligibilityBlocked(eligibility.reason);
  // The frozen patch contract cannot set/remove any field above or write a
  // commercial profile. Its resulting domain view is identical to this one.
  return cadastral(transaction, store, input, snapshot);
});
const adjustProductStockV1 = mutation("adjustProductStockV1", (data) => {
  // Check own presence before the legacy normalizer can project any fields.
  if (data && Object.hasOwn(data, "variantId")) throw new TypeError("variantId não é aceito pelo ajuste legado.");
  return contract.validateAdjustProductStock(data);
}, async (transaction, store, input, snapshot) => {
  const {evaluateProductEligibility} = require("../contracts/productEligibilityC5");
  const commercial = await transaction.get(snapshot.ref.collection("commercialProfiles").doc("current"));
  const current = snapshot.data();
  // Complete C5-D/D1 stock dependencies, preserving every structural marker.
  // Price/cost, stock/lots and arbitrary SDK metadata are not stock-domain input;
  // the unmodified F9 stock preparer below still receives the real snapshot.
  const fields = ["productKind", "variantSchemaVersion", "productId", "variantId",
    "attributes", "attributeDefinitions", "priceCents", "costCents", "commercial", "commercialProfiles", "isArchived"];
  const data = Object.fromEntries(fields.filter(key => Object.hasOwn(current, key)).map(key => [key, current[key]]));
  let eligibility;
  try {
    eligibility = evaluateProductEligibility({protocol: "legacyV2", operation: "stock",
      scope: {projectId: admin.app().options.projectId, storeId: store.id},
      identity: {productId: snapshot.id, variantId: null},
      entity: {exists: true, data, updateTime: time(snapshot.updateTime)},
      commercial: commercial.exists ? {exists: true, data: commercial.data(), updateTime: time(commercial.updateTime)} : {exists: false}});
  } catch (error) {
    if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
    throw new StockEligibilityBlocked("invalid-eligibility-snapshot");
  }
  // Keep the existing archived-stock rejection and its scoped terminal receipt.
  // Parent/type/profile failures take precedence and never gain a new receipt.
  if (eligibility.status !== "compatible" &&
      !(eligibility.reason === "entity-not-active" && current.isArchived === true)) {
    throw new StockEligibilityBlocked(eligibility.reason);
  }
  if (await hasProductVariantStructure(transaction, snapshot.ref)) {
    throw new StockEligibilityBlocked("variant-structure-not-supported");
  }
  return stock(input, snapshot);
});

module.exports = {updateProductV2, adjustProductStockV1};
