"use strict";

const assert =
  require("node:assert/strict");

const {
  validateCategoryId,
  normalizeStoredParentCategoryId,
  validateCategoryMutationInput,
  validateCategoryHierarchyDecision,
} = require(
  "../../categories/categoryHierarchyContract",
);

let passed = 0;
const failures = [];

function test(name, run) {
  try {
    run();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    failures.push({
      name,
      error,
    });

    console.error(`❌ ${name}`);
    console.error(error);
  }
}

function expectThrows(
  run,
  pattern,
) {
  assert.throws(
    run,
    pattern,
  );
}

// ============================================================
// CATEGORY ID
// ============================================================

test(
  "01 category ID valido e preservado",
  () => {
    assert.equal(
      validateCategoryId(
        "Cat_Feminino-01",
      ),
      "Cat_Feminino-01",
    );
  },
);

for (const [
  name,
  value,
] of [
  ["02 rejeita ID nao string", 123],
  ["03 rejeita ID vazio", ""],
  ["04 rejeita ID blank", "   "],
  ["05 rejeita whitespace externo", " cat"],
  ["06 rejeita slash", "cat/filha"],
]) {
  test(
    name,
    () => {
      expectThrows(
        () =>
          validateCategoryId(
            value,
          ),
        /categoryId/,
      );
    },
  );
}

// ============================================================
// MUTATION INPUT
// ============================================================

test(
  "07 cria categoria raiz",
  () => {
    assert.deepEqual(
      validateCategoryMutationInput({
        name: "Feminino",
        imageUrl: "",
        parentCategoryId: null,
      }),
      {
        mode: "create",
        categoryId: null,
        name: "Feminino",
        imageUrl: "",
        parentCategoryId: null,
      },
    );
  },
);

test(
  "07b categoryId null tambem representa criacao",
  () => {
    assert.deepEqual(
      validateCategoryMutationInput({
        categoryId: null,
        name: "Masculino",
        imageUrl: "",
        parentCategoryId: null,
      }),
      {
        mode: "create",
        categoryId: null,
        name: "Masculino",
        imageUrl: "",
        parentCategoryId: null,
      },
    );
  },
);

test(
  "08 cria subcategoria",
  () => {
    assert.deepEqual(
      validateCategoryMutationInput({
        name: "Perfumes",
        imageUrl:
          "https://example.test/perfumes.jpg",
        parentCategoryId:
          "cat_feminino",
      }),
      {
        mode: "create",
        categoryId: null,
        name: "Perfumes",
        imageUrl:
          "https://example.test/perfumes.jpg",
        parentCategoryId:
          "cat_feminino",
      },
    );
  },
);

test(
  "09 edita ou move categoria existente",
  () => {
    assert.deepEqual(
      validateCategoryMutationInput({
        categoryId:
          "cat_perfumes",
        name:
          "Perfumes importados",
        imageUrl: "",
        parentCategoryId:
          "cat_masculino",
      }),
      {
        mode: "update",
        categoryId:
          "cat_perfumes",
        name:
          "Perfumes importados",
        imageUrl: "",
        parentCategoryId:
          "cat_masculino",
      },
    );
  },
);

test(
  "10 parentCategoryId deve ser explicito",
  () => {
    expectThrows(
      () =>
        validateCategoryMutationInput({
          name: "Feminino",
          imageUrl: "",
        }),
      /parentCategoryId is required/,
    );
  },
);

test(
  "11 name obrigatorio",
  () => {
    expectThrows(
      () =>
        validateCategoryMutationInput({
          imageUrl: "",
          parentCategoryId: null,
        }),
      /name is required/,
    );
  },
);

test(
  "12 imageUrl obrigatorio",
  () => {
    expectThrows(
      () =>
        validateCategoryMutationInput({
          name: "Feminino",
          parentCategoryId: null,
        }),
      /imageUrl is required/,
    );
  },
);

for (const [
  name,
  value,
] of [
  ["13 rejeita name nao string", 1],
  ["14 rejeita name vazio", ""],
  ["15 rejeita name blank", "   "],
  [
    "16 rejeita whitespace externo no name",
    " Feminino",
  ],
]) {
  test(
    name,
    () => {
      expectThrows(
        () =>
          validateCategoryMutationInput({
            name: value,
            imageUrl: "",
            parentCategoryId: null,
          }),
        /name/,
      );
    },
  );
}

test(
  "17 imageUrl deve ser string",
  () => {
    expectThrows(
      () =>
        validateCategoryMutationInput({
          name: "Feminino",
          imageUrl: null,
          parentCategoryId: null,
        }),
      /imageUrl must be a string/,
    );
  },
);

test(
  "18 rejeita campo desconhecido",
  () => {
    expectThrows(
      () =>
        validateCategoryMutationInput({
          name: "Feminino",
          imageUrl: "",
          parentCategoryId: null,
          depth: 1,
        }),
      /unsupported field/,
    );
  },
);

