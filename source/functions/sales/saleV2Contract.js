"use strict";

const {createHash} = require("node:crypto");
const {normalizeSalePayments} = require("./splitPaymentBreakdown");
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function keys(value, allowed, required = allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some((k) => !allowed.includes(k)) || required.some((k) => !own(value, k))) {
    throw new TypeError("Campos inválidos.");
  }
}
function id(value) {
  // Firestore document ID constraints, not a commercial 128-character cap.
  if (typeof value !== "string" || !value || value.trim() !== value ||
      value.includes("/") || value === "." || value === ".." || /^__.*__$/.test(value) ||
      Buffer.byteLength(value, "utf8") > 1500 || /[\u0000-\u001f\ud800-\udfff]/u.test(value)) {
    throw new TypeError("Identidade inválida.");
  }
  return value;
}
function integer(value, positive = false) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < (positive ? 1 : 0)) {
    throw new TypeError("Valor deve ser inteiro seguro.");
  }
  return value;
}
function scope(value) {
  keys(value, ["projectId", "uid", "storeId"]);
  return {projectId: id(value.projectId), uid: id(value.uid), storeId: id(value.storeId)};
}
function normalize(data) {
  const required = ["schemaVersion", "requestId", "saleId", "scope", "origin", "saleKind", "items", "expectedTotalCents", "paymentMethod"];
  keys(data, [...required, "notes", "customerId", "payments"], required);
  if (data.schemaVersion !== 2 || data.origin !== "online" || data.saleKind !== "instant" ||
      id(data.requestId) !== id(data.saleId) ||
      !["Dinheiro", "PIX", "Cartão de crédito", "Cartão de débito", "Misto"].includes(data.paymentMethod) ||
      !Array.isArray(data.items) || !data.items.length) throw new TypeError("Comando instantâneo inválido.");
  const seen = new Set();
  let total = 0;
  const items = data.items.map((item) => {
    keys(item, ["productId", "quantity", "expectedUnitPriceCents"]);
    const productId = id(item.productId);
    if (seen.has(productId)) throw new TypeError("productId duplicado.");
    seen.add(productId);
    const quantity = integer(item.quantity, true);
    const expectedUnitPriceCents = integer(item.expectedUnitPriceCents);
    const subtotal = integer(quantity * expectedUnitPriceCents);
    total = integer(total + subtotal);
    return {productId, quantity, expectedUnitPriceCents};
  }).sort((a, b) => a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0);
  if (integer(data.expectedTotalCents) !== total) throw new TypeError("Total divergente.");
  const payments = normalizeSalePayments(data.paymentMethod, data.payments, total);
  if (own(data, "notes") && data.notes !== null && typeof data.notes !== "string") throw new TypeError("Notas inválidas.");
  return {schemaVersion: 2, requestId: data.requestId, saleId: data.saleId,
    scope: scope(data.scope), origin: "online", saleKind: "instant", items,
    expectedTotalCents: total, paymentMethod: data.paymentMethod,
    ...(payments ? {payments} : {}),
    notes: data.notes == null ? null : data.notes,
    customerId: data.customerId == null ? null : id(data.customerId)};
}
// Convert the decimal representation of a stored number without rounding or
// requiring binary price*100 to be integral (e.g. 0.29). Fractional cents fail.
function priceCents(price) {
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0 || Object.is(price, -0)) throw new TypeError("Preço inválido.");
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(price));
  if (!match) throw new TypeError("Preço inválido.");
  const fraction = match[2] || "";
  const shift = 2 + Number(match[3] || 0) - fraction.length;
  let cents = BigInt(match[1] + fraction);
  if (shift >= 0) cents *= 10n ** BigInt(shift);
  else {
    const divisor = 10n ** BigInt(-shift);
    if (cents % divisor !== 0n) throw new TypeError("Preço possui fração de centavo.");
    cents /= divisor;
  }
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError("Preço excede inteiro seguro.");
  const result = integer(Number(cents));
  // Legacy readers use monetary units as Number; require a lossless roundtrip.
  if (result / 100 !== price) throw new TypeError("Preço incompatível com histórico.");
  return result;
}
const hash = (command) => createHash("sha256").update(JSON.stringify(command)).digest("hex");
module.exports = {keys, id, integer, normalize, priceCents, hash};
