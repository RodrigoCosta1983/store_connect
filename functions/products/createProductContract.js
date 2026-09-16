"use strict";

const {
  validateCategoryIds,
} = require("./productCategoryContract");

const ROOT_FIELDS = new Set([
  "requestId",
  "product",
  "categoryIds",
]);

const PRODUCT_FIELDS = new Set([
  "name",
  "price",
  "quantidade",
  "lotes",
  "minimumStock",
  "imageUrl",
  "barcode",
  "costPrice",
  "fiscal",
]);

const REQUIRED_PRODUCT_FIELDS = [
  "name",
  "price",
  "quantidade",
  "lotes",
  "minimumStock",
  "imageUrl",
];

const LOT_FIELDS = new Set([
  "quantidade",
  "validadeMs",
]);

const FISCAL_FIELDS = new Set([
  "ncm",
  "origem",
  "cfop",
  "unidade",
  "cest",
  "icmsSituacaoTributaria",
  "pisSituacaoTributaria",
  "cofinsSituacaoTributaria",
  "ibsCbsSituacaoTributaria",
  "ibsCbsClassificacaoTributaria",
]);

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function assertNoUnexpectedKeys(
  value,
  allowedFields,
  label,
) {
  const unexpected =
    Object.keys(value)
      .filter(
        (key) =>
          !allowedFields.has(key),
      );

  if (unexpected.length > 0) {
    throw new TypeError(
      `${label} possui campos nao permitidos: ${unexpected.join(", ")}`,
    );
  }
}

function requireOwnField(
  value,
  field,
  label,
) {
  if (
    !Object.prototype.hasOwnProperty.call(
      value,
      field,
    )
  ) {
    throw new TypeError(
      `${label}.${field} e obrigatorio.`,
    );
  }
}

function validateRequestId(value) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new TypeError(
      "requestId deve ser uma string nao vazia.",
    );
  }

  return value;
}

function validateFiniteNonNegativeNumber(
  value,
  label,
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    throw new TypeError(
      `${label} deve ser um numero finito.`,
    );
  }

  if (value < 0) {
    throw new RangeError(
      `${label} nao pode ser negativo.`,
    );
  }

  return value;
}

function validateSafeNonNegativeInteger(
  value,
  label,
) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(
      `${label} deve ser um inteiro seguro.`,
    );
  }

  if (value < 0) {
    throw new RangeError(
      `${label} nao pode ser negativo.`,
    );
  }

  return value;
}

function validateFiscal(fiscal) {
  if (!isPlainObject(fiscal)) {
    throw new TypeError(
      "product.fiscal deve ser um objeto.",
    );
  }

  assertNoUnexpectedKeys(
    fiscal,
    FISCAL_FIELDS,
    "product.fiscal",
  );

  const normalized = {};

  for (const field of Object.keys(fiscal)) {
    const value =
      fiscal[field];

    if (
      value !== null &&
      typeof value !== "string"
    ) {
      throw new TypeError(
        `product.fiscal.${field} deve ser string ou null.`,
      );
    }

    normalized[field] =
      value;
  }

  return normalized;
}

function validateLots(
  lotes,
  quantidade,
) {
  if (!Array.isArray(lotes)) {
    throw new TypeError(
      "product.lotes deve ser um array.",
    );
  }

  const normalized = [];
  let sum = 0;

  for (
    let index = 0;
    index < lotes.length;
    index += 1
  ) {
    const lot =
      lotes[index];

    if (!isPlainObject(lot)) {
      throw new TypeError(
        `product.lotes[${index}] deve ser um objeto.`,
      );
    }

    assertNoUnexpectedKeys(
      lot,
      LOT_FIELDS,
      `product.lotes[${index}]`,
    );

    requireOwnField(
      lot,
      "quantidade",
      `product.lotes[${index}]`,
    );

    requireOwnField(
      lot,
      "validadeMs",
      `product.lotes[${index}]`,
    );

    if (
      !Number.isSafeInteger(
        lot.quantidade,
      )
    ) {
      throw new TypeError(
        `product.lotes[${index}].quantidade deve ser um inteiro seguro.`,
      );
    }

    if (lot.quantidade <= 0) {
      throw new RangeError(
        `product.lotes[${index}].quantidade deve ser maior que zero.`,
      );
    }

    if (
      !Number.isSafeInteger(
        lot.validadeMs,
      )
    ) {
      throw new TypeError(
        `product.lotes[${index}].validadeMs deve ser um inteiro seguro.`,
      );
    }

    sum +=
      lot.quantidade;

    if (!Number.isSafeInteger(sum)) {
      throw new RangeError(
        "A soma das quantidades dos lotes excede o intervalo seguro.",
      );
    }

    normalized.push({
      quantidade:
        lot.quantidade,

      validadeMs:
        lot.validadeMs,
    });
  }

  if (
    normalized.length > 0 &&
    quantidade !== sum
  ) {
    throw new RangeError(
      "product.quantidade deve ser igual a soma das quantidades dos lotes.",
    );
  }

  return normalized;
}