test(
  "19 categoria nao pode ser o proprio pai",
  () => {
    expectThrows(
      () =>
        validateCategoryMutationInput({
          categoryId: "cat_a",
          name: "A",
          imageUrl: "",
          parentCategoryId: "cat_a",
        }),
      /own parent/,
    );
  },
);

test(
  "20 input raiz deve ser objeto simples",
  () => {
    expectThrows(
      () =>
        validateCategoryMutationInput(
          [],
        ),
      /plain object/,
    );
  },
);

// ============================================================
// HIERARCHY DECISION
// ============================================================

test(
  "21 cria categoria raiz",
  () => {
    assert.deepEqual(
      validateCategoryHierarchyDecision({
        categoryId: null,
        nextParentCategoryId: null,
        childCount: 0,
        targetParent: null,
      }),
      {
        categoryId: null,
        nextParentCategoryId: null,
        childCount: 0,
        targetParent: null,
      },
    );
  },
);

test(
  "22 cria subcategoria abaixo de raiz",
  () => {
    assert.deepEqual(
      validateCategoryHierarchyDecision({
        categoryId: null,
        nextParentCategoryId:
          "cat_feminino",
        childCount: 0,
        targetParent: {
          id: "cat_feminino",
          parentCategoryId: null,
        },
      }),
      {
        categoryId: null,
        nextParentCategoryId:
          "cat_feminino",
        childCount: 0,
        targetParent: {
          id: "cat_feminino",
          parentCategoryId: null,
        },
      },
    );
  },
);

test(
  "23 move subcategoria entre duas categorias raiz",
  () => {
    assert.deepEqual(
      validateCategoryHierarchyDecision({
        categoryId:
          "cat_perfumes",
        nextParentCategoryId:
          "cat_masculino",
        childCount: 0,
        targetParent: {
          id: "cat_masculino",
          parentCategoryId: null,
        },
      }).nextParentCategoryId,
      "cat_masculino",
    );
  },
);

test(
  "24 promove subcategoria para raiz",
  () => {
    assert.equal(
      validateCategoryHierarchyDecision({
        categoryId:
          "cat_perfumes",
        nextParentCategoryId: null,
        childCount: 0,
        targetParent: null,
      }).nextParentCategoryId,
      null,
    );
  },
);

test(
  "25 categoria raiz com filhos pode permanecer raiz",
  () => {
    assert.equal(
      validateCategoryHierarchyDecision({
        categoryId:
          "cat_feminino",
        nextParentCategoryId: null,
        childCount: 4,
        targetParent: null,
      }).childCount,
      4,
    );
  },
);

test(
  "26 bloqueia terceiro nivel",
  () => {
    expectThrows(
      () =>
        validateCategoryHierarchyDecision({
          categoryId:
            "cat_importados",
          nextParentCategoryId:
            "cat_perfumes",
          childCount: 0,
          targetParent: {
            id: "cat_perfumes",
            parentCategoryId:
              "cat_feminino",
          },
        }),
      /root category/,
    );
  },
);

test(
  "27 bloqueia auto-parent",
  () => {
    expectThrows(
      () =>
        validateCategoryHierarchyDecision({
          categoryId: "cat_a",
          nextParentCategoryId:
            "cat_a",
          childCount: 0,
          targetParent: {
            id: "cat_a",
            parentCategoryId: null,
          },
        }),
      /own parent/,
    );
  },
);

test(
  "28 categoria com filhos nao pode virar subcategoria",
  () => {
    expectThrows(
      () =>
        validateCategoryHierarchyDecision({
          categoryId:
            "cat_feminino",
          nextParentCategoryId:
            "cat_loja",
          childCount: 2,
          targetParent: {
            id: "cat_loja",
            parentCategoryId: null,
          },
        }),
      /with children/,
    );
  },
);

test(
  "29 pai solicitado precisa existir",
  () => {
    expectThrows(
      () =>
        validateCategoryHierarchyDecision({
          categoryId:
            "cat_perfumes",
          nextParentCategoryId:
            "cat_feminino",
          childCount: 0,
          targetParent: null,
        }),
      /does not exist/,
    );
  },
);

test(
  "30 targetParent precisa corresponder ao ID solicitado",
  () => {
    expectThrows(
      () =>
        validateCategoryHierarchyDecision({
          categoryId:
            "cat_perfumes",
          nextParentCategoryId:
            "cat_feminino",
          childCount: 0,
          targetParent: {
            id: "cat_masculino",
            parentCategoryId: null,
          },
        }),
      /does not match/,
    );
  },
);

