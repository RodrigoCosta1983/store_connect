"use strict";

const MAX_DYNAMIC_CATEGORY_IDS_PER_SECTION = 10;
const MAX_DYNAMIC_CATEGORY_ID_LENGTH = 128;

const DYNAMIC_SECTION_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "suggestions",
    title: "Sugestões para você",
  }),
  Object.freeze({
    id: "offers",
    title: "Ofertas",
  }),
  Object.freeze({
    id: "completeOrder",
    title: "Complete seu pedido",
  }),
]);

const DYNAMIC_SECTION_IDS = new Set(
    DYNAMIC_SECTION_DEFINITIONS.map((section) => section.id),
);

class CatalogDynamicSectionsError extends Error {
  constructor(reason, message) {
    super(message || "Configuração de seção dinâmica inválida.");
    this.name = "CatalogDynamicSectionsError";
    this.code = "invalid-argument";
    this.reason = reason;
  }
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function fail(reason, message) {
  throw new CatalogDynamicSectionsError(reason, message);
}

function normalizeCategoryId(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (
    !normalized ||
    normalized !== value ||
    normalized.length > MAX_DYNAMIC_CATEGORY_ID_LENGTH ||
    normalized.includes("/")
  ) {
    return null;
  }

  return normalized;
}

function validateCategoryIds(rawCategoryIds, sectionId) {
  if (!Array.isArray(rawCategoryIds)) {
    fail(
        "invalid-category-ids",
        `categoryIds inválido na seção ${sectionId}.`,
    );
  }

  if (
    rawCategoryIds.length >
    MAX_DYNAMIC_CATEGORY_IDS_PER_SECTION
  ) {
    fail(
        "too-many-category-ids",
        `A seção ${sectionId} possui categorias demais.`,
    );
  }

  const categoryIds = [];
  const seen = new Set();

  for (const rawCategoryId of rawCategoryIds) {
    const categoryId = normalizeCategoryId(rawCategoryId);

    if (!categoryId) {
      fail(
          "invalid-category-id",
          `Categoria inválida na seção ${sectionId}.`,
      );
    }

    if (seen.has(categoryId)) {
      fail(
          "duplicate-category-id",
          `Categoria duplicada na seção ${sectionId}.`,
      );
    }

    seen.add(categoryId);
    categoryIds.push(categoryId);
  }

  return categoryIds;
}

function createDefaultDynamicSections() {
  const result = {};

  for (const definition of DYNAMIC_SECTION_DEFINITIONS) {
    result[definition.id] = {
      enabled: false,
      categoryIds: [],
    };
  }

  return result;
}

function validateSection(sectionId, value) {
  if (!isPlainObject(value)) {
    fail(
        "invalid-section",
        `Seção dinâmica inválida: ${sectionId}.`,
    );
  }

  const allowedKeys = new Set([
    "enabled",
    "categoryIds",
  ]);

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      fail(
          "unknown-section-field",
          `Campo não permitido na seção ${sectionId}: ${key}.`,
      );
    }
  }

  if (typeof value.enabled !== "boolean") {
    fail(
        "invalid-enabled",
        `enabled deve ser boolean na seção ${sectionId}.`,
    );
  }

  const categoryIds = validateCategoryIds(
      value.categoryIds ?? [],
      sectionId,
  );

  if (value.enabled && categoryIds.length === 0) {
    fail(
        "active-section-without-category",
        `A seção ${sectionId} precisa possuir ao menos uma categoria.`,
    );
  }

  return {
    enabled: value.enabled,
    categoryIds,
  };
}

function validateDynamicSectionsInput(value) {
  if (!isPlainObject(value)) {
    fail(
        "invalid-dynamic-sections",
        "dynamicSections deve ser um objeto.",
    );
  }

  for (const key of Object.keys(value)) {
    if (!DYNAMIC_SECTION_IDS.has(key)) {
      fail(
          "unknown-section",
          `Seção dinâmica desconhecida: ${key}.`,
      );
    }
  }

  const result = createDefaultDynamicSections();

  for (const definition of DYNAMIC_SECTION_DEFINITIONS) {
    if (
      Object.prototype.hasOwnProperty.call(
          value,
          definition.id,
      )
    ) {
      result[definition.id] = validateSection(
          definition.id,
          value[definition.id],
      );
    }
  }

  return result;
}

function normalizeStoredDynamicSections(value) {
  const result = createDefaultDynamicSections();

  if (!isPlainObject(value)) {
    return result;
  }

  for (const definition of DYNAMIC_SECTION_DEFINITIONS) {
    if (
      !Object.prototype.hasOwnProperty.call(
          value,
          definition.id,
      )
    ) {
      continue;
    }

    try {
      result[definition.id] = validateSection(
          definition.id,
          value[definition.id],
      );
    } catch (error) {
      if (!(error instanceof CatalogDynamicSectionsError)) {
        throw error;
      }

      // Fail closed:
      // configuração persistida inconsistente não publica produtos.
      result[definition.id] = {
        enabled: false,
        categoryIds: [],
      };
    }
  }

  return result;
}

function getEffectiveProductCategoryIds(productData) {
  if (!isPlainObject(productData)) {
    return [];
  }

  if (
    Object.prototype.hasOwnProperty.call(
        productData,
        "categoryIds",
    )
  ) {
    const rawCategoryIds = productData.categoryIds;

    if (
      !Array.isArray(rawCategoryIds) ||
      rawCategoryIds.length >
        MAX_DYNAMIC_CATEGORY_IDS_PER_SECTION
    ) {
      return [];
    }

    const categoryIds = [];
    const seen = new Set();

    for (const rawCategoryId of rawCategoryIds) {
      const categoryId =
        normalizeCategoryId(rawCategoryId);

      if (!categoryId || seen.has(categoryId)) {
        return [];
      }

      seen.add(categoryId);
      categoryIds.push(categoryId);
    }

    return categoryIds;
  }

  const legacyCategoryId =
    normalizeCategoryId(productData.categoryId);

  return legacyCategoryId ?
    [legacyCategoryId] :
    [];
}

function productMatchesCategoryIds(
    productData,
    categoryIds,
) {
  if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
    return false;
  }

  const wanted = new Set();

  for (const rawCategoryId of categoryIds) {
    const categoryId =
      normalizeCategoryId(rawCategoryId);

    if (!categoryId) {
      return false;
    }

    wanted.add(categoryId);
  }

  const effectiveCategoryIds =
    getEffectiveProductCategoryIds(productData);

  return effectiveCategoryIds.some(
      (categoryId) => wanted.has(categoryId),
  );
}

function getActiveDynamicCategoryIds(value) {
  const sections =
    normalizeStoredDynamicSections(value);

  const result = [];
  const seen = new Set();

  for (const definition of DYNAMIC_SECTION_DEFINITIONS) {
    const section = sections[definition.id];

    if (!section.enabled) {
      continue;
    }

    for (const categoryId of section.categoryIds) {
      if (!seen.has(categoryId)) {
        seen.add(categoryId);
        result.push(categoryId);
      }
    }
  }

  return result;
}

module.exports = {
  CatalogDynamicSectionsError,
  DYNAMIC_SECTION_DEFINITIONS,
  MAX_DYNAMIC_CATEGORY_IDS_PER_SECTION,
  createDefaultDynamicSections,
  validateDynamicSectionsInput,
  normalizeStoredDynamicSections,
  getEffectiveProductCategoryIds,
  productMatchesCategoryIds,
  getActiveDynamicCategoryIds,
};