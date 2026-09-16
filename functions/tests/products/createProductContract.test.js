"use strict";

const assert =
  require("node:assert/strict");

const {
  validateCreateProductInput,
} = require(
  "../../products/createProductContract",
);

let passed = 0;
let failed = 0;

function basePayload() {
  return {
    requestId:
      "request-001",

    product: {
      name:
        "Produto Teste",

      price:
        19.9,

      quantidade:
        5,

      lotes:
        [],

      minimumStock:
        1,

      imageUrl:
        "",
    },

    categoryIds:
      [],
  };
}

function test(
  name,
  callback,
) {
  try {
    callback();

    passed += 1;
    console.log(
      `PASS ${name}`,
    );
  } catch (error) {
    failed += 1;

    console.error(
      `FAIL ${name}`,
    );

    console.error(
      error?.stack ||
      error,
    );
  }
}

function expectThrows(
  callback,
  ErrorType,
) {
  assert.throws(
    callback,
    ErrorType,
  );
}

test(
  "accepts minimal manual product",
  () => {
    const result =
      validateCreateProductInput(
        basePayload(),
      );

    assert.equal(
      result.requestId,
      "request-001",
    );

    assert.equal(
      result.product.name,
      "Produto Teste",
    );

    assert.deepEqual(
      result.categoryIds,
      [],
    );
  },
);

test(
  "trims product name",
  () => {
    const payload =
      basePayload();

    payload.product.name =
      "  Produto X  ";

    const result =
      validateCreateProductInput(
        payload,
      );

    assert.equal(
      result.product.name,
      "Produto X",
    );
  },
);

test(
  "preserves category order",
  () => {
    const payload =
      basePayload();

    payload.categoryIds = [
      "cat-B",
      "cat-A",
      "cat-a",
    ];

    const result =
      validateCreateProductInput(
        payload,
      );

    assert.deepEqual(
      result.categoryIds,
      [
        "cat-B",
        "cat-A",
        "cat-a",
      ],
    );
  },
);

test(
  "returns new product and category references",
  () => {
    const payload =
      basePayload();

    const originalProduct =
      payload.product;

    const originalCategories =
      payload.categoryIds;

    const result =
      validateCreateProductInput(
        payload,
      );

    assert.notEqual(
      result.product,
      originalProduct,
    );

    assert.notEqual(
      result.categoryIds,
      originalCategories,
    );
  },
);

test(
  "does not mutate input",
  () => {
    const payload =
      basePayload();

    payload.product.name =
      "  Produto  ";

    const before =
      JSON.stringify(payload);

    validateCreateProductInput(
      payload,
    );

    assert.equal(
      JSON.stringify(payload),
      before,
    );
  },
);

for (
  const invalidRoot
  of [
    null,
    [],
    "x",
    1,
  ]
) {
  test(
    `rejects invalid root ${String(invalidRoot)}`,
    () => {
      expectThrows(
        () =>
          validateCreateProductInput(
            invalidRoot,
          ),
        TypeError,
      );
    },
  );
}

test(
  "rejects unexpected root storeId",
  () => {
    const payload =
      basePayload();

    payload.storeId =
      "store-x";

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      TypeError,
    );
  },
);

test(
  "rejects unexpected root isBusiness",
  () => {
    const payload =
      basePayload();

    payload.isBusiness =
      true;

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      TypeError,
    );
  },
);

for (
  const field
  of [
    "requestId",
    "product",
    "categoryIds",
  ]
) {
  test(
    `rejects missing root field ${field}`,
    () => {
      const payload =
        basePayload();

      delete payload[field];

      expectThrows(
        () =>
          validateCreateProductInput(
            payload,
          ),
        TypeError,
      );
    },
  );
}

for (
  const requestId
  of [
    "",
    "   ",
    null,
    123,
  ]
) {
  test(
    `rejects invalid requestId ${String(requestId)}`,
    () => {
      const payload =
        basePayload();

      payload.requestId =
        requestId;

      expectThrows(
        () =>
          validateCreateProductInput(
            payload,
          ),
        TypeError,
      );
    },
  );
}

