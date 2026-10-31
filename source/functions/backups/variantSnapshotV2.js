"use strict";
const {createHash} = require("node:crypto");
const {HttpsError} = require("firebase-functions/v2/https");
const dto = require("../contracts/productVariantsV1");
const commercial = require("../contracts/productCommercialC5");
const {normalizeCod, reservationOwner} = require("../products/productCodeReservation");
const {localMutationSupport: core} = require("../products/productVariantsC1");
const baseCollections = {products: "products", customers: "customers", categories: "categories", sales: "sales", cashFlow: "cash_flow"};
const fail = code => { throw new HttpsError("failed-precondition", code, {reason: code}); };
const digest = v => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const pathAllowed = p => typeof p === "string" && /^(?:products\/[^/]+\/(?:variants\/[^/]+(?:\/commercialProfiles\/current)?|variantCombinations\/[^/]+|commercialProfiles\/current)|(?:catalogs|catalogRequests)\/[^/]+(?:\/items\/[^/]+)?|productCodes\/[^/]+|auditLogs\/[^/]+)$/.test(p);
const receiptAllowed = id => /^(?:f10-c1-|f10-sale-evidence-|catalog-v3-|variant-sale-v1-|variant-commercial-v2-|sale-v2-|deferred-sale-v1-|offline-sale-v1-|debt-payment-v1-)/.test(id);

