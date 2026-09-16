"use strict";

const test =
  require("node:test");

const assert =
  require("node:assert/strict");

const {
  validateDeleteCategoryInput,
} = require(
  "../../categories/deleteCategoryContract",
);

test(
  "aceita categoryId simples",
  () => {
    assert.deepStrictEqual(
      validateDeleteCategoryInput({
        categoryId: "catA",
      }),
      {
        categoryId: "catA",
      },
    );
  },
);

test(
  "preserva maiusculas e minusculas",
  () => {
    assert.deepStrictEqual(
      validateDeleteCategoryInput({
        categoryId: "Cat-AaZ",
      }),
      {
        categoryId: "Cat-AaZ",
      },
    );
  },
);

test(
  "aceita espaco interno",
  () => {
    assert.deepStrictEqual(
      validateDeleteCategoryInput({
        categoryId: "categoria especial",
      }),
      {
        categoryId: "categoria especial",
      },
    );
  },
);

test(
  "aceita caracteres unicode",
  () => {
    assert.deepStrictEqual(
      validateDeleteCategoryInput({
        categoryId: "categoria-á-01",
      }),
      {
        categoryId: "categoria-á-01",
      },
    );
  },
);

test(
  "nao altera o objeto recebido",
  () => {
    const input = {
      categoryId: "catA",
    };

    const before =
      JSON.stringify(input);

    const result =
      validateDeleteCategoryInput(input);

    assert.equal(
      JSON.stringify(input),
      before,
    );

    assert.notStrictEqual(
      result,
      input,
    );

    assert.deepStrictEqual(
      result,
      input,
    );
  },
);

test(
  "aceita objeto com prototype null",
  () => {
    const input =
      Object.create(null);

    input.categoryId =
      "catA";

    assert.deepStrictEqual(
      validateDeleteCategoryInput(input),
      {
        categoryId: "catA",
      },
    );
  },
);

test(
  "rejeita null",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput(null),
      TypeError,
    );
  },
);

test(
  "rejeita undefined",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput(undefined),
      TypeError,
    );
  },
);

test(
  "rejeita array",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput([]),
      TypeError,
    );
  },
);

test(
  "rejeita string como raiz",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput(
          "catA",
        ),
      TypeError,
    );
  },
);

test(
  "rejeita Date como raiz",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput(
          new Date(),
        ),
      TypeError,
    );
  },
);

test(
  "rejeita payload vazio",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput({}),
      TypeError,
    );
  },
);

test(
  "rejeita campo extra",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput({
          categoryId: "catA",
          storeId: "storeA",
        }),
      TypeError,
    );
  },
);

test(
  "rejeita somente campo extra",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput({
          storeId: "storeA",
        }),
      TypeError,
    );
  },
);

test(
  "rejeita categoryId herdado",
  () => {
    const prototype = {
      categoryId: "catA",
    };

    const input =
      Object.create(prototype);

    assert.throws(
      () =>
        validateDeleteCategoryInput(
          input,
        ),
      TypeError,
    );
  },
);

test(
  "rejeita categoryId null",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput({
          categoryId: null,
        }),
      TypeError,
    );
  },
);

test(
  "rejeita categoryId numerico",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput({
          categoryId: 123,
        }),
      TypeError,
    );
  },
);

test(
  "rejeita categoryId booleano",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput({
          categoryId: true,
        }),
      TypeError,
    );
  },
);

test(
  "rejeita categoryId vazio",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput({
          categoryId: "",
        }),
      TypeError,
    );
  },
);

test(
  "rejeita categoryId somente com espacos",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput({
          categoryId: "   ",
        }),
      TypeError,
    );
  },
);

test(
  "rejeita whitespace no inicio",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput({
          categoryId: " catA",
        }),
      TypeError,
    );
  },
);

test(
  "rejeita whitespace no final",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput({
          categoryId: "catA ",
        }),
      TypeError,
    );
  },
);

test(
  "rejeita tab externo",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput({
          categoryId: "\tcatA",
        }),
      TypeError,
    );
  },
);

test(
  "rejeita quebra de linha externa",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput({
          categoryId: "catA\n",
        }),
      TypeError,
    );
  },
);

test(
  "rejeita slash no meio",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput({
          categoryId: "cat/A",
        }),
      TypeError,
    );
  },
);

test(
  "rejeita slash no inicio",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput({
          categoryId: "/catA",
        }),
      TypeError,
    );
  },
);

test(
  "rejeita slash no final",
  () => {
    assert.throws(
      () =>
        validateDeleteCategoryInput({
          categoryId: "catA/",
        }),
      TypeError,
    );
  },
);

test(
  "nao inventa limite de tamanho",
  () => {
    const categoryId =
      "a".repeat(5000);

    assert.deepStrictEqual(
      validateDeleteCategoryInput({
        categoryId,
      }),
      {
        categoryId,
      },
    );
  },
);