function validateProduct(product) {
  if (!isPlainObject(product)) {
    throw new TypeError(
      "product deve ser um objeto.",
    );
  }

  assertNoUnexpectedKeys(
    product,
    PRODUCT_FIELDS,
    "product",
  );

  for (
    const field
    of REQUIRED_PRODUCT_FIELDS
  ) {
    requireOwnField(
      product,
      field,
      "product",
    );
  }

  if (typeof product.name !== "string") {
    throw new TypeError(
      "product.name deve ser uma string.",
    );
  }

  const name =
    product.name.trim();

  if (name.length === 0) {
    throw new TypeError(
      "product.name nao pode ser vazio.",
    );
  }

  const price =
    validateFiniteNonNegativeNumber(
      product.price,
      "product.price",
    );

  const quantidade =
    validateSafeNonNegativeInteger(
      product.quantidade,
      "product.quantidade",
    );

  const minimumStock =
    validateSafeNonNegativeInteger(
      product.minimumStock,
      "product.minimumStock",
    );

  if (
    typeof product.imageUrl !==
    "string"
  ) {
    throw new TypeError(
      "product.imageUrl deve ser uma string.",
    );
  }

  const lotes =
    validateLots(
      product.lotes,
      quantidade,
    );

  const normalized = {
    name,
    price,
    quantidade:
      lotes.length > 0
        ? lotes.reduce(
          (sum, lot) =>
            sum +
            lot.quantidade,
          0,
        )
        : quantidade,
    lotes,
    minimumStock,
    imageUrl:
      product.imageUrl,
  };

  if (
    Object.prototype.hasOwnProperty.call(
      product,
      "barcode",
    )
  ) {
    if (
      typeof product.barcode !==
      "string"
    ) {
      throw new TypeError(
        "product.barcode deve ser uma string.",
      );
    }

    const barcode =
      product.barcode.trim();

    if (barcode.length > 0) {
      normalized.barcode =
        barcode;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(
      product,
      "costPrice",
    )
  ) {
    normalized.costPrice =
      validateFiniteNonNegativeNumber(
        product.costPrice,
        "product.costPrice",
      );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      product,
      "fiscal",
    )
  ) {
    normalized.fiscal =
      validateFiscal(
        product.fiscal,
      );
  }

  return normalized;
}

function validateCreateProductInput(input) {
  if (!isPlainObject(input)) {
    throw new TypeError(
      "Payload de createProduct deve ser um objeto.",
    );
  }

  assertNoUnexpectedKeys(
    input,
    ROOT_FIELDS,
    "payload",
  );

  requireOwnField(
    input,
    "requestId",
    "payload",
  );

  requireOwnField(
    input,
    "product",
    "payload",
  );

  requireOwnField(
    input,
    "categoryIds",
    "payload",
  );

  const requestId =
    validateRequestId(
      input.requestId,
    );

  const product =
    validateProduct(
      input.product,
    );

  const categoryIds =
    validateCategoryIds(
      input.categoryIds,
    );

  return {
    requestId,
    product,
    categoryIds,
  };
}

module.exports = {
  validateCreateProductInput,
};