// A single read transaction freezes the five operational collections together
// with F10 descendants and identity evidence; no HML archive root is traversed.
async function capture(db, store, encode) {
  return db.runTransaction(async tx => {
    const collections = {}, entries = [];
    for (const [name, path] of Object.entries(baseCollections)) {
      const rows = await tx.get(store.collection(path));
      collections[name] = rows.docs.map(d => ({id: d.id, data: encode(d.data())}));
    }
    async function add(ref) {
      const rows = await tx.get(ref);
      for (const d of rows.docs) entries.push({path: d.ref.path.slice(store.path.length + 1), data: encode(d.data())});
      return rows;
    }
    for (const product of collections.products) {
      const ref = store.collection("products").doc(product.id);
      await add(ref.collection("commercialProfiles"));
      const variants = await add(ref.collection("variants"));
      await add(ref.collection("variantCombinations"));
      for (const v of variants.docs) await add(v.ref.collection("commercialProfiles"));
    }
    await add(store.collection("productCodes"));
    for (const name of ["catalogs", "catalogRequests"]) {
      const roots = await add(store.collection(name));
      for (const root of roots.docs) await add(root.ref.collection("items"));
    }
    const receipts = await tx.get(store.collection("auditLogs"));
    for (const r of receipts.docs) if (receiptAllowed(r.id)) entries.push({path: "auditLogs/" + r.id, data: encode(r.data())});
    entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (entries.length > 100000) fail("f10-backup-document-limit");
    const graph = {schemaVersion: 1, projectId: db.projectId, storeId: store.id, entries, checksumSha256: digest(entries),
      scope: "operational-f10-graph", excluded: ["Auth", "StorageObjects", "Asaas", "hmlMigrationArchives", "catalogPublicTokens"]};
    validate({snapshotVersion: 2, metadata: {storeId: store.id}, collections, f10Graph: graph});
    return {collections, graph};
  }, {readOnly: true});
}
function validate(snapshot) {
  const g = snapshot.f10Graph;
  if (snapshot.snapshotVersion !== 2 || !g || g.schemaVersion !== 1 || g.storeId !== snapshot.metadata.storeId ||
      typeof g.projectId !== "string" || !g.projectId || g.scope !== "operational-f10-graph" ||
      !Array.isArray(g.entries) || g.entries.length > 100000 || g.checksumSha256 !== digest(g.entries)) fail("invalid-f10-backup-graph");
  const paths = new Map(), products = new Map(snapshot.collections.products.map(p => [p.id, p.data]));
  for (const e of g.entries) {
    if (!e || Object.keys(e).sort().join() !== "data,path" || !pathAllowed(e.path) || paths.has(e.path) ||
        !e.data || typeof e.data !== "object" || Array.isArray(e.data) ||
        e.path.startsWith("auditLogs/") && !receiptAllowed(e.path.slice(10))) fail("invalid-f10-backup-path");
    if (e.path.startsWith("products/") && !products.has(e.path.split("/")[1])) fail("orphan-f10-backup-entry");
    paths.set(e.path, e.data);
  }
  for (const [id, p] of products) {
    if (p.productKind !== "variantParent") continue;
    if (p.quantidade !== 0 || !Array.isArray(p.lotes) || p.lotes.length) fail("invalid-backup-parent-stock");
    const parent = new dto.VariantParentDto(id, {productKind: p.productKind, variantSchemaVersion: p.variantSchemaVersion, attributeDefinitions: p.attributeDefinitions});
    if (!paths.has(`products/${id}/commercialProfiles/current`)) fail("missing-parent-commercial-profile");
    function profile(path, variantId, data) {
      const raw = paths.get(path + "/commercialProfiles/current");
      const expected = {projectId: g.projectId, storeId: g.storeId, productId: id, variantId, kind: variantId === null ? "variantParent" : "variant"};
      if (!raw || raw.schemaVersion !== 1 || core.hash(core.canonical(raw.identity)) !== core.hash(core.canonical(expected)) ||
          Object.hasOwn(data, "price") || Object.hasOwn(data, "costPrice")) fail("invalid-backup-commercial-profile");
      const config = variantId === null ? new commercial.ProductCommercialDto(raw.configuration) : new commercial.VariantCommercialDto(raw.configuration);
      if (Object.hasOwn(data, "cod")) {
        const cod = normalizeCod(data.cod), index = paths.get("productCodes/" + createHash("sha256").update(cod).digest("hex"));
        if (!cod || cod !== data.cod || !index || index.cod !== cod ||
            core.hash(core.canonical(reservationOwner(index))) !== core.hash(core.canonical({ownerType: variantId === null ? "product" : "variant", productId: id, variantId}))) fail("invalid-backup-cod-owner");
      }
      return config;
    }
    const base = profile(`products/${id}`, null, p);
    const combinations = [];
    for (const [path, v] of paths) {
      const parts = path.split("/");
      if (parts.length !== 4 || parts[1] !== id || parts[2] !== "variants") continue;
      const variant = new dto.VariantDto(parts[3], {variantSchemaVersion: v.variantSchemaVersion, productId: v.productId, attributes: v.attributes}, parent);
      combinations.push(variant.combination);
      const cfg = profile(path, parts[3], v);
      if (commercial.resolveCommercial(base, cfg).priceCents.state !== "value" || !Number.isSafeInteger(v.quantidade) || v.quantidade < 0 ||
          !Array.isArray(v.lotes) || v.lotes.some(l => !Number.isSafeInteger(l.quantidade) || l.quantidade < 0 ||
            l.validade?.__storeConnectType !== "timestamp") || v.lotes.length && v.lotes.reduce((n, l) => n + l.quantidade, 0) !== v.quantidade) fail("invalid-backup-variant-state");
      const index = paths.get(`products/${id}/variantCombinations/${core.hash(variant.combination.key)}`);
      if (!index || index.variantId !== parts[3] || index.productId !== id || index.combinationKey !== variant.combination.key ||
          !paths.has(path + "/commercialProfiles/current")) fail("invalid-backup-variant-relation");
    }
    dto.uniqueCombinations(combinations);
  }
  for (const e of g.entries) {
    const p = e.path.split("/");
    if (["catalogs", "catalogRequests"].includes(p[0]) && p.length === 4 && !paths.has(p.slice(0, 2).join("/"))) fail("orphan-catalog-backup-item");
    if (p[0] === "products" && p[2] === "variants" && p.length === 6 && !paths.has(p.slice(0, 4).join("/"))) fail("orphan-variant-backup-profile");
  }
  return snapshot;
}
function restorePlan(snapshot, {projectId, storeId}) {
  validate(snapshot);
  if (snapshot.f10Graph.projectId !== projectId || snapshot.metadata.storeId !== storeId) fail("f10-cross-context-restore-requires-separate-contract");
  const entries = Object.entries(baseCollections).flatMap(([key, collection]) => snapshot.collections[key]
    .map(d => ({path: collection + "/" + d.id, data: d.data})));
  entries.push(...snapshot.f10Graph.entries);
  if (new Set(entries.map(e => e.path)).size !== entries.length) fail("duplicate-restore-path");
  entries.sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
  return {schemaVersion: 2, projectId, storeId, mode: "create-only-empty-operational-target",
    entries, checksumSha256: digest(entries), preservesIds: true, includesHistoricalArchive: false};
}
// No callable/export in index. Only the existing demo boundary may execute this
// internal restore, atomically, with collision checks and a caller decoder.
async function restoreToEmulator(db, snapshot, decode) {
  core.environment(db);
  if (typeof decode !== "function") fail("restore-decoder-required");
  const plan = restorePlan(snapshot, {projectId: db.projectId, storeId: snapshot.metadata.storeId});
  if (plan.entries.length > 450) fail("atomic-restore-size-limit");
  const store = db.collection("stores").doc(plan.storeId);
  return db.runTransaction(async tx => {
    if (!(await tx.get(store)).exists) fail("restore-store-shell-required");
    for (const collection of [...Object.values(baseCollections), "productCodes", "auditLogs", "catalogs", "catalogRequests"]) {
      if (!(await tx.get(store.collection(collection).limit(1))).empty) fail("restore-target-not-empty");
    }
    for (const e of plan.entries) if ((await tx.get(db.doc(store.path + "/" + e.path))).exists) fail("restore-id-collision");
    for (const e of plan.entries) if (/^catalogs\/[^/]+$/.test(e.path) && e.data.status === "active") {
      const tokenHash = e.data.publicTokenHash;
      if (typeof tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(tokenHash)) fail("restore-catalog-token-review-required");
      const token = await tx.get(db.collection("catalogPublicTokens").doc(tokenHash));
      if (!token.exists || token.data().storeId !== plan.storeId || token.data().catalogId !== e.path.split("/")[1]) fail("restore-catalog-token-review-required");
    }
    for (const e of plan.entries) tx.create(db.doc(store.path + "/" + e.path), decode(e.data));
    return {status: "restored", checksumSha256: plan.checksumSha256, documentCount: plan.entries.length};
  });
}
module.exports = {capture, validate, restorePlan, restoreToEmulator};
