"use strict";

const MUTATION_FIELDS = new Set([
  "categoryId",
  "name",
  "imageUrl",
  "parentCategoryId",
]);

const HIERARCHY_DECISION_FIELDS = new Set([
  "categoryId",
  "nextParentCategoryId",
  "childCount",
  "targetParent",
]);

const TARGET_PARENT_FIELDS = new Set([
  "id",
  "parentCategoryId",
]);

function isPlainObject(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function hasOwn(object, field) {
  return Object.prototype.hasOwnProperty.call(
    object,
    field,
  );
}

function validateExactFields(
  input,
  allowedFields,
  context,
) {
  for (const key of Object.keys(input)) {
    if (!allowedFields.has(key)) {
      throw new TypeError(
        `${context} contains unsupported field: ${key}`,
      );
    }
  }
}

function validateCategoryId(
  value,
  fieldName = "categoryId",
) {
  if (typeof value !== "string") {
    throw new TypeError(
      `${fieldName} must be a string`,
    );
  }

  if (value.length === 0) {
    throw new TypeError(
      `${fieldName} must not be empty`,
    );
  }

  if (value.trim().length === 0) {
    throw new TypeError(
      `${fieldName} must not be blank`,
    );
  }

  if (value.trim() !== value) {
    throw new TypeError(
      `${fieldName} must not contain external whitespace`,
    );
  }

  if (value.includes("/")) {
    throw new TypeError(
      `${fieldName} must not contain slash`,
    );
  }

  return value;
}

/**
 * Missing/null stored parent means root, including legacy documents.
 * Present IDs are validated verbatim; this does not validate the tree.
 */
function normalizeStoredParentCategoryId(categoryData) {
  if (
    !hasOwn(categoryData, "parentCategoryId") ||
    categoryData.parentCategoryId === null
  ) {
    return null;
  }

  return validateCategoryId(
    categoryData.parentCategoryId,
    "parentCategoryId",
  );
}

function validateNullableCategoryId(
  value,
  fieldName,
) {
  if (value === null) {
    return null;
  }

  return validateCategoryId(
    value,
    fieldName,
  );
}

/**
 * Pure payload contract for create/edit/move operations.
 *
 * categoryId:
 * - null/absent => create;
 * - string => update.
 *
 * parentCategoryId:
 * - null => root category;
 * - string => subcategory of that category.
 *
 * The caller must always send parentCategoryId explicitly.
 */
function validateCategoryMutationInput(input) {
  if (!isPlainObject(input)) {
    throw new TypeError(
      "input must be a plain object",
    );
  }

  validateExactFields(
    input,
    MUTATION_FIELDS,
    "input",
  );

  if (!hasOwn(input, "name")) {
    throw new TypeError(
      "name is required",
    );
  }

  if (!hasOwn(input, "imageUrl")) {
    throw new TypeError(
      "imageUrl is required",
    );
  }

  if (!hasOwn(input, "parentCategoryId")) {
    throw new TypeError(
      "parentCategoryId is required",
    );
  }

  let categoryId = null;

  if (
    hasOwn(input, "categoryId") &&
    input.categoryId !== null
  ) {
    categoryId = validateCategoryId(
      input.categoryId,
      "categoryId",
    );
  }

  if (typeof input.name !== "string") {
    throw new TypeError(
      "name must be a string",
    );
  }

  if (input.name.length === 0) {
    throw new TypeError(
      "name must not be empty",
    );
  }

  if (input.name.trim().length === 0) {
    throw new TypeError(
      "name must not be blank",
    );
  }

  if (input.name.trim() !== input.name) {
    throw new TypeError(
      "name must not contain external whitespace",
    );
  }

  if (typeof input.imageUrl !== "string") {
    throw new TypeError(
      "imageUrl must be a string",
    );
  }

  const parentCategoryId =
    validateNullableCategoryId(
      input.parentCategoryId,
      "parentCategoryId",
    );

  if (
    categoryId !== null &&
    parentCategoryId === categoryId
  ) {
    throw new RangeError(
      "category cannot be its own parent",
    );
  }

  return {
    mode:
      categoryId === null
        ? "create"
        : "update",
    categoryId,
    name: input.name,
    imageUrl: input.imageUrl,
    parentCategoryId,
  };
}

/**
 * Pure hierarchy decision.
 *
 * The backend will build this context from Firestore snapshots.
 *
 * Rules:
 * - root category: nextParentCategoryId === null;
 * - subcategory: targetParent must exist;
 * - target parent must itself be a root category;
 * - category cannot point to itself;
 * - a category that already has children cannot become a subcategory;
 * - promotion from subcategory to root is allowed.
 *
 * categoryId may be null during creation.
 */
function validateCategoryHierarchyDecision(input) {
  if (!isPlainObject(input)) {
    throw new TypeError(
      "hierarchy input must be a plain object",
    );
  }

  validateExactFields(
    input,
    HIERARCHY_DECISION_FIELDS,
    "hierarchy input",
  );

  for (const field of [
    "categoryId",
    "nextParentCategoryId",
    "childCount",
    "targetParent",
  ]) {
    if (!hasOwn(input, field)) {
      throw new TypeError(
        `${field} is required`,
      );
    }
  }

  const categoryId =
    validateNullableCategoryId(
      input.categoryId,
      "categoryId",
    );

  const nextParentCategoryId =
    validateNullableCategoryId(
      input.nextParentCategoryId,
      "nextParentCategoryId",
    );

  if (
    !Number.isInteger(input.childCount) ||
    input.childCount < 0
  ) {
    throw new TypeError(
      "childCount must be a non-negative integer",
    );
  }

  if (
    categoryId !== null &&
    nextParentCategoryId === categoryId
  ) {
    throw new RangeError(
      "category cannot be its own parent",
    );
  }

  if (nextParentCategoryId === null) {
    if (input.targetParent !== null) {
      throw new TypeError(
        "targetParent must be null for a root category",
      );
    }

    return {
      categoryId,
      nextParentCategoryId: null,
      childCount: input.childCount,
      targetParent: null,
    };
  }

  if (!isPlainObject(input.targetParent)) {
    throw new RangeError(
      "target parent category does not exist",
    );
  }

  validateExactFields(
    input.targetParent,
    TARGET_PARENT_FIELDS,
    "targetParent",
  );

  if (!hasOwn(input.targetParent, "id")) {
    throw new TypeError(
      "targetParent.id is required",
    );
  }

  if (
    !hasOwn(
      input.targetParent,
      "parentCategoryId",
    )
  ) {
    throw new TypeError(
      "targetParent.parentCategoryId is required",
    );
  }

  const targetParentId =
    validateCategoryId(
      input.targetParent.id,
      "targetParent.id",
    );

  const targetParentParentCategoryId =
    validateNullableCategoryId(
      input.targetParent.parentCategoryId,
      "targetParent.parentCategoryId",
    );

  if (
    targetParentId !==
    nextParentCategoryId
  ) {
    throw new RangeError(
      "target parent ID does not match nextParentCategoryId",
    );
  }

  if (
    targetParentParentCategoryId !==
    null
  ) {
    throw new RangeError(
      "target parent must be a root category",
    );
  }

  if (input.childCount > 0) {
    throw new RangeError(
      "category with children cannot become a subcategory",
    );
  }

  return {
    categoryId,
    nextParentCategoryId,
    childCount: input.childCount,
    targetParent: {
      id: targetParentId,
      parentCategoryId: null,
    },
  };
}

module.exports = {
  validateCategoryId,
  normalizeStoredParentCategoryId,
  validateCategoryMutationInput,
  validateCategoryHierarchyDecision,
};
