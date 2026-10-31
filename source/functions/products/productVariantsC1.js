"use strict";

// Local F10-C1/C2 service only. Deliberately no onCall and no index export.
const admin = require("firebase-admin");
const {Timestamp, DocumentReference, GeoPoint, FieldValue} = require("firebase-admin/firestore");
const {createStoreWriterAdmission} = require("../sales/storeWriterAdmission");
const {HttpsError} = require("firebase-functions/v2/https");
const {createHash} = require("node:crypto");
const {isDeepStrictEqual} = require("node:util");
const dto = require("../contracts/productVariantsV1");
const {expectedTime} = require("./productMutationContract");
const {normalizeCod} = require("./productCodeReservation");
const {prepareCodeCreation} = require("./productVariantCodesC2");
const roles = new Set(["admin", "gerente", "operador", "caixa", "vendedor"]);
const text = (v) => typeof v === "string" ? v.trim().toLowerCase() : "";
const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const own = (v, k) => Object.hasOwn(v, k);
const fail = (code, reason) => { throw new HttpsError(code, reason, {reason}); };
function keys(value, allowed, required = allowed) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some((k) => !allowed.includes(k)) || required.some((k) => !own(value, k))) {
    throw new TypeError("Invalid C1 fields.");
  }
}
function stableId(value) {
  return new dto.ItemIdentityDto({productId: value, variantId: null}).productId;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
}
function validate(fn) {
  try { return fn(); } catch (e) {
    if (e instanceof TypeError || e instanceof RangeError) fail("invalid-argument", e.message);
    throw e;
  }
}
function environment(db) {
  const project = db.projectId;
  const host = process.env.FIRESTORE_EMULATOR_HOST || "";
  const match = /^(localhost|127\.0\.0\.1|\[::1\]):([0-9]+)$/.exec(host);
  if (!/^demo-[a-z0-9-]+$/.test(project || "") || !match || Number(match[2]) < 1 || Number(match[2]) > 65535 ||
      db._settings.servicePath !== match[1] || Number(db._settings.port) !== Number(match[2]) || db._settings.ssl !== false) {
    fail("failed-precondition", "c1-emulator-only");
  }
  return project;
}
async function authorize(tx, db, auth, scope) {
  if (!auth || typeof auth.uid !== "string" || !auth.uid) fail("unauthenticated", "authentication-required");
  const uid = validate(() => stableId(auth.uid));
  const profile = await tx.get(db.collection("users").doc(uid));
  const user = profile.data() || {};
  if (!profile.exists || !roles.has(text(user.role)) || text(user.accessStatus) === "revoked") {
    fail("permission-denied", "actor-not-authorized");
  }
  let storeId;
  try { storeId = stableId(user.storeId); } catch (_) { fail("permission-denied", "invalid-store-membership"); }
  if (scope.projectId !== db.projectId || scope.uid !== uid || scope.storeId !== storeId) {
    fail("permission-denied", "scope-mismatch");
  }
  const store = db.collection("stores").doc(storeId);
  if (!(await tx.get(store)).exists) fail("not-found", "store-not-found");
  return store;
}
function scopeOf(raw) {
  keys(raw, ["projectId", "uid", "storeId"]);
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, stableId(v)]));
}
function zeroOnly(raw, allowCod = false) {
  for (const key of [...(allowCod ? [] : ["cod"]), "COD", "code", "initialStock", "stock", "stockChange"]) {
    if (own(raw, key)) fail("invalid-argument", "c1-cod-or-initial-stock-not-supported");
  }
  if ((own(raw, "quantidade") && (raw.quantidade !== 0 || Object.is(raw.quantidade, -0))) ||
      (own(raw, "lotes") && (!Array.isArray(raw.lotes) || raw.lotes.length))) {
    fail("invalid-argument", "c1-initial-stock-not-supported");
  }
}
function command(operation, raw, allowCod = false) {
  const variant = operation === "createVariantC1";
  const fields = ["schemaVersion", "requestId", "scope", "productId", "product"];
  if (variant) fields.splice(4, 1, "variantId", "expectedProductUpdateTime", "variant");
  keys(raw, fields);
  if (raw.schemaVersion !== 1) throw new TypeError("Invalid command version.");
  const result = {schemaVersion: 1, requestId: stableId(raw.requestId), scope: scopeOf(raw.scope),
    productId: stableId(raw.productId)};
  if (result.requestId.length > 128) throw new TypeError("requestId too long.");
  const data = variant ? raw.variant : raw.product;
  keys(data, variant ? ["attributes", "name", "quantidade", "lotes", ...(allowCod ? ["cod"] : [])] :
    ["productKind", "name", "attributeDefinitions", "quantidade", "lotes", ...(allowCod ? ["cod"] : [])],
  variant ? ["attributes"] : ["productKind", "name"]);
  zeroOnly(data, allowCod);
  if (own(data, "cod")) {
    if (typeof data.cod !== "string") throw new TypeError("COD must be a string.");
    normalizeCod(data.cod); // Official F9 validation, before any await.
  }
  if (own(data, "name") && (typeof data.name !== "string" || !data.name.trim() || data.name.length > 200)) {
    throw new TypeError("Invalid name.");
  }
  if (variant) {
    result.variantId = stableId(raw.variantId);
    result.expectedProductUpdateTime = expectedTime(raw.expectedProductUpdateTime);
    // Copy/freeze JSON input before the first await; no mutable caller payload.
    result.variant = new dto.SimpleProductDto("input", data).data;
  } else {
    if (!["simple", "variantParent"].includes(data.productKind)) throw new TypeError("Invalid product kind.");
    const product = {...data, variantSchemaVersion: 1, quantidade: 0, lotes: [], isArchived: false};
    result.product = dto.productDto(result.productId, product).data;
    if (data.productKind === "variantParent") {
      const defs = dto.definitions(data.attributeDefinitions);
      if (!defs.length || defs.length > 10 || defs.some((d) => !d.values.length || d.values.length > 100)) {
        throw new TypeError("C1 attribute bounds: 1..10 definitions, 1..100 values each.");
      }
    }
  }
  return canonical(result);
}
// Explicit SDK boundary. Never coerce SDK objects into strings or lose nanos.
function firestoreValue(value) {
  if (value instanceof Timestamp) return {seconds: String(value.seconds), nanoseconds: value.nanoseconds};
  if (value instanceof DocumentReference) return {firestoreReference: value.path,
    projectId: value.firestore.projectId, databaseId: value.firestore.databaseId};
  if (Buffer.isBuffer(value)) return {firestoreBytesBase64: value.toString("base64")};
  if (value instanceof GeoPoint) return {latitude: value.latitude, longitude: value.longitude};
  if (Array.isArray(value)) return value.map(firestoreValue);
  if (value && typeof value === "object") {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError("Unsupported Firestore value.");
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, firestoreValue(v)]));
  }
  return value;
}
function project(snapshot, parent) {
  if (!snapshot.exists) fail("not-found", "entity-not-found");
  const raw = firestoreValue(snapshot.data());
  const metadata = {};
  // F10-B keeps server metadata outside its strict versioned data envelope.
  if (parent || own(raw, "variantSchemaVersion") || own(raw, "productKind")) {
    for (const key of ["createdAt", "updatedAt"]) {
      if (own(raw, key)) { metadata[key] = raw[key]; delete raw[key]; }
    }
  }
  const entity = parent ? new dto.VariantDto(snapshot.id, raw, parent) : dto.productDto(snapshot.id, raw);
  return {entity, expectedUpdateTime: expectedTime(firestoreValue(snapshot.updateTime)), metadata};
}
async function create(db, operation, request, allowCod = false) {
  environment(db);
  const input = validate(() => {
    const raw = request.data;
    // Give explicit errors even for forbidden keys otherwise rejected by allowlist.
    if (raw && typeof raw === "object") {
      zeroOnly(raw);
      const body = operation === "createVariantC1" ? raw.variant : raw.product;
      if (body && typeof body === "object") zeroOnly(body, allowCod);
    }
    return command(operation, raw, allowCod);
  });
  const variant = operation === "createVariantC1";
  const admitWriter = createStoreWriterAdmission(db, operation, request.auth?.uid);
  return db.runTransaction(async (tx) => {
    const store = await authorize(tx, db, request.auth, input.scope);
    const receipt = store.collection("auditLogs").doc("f10-c1-" + hash([input.scope.uid, input.requestId]));
    const previous = await tx.get(receipt);
    if (previous.exists) {
      const saved = previous.data();
      if (saved.operation !== operation || !isDeepStrictEqual(saved.command, input)) fail("already-exists", "request-identity-conflict");
      return {...saved.result, replayed: true};
    }
    await admitWriter(tx, store.id);
    const product = store.collection("products").doc(input.productId);
    const snapshot = await tx.get(product);
    let target = product;
    let data = input.product;
    let reservation;
    let combinationKey;
    if (variant) {
      if (!snapshot.exists) fail("not-found", "parent-not-found");
      let parent;
      try { parent = project(snapshot).entity; } catch (_) { fail("failed-precondition", "invalid-parent"); }
      if (!(parent instanceof dto.VariantParentDto) || parent.data.isArchived !== false) fail("failed-precondition", "parent-unavailable");
      if (!isDeepStrictEqual(expectedTime(firestoreValue(snapshot.updateTime)), input.expectedProductUpdateTime)) {
        fail("failed-precondition", "stale-parent");
      }
      data = {variantSchemaVersion: 1, productId: input.productId, ...input.variant,
        quantidade: 0, lotes: [], isArchived: false};
      const leaf = validate(() => new dto.VariantDto(input.variantId, data, parent));
      // Approved C05 keeps partial/empty combinations disabled.
      if (!leaf.combination.pairs.length || leaf.combination.pairs.length !== parent.attributeDefinitions.length) {
        fail("failed-precondition", "c05-partial-combinations-not-enabled");
      }
      data.attributes = leaf.combination.pairs.map((p) => ({...p}));
      combinationKey = leaf.combination.key;
      target = product.collection("variants").doc(input.variantId);
      reservation = product.collection("variantCombinations").doc(hash(combinationKey));
      const existing = await tx.get(target);
      const reserved = await tx.get(reservation);
      // Transactional query also fails closed for synthetic/imported rows missing
      // a reservation, including archived variants. No repair or migration.
      const siblings = await tx.get(product.collection("variants"));
      if (siblings.size >= 200) fail("resource-exhausted", "c1-variant-limit");
      for (const sibling of siblings.docs) {
        let other;
        try { other = project(sibling, parent).entity; } catch (_) { fail("failed-precondition", "invalid-existing-variant"); }
        if (other.combination.key === combinationKey) fail("already-exists", "combination-already-exists");
      }
      if (existing.exists) fail("already-exists", "variant-id-conflict");
      if (reserved.exists) fail("already-exists", "combination-reserved");
    } else {
      if (snapshot.exists) fail("already-exists", "product-id-conflict");
      // A missing root does not prove a fresh simple/product identity: Firestore
      // can retain variant descendants without the parent document. Never adopt
      // that structure implicitly, including archived or malformed descendants.
      for (const collection of ["variants", "variantCombinations"]) {
        const descendants = await tx.get(product.collection(collection).limit(1));
        if (!descendants.empty) fail("failed-precondition", "orphan-variant-structure");
      }
    }
    // Keep the supplied COD in the receipt command (including empty/whitespace),
    // while storing only F9's canonical nonempty COD on the entity.
    let reserveCode = () => {};
    if (own(data, "cod")) {
      const cod = normalizeCod(data.cod);
      reserveCode = await prepareCodeCreation(tx, store, cod, {ownerType: variant ? "variant" : "product",
        productId: input.productId, variantId: variant ? input.variantId : null});
      data = {...data};
      if (cod) data.cod = cod;
      else delete data.cod;
    }
    const result = {schemaVersion: 1, productId: input.productId, variantId: variant ? input.variantId : null,
      status: "created", replayed: false};
    const now = FieldValue.serverTimestamp();
    reserveCode();
    tx.create(target, {...data, createdAt: now, updatedAt: now});
    if (reservation) {
      tx.create(reservation, {schemaVersion: 1, productId: input.productId,
        variantId: input.variantId, combinationKey, createdAt: now});
      // Serialize creation on the parent and invalidate stale creation baselines.
      tx.update(product, {updatedAt: now});
    }
    tx.create(receipt, {schemaVersion: 1, operation, command: input, result, createdAt: now});
    return result;
  });
}
async function readProductC1(db, request) {
  environment(db);
  const input = validate(() => {
    keys(request.data, ["scope", "productId", "variantId"], ["scope", "productId"]);
    return {scope: scopeOf(request.data.scope), productId: stableId(request.data.productId),
      variantId: own(request.data, "variantId") ? stableId(request.data.variantId) : null};
  });
  return db.runTransaction(async (tx) => {
    const store = await authorize(tx, db, request.auth, input.scope);
    const ref = store.collection("products").doc(input.productId);
    const product = await tx.get(ref);
    try {
      const parent = project(product);
      if (!input.variantId) return parent;
      return {parent, variant: project(await tx.get(ref.collection("variants").doc(input.variantId)), parent.entity)};
    } catch (e) {
      if (e instanceof TypeError || e instanceof RangeError) fail("failed-precondition", "invalid-stored-product");
      throw e;
    }
  });
}
module.exports = {createProductC1: (db, request) => create(db, "createProductC1", request),
  createVariantC1: (db, request) => create(db, "createVariantC1", request),
  // Additive local entrypoints; same operation/receipt identity, no protocol fork.
  createProductC2: (db, request) => create(db, "createProductC1", request, true),
  createVariantC2: (db, request) => create(db, "createVariantC1", request, true),
  readProductC1, firestoreValue, project,
  // Internal local adapter support; no remote handler or changed C1/C2 command.
  localMutationSupport: {environment, authorize, scopeOf, stableId, canonical, validate, hash, command}};