for (const [
  name,
  value,
] of [
  [
    "31 childCount negativo",
    -1,
  ],
  [
    "32 childCount decimal",
    1.5,
  ],
  [
    "33 childCount string",
    "0",
  ],
]) {
  test(
    name,
    () => {
      expectThrows(
        () =>
          validateCategoryHierarchyDecision({
            categoryId:
              "cat_perfumes",
            nextParentCategoryId: null,
            childCount: value,
            targetParent: null,
          }),
        /childCount/,
      );
    },
  );
}

test(
  "34 raiz exige targetParent null",
  () => {
    expectThrows(
      () =>
        validateCategoryHierarchyDecision({
          categoryId:
            "cat_perfumes",
          nextParentCategoryId: null,
          childCount: 0,
          targetParent: {
            id: "cat_feminino",
            parentCategoryId: null,
          },
        }),
      /targetParent must be null/,
    );
  },
);

test(
  "35 targetParent rejeita campos desconhecidos",
  () => {
    expectThrows(
      () =>
        validateCategoryHierarchyDecision({
          categoryId:
            "cat_perfumes",
          nextParentCategoryId:
            "cat_feminino",
          childCount: 0,
          targetParent: {
            id: "cat_feminino",
            parentCategoryId: null,
            name: "Feminino",
          },
        }),
      /unsupported field/,
    );
  },
);

test(
  "36 decisao rejeita campos desconhecidos",
  () => {
    expectThrows(
      () =>
        validateCategoryHierarchyDecision({
          categoryId: null,
          nextParentCategoryId: null,
          childCount: 0,
          targetParent: null,
          depth: 0,
        }),
      /unsupported field/,
    );
  },
);

test(
  "37 resultado nao compartilha targetParent de entrada",
  () => {
    const targetParent = {
      id: "cat_feminino",
      parentCategoryId: null,
    };

    const result =
      validateCategoryHierarchyDecision({
        categoryId:
          "cat_perfumes",
        nextParentCategoryId:
          "cat_feminino",
        childCount: 0,
        targetParent,
      });

    assert.notEqual(
      result.targetParent,
      targetParent,
    );

    assert.deepEqual(
      result.targetParent,
      targetParent,
    );
  },
);

// ============================================================
// STORED PARENT
// ============================================================

for (const [name, categoryData, expected] of [
  ["ausente representa raiz legada", {name: "Raiz"}, null],
  ["null representa raiz", {parentCategoryId: null}, null],
  ["ID simples", {parentCategoryId: "cat_a"}, "cat_a"],
  ["preserva caixa exata", {parentCategoryId: "Cat_AbC-01"}, "Cat_AbC-01"],
  ["preserva espaco interno permitido", {parentCategoryId: "Cat A"}, "Cat A"],
]) {
  test(`stored parent: ${name}`, () => {
    const before = {...categoryData};
    Object.freeze(categoryData);
    assert.strictEqual(
      normalizeStoredParentCategoryId(categoryData),
      expected,
    );
    assert.deepEqual(categoryData, before);
    if (typeof expected === "string") {
      assert.strictEqual(expected, categoryData.parentCategoryId);
    }
  });
}

for (const [name, value] of [
  ["whitespace inicial", " cat_a"],
  ["whitespace final", "cat_a "],
  ["vazio", ""],
  ["somente espaco", " "],
  ["tabulacao", "\t"],
  ["CR", "\r"],
  ["LF", "\n"],
  ["tabulacao externa", "\tcat_a"],
  ["CR/LF externos", "cat_a\r\n"],
  ["slash", "cat_a/filha"],
  ["numero", 123],
  ["boolean", false],
  ["array", []],
  ["objeto/map", {}],
  ["undefined explicito", undefined],
  ["String encapsulada", new String("cat_a")],
  ["symbol", Symbol("cat_a")],
  ["bigint", 1n],
]) {
  test(`stored parent rejeita: ${name}`, () => {
    const categoryData = {name: "Categoria", parentCategoryId: value};
    const before = {...categoryData};
    Object.freeze(categoryData);
    assert.throws(
      () => normalizeStoredParentCategoryId(categoryData),
      {name: "TypeError", message: /parentCategoryId/},
    );
    assert.deepEqual(categoryData, before);
    assert.equal(
      Object.prototype.hasOwnProperty.call(categoryData, "parentCategoryId"),
      true,
    );
  });
}

// ============================================================
// RESULTADO
// ============================================================

console.log("");
console.log("============================================================");

if (failures.length === 0) {
  console.log(
    `✅ T2-A: ${passed} casos puros passaram.`,
  );
  console.log(
    "Sem Firebase, Emulator, rede ou escrita de dados.",
  );
  console.log("============================================================");
} else {
  console.error(
    `❌ T2-A: ${failures.length} falha(s).`,
  );

  for (const failure of failures) {
    console.error(
      `- ${failure.name}: ${failure.error.message}`,
    );
  }

  console.error("============================================================");
  process.exitCode = 1;
}
