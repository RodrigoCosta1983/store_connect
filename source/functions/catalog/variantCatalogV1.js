"use strict";
const admin = require("firebase-admin");
const {createHash} = require("node:crypto");
const {FieldValue, FieldPath} = require("firebase-admin/firestore");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {localMutationSupport: core} = require("../products/productVariantsC1");
const {environment} = require("../products/registerVariantProductV1");
const {variantSaleReadSupport: sale} = require("../sales/variantSaleV1");
const {priceCents, keys} = require("../sales/saleV2Contract");
const customer = require("./catalogRequestContract");
const hash = v => createHash("sha256").update(v).digest("hex");
const fail = (reason, item = {}, code = "failed-precondition") => { throw new HttpsError(code,
  "Atualize o catálogo e revise a seleção.", {reason, ...item}); };
function publicRow(v) {
  return {...v.identity, schemaVersion: 3, name: v.name, parentName: v.parentName, attributes: v.attributes,
    cod: v.row.data.cod || null, price: v.price / 100, unitPriceCents: v.price,
    quantidade: v.row.data.quantidade, imageUrl: v.resolved.imageUrl.state === "value" ? v.resolved.imageUrl.value : ""};
}
// Called only after the existing public resolver has authorized the link.
async function publicRows(db, store, productId, transaction = null) {
  environment(db);
  const read = async tx => {
    const scope = {projectId: db.projectId, storeId: store.id};
    const p = await sale.readParent(tx, store, scope, productId);
    const variants = await tx.get(p.ref.collection("variants").orderBy(FieldPath.documentId()).limit(201));
    if (variants.size > 200) fail("catalog-variant-limit");
    const rows = [];
    for (const v of variants.docs) {
      if (v.data().isArchived === true) continue;
      const leaf = await sale.leaf(tx, store, scope, p, v);
      if (leaf.row.data.quantidade > 0) rows.push(publicRow(leaf));
    }
    return rows;
  };
  return transaction ? read(transaction) : db.runTransaction(read);
}
function parse(raw) {
  keys(raw, ["requestVersion", "requestId", "publicSlug", "publicToken", "customerName", "customerPhone", "note", "items"],
    ["requestVersion", "requestId", "publicSlug", "publicToken", "customerName", "customerPhone", "items"]);
  if (raw.requestVersion !== 3 || typeof raw.publicSlug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.publicSlug) ||
      raw.publicSlug.length > 128 || typeof raw.publicToken !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(raw.publicToken) ||
      !Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 200) throw new TypeError("Invalid variant selection.");
  const seen = new Set();
  const items = raw.items.map(i => {
    keys(i, Object.hasOwn(i, "variantId") ? ["productId", "variantId", "quantity", "expectedUnitPriceCents"] :
      ["productId", "quantity", "expectedUnitPriceCents"]);
    const productId = core.stableId(i.productId), variantId = Object.hasOwn(i, "variantId") ? core.stableId(i.variantId) : null;
    const key = JSON.stringify([productId, variantId]);
    if (seen.has(key)) throw new TypeError("Duplicate tuple."); seen.add(key);
    return {productId, variantId, quantity: sale.integer(i.quantity, true), expectedUnitPriceCents: sale.integer(i.expectedUnitPriceCents)};
  });
  const requestId = core.stableId(raw.requestId);
  if (requestId.length > 128) throw new TypeError("Invalid request ID.");
  return core.canonical({requestVersion: 3, requestId, publicSlug: raw.publicSlug, tokenHash: hash(raw.publicToken),
    customerName: customer.normalizeCatalogRequestCustomerName(raw.customerName),
    customerPhone: customer.normalizeCatalogRequestCustomerPhone(raw.customerPhone),
    note: Object.hasOwn(raw, "note") ? customer.normalizeCatalogRequestNote(raw.note) : null, items});
}
async function submit(request) {
  const db = admin.firestore(); environment(db);
  const c = core.validate(() => parse(request.data));
  return db.runTransaction(async tx => {
    const token = await tx.get(db.collection("catalogPublicTokens").doc(c.tokenHash));
    if (!token.exists) fail("catalog-unavailable", {}, "not-found");
    const storeId = core.stableId(token.data().storeId), catalogId = core.stableId(token.data().catalogId);
    const store = db.collection("stores").doc(storeId), catalog = store.collection("catalogs").doc(catalogId);
    const s = await tx.get(store), cat = await tx.get(catalog), data = cat.data();
    if (!s.exists || !cat.exists || s.data().publicSlug !== c.publicSlug || data.publicTokenHash !== c.tokenHash ||
        !["active", "trial", "overdue"].includes(s.data().subscriptionStatus) || data.status !== "active" ||
        !data.expiresAt || typeof data.expiresAt.toMillis !== "function" || data.expiresAt.toMillis() <= Date.now()) fail("catalog-unavailable");
    const receipt = store.collection("auditLogs").doc("catalog-v3-" + core.hash([c.tokenHash, c.requestId]));
    const saved = await tx.get(receipt);
    if (saved.exists) {
      if (saved.data().requestHash !== core.hash(c)) fail("catalog-request-identity-conflict");
      return {...saved.data().result, replayed: true};
    }
    // Membership is resolved in this same transaction, including the existing
    // sorted/capped dynamic category selection. The client cannot broaden it.
    const members = await tx.get(catalog.collection("items"));
    const ids = new Set(members.docs.map(d => d.data().productId));
    const dynamic = await require("./createCatalog").variantCatalogSupport.resolveDynamicCatalogSections({
      storeRef: store, storedDynamicSections: data.dynamicSections, excludedProductIds: ids, reader: tx, includeVariants: true});
    for (const id of dynamic.allowedProductIds) ids.add(id);
    const scope = {projectId: db.projectId, storeId}, parents = new Map(), rows = [];
    let totalCents = 0, totalUnits = 0;
    for (const item of c.items) {
      if (!ids.has(item.productId)) fail("product-not-in-catalog", item);
      let row;
      if (item.variantId !== null) {
        if (!parents.has(item.productId)) parents.set(item.productId, await sale.readParent(tx, store, scope, item.productId));
        const p = parents.get(item.productId);
        try { row = publicRow(await sale.leaf(tx, store, scope, p, await tx.get(p.ref.collection("variants").doc(item.variantId)))); }
        catch (e) { if (e instanceof HttpsError && e.code === "failed-precondition") fail(e.details?.reason || "variant-unavailable", item); throw e; }
      } else {
        const p = await tx.get(store.collection("products").doc(item.productId)), d = p.data();
        if (!p.exists || d.isArchived === true || d.productKind === "variantParent" ||
            ["attributes", "attributeDefinitions", "variantId", "productId"].some(k => Object.hasOwn(d, k)) ||
            !(await tx.get(p.ref.collection("variants").limit(1))).empty ||
            !(await tx.get(p.ref.collection("variantCombinations").limit(1))).empty ||
            typeof d.name !== "string" || !d.name.trim()) fail("product-unavailable", item);
        row = {productId: p.id, name: d.name, quantidade: d.quantidade, unitPriceCents: priceCents(d.price), price: d.price};
      }
      if (row.unitPriceCents !== item.expectedUnitPriceCents) fail("price-conflict", {productId: item.productId, variantId: item.variantId});
      if (!Number.isSafeInteger(row.quantidade) || row.quantidade < item.quantity) fail("insufficient-stock",
        {productId: item.productId, variantId: item.variantId, availableQuantity: row.quantidade});
      const subtotalCents = sale.integer(row.unitPriceCents * item.quantity);
      totalCents = sale.integer(totalCents + subtotalCents); totalUnits = sale.integer(totalUnits + item.quantity);
      const {quantidade, imageUrl, ...snapshot} = row;
      rows.push({...snapshot, quantity: item.quantity, subtotalCents, subtotal: subtotalCents / 100});
    }
    const ref = store.collection("catalogRequests").doc("v3-" + core.hash([c.tokenHash, c.requestId]));
    if ((await tx.get(ref)).exists) fail("catalog-request-identity-conflict");
    const now = FieldValue.serverTimestamp();
    tx.create(ref, {requestVersion: 3, catalogId, status: "pending", itemCount: rows.length,
      totalUnits, totalCents, totalAmount: totalCents / 100, customerName: c.customerName,
      customerPhone: c.customerPhone, note: c.note, createdAt: now, updatedAt: now, source: "public_catalog"});
    rows.forEach((r, i) => tx.create(ref.collection("items").doc(String(i).padStart(3, "0")), r));
    const result = {success: true, requestId: ref.id, validatedItemCount: rows.length, totalUnits, totalAmount: totalCents / 100, totalCents};
    tx.create(receipt, {schemaVersion: 3, operation: "submitPublicVariantCatalogSelectionV1", requestHash: core.hash(c),
      result, createdAt: now});
    return result;
  });
}
module.exports = {publicRows, submitPublicVariantCatalogSelectionV1: onCall({region: "us-central1", timeoutSeconds: 60}, submit)};
