"use strict";

const {validateCreateProductInput} = require("./createProductContract");

function validateUpdateProductInput(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some((key) => !["requestId", "productId", "product"].includes(key))) {
    throw new TypeError("Payload de updateProduct inválido.");
  }
  const {productId} = data;
  if (typeof productId !== "string" || !productId || productId.trim() !== productId ||
      productId.includes("/")) throw new TypeError("productId inválido.");
  const normalized = validateCreateProductInput({
    requestId: data.requestId, product: data.product, categoryIds: [],
  });
  return {
    requestId: normalized.requestId, productId, product: normalized.product,
    codSupplied: Object.prototype.hasOwnProperty.call(data.product, "cod"),
  };
}

module.exports = {validateUpdateProductInput};
