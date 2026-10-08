"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {isDeepStrictEqual} = require("node:util");
const {
  normalizeStoredParentCategoryId,
} = require("../categories/categoryHierarchyContract");
const {
  DYNAMIC_SECTION_DEFINITIONS,
  normalizeStoredDynamicSections,
} = require("./catalogDynamicSections");

function dynamicSectionsEqual(next, stored) {
  const comparable = (value) => {
    const normalized = normalizeStoredDynamicSections(value);
    return DYNAMIC_SECTION_DEFINITIONS.map(({id}) => ({
      enabled: normalized[id].enabled,
      categoryIds: normalized[id].categoryIds.slice().sort(),
    }));
  };
  return isDeepStrictEqual(comparable(next), comparable(stored));
}

// The caller supplies db or transaction; all reads precede caller writes.
async function validateDynamicCategoryAuthority(sections, storeRef, reader) {
  const ids = [...new Set(DYNAMIC_SECTION_DEFINITIONS.flatMap(
      ({id}) => sections[id].categoryIds,
  ))];
  if (ids.length === 0) return;

  const categories = storeRef.collection("categories");
  const resolved = new Map();
  const invalid = () => {
    throw new HttpsError(
        "invalid-argument",
        "Configuração de categorias das seções dinâmicas é inválida.",
        {reason: "invalid-dynamic-section-categories"},
    );
  };
  const read = async (wanted) => {
    if (wanted.length === 0) return;
    const snapshots = await reader.getAll(
        ...wanted.map((id) => categories.doc(id)),
    );
    snapshots.forEach((snapshot) => {
      if (!snapshot.exists) invalid();
      resolved.set(snapshot.id, snapshot.data());
    });
  };
  const parent = (data) => {
    try {
      return normalizeStoredParentCategoryId(data);
    } catch (error) {
      if (error instanceof TypeError) invalid();
      throw error;
    }
  };

  await read(ids);
  const parents = new Set();
  for (const id of ids) {
    const parentId = parent(resolved.get(id));
    if (parentId === id) invalid();
    if (parentId !== null) parents.add(parentId);
  }
  await read([...parents].filter((id) => !resolved.has(id)));
  for (const id of parents) {
    if (parent(resolved.get(id)) !== null) invalid();
  }
}

module.exports = {dynamicSectionsEqual, validateDynamicCategoryAuthority};
