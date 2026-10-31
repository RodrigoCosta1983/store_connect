"use strict";

// Static local adapter of F9 productMutationV2.stock; writer V2 stays untouched.
const {Timestamp} = require("firebase-admin/firestore");
const {HttpsError} = require("firebase-functions/v2/https");
const {isDeepStrictEqual} = require("node:util");
const contract = require("./productMutationContract");
function fail(reason, message) { throw new HttpsError("failed-precondition", message, {reason}); }
function prepareVariantStock(input, snapshot) {
  const current = snapshot.data();
  if (current.isArchived === true) fail("archived-product-stock-immutable", "Produto arquivado não admite ajuste.");
  const quantity = current.quantidade;
  const lots = contract.has(current, "lotes") ? current.lotes : [];
  const validQuantity = (n) => Number.isSafeInteger(n) && n >= 0;
  if (!validQuantity(quantity) || !Array.isArray(lots) || lots.some((lot) =>
    !lot || typeof lot !== "object" || Array.isArray(lot) || !validQuantity(lot.quantidade) ||
    !(lot.validade instanceof Timestamp))) fail("invalid-current-stock", "Estoque atual inválido.");
  const total = (list) => {
    const sum = list.reduce((n, lot) => n + lot.quantidade, 0);
    if (!validQuantity(sum)) fail("invalid-stock-total", "Soma do estoque inválida.");
    return sum;
  };
  if (lots.length && total(lots) !== quantity) fail("invalid-current-stock", "Estoque e lotes divergentes.");
  const change = input.stockChange;
  const newLot = (lot) => ({quantidade: lot.quantidade,
    validade: Timestamp.fromMillis(lot.validadeMs)});
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
      if (contract.has(op.set, "validadeMs")) value.validade = Timestamp.fromMillis(op.set.validadeMs);
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
module.exports = {prepareVariantStock};
