"use strict";
const admin = require("firebase-admin");
const {FieldValue, FieldPath} = require("firebase-admin/firestore");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {isDeepStrictEqual: equal} = require("node:util");
const {localMutationSupport: core, firestoreValue} = require("./productVariantsC1");
const {variantReadSupport: reads} = require("./productVariantsReadB2A");
const {environment} = require("./registerVariantProductV1");
const dto = require("../contracts/productVariantsV1");
const commercial = require("../contracts/productCommercialC5");
const {projectCommercialRead} = require("../contracts/productCommercialPersistenceC5");
const {keys, validateAdjustProductStock} = require("./productMutationContract");
const {prepareVariantStock} = require("./productVariantStockC3");
const {normalizeCod} = require("./productCodeReservation");
const {prepareCodeCreation} = require("./productVariantCodesC2");
const {createStoreWriterAdmission, controlRef, validControl} = require("../sales/storeWriterAdmission");
const fail = (reason, code = "failed-precondition") => { throw new HttpsError(code, reason, {reason}); };
const operation = "manageVariantProductV1";
function parse(raw) {
  keys(raw, ["schemaVersion", "requestId", "scope", "productId", "variantId", "expectedFingerprint",
    "expectedAdmissionEpoch", "action", "changes", "reason"], operation);
  if (raw.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(raw.expectedFingerprint) ||
      !Number.isSafeInteger(raw.expectedAdmissionEpoch) || raw.expectedAdmissionEpoch < 1 ||
      !["editParent", "editVariant", "addVariant", "archive", "restore", "stock"].includes(raw.action) ||
      typeof raw.reason !== "string" || !raw.reason.trim() || raw.reason.length > 2048) throw new TypeError("Invalid management command.");
  const c = {...raw, requestId: core.stableId(raw.requestId), productId: core.stableId(raw.productId),
    variantId: raw.variantId === null ? null : core.stableId(raw.variantId), scope: core.scopeOf(raw.scope)};
  if (c.requestId.length > 128 || (c.action === "editParent" && c.variantId !== null) ||
      (["editVariant", "addVariant", "stock"].includes(c.action) && c.variantId === null)) throw new TypeError("Invalid target.");
  if (["editParent", "editVariant", "addVariant"].includes(c.action)) {
    keys(c.changes, c.variantId === null ? ["name", "cod", "attributeDefinitions", "commercial"] :
      ["name", "cod", "attributes", "commercial"], "changes", []);
    if (!Object.keys(c.changes).length) throw new TypeError("Empty edit.");
    if (c.action === "addVariant" && (!Object.hasOwn(c.changes, "attributes") || !Object.hasOwn(c.changes, "commercial"))) throw new TypeError("Variant configuration required.");
    if (Object.hasOwn(c.changes, "name") && (typeof c.changes.name !== "string" ||
        !c.changes.name.trim() || c.changes.name.length > 200)) throw new TypeError("Invalid name.");
    if (Object.hasOwn(c.changes, "cod")) normalizeCod(c.changes.cod);
    if (Object.hasOwn(c.changes, "commercial")) {
      const model = c.variantId === null ? new commercial.ProductCommercialDto(c.changes.commercial) :
        new commercial.VariantCommercialDto(c.changes.commercial);
      if (c.variantId === null && model.priceCents.state !== "value") throw new TypeError("Base price required.");
    }
  } else if (c.action === "stock") {
    c.changes = {stockChange: validateAdjustProductStock({schemaVersion: 1, requestId: c.requestId,
      productId: c.productId, expectedUpdateTime: {seconds: "0", nanoseconds: 0}, reason: c.reason,
      stockChange: c.changes.stockChange}).stockChange};
    keys(raw.changes, ["stockChange"], "stock");
  } else keys(c.changes, [], "lifecycle");
  if (Buffer.byteLength(JSON.stringify(c)) > 400000) throw new TypeError("Command too large.");
  return core.canonical(c);
}
async function load(tx, db, store, scope, productId) {
  const parent = await reads.readParent(tx, store, productId);
  if (!parent) fail("variant-parent-absent");
  if (parent.parent.data.quantidade !== 0 || !Array.isArray(parent.parent.data.lotes) || parent.parent.data.lotes.length) fail("invalid-parent-stock");
  const saved = await tx.get(parent.ref.collection("variants").orderBy(FieldPath.documentId()).limit(201));
  if (saved.size > 200) fail("variant-management-limit");
  const rows = [{variantId: null, ref: parent.ref, ...parent.parent}];
  for (const v of saved.docs) rows.push({variantId: v.id, ref: v.ref, ...await reads.readVariant(tx, store, parent.ref, parent.parentDto, v)});
  for (const row of rows) {
    const profile = await tx.get(row.ref.collection("commercialProfiles").doc("current"));
    const context = {projectId: scope.projectId, storeId: store.id, productId, variantId: row.variantId,
      kind: row.variantId === null ? "variantParent" : "variant"};
    const view = projectCommercialRead(context, {exists: true, data: row.data, updateTime: row.updateTime},
      profile.exists ? {exists: true, ...reads.snapshot(profile)} : {exists: false});
    if (view.status !== "commercialV1") fail("invalid-commercial-profile");
    row.commercial = {configuration: profile.data().configuration, updateTime: firestoreValue(profile.updateTime)};
    row.native = (await tx.get(row.ref)).data();
  }
  const fingerprint = core.hash(core.canonical(rows.map(r => [r.variantId, r.updateTime, r.commercial])));
  return {parent, rows, fingerprint};
}
async function permission(tx, db, scope, action) {
  const user = (await tx.get(db.collection("users").doc(scope.uid))).data();
  const role = String(user?.role || "").trim().toLowerCase();
  if (!["admin", "gerente"].includes(role) || ["archive", "restore"].includes(action) && role !== "admin") fail("variant-management-role-denied", "permission-denied");
  return role;
}
const refFor = (store, c) => store.collection("auditLogs").doc("f10-c1-" + core.hash([c.scope.uid, c.requestId]));
function replay(saved, c) {
  const r = saved.data();
  if (r.operation !== operation || !equal(r.command, c)) return {status: "identity-conflict", requestId: c.requestId};
  if (!["confirmed", "rejected"].includes(r.result?.status)) fail("invalid-management-receipt");
  return {...r.result, replayed: true};
}
async function execute(db, request, queryOnly = false) {
  environment(db);
  const c = core.validate(() => parse(request.data));
  const admit = createStoreWriterAdmission(db, c.action === "stock" ? "adjustVariantStockC3" : c.action === "addVariant" ? "createVariantC1" : "createProductC1", request.auth?.uid);
  return db.runTransaction(async tx => {
    const store = await core.authorize(tx, db, request.auth, c.scope);
    const role = await permission(tx, db, c.scope, c.action);
    const receipt = refFor(store, c), saved = await tx.get(receipt);
    if (saved.exists) return replay(saved, c);
    if (queryOnly) return {status: "not-recorded", requestId: c.requestId, definitive: false};
    await admit(tx, store.id);
    const control = (await tx.get(controlRef(db, store.id))).data();
    if (!validControl(control) || control.mode !== "authoritative" || control.epoch !== c.expectedAdmissionEpoch) fail("variant-management-epoch-conflict");
    let state, target, fields = {}, profile, codeWrite = () => {}, comboWrite = () => {}, result;
    try {
      state = await load(tx, db, store, c.scope, c.productId);
      if (state.fingerprint !== c.expectedFingerprint) fail("variant-management-version-conflict");
      target = state.rows.find(r => r.variantId === c.variantId);
      if (c.action === "addVariant") {
        if (target || state.rows.length > 200) fail("variant-id-or-limit-conflict");
        target = {variantId: c.variantId, ref: state.parent.ref.collection("variants").doc(c.variantId),
          data: {productId: c.productId, variantSchemaVersion: 1, attributes: [], quantidade: 0, lotes: [], isArchived: false},
          commercial: {configuration: {}}};
        if ((await tx.get(target.ref)).exists) fail("variant-id-conflict");
        for (const name of ["commercialProfiles"]) if (!(await tx.get(target.ref.collection(name).limit(1))).empty) fail("orphan-variant-profile");
      }
      if (!target) fail("variant-absent");
      const p = state.rows[0];
      if (c.action === "archive" || c.action === "restore") {
        if (c.action === "restore" && c.variantId !== null && p.data.isArchived) fail("parent-archived");
        fields.isArchived = c.action === "archive";
      } else {
        if (p.data.isArchived || target.data.isArchived) fail("archived-entity-immutable");
        if (c.action === "stock") {
          fields = Object.fromEntries(prepareVariantStock({reason: c.reason, stockChange: c.changes.stockChange},
            {data: () => target.native}).fields.map(([path, value]) => [path[0], value]));
        } else {
          for (const k of ["name", "attributes", "attributeDefinitions"]) if (Object.hasOwn(c.changes, k)) fields[k] = c.changes[k];
          if (Object.hasOwn(c.changes, "cod")) {
            if (typeof c.changes.cod !== "string") throw new TypeError("COD requires text.");
            const cod = normalizeCod(c.changes.cod), old = target.data.cod || "";
            if (cod !== old) codeWrite = await prepareCodeCreation(tx, store, cod,
              {ownerType: c.variantId === null ? "product" : "variant", productId: c.productId, variantId: c.variantId});
            if (cod) fields.cod = cod;
            else if (c.action !== "addVariant") fields.cod = FieldValue.delete(); // Previous reservation is retained.
          }
          profile = c.changes.commercial;
          const candidateParent = new dto.VariantParentDto(c.productId, {productKind: "variantParent", variantSchemaVersion: 1,
            attributeDefinitions: c.variantId === null && fields.attributeDefinitions ? fields.attributeDefinitions : p.data.attributeDefinitions});
          if (!candidateParent.attributeDefinitions.length || candidateParent.attributeDefinitions.length > 10 ||
              candidateParent.attributeDefinitions.some(d => !d.values.length || d.values.length > 100)) fail("attribute-limit");
          const base = new commercial.ProductCommercialDto(c.variantId === null && profile ? profile : p.commercial.configuration);
          const combinations = [];
          for (const row of [...state.rows.slice(1), ...(c.action === "addVariant" ? [target] : [])]) {
            const candidate = new dto.VariantDto(row.variantId, {variantSchemaVersion: 1, productId: c.productId,
              attributes: row === target && fields.attributes ? fields.attributes : row.data.attributes}, candidateParent);
            if (row === target && fields.attributes) fields.attributes = candidate.combination.pairs.map(p => ({...p}));
            if (candidate.combination.pairs.length !== candidateParent.attributeDefinitions.length) fail("incomplete-variant-combination");
            combinations.push(candidate.combination);
            const cfg = new commercial.VariantCommercialDto(row === target && profile ? profile : row.commercial.configuration);
            if (commercial.resolveCommercial(base, cfg).priceCents.state !== "value") fail("unresolved-price");
            if (row === target && Object.hasOwn(fields, "attributes")) {
              const index = p.ref.collection("variantCombinations").doc(core.hash(candidate.combination.key));
              const previous = await tx.get(index);
              if (previous.exists && (previous.data().productId !== c.productId || previous.data().variantId !== c.variantId ||
                  previous.data().combinationKey !== candidate.combination.key)) fail("combination-already-reserved");
              comboWrite = () => { if (!previous.exists) tx.create(index, {schemaVersion: 1, productId: c.productId,
                variantId: c.variantId, combinationKey: candidate.combination.key, createdAt: FieldValue.serverTimestamp()}); };
            }
          }
          dto.uniqueCombinations(combinations);
        }
      }
      result = {status: "confirmed", requestId: c.requestId, productId: c.productId, variantId: c.variantId, action: c.action};
    } catch (e) {
      if (!(e instanceof TypeError || e instanceof RangeError || e instanceof HttpsError && ["failed-precondition", "already-exists"].includes(e.code))) throw e;
      result = {status: "rejected", requestId: c.requestId, reason: e.details?.reason || "invalid-management-state"};
    }
    if (result.status === "confirmed") {
      codeWrite(); comboWrite();
      if (c.action === "addVariant") {
        tx.create(target.ref, {...target.data, ...fields, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
        tx.create(target.ref.collection("commercialProfiles").doc("current"), {schemaVersion: 1,
          identity: {projectId: db.projectId, storeId: store.id, productId: c.productId, variantId: c.variantId, kind: "variant"}, configuration: profile});
      } else {
        tx.update(target.ref, {...fields, updatedAt: FieldValue.serverTimestamp()});
        if (profile) tx.update(target.ref.collection("commercialProfiles").doc("current"), {configuration: profile});
      }
    }
    tx.create(receipt, {schemaVersion: 1, operation, command: c, result, actorUid: c.scope.uid, role,
      before: result.status === "confirmed" ? {entity: target.data, commercial: target.commercial} : null,
      createdAt: FieldValue.serverTimestamp()});
    return result;
  });
}
async function state(db, request) {
  environment(db);
  const c = core.validate(() => { keys(request.data, ["scope", "productId"], "management state");
    return {scope: core.scopeOf(request.data.scope), productId: core.stableId(request.data.productId)}; });
  return db.runTransaction(async tx => {
    const store = await core.authorize(tx, db, request.auth, c.scope);
    await permission(tx, db, c.scope, "read");
    const control = (await tx.get(controlRef(db, store.id))).data();
    if (!validControl(control) || control.mode !== "authoritative") fail("variant-management-admission-denied");
    const s = await load(tx, db, store, c.scope, c.productId);
    return {status: "available", scope: c.scope, productId: c.productId, admissionEpoch: control.epoch,
      fingerprint: s.fingerprint, rows: s.rows.map(({variantId, data, updateTime, commercial}) => ({variantId, data, updateTime, commercial}))};
  });
}
const wrap = fn => onCall({region: "us-central1", enforceAppCheck: true, timeoutSeconds: 60}, r => {
  if (!r.auth?.uid) fail("authentication-required", "unauthenticated");
  return fn(admin.firestore(), r);
});
module.exports = {manageVariantProductV1: wrap(execute), getVariantProductManagementResultV1: wrap((db, r) => execute(db, r, true)),
  getVariantProductManagementStateV1: wrap(state)};
