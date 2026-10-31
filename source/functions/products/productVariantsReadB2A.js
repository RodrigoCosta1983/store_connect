"use strict";

// Demo-only by default; trusted operational composition shares the read checks.
// No endpoint, transport or ledger transition is defined in this module.
const admin = require("firebase-admin");
const {Timestamp, FieldPath} = require("firebase-admin/firestore");
const {isDeepStrictEqual: equal} = require("node:util");
const dto = require("../contracts/productVariantsV1");
const contract = require("./productMutationContract");
const {firestoreValue, localMutationSupport: core} = require("./productVariantsC1");
const {localReadSupport: c3} = require("./productVariantsC3");
const {prepareVariantStock} = require("./productVariantStockC3");
const {normalizeCod, codeRef, reservationOwner} = require("./productCodeReservation");
const operations = Object.freeze({createProductC1: "createProductC1", createProductC2: "createProductC1",
  createVariantC1: "createVariantC1", createVariantC2: "createVariantC1",
  adjustVariantStockC3: "adjustVariantStockC3", archiveVariantC3: "archiveVariantC3"});
const outcome = (status, reason) => ({status, reason});
function object(value) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError("Expected plain object.");
}
function normalize(operation, raw) {
  if (!Object.hasOwn(operations, operation)) throw new TypeError("Unsupported operation.");
  const persisted = operations[operation];
  return persisted.endsWith("C1") ? core.command(persisted, raw, operation.endsWith("C2")) : c3.command(persisted, raw);
}
function storedCommand(operation, raw) {
  // Product creation stores server defaults in command, unlike its input.
  let input = raw;
  if (operation === "createProductC1") {
    object(raw); object(raw.product);
    const {variantSchemaVersion, isArchived, ...product} = raw.product;
    if (variantSchemaVersion !== 1 || isArchived !== false) throw new TypeError("Invalid creation defaults.");
    input = {...raw, product};
  }
  const normalized = normalize(operation === "createProductC1" ? "createProductC2" :
    operation === "createVariantC1" ? "createVariantC2" : operation, input);
  if (!equal(normalized, raw)) throw new TypeError("Noncanonical stored command.");
  return normalized;
}
function stock(raw) {
  // Exactly C3/F9 validation, including archived inventory, without any write.
  prepareVariantStock({reason: "authoritative-read", stockChange: raw.lotes?.length ?
    {kind: "editLots", operations: []} : {kind: "setManualQuantity", quantity: raw.quantidade}},
  {data: () => ({...raw, isArchived: false})});
}
function validateReceipt(raw) {
  object(raw);
  if (raw.schemaVersion !== 1 || !Object.hasOwn(operations, raw.operation) ||
      operations[raw.operation] !== raw.operation || !(raw.createdAt instanceof Timestamp)) {
    throw new TypeError("Invalid receipt envelope.");
  }
  const cmd = storedCommand(raw.operation, raw.command);
  const creation = raw.operation.endsWith("C1");
  const expected = {schemaVersion: 1, productId: cmd.productId, variantId: cmd.variantId || null,
    status: creation ? "created" : raw.operation === "adjustVariantStockC3" ? "adjusted" : "archived",
    replayed: false};
  if (!creation) {
    if (typeof raw.result?.changed !== "boolean") throw new TypeError("Invalid changed flag.");
    expected.requestId = cmd.requestId; expected.changed = raw.result.changed;
    object(raw.audit);
    if (raw.audit.reason !== cmd.reason) throw new TypeError("Invalid audit reason.");
    if (raw.operation === "archiveVariantC3") {
      if (typeof raw.audit.before?.isArchived !== "boolean" || raw.audit.after?.isArchived !== true ||
          raw.result.changed !== !raw.audit.before.isArchived) throw new TypeError("Invalid archive audit.");
    } else {
      stock(raw.audit.before); stock(raw.audit.after);
      // Check both the stock intent and its recorded result against native F9 semantics.
      const prepared = prepareVariantStock(cmd, {data: () => raw.audit.before});
      if (!equal(prepared.audit, raw.audit) || (prepared.fields.length > 0) !== raw.result.changed) {
        throw new TypeError("Invalid stock audit.");
      }
    }
  }
  if (!equal(raw.result, expected)) throw new TypeError("Invalid receipt result.");
  return cmd;
}
async function readTransaction(db, request, scope, fn, archive = false) {
  try {
    return await db.runTransaction(async (tx) => {
      const store = await core.authorize(tx, db, request.auth, scope);
      if (archive) {
        const user = await tx.get(db.collection("users").doc(scope.uid));
        if (user.data().role.trim().toLowerCase() !== "admin") return outcome("access-denied", "archive-admin-required");
      }
      return fn(tx, store);
    });
  } catch (error) {
    if (["permission-denied", "unauthenticated"].includes(error.code)) return outcome("access-denied", "authorization-failed");
    if (error instanceof TypeError || error instanceof RangeError || error.code === "failed-precondition") {
      return outcome("inconsistent-state", "invalid-stored-state");
    }
    // Missing store, timeout, transport errors and transaction exhaustion prove no rejection.
    return outcome("unknown", "read-unavailable");
  }
}
async function queryVariantReceiptB2A(db, request) {
  core.environment(db); // Before all I/O, never swallowed as a transient failure.
  const {operation, command} = core.validate(() => {
    contract.keys(request.data, ["operation", "command"], "receipt query", ["operation", "command"]);
    return {operation: request.data.operation, command: normalize(request.data.operation, request.data.command)};
  });
  return readTransaction(db, request, command.scope, async (tx, store) => {
    const ref = store.collection("auditLogs").doc("f10-c1-" + core.hash([command.scope.uid, command.requestId]));
    const saved = await tx.get(ref);
    if (!saved.exists) return outcome("unknown", "receipt-absent");
    const raw = saved.data();
    let actual;
    try { actual = validateReceipt(raw); } catch (_) { throw new TypeError("Invalid stored receipt."); }
    if (raw.operation !== operations[operation] || !equal(actual, command)) {
      return outcome("identity-conflict", "request-identity-conflict");
    }
    return {status: "confirmed", operation, persistedOperation: raw.operation,
      receipt: {path: ref.path, updateTime: contract.expectedTime(firestoreValue(saved.updateTime)),
        data: firestoreValue(raw)}};
  }, operation === "archiveVariantC3");
}
async function checkCode(tx, store, data, owner) {
  if (!Object.hasOwn(data, "cod")) return;
  if (typeof data.cod !== "string" || !data.cod || normalizeCod(data.cod) !== data.cod) throw new TypeError("Invalid COD.");
  const saved = await tx.get(codeRef(store, data.cod));
  if (!saved.exists || saved.data().cod !== data.cod || !equal(reservationOwner(saved.data()), owner)) {
    throw new TypeError("Invalid COD reservation.");
  }
}
const snapshot = (s) => ({updateTime: contract.expectedTime(firestoreValue(s.updateTime)), data: firestoreValue(s.data())});
async function readParent(tx, store, productId) {
  const ref = store.collection("products").doc(productId);
  const saved = await tx.get(ref);
  if (!saved.exists) return null;
  const parent = saved.data();
  const parentDto = new dto.VariantParentDto(productId, {productKind: parent.productKind,
    variantSchemaVersion: parent.variantSchemaVersion, attributeDefinitions: parent.attributeDefinitions});
  if (typeof parent.isArchived !== "boolean") throw new TypeError("Invalid parent archive state.");
  await checkCode(tx, store, parent, {ownerType: "product", productId, variantId: null});
  return {ref, parentDto, parent: {...snapshot(saved), isSellable: false}};
}
async function readVariant(tx, store, parentRef, parentDto, saved) {
  const productId = parentRef.id, variantId = core.stableId(saved.id), variant = saved.data();
  const variantDto = new dto.VariantDto(variantId, {productId: variant.productId,
    variantSchemaVersion: variant.variantSchemaVersion, attributes: variant.attributes}, parentDto);
  if (typeof variant.isArchived !== "boolean" || !variantDto.combination.pairs.length ||
      variantDto.combination.pairs.length !== parentDto.attributeDefinitions.length ||
      !equal(variant.attributes, variantDto.combination.pairs)) throw new TypeError("Invalid variant state.");
  stock(variant);
  const combo = await tx.get(parentRef.collection("variantCombinations").doc(core.hash(variantDto.combination.key)));
  if (!combo.exists || combo.data().schemaVersion !== 1 || combo.data().productId !== productId ||
      combo.data().variantId !== variantId || combo.data().combinationKey !== variantDto.combination.key) {
    throw new TypeError("Invalid combination reservation.");
  }
  await checkCode(tx, store, variant, {ownerType: "variant", productId, variantId});
  return snapshot(saved);
}
async function readVariantStateB2A(db, request) {
  core.environment(db);
  const input = core.validate(() => {
    contract.keys(request.data, ["scope", "productId", "variantId"], "state read", ["scope", "productId"]);
    return {scope: core.scopeOf(request.data.scope), productId: core.stableId(request.data.productId),
      variantId: Object.hasOwn(request.data, "variantId") ? core.stableId(request.data.variantId) : null};
  });
  return readTransaction(db, request, input.scope, async (tx, store) => {
    const parent = await readParent(tx, store, input.productId);
    if (!parent) return outcome("unknown", "entity-absent");
    const result = {status: "available", scope: input.scope, identity: {productId: input.productId, variantId: input.variantId},
      parent: parent.parent};
    if (!input.variantId) return result;
    const v = await tx.get(parent.ref.collection("variants").doc(input.variantId));
    if (!v.exists) return outcome("unknown", "entity-absent");
    return {...result, variant: await readVariant(tx, store, parent.ref, parent.parentDto, v)};
  });
}

function listInput(raw) {
  contract.keys(raw, ["scope", "productId", "pageSize", "cursor"], "variant list", ["scope", "productId"]);
  const pageSize = Object.hasOwn(raw, "pageSize") ? raw.pageSize : 50;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new TypeError("Invalid page size.");
  const input = {scope: core.scopeOf(raw.scope), productId: core.stableId(raw.productId), pageSize};
  if (Object.hasOwn(raw, "cursor")) {
    const cursor = raw.cursor;
    const fields = ["version", "scope", "productId", "pageSize", "offset", "afterId", "fingerprint"];
    contract.keys(cursor, fields, "variant cursor", fields);
    if (cursor.version !== 1 || cursor.pageSize !== pageSize || !Number.isInteger(cursor.offset) ||
        cursor.offset < 1 || cursor.offset >= 200 || cursor.offset % pageSize !== 0 ||
        typeof cursor.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(cursor.fingerprint)) {
      throw new TypeError("Invalid cursor.");
    }
    input.cursor = {version: 1, scope: core.scopeOf(cursor.scope), productId: core.stableId(cursor.productId),
      pageSize, offset: cursor.offset, afterId: core.stableId(cursor.afterId), fingerprint: cursor.fingerprint};
  }
  return input;
}

// In-process local reader only. request.auth must come from the trusted local
// caller, never a JSON body/UID token. Cursor hashes bind consistency, not trust.
async function listProductVariantsB02(db, request, support = {}) {
  // Trusted composition only, never options taken from request.data. The local
  // adapter retains its original demo-only gate and exact response by default.
  (support.environment || core.environment)(db);
  const input = core.validate(() => listInput(request.data));
  const auth = request.auth && {uid: request.auth.uid};
  return readTransaction(db, {auth}, input.scope, async (tx, store) => {
    const cursor = input.cursor;
    if (cursor && (!equal(cursor.scope, input.scope) || cursor.productId !== input.productId)) {
      return outcome("identity-conflict", "cursor-identity-conflict");
    }
    const parent = await readParent(tx, store, input.productId);
    if (!parent) return outcome("unknown", "entity-absent");
    // Bounded full verification on EACH page detects C3 changes that do not
    // update the parent. This is response pagination, not scalable DB paging.
    const saved = await tx.get(parent.ref.collection("variants").orderBy(FieldPath.documentId()).limit(201));
    if (saved.size > 200) throw new RangeError("Local C1 variant bound exceeded.");
    const variants = [];
    if (support.commercialRead) parent.parent.commercial = await support.commercialRead(tx, parent.ref,
      {projectId: input.scope.projectId, storeId: store.id, productId: input.productId, variantId: null, kind: "variantParent"}, parent.parent);
    for (const v of saved.docs) {
      const row = {identity: {productId: input.productId, variantId: v.id},
        ...await readVariant(tx, store, parent.ref, parent.parentDto, v)};
      if (support.commercialRead) row.commercial = await support.commercialRead(tx, v.ref,
        {projectId: input.scope.projectId, storeId: store.id, productId: input.productId, variantId: v.id, kind: "variant"}, row);
      variants.push(row);
    }
    const fingerprint = core.hash(core.canonical([1, input.scope, input.productId, parent.parent.updateTime,
      variants.map(v => [v.identity.variantId, v.updateTime]),
      ...(support.commercialRead ? [parent.parent.commercial, variants.map(v => v.commercial)] : [])]));
    if (cursor && cursor.fingerprint !== fingerprint) return outcome("unknown", "listing-changed");
    const offset = cursor ? cursor.offset : 0;
    if (cursor && (offset >= variants.length || variants[offset - 1].identity.variantId !== cursor.afterId)) {
      return outcome("identity-conflict", "cursor-position-conflict");
    }
    const page = variants.slice(offset, offset + input.pageSize);
    const end = offset + page.length, complete = end === variants.length;
    return {status: "available", scope: input.scope, identity: {productId: input.productId, variantId: null},
      parent: parent.parent, variants: page,
      pagination: {pageSize: input.pageSize, offset, totalCount: variants.length, fingerprint,
        complete, empty: variants.length === 0,
        nextCursor: complete ? null : {version: 1, scope: input.scope, productId: input.productId,
          pageSize: input.pageSize, offset: end, afterId: page[page.length - 1].identity.variantId, fingerprint}}};
  });
}
module.exports = {readVariantStateB2A, queryVariantReceiptB2A, listProductVariantsB02,
  // Trusted backend composition; callers own Auth, environment and transaction.
  variantReadSupport: {readParent, readVariant, snapshot}};
