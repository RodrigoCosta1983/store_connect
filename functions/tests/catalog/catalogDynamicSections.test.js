"use strict";

const assert = require("node:assert/strict");

const {
  CatalogDynamicSectionsError,
  DYNAMIC_SECTION_DEFINITIONS,
  MAX_DYNAMIC_CATEGORY_IDS_PER_SECTION,
  createDefaultDynamicSections,
  validateDynamicSectionsInput,
  normalizeStoredDynamicSections,
  getEffectiveProductCategoryIds,
  productMatchesCategoryIds,
  getActiveDynamicCategoryIds,
} = require("../../catalog/catalogDynamicSections");

function assertReason(fn, reason) {
  assert.throws(
      fn,
      (error) =>
        error instanceof CatalogDynamicSectionsError &&
        error.reason === reason,
  );
}

function run() {
  assert.deepEqual(
      DYNAMIC_SECTION_DEFINITIONS.map(
          ({id, title}) => ({id, title}),
      ),
      [
        {
          id: "suggestions",
          title: "Sugestões para você",
        },
        {
          id: "offers",
          title: "Ofertas",
        },
        {
          id: "completeOrder",
          title: "Complete seu pedido",
        },
      ],
  );

  assert.deepEqual(
      createDefaultDynamicSections(),
      {
        suggestions: {
          enabled: false,
          categoryIds: [],
        },
        offers: {
          enabled: false,
          categoryIds: [],
        },
        completeOrder: {
          enabled: false,
          categoryIds: [],
        },
      },
  );

  const validated = validateDynamicSectionsInput({
    suggestions: {
      enabled: true,
      categoryIds: [
        "cuidados-pessoais",
        "feminino",
      ],
    },
    offers: {
      enabled: false,
      categoryIds: ["promocao"],
    },
    completeOrder: {
      enabled: true,
      categoryIds: ["complementares"],
    },
  });

  assert.deepEqual(validated, {
    suggestions: {
      enabled: true,
      categoryIds: [
        "cuidados-pessoais",
        "feminino",
      ],
    },
    offers: {
      enabled: false,
      categoryIds: ["promocao"],
    },
    completeOrder: {
      enabled: true,
      categoryIds: ["complementares"],
    },
  });

  assertReason(
      () => validateDynamicSectionsInput({
        desconhecida: {
          enabled: true,
          categoryIds: ["x"],
        },
      }),
      "unknown-section",
  );

  assertReason(
      () => validateDynamicSectionsInput({
        suggestions: {
          enabled: "true",
          categoryIds: ["x"],
        },
      }),
      "invalid-enabled",
  );

  assertReason(
      () => validateDynamicSectionsInput({
        suggestions: {
          enabled: true,
          categoryIds: [],
        },
      }),
      "active-section-without-category",
  );

  assertReason(
      () => validateDynamicSectionsInput({
        suggestions: {
          enabled: true,
          categoryIds: ["duplicada", "duplicada"],
        },
      }),
      "duplicate-category-id",
  );

  assertReason(
      () => validateDynamicSectionsInput({
        suggestions: {
          enabled: true,
          categoryIds: ["categoria/invalida"],
        },
      }),
      "invalid-category-id",
  );

  assertReason(
      () => validateDynamicSectionsInput({
        suggestions: {
          enabled: true,
          categoryIds: Array.from(
              {
                length:
                  MAX_DYNAMIC_CATEGORY_IDS_PER_SECTION + 1,
              },
              (_, index) => `categoria-${index}`,
          ),
        },
      }),
      "too-many-category-ids",
  );

  // categoryIds é autoridade quando existe.
  assert.deepEqual(
      getEffectiveProductCategoryIds({
        categoryIds: ["a", "b"],
        categoryId: "legado",
      }),
      ["a", "b"],
  );

  // Array vazio continua sendo autoridade:
  // não cai no categoryId legado.
  assert.deepEqual(
      getEffectiveProductCategoryIds({
        categoryIds: [],
        categoryId: "legado",
      }),
      [],
  );

  // categoryIds inválido também não cai no legado.
  assert.deepEqual(
      getEffectiveProductCategoryIds({
        categoryIds: ["a", "a"],
        categoryId: "legado",
      }),
      [],
  );

  // Produto legado sem categoryIds continua compatível.
  assert.deepEqual(
      getEffectiveProductCategoryIds({
        categoryId: "legado",
      }),
      ["legado"],
  );

  assert.equal(
      productMatchesCategoryIds(
          {
            categoryIds: ["feminino", "promocao"],
          },
          ["promocao"],
      ),
      true,
  );

  assert.equal(
      productMatchesCategoryIds(
          {
            categoryIds: ["feminino"],
          },
          ["complementares"],
      ),
      false,
  );

  assert.deepEqual(
      getActiveDynamicCategoryIds({
        suggestions: {
          enabled: true,
          categoryIds: ["a", "b"],
        },
        offers: {
          enabled: true,
          categoryIds: ["b", "c"],
        },
        completeOrder: {
          enabled: false,
          categoryIds: ["d"],
        },
      }),
      ["a", "b", "c"],
  );

  // Configuração persistida inválida falha fechada
  // apenas naquela seção.
  assert.deepEqual(
      normalizeStoredDynamicSections({
        suggestions: {
          enabled: true,
          categoryIds: ["ok"],
        },
        offers: {
          enabled: true,
          categoryIds: [],
        },
      }),
      {
        suggestions: {
          enabled: true,
          categoryIds: ["ok"],
        },
        offers: {
          enabled: false,
          categoryIds: [],
        },
        completeOrder: {
          enabled: false,
          categoryIds: [],
        },
      },
  );

  console.log(
      "catalogDynamicSections.test.js: OK",
  );
}

run();