for (
  const field
  of [
    "name",
    "price",
    "quantidade",
    "lotes",
    "minimumStock",
    "imageUrl",
  ]
) {
  test(
    `rejects missing product field ${field}`,
    () => {
      const payload =
        basePayload();

      delete payload.product[field];

      expectThrows(
        () =>
          validateCreateProductInput(
            payload,
          ),
        TypeError,
      );
    },
  );
}

for (
  const forbiddenField
  of [
    "storeId",
    "name_lowercase",
    "createdAt",
    "categoryId",
    "categoryName",
    "isArchived",
    "archivedAt",
    "archivedBy",
  ]
) {
  test(
    `rejects derived product field ${forbiddenField}`,
    () => {
      const payload =
        basePayload();

      payload.product[
        forbiddenField
      ] = "forbidden";

      expectThrows(
        () =>
          validateCreateProductInput(
            payload,
          ),
        TypeError,
      );
    },
  );
}

for (
  const invalidName
  of [
    "",
    "   ",
    null,
    123,
  ]
) {
  test(
    `rejects invalid product name ${String(invalidName)}`,
    () => {
      const payload =
        basePayload();

      payload.product.name =
        invalidName;

      expectThrows(
        () =>
          validateCreateProductInput(
            payload,
          ),
        TypeError,
      );
    },
  );
}

for (
  const invalidPrice
  of [
    "19.90",
    NaN,
    Infinity,
  ]
) {
  test(
    `rejects non-finite/non-number price ${String(invalidPrice)}`,
    () => {
      const payload =
        basePayload();

      payload.product.price =
        invalidPrice;

      expectThrows(
        () =>
          validateCreateProductInput(
            payload,
          ),
        TypeError,
      );
    },
  );
}

test(
  "rejects negative price",
  () => {
    const payload =
      basePayload();

    payload.product.price =
      -0.01;

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      RangeError,
    );
  },
);

for (
  const invalidQuantity
  of [
    1.5,
    "5",
    NaN,
  ]
) {
  test(
    `rejects invalid quantity ${String(invalidQuantity)}`,
    () => {
      const payload =
        basePayload();

      payload.product.quantidade =
        invalidQuantity;

      expectThrows(
        () =>
          validateCreateProductInput(
            payload,
          ),
        TypeError,
      );
    },
  );
}

test(
  "rejects negative quantity",
  () => {
    const payload =
      basePayload();

    payload.product.quantidade =
      -1;

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      RangeError,
    );
  },
);

test(
  "rejects invalid minimumStock integer",
  () => {
    const payload =
      basePayload();

    payload.product.minimumStock =
      1.2;

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      TypeError,
    );
  },
);

test(
  "rejects negative minimumStock",
  () => {
    const payload =
      basePayload();

    payload.product.minimumStock =
      -1;

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      RangeError,
    );
  },
);

test(
  "rejects non-string imageUrl",
  () => {
    const payload =
      basePayload();

    payload.product.imageUrl =
      null;

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      TypeError,
    );
  },
);

test(
  "accepts valid lots and preserves canonical sum",
  () => {
    const payload =
      basePayload();

    payload.product.quantidade =
      7;

    payload.product.lotes = [
      {
        quantidade:
          3,

        validadeMs:
          1798761600000,
      },
      {
        quantidade:
          4,

        validadeMs:
          1801439999000,
      },
    ];

    const result =
      validateCreateProductInput(
        payload,
      );

    assert.equal(
      result.product.quantidade,
      7,
    );

    assert.deepEqual(
      result.product.lotes,
      payload.product.lotes,
    );

    assert.notEqual(
      result.product.lotes,
      payload.product.lotes,
    );

    assert.notEqual(
      result.product.lotes[0],
      payload.product.lotes[0],
    );
  },
);

test(
  "rejects lot quantity mismatch",
  () => {
    const payload =
      basePayload();

    payload.product.quantidade =
      99;

    payload.product.lotes = [
      {
        quantidade:
          2,

        validadeMs:
          1798761600000,
      },
    ];

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      RangeError,
    );
  },
);

test(
  "rejects non-array lots",
  () => {
    const payload =
      basePayload();

    payload.product.lotes =
      {};

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      TypeError,
    );
  },
);

test(
  "rejects non-object lot",
  () => {
    const payload =
      basePayload();

    payload.product.quantidade =
      1;

    payload.product.lotes = [
      "lot",
    ];

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      TypeError,
    );
  },
);

test(
  "rejects unexpected lot field",
  () => {
    const payload =
      basePayload();

    payload.product.quantidade =
      1;

    payload.product.lotes = [
      {
        quantidade:
          1,

        validadeMs:
          1798761600000,

        validade:
          "forbidden",
      },
    ];

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      TypeError,
    );
  },
);

for (
  const missingField
  of [
    "quantidade",
    "validadeMs",
  ]
) {
  test(
    `rejects lot missing ${missingField}`,
    () => {
      const payload =
        basePayload();

      payload.product.quantidade =
        1;

      const lot = {
        quantidade:
          1,

        validadeMs:
          1798761600000,
      };

      delete lot[missingField];

      payload.product.lotes = [
        lot,
      ];

      expectThrows(
        () =>
          validateCreateProductInput(
            payload,
          ),
        TypeError,
      );
    },
  );
}

for (
  const invalidLotQuantity
  of [
    1.5,
    "1",
    NaN,
  ]
) {
  test(
    `rejects invalid lot quantity ${String(invalidLotQuantity)}`,
    () => {
      const payload =
        basePayload();

      payload.product.quantidade =
        1;

      payload.product.lotes = [
        {
          quantidade:
            invalidLotQuantity,

          validadeMs:
            1798761600000,
        },
      ];

      expectThrows(
        () =>
          validateCreateProductInput(
            payload,
          ),
        TypeError,
      );
    },
  );
}

for (
  const invalidLotQuantity
  of [
    0,
    -1,
  ]
) {
  test(
    `rejects non-positive lot quantity ${invalidLotQuantity}`,
    () => {
      const payload =
        basePayload();

      payload.product.quantidade =
        0;

      payload.product.lotes = [
        {
          quantidade:
            invalidLotQuantity,

          validadeMs:
            1798761600000,
        },
      ];

      expectThrows(
        () =>
          validateCreateProductInput(
            payload,
          ),
        RangeError,
      );
    },
  );
}

for (
  const invalidValidity
  of [
    1.2,
    "1798761600000",
    NaN,
    Infinity,
  ]
) {
  test(
    `rejects invalid validadeMs ${String(invalidValidity)}`,
    () => {
      const payload =
        basePayload();

      payload.product.quantidade =
        1;

      payload.product.lotes = [
        {
          quantidade:
            1,

          validadeMs:
            invalidValidity,
        },
      ];

      expectThrows(
        () =>
          validateCreateProductInput(
            payload,
          ),
        TypeError,
      );
    },
  );
}

test(
  "rejects unsafe lot sum",
  () => {
    const payload =
      basePayload();

    payload.product.quantidade =
      Number.MAX_SAFE_INTEGER;

    payload.product.lotes = [
      {
        quantidade:
          Number.MAX_SAFE_INTEGER,

        validadeMs:
          1,
      },
      {
        quantidade:
          1,

        validadeMs:
          2,
      },
    ];

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      RangeError,
    );
  },
);

test(
  "trims barcode",
  () => {
    const payload =
      basePayload();

    payload.product.barcode =
      "  789123  ";

    const result =
      validateCreateProductInput(
        payload,
      );

    assert.equal(
      result.product.barcode,
      "789123",
    );
  },
);

test(
  "empty barcode is omitted",
  () => {
    const payload =
      basePayload();

    payload.product.barcode =
      "   ";

    const result =
      validateCreateProductInput(
        payload,
      );

    assert.equal(
      Object.prototype.hasOwnProperty.call(
        result.product,
        "barcode",
      ),
      false,
    );
  },
);

