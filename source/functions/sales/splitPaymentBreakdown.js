"use strict";
const METHODS = Object.freeze(["Dinheiro", "PIX", "Cartão de crédito", "Cartão de débito"]);
function normalizeSalePayments(method, raw, totalCents) {
  if (raw === undefined && method !== "Misto") return undefined;
  if (method !== "Misto" || !Array.isArray(raw) || raw.length < 2 || raw.length > METHODS.length ||
      !Number.isSafeInteger(totalCents) || totalCents <= 0) throw new TypeError("Invalid split payment.");
  if (BigInt((totalCents / 100).toFixed(2).replace(".", "")) !== BigInt(totalCents)) throw new TypeError("Unrepresentable total.");
  const seen = new Set(); let sum = 0;
  const payments = raw.map(part => {
    if (!part || typeof part !== "object" || Array.isArray(part) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(part)) ||
        Object.keys(part).sort().join() !== "amountCents,method" ||
        !METHODS.includes(part.method) || seen.has(part.method) ||
        !Number.isSafeInteger(part.amountCents) || part.amountCents <= 0) throw new TypeError("Invalid payment part.");
    seen.add(part.method); sum += part.amountCents;
    if (BigInt((part.amountCents / 100).toFixed(2).replace(".", "")) !== BigInt(part.amountCents)) throw new TypeError("Unrepresentable payment.");
    if (!Number.isSafeInteger(sum)) throw new TypeError("Invalid payment total.");
    return {method: part.method, amountCents: part.amountCents};
  }).sort((a, b) => METHODS.indexOf(a.method) - METHODS.indexOf(b.method));
  if (sum !== totalCents) throw new TypeError("Payment total does not match sale.");
  return payments;
}
module.exports = {METHODS, normalizeSalePayments};
