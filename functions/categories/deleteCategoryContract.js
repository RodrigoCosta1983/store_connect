"use strict";

/**
 * Contrato puro de entrada para deleteCategory.
 *
 * Regras deliberadas:
 *
 * - payload raiz deve ser objeto simples;
 * - somente categoryId e permitido;
 * - categoryId e obrigatorio;
 * - categoryId deve ser string;
 * - nao aceita vazio;
 * - nao aceita somente whitespace;
 * - nao aceita whitespace externo;
 * - nao aceita "/";
 * - nao aplica trim automatico;
 * - nao cria limite de tamanho que nao tenha sido definido;
 * - nao altera o objeto recebido.
 */

const ALLOWED_FIELDS = new Set([
  "categoryId",
]);

function isPlainObject(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function validateDeleteCategoryInput(input) {
  if (!isPlainObject(input)) {
    throw new TypeError(
      "input must be a plain object",
    );
  }

  const keys =
    Object.keys(input);

  for (const key of keys) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new TypeError(
        `unexpected field: ${key}`,
      );
    }
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      input,
      "categoryId",
    )
  ) {
    throw new TypeError(
      "categoryId is required",
    );
  }

  if (keys.length !== 1) {
    throw new TypeError(
      "input must contain only categoryId",
    );
  }

  const categoryId =
    input.categoryId;

  if (typeof categoryId !== "string") {
    throw new TypeError(
      "categoryId must be a string",
    );
  }

  if (categoryId.length === 0) {
    throw new TypeError(
      "categoryId must not be empty",
    );
  }

  if (categoryId.trim().length === 0) {
    throw new TypeError(
      "categoryId must not be blank",
    );
  }

  if (categoryId.trim() !== categoryId) {
    throw new TypeError(
      "categoryId must not contain external whitespace",
    );
  }

  if (categoryId.includes("/")) {
    throw new TypeError(
      "categoryId must not contain slash",
    );
  }

  return {
    categoryId,
  };
}

module.exports = {
  validateDeleteCategoryInput,
};