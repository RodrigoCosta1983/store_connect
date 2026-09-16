"use strict";

/** Validate without normalizing IDs; return an independent, ordered array. */
function validateCategoryIds(categoryIds) {
  if (!Array.isArray(categoryIds)) {
    throw new TypeError("categoryIds must be an array");
  }
  if (categoryIds.length > 10) {
    throw new RangeError("categoryIds must contain at most 10 IDs");
  }
  const seen = new Set();
  for (const id of categoryIds) {
    if (typeof id !== "string" || id.length === 0 ||
        id.trim() !== id || id.includes("/")) {
      throw new TypeError("Each category ID must be a nonempty string without outer whitespace or slash");
    }
    if (seen.has(id)) {
      throw new TypeError("Duplicate category ID");
    }
    seen.add(id);
  }
  return categoryIds.slice();
}

/**
 * Capture own-field presence and exact values, including invalid values.
 * Values are retained by reference; this helper neither mutates nor repairs them.
 */
function captureTaxonomyState(product) {
  if (product === null || typeof product !== "object" || Array.isArray(product)) {
    throw new TypeError("product must be an object");
  }
  const state = {};
  for (const field of ["categoryIds", "categoryId", "categoryName"]) {
    state[field] = Object.prototype.hasOwnProperty.call(product, field)
      ? { present: true, value: product[field] }
      : { present: false };
  }
  return state;
}

/**
 * resolvedCategories: Map<ID, {name: canonicalName}> supplied by the caller.
 * Every requested category must resolve to a nonblank string name.
 * Canonical names are preserved verbatim; legacy fields are never consulted.
 */
function projectLegacyCategories(categoryIds, resolvedCategories) {
  const ids = validateCategoryIds(categoryIds);
  if (!(resolvedCategories instanceof Map)) {
    throw new TypeError("resolvedCategories must be a Map");
  }
  for (const id of ids) {
    if (!resolvedCategories.has(id)) {
      throw new TypeError("Unresolved category ID");
    }
    const category = resolvedCategories.get(id);
    if (category === null || typeof category !== "object" ||
        Array.isArray(category) || typeof category.name !== "string" ||
        category.name.trim().length === 0) {
      throw new TypeError("Invalid canonical category name");
    }
  }
  return {
    categoryIds: ids,
    categoryId: ids.length === 0 ? null : ids[0],
    categoryName: ids.length === 0 ? null : resolvedCategories.get(ids[0]).name,
  };
}

module.exports = {
  validateCategoryIds,
  captureTaxonomyState,
  projectLegacyCategories,
};