test(
  "rejects non-string barcode",
  () => {
    const payload =
      basePayload();

    payload.product.barcode =
      789;

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      TypeError,
    );
  },
);

test(
  "accepts zero costPrice",
  () => {
    const payload =
      basePayload();

    payload.product.costPrice =
      0;

    const result =
      validateCreateProductInput(
        payload,
      );

    assert.equal(
      result.product.costPrice,
      0,
    );
  },
);

test(
  "rejects negative costPrice",
  () => {
    const payload =
      basePayload();

    payload.product.costPrice =
      -1;

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      RangeError,
    );
  },
);

test(
  "rejects non-number costPrice",
  () => {
    const payload =
      basePayload();

    payload.product.costPrice =
      "10";

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      TypeError,
    );
  },
);

test(
  "accepts fiscal structure used by manual registration",
  () => {
    const payload =
      basePayload();

    payload.product.fiscal = {
      ncm:
        "12345678",

      origem:
        "0",

      cfop:
        "5102",

      unidade:
        "UN",

      cest:
        null,

      icmsSituacaoTributaria:
        "102",

      pisSituacaoTributaria:
        "07",

      cofinsSituacaoTributaria:
        "07",

      ibsCbsSituacaoTributaria:
        "",

      ibsCbsClassificacaoTributaria:
        "",
    };

    const result =
      validateCreateProductInput(
        payload,
      );

    assert.deepEqual(
      result.product.fiscal,
      payload.product.fiscal,
    );

    assert.notEqual(
      result.product.fiscal,
      payload.product.fiscal,
    );
  },
);

test(
  "accepts import fiscal with only ncm",
  () => {
    const payload =
      basePayload();

    payload.product.fiscal = {
      ncm:
        "12345678",
    };

    const result =
      validateCreateProductInput(
        payload,
      );

    assert.deepEqual(
      result.product.fiscal,
      {
        ncm:
          "12345678",
      },
    );
  },
);

for (
  const invalidFiscal
  of [
    null,
    [],
    "fiscal",
  ]
) {
  test(
    `rejects invalid fiscal object ${String(invalidFiscal)}`,
    () => {
      const payload =
        basePayload();

      payload.product.fiscal =
        invalidFiscal;

      expectThrows(
        () =>
          validateCreateProductInput(
            payload,
          ),
        TypeError,
      );
    },
  );
}

test(
  "rejects client fiscal updatedAt",
  () => {
    const payload =
      basePayload();

    payload.product.fiscal = {
      ncm:
        "12345678",

      updatedAt:
        123,
    };

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      TypeError,
    );
  },
);

test(
  "rejects invalid fiscal value type",
  () => {
    const payload =
      basePayload();

    payload.product.fiscal = {
      origem:
        0,
    };

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      TypeError,
    );
  },
);

test(
  "rejects duplicate categoryIds",
  () => {
    const payload =
      basePayload();

    payload.categoryIds = [
      "catA",
      "catA",
    ];

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      TypeError,
    );
  },
);

test(
  "rejects more than 10 categoryIds",
  () => {
    const payload =
      basePayload();

    payload.categoryIds =
      Array.from(
        {
          length:
            11,
        },
        (_, index) =>
          `cat-${index}`,
      );

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      RangeError,
    );
  },
);

test(
  "rejects categoryId with slash",
  () => {
    const payload =
      basePayload();

    payload.categoryIds = [
      "cat/A",
    ];

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      TypeError,
    );
  },
);

test(
  "rejects categoryId with external whitespace",
  () => {
    const payload =
      basePayload();

    payload.categoryIds = [
      " catA",
    ];

    expectThrows(
      () =>
        validateCreateProductInput(
          payload,
        ),
      TypeError,
    );
  },
);

console.log("");
console.log(
  `Tests: ${passed} passed; ${failed} failed`,
);

if (failed > 0) {
  process.exitCode = 1;
}