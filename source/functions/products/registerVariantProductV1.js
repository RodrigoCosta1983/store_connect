"use strict";

// Operational composition of F10 C1/C2/C3/C5. No legacy writer or conversion.
const admin = require("firebase-admin");
const {Timestamp, FieldValue} = require("firebase-admin/firestore");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {isDeepStrictEqual: equal} = require("node:util");
const {localMutationSupport: core, firestoreValue} = require("./productVariantsC1");
const dto = require("../contracts/productVariantsV1");
const {ProductCommercialDto, VariantCommercialDto, resolveCommercial} = require("../contracts/productCommercialC5");
const {projectCommercialRead} = require("../contracts/productCommercialPersistenceC5");
const {normalizeCod} = require("./productCodeReservation");
const {prepareCodeCreation} = require("./productVariantCodesC2");
const {prepareVariantStock} = require("./productVariantStockC3");
const {validateAdjustProductStock, keys} = require("./productMutationContract");
const {createStoreWriterAdmission} = require("../sales/storeWriterAdmission");
const fail = (code, reason) => { throw new HttpsError(code, reason, {reason}); };
const operation = "registerVariantProductV1";

function environment(db) {
  if (/^demo-/.test(db.projectId || "")) return core.environment(db);
  if (db.projectId !== "store-connect-hml" || process.env.GCLOUD_PROJECT !== db.projectId ||
      process.env.F10_PRODUCTS_PROJECT !== db.projectId || process.env.FIRESTORE_EMULATOR_HOST) {
    fail("failed-precondition", "f10-environment-not-admitted");
  }
  return db.projectId;
}
function normalize(raw) {
  keys(raw, ["schemaVersion", "requestId", "scope", "productId", "product", "commercial", "variants"],
    "F10 registration", ["schemaVersion", "requestId", "scope", "productId", "product", "commercial", "variants"]);
  // Reuse the exact C2 creation body and C05 bounds; do not change its namespace.
  const parent = core.command("createProductC1", {schemaVersion: raw.schemaVersion, requestId: raw.requestId,
    scope: raw.scope, productId: raw.productId, product: raw.product}, true);
  if (parent.product.productKind !== "variantParent") throw new TypeError("Variant parent required.");
  const parentCommercial = new ProductCommercialDto(raw.commercial);
  if (!Number.isSafeInteger(raw.commercial.priceCents) || raw.commercial.priceCents < 0) {
    throw new TypeError("Explicit base price in cents required.");
  }
  // Worst case 4 writes per variant + parent/profile/receipt, below Firestore's 500.
  if (!Array.isArray(raw.variants) || raw.variants.length < 1 || raw.variants.length > 120) {
    throw new TypeError("Registration requires 1..120 explicit variants.");
  }
  const parentDto = new dto.VariantParentDto(parent.productId, parent.product);
  const seenIds = new Set(), seenCodes = new Set(), combinations = [];
  const checkCode = data => {
    if (!Object.hasOwn(data, "cod")) return;
    if (typeof data.cod !== "string") throw new TypeError("COD must be text.");
    const cod = normalizeCod(data.cod);
    if (cod && seenCodes.has(cod)) throw new TypeError("Duplicate COD in registration.");
    if (cod) seenCodes.add(cod);
  };
  checkCode(parent.product);
  const variants = raw.variants.map(v => {
    keys(v, ["variantId", "variant", "commercial", "initialStock"], "variant", ["variantId", "variant", "commercial", "initialStock"]);
    const variantId = core.stableId(v.variantId);
    if (seenIds.has(variantId)) throw new TypeError("Duplicate variant identity.");
    seenIds.add(variantId);
    keys(v.variant, ["attributes", "name", "cod"], "variant fields", ["attributes"]);
    if (Object.hasOwn(v.variant, "name") && (typeof v.variant.name !== "string" || !v.variant.name.trim() || v.variant.name.length > 200)) {
      throw new TypeError("Invalid variant name.");
    }
    const leaf = new dto.VariantDto(variantId, {variantSchemaVersion: 1, productId: parent.productId, ...v.variant}, parentDto);
    if (leaf.combination.pairs.length !== parentDto.attributeDefinitions.length) throw new TypeError("Incomplete combination.");
    combinations.push(leaf.combination);
    checkCode(v.variant);
    const commercial = new VariantCommercialDto(v.commercial);
    if (resolveCommercial(parentCommercial, commercial).priceCents.state !== "value") {
      throw new TypeError("Variant price must resolve explicitly.");
    }
    const initialStock = validateAdjustProductStock({schemaVersion: 1, requestId: parent.requestId,
      productId: parent.productId, expectedUpdateTime: {seconds: "0", nanoseconds: 0},
      reason: "initial-variant-registration", stockChange: v.initialStock}).stockChange;
    if (!["setManualQuantity", "convertToLots"].includes(initialStock.kind)) throw new TypeError("Invalid initial stock mode.");
    return {variantId, variant: {...v.variant, attributes: leaf.combination.pairs.map(p => ({...p}))},
      commercial: v.commercial, initialStock};
  });
  dto.uniqueCombinations(combinations);
  const input = core.canonical({...parent, commercial: raw.commercial, variants});
  if (Buffer.byteLength(JSON.stringify(input)) > 400000) throw new TypeError("Registration too large.");
  return input;
}
const receiptRef = (store, c) => store.collection("auditLogs").doc("f10-c1-" + core.hash([c.scope.uid, c.requestId]));
function previous(saved, input) {
  const raw = saved.data();
  if (raw.operation !== operation || !equal(raw.command, input)) fail("already-exists", "request-identity-conflict");
  if (raw.schemaVersion !== 1) fail("failed-precondition", "invalid-registration-receipt");
  const expected = {schemaVersion: 1, status: "created", requestId: input.requestId, productId: input.productId,
    variantIds: input.variants.map(v => v.variantId), replayed: false};
  if (!equal(raw.result, expected) || !(raw.createdAt instanceof Timestamp)) fail("failed-precondition", "invalid-registration-receipt");
  return {...expected, replayed: true};
}
async function register(db, request) {
  environment(db);
  const input = core.validate(() => normalize(request.data));
  // Compose the already admitted F10 families. Capture epochs outside retries.
  const admissions = ["createProductC1", "createVariantC1"].map(w => createStoreWriterAdmission(db, w, request.auth?.uid));
  return db.runTransaction(async tx => {
    const store = await core.authorize(tx, db, request.auth, input.scope);
    const receipt = receiptRef(store, input), saved = await tx.get(receipt);
    if (saved.exists) return previous(saved, input);
    for (const admit of admissions) await admit(tx, store.id);
    const product = store.collection("products").doc(input.productId);
    if ((await tx.get(product)).exists) fail("already-exists", "product-id-conflict");
    for (const c of ["variants", "variantCombinations", "commercialProfiles"]) {
      if (!(await tx.get(product.collection(c).limit(1))).empty) fail("failed-precondition", "orphan-variant-structure");
    }
    const parent = new dto.VariantParentDto(input.productId, input.product);
    const rows = [{ref: product, data: input.product, configuration: input.commercial, variantId: null, kind: "variantParent"}];
    for (const v of input.variants) {
      const leaf = new dto.VariantDto(v.variantId, {variantSchemaVersion: 1, productId: input.productId, ...v.variant}, parent);
      const stock = prepareVariantStock({reason: "initial-variant-registration", stockChange: v.initialStock},
        {data: () => ({quantidade: 0, lotes: [], isArchived: false})}).audit.after;
      rows.push({ref: product.collection("variants").doc(v.variantId), variantId: v.variantId, kind: "variant",
        data: {...leaf.data, ...stock, isArchived: false}, configuration: v.commercial, combinationKey: leaf.combination.key});
    }
    const codeWrites = [];
    for (const row of rows) {
      row.data = {...row.data};
      if (Object.hasOwn(row.data, "cod")) {
        const cod = normalizeCod(row.data.cod);
        codeWrites.push(await prepareCodeCreation(tx, store, cod, {ownerType: row.variantId ? "variant" : "product",
          productId: input.productId, variantId: row.variantId}));
        if (cod) row.data.cod = cod; else delete row.data.cod;
      }
    }
    const now = FieldValue.serverTimestamp();
    for (const write of codeWrites) write();
    for (const row of rows) {
      tx.create(row.ref, {...row.data, createdAt: now, updatedAt: now});
      tx.create(row.ref.collection("commercialProfiles").doc("current"), {schemaVersion: 1,
        identity: {projectId: db.projectId, storeId: store.id, productId: input.productId, variantId: row.variantId, kind: row.kind},
        configuration: row.configuration});
      if (row.variantId) tx.create(product.collection("variantCombinations").doc(core.hash(row.combinationKey)),
        {schemaVersion: 1, productId: input.productId, variantId: row.variantId, combinationKey: row.combinationKey, createdAt: now});
    }
    const result = {schemaVersion: 1, status: "created", requestId: input.requestId, productId: input.productId,
      variantIds: input.variants.map(v => v.variantId), replayed: false};
    tx.create(receipt, {schemaVersion: 1, operation, command: input, result, createdAt: now});
    return result;
  });
}
async function query(db, request) {
  environment(db);
  const input = core.validate(() => normalize(request.data));
  return db.runTransaction(async tx => {
    const store = await core.authorize(tx, db, request.auth, input.scope);
    const saved = await tx.get(receiptRef(store, input));
    return saved.exists ? previous(saved, input) : {status: "unknown", requestId: input.requestId, productId: input.productId};
  });
}
async function commercialRead(tx, ref, context, entity) {
  const saved = await tx.get(ref.collection("commercialProfiles").doc("current"));
  const snap = s => s.exists ? {exists: true, data: firestoreValue(s.data()),
    updateTime: firestoreValue(s.updateTime)} : {exists: false};
  const result = projectCommercialRead(context, {exists: true, data: entity.data, updateTime: entity.updateTime}, snap(saved));
  if (result.status !== "commercialV1") fail("failed-precondition", "commercial-configuration-unavailable");
  return {configuration: saved.data().configuration, updateTime: firestoreValue(saved.updateTime)};
}
async function list(db, request) {
  environment(db);
  return require("./productVariantsReadB2A").listProductVariantsB02(db, request, {environment, commercialRead});
}
const callable = fn => onCall({region: "us-central1", enforceAppCheck: true}, request => {
  if (!request.auth?.uid) fail("unauthenticated", "authentication-required");
  return fn(admin.firestore(), request);
});
module.exports = {registerVariantProductV1: callable(register), getVariantProductRegistrationResultV1: callable(query),
  listRegisteredProductVariantsV1: callable(list), register, query, list, normalize, environment};
