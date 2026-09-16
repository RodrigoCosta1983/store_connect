"use strict";

const assert =
  require("assert");

const admin =
  require("firebase-admin");

const emulatorHost =
  String(
    process.env.FIRESTORE_EMULATOR_HOST ||
    "",
  );

if (
  !/^(127\.0\.0\.1|localhost):\d+$/.test(
    emulatorHost,
  )
) {
  throw new Error(
    "Este teste exige Firestore Emulator local.",
  );
}

const projectId =
  process.env.GCLOUD_PROJECT ||
  "demo-taxonomy-backend";

if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId,
  });
}

const {
  setProductCategories,
} =
  require(
    "../../products/setProductCategories",
  );

const db =
  admin.firestore();

let passed = 0;
let failed = 0;
let sequence = 0;

function ownTaxonomy(data) {
  const result = {};

  for (
    const field of [
      "categoryIds",
      "categoryId",
      "categoryName",
    ]
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        data,
        field,
      )
    ) {
      result[field] =
        data[field];
    }
  }

  return result;
}

function errorCode(error) {
  return String(
    error?.code || "",
  ).replace(
    /^functions\//,
    "",
  );
}

async function expectError(
  action,
  expectedCode,
  expectedReason = null,
) {
  let caught = null;

  try {
    await action();
  } catch (error) {
    caught = error;
  }

  assert.ok(
    caught,
    `Expected ${expectedCode}, but call succeeded`,
  );

  assert.strictEqual(
    errorCode(caught),
    expectedCode,
  );

  if (expectedReason !== null) {
    assert.strictEqual(
      caught.details?.reason,
      expectedReason,
    );
  }

  return caught;
}

async function runTest(
  name,
  callback,
) {
  try {
    await callback();

    passed += 1;
    console.log(`PASS ${name}`);
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

async function seedScenario({
  role = "admin",
  accessStatus = "active",
  productTaxonomy = {},
  isArchived = false,
  categories = [
    {
      id: "catA",
      name: "Alpha",
    },
    {
      id: "catB",
      name: "Beta",
    },
  ],
  subscriptionStatus = "inactive",
} = {}) {
  sequence += 1;

  const suffix =
    `${Date.now()}-${process.pid}-${sequence}`;

  const uid =
    `user-${suffix}`;

  const storeId =
    `store-${suffix}`;

  const productId =
    `product-${suffix}`;

  const userRef =
    db.collection("users")
      .doc(uid);

  const storeRef =
    db.collection("stores")
      .doc(storeId);

  const productRef =
    storeRef
      .collection("products")
      .doc(productId);

  await userRef.set({
    storeId,
    role,
    accessStatus,
  });

  await storeRef.set({
    name:
      `Store ${suffix}`,

    ownerId:
      `owner-${suffix}`,

    subscriptionStatus,
  });

  const productData = {
    name:
      "Produto Teste",

    name_lowercase:
      "produto teste",

    price:
      19.9,

    quantidade:
      17,

    minimumStock:
      3,

    lotes: [
      {
        quantidade:
          17,
      },
    ],

    isArchived,

    ...productTaxonomy,
  };

  await productRef.set(
    productData,
  );

  for (
    const category
    of categories
  ) {
    await storeRef
      .collection("categories")
      .doc(category.id)
      .set({
        name:
          category.name,

        imageUrl:
          "",

        createdAt:
          admin.firestore
            .FieldValue
            .serverTimestamp(),
      });
  }

  return {
    uid,
    storeId,
    productId,
    userRef,
    storeRef,
    productRef,
    productData,
  };
}

async function callSetCategories(
  scenario,
  categoryIds,
  expectedTaxonomy =
    ownTaxonomy(
      scenario.productData,
    ),
) {
  return await setProductCategories.run({
    auth: {
      uid:
        scenario.uid,
    },

    data: {
      productId:
        scenario.productId,

      categoryIds,

      expectedTaxonomy,
    },
  });
}

async function auditEntries(
  scenario,
) {
  const snapshot =
    await scenario.storeRef
      .collection("auditLogs")
      .get();

  return snapshot.docs
    .map(
      (doc) =>
        doc.data(),
    )
    .filter(
      (data) =>
        data.action ===
        "product_categories_changed",
    );
}

(async () => {
  await runTest(
    "unauthenticated is denied",
    async () => {
      await expectError(
        () =>
          setProductCategories.run({
            data: {
              productId:
                "product-x",

              categoryIds:
                [],

              expectedTaxonomy:
                {},
            },
          }),
        "unauthenticated",
      );
    },
  );

  await runTest(
    "payload rejects client storeId",
    async () => {
      await expectError(
        () =>
          setProductCategories.run({
            auth: {
              uid:
                "irrelevant-user",
            },

            data: {
              productId:
                "product-x",

              categoryIds:
                [],

              expectedTaxonomy:
                {},

              storeId:
                "evil-store",
            },
          }),
        "invalid-argument",
      );
    },
  );

  await runTest(
    "categoryIds validation runs before persistence",
    async () => {
      await expectError(
        () =>
          setProductCategories.run({
            auth: {
              uid:
                "irrelevant-user",
            },

            data: {
              productId:
                "product-x",

              categoryIds:
                Array.from(
                  {
                    length:
                      11,
                  },
                  (_, index) =>
                    `cat-${index}`,
                ),

              expectedTaxonomy:
                {},
            },
          }),
        "invalid-argument",
      );
    },
  );

  await runTest(
    "missing user profile is denied",
    async () => {
      await expectError(
        () =>
          setProductCategories.run({
            auth: {
              uid:
                `missing-${Date.now()}`,
            },

            data: {
              productId:
                "product-x",

              categoryIds:
                [],

              expectedTaxonomy:
                {},
            },
          }),
        "permission-denied",
      );
    },
  );

  for (
    const role
    of [
      "admin",
      "gerente",
      "operador",
      "caixa",
      "vendedor",
    ]
  ) {
    await runTest(
      `${role} can change taxonomy`,
      async () => {
        const scenario =
          await seedScenario({
            role,

            productTaxonomy: {
              categoryId:
                "catA",

              categoryName:
                "Alpha",
            },
          });

        const result =
          await callSetCategories(
            scenario,
            [
              "catA",
              "catB",
            ],
          );

        assert.strictEqual(
          result.success,
          true,
        );

        assert.strictEqual(
          result.changed,
          true,
        );

        assert.deepStrictEqual(
          result.categoryIds,
          [
            "catA",
            "catB",
          ],
        );

        assert.strictEqual(
          result.categoryId,
          "catA",
        );

        assert.strictEqual(
          result.categoryName,
          "Alpha",
        );

        const fresh =
          (
            await scenario
              .productRef
              .get()
          ).data();

        assert.deepStrictEqual(
          fresh.categoryIds,
          [
            "catA",
            "catB",
          ],
        );

        assert.strictEqual(
          fresh.price,
          19.9,
        );

        assert.strictEqual(
          fresh.quantidade,
          17,
        );

        assert.strictEqual(
          fresh.isArchived,
          false,
        );

        const store =
          (
            await scenario
              .storeRef
              .get()
          ).data();

        assert.strictEqual(
          store.subscriptionStatus,
          "inactive",
        );
      },
    );
  }

  await runTest(
    "unknown role is denied",
    async () => {
      const scenario =
        await seedScenario({
          role:
            "desconhecido",
        });

      await expectError(
        () =>
          callSetCategories(
            scenario,
            [],
          ),
        "permission-denied",
      );
    },
  );

  await runTest(
    "revoked user is denied",
    async () => {
      const scenario =
        await seedScenario({
          accessStatus:
            "revoked",
        });

      await expectError(
        () =>
          callSetCategories(
            scenario,
            [],
          ),
        "permission-denied",
      );
    },
  );

  await runTest(
    "missing product returns not-found",
    async () => {
      const scenario =
        await seedScenario();

      scenario.productId =
        "produto-inexistente";

      await expectError(
        () =>
          callSetCategories(
            scenario,
            [],
          ),
        "not-found",
      );
    },
  );

  await runTest(
    "missing category is rejected",
    async () => {
      const scenario =
        await seedScenario();

      await expectError(
        () =>
          callSetCategories(
            scenario,
            [
              "nao-existe",
            ],
          ),
        "failed-precondition",
        "category-unavailable",
      );
    },
  );

  await runTest(
    "category existing only in another store is not accepted",
    async () => {
      const scenario =
        await seedScenario({
          categories:
            [],
        });

      const foreignStoreId =
        `foreign-${Date.now()}-${sequence}`;

      await db
        .collection("stores")
        .doc(foreignStoreId)
        .collection("categories")
        .doc("catForeign")
        .set({
          name:
            "Foreign",
        });

      await expectError(
        () =>
          callSetCategories(
            scenario,
            [
              "catForeign",
            ],
          ),
        "failed-precondition",
        "category-unavailable",
      );
    },
  );

  await runTest(
    "invalid canonical category name is rejected",
    async () => {
      const scenario =
        await seedScenario({
          categories: [
            {
              id:
                "catA",

              name:
                "   ",
            },
          ],
        });

      await expectError(
        () =>
          callSetCategories(
            scenario,
            [
              "catA",
            ],
          ),
        "failed-precondition",
        "invalid-category-data",
      );
    },
  );

  await runTest(
    "empty array clears legacy projection explicitly",
    async () => {
      const scenario =
        await seedScenario({
          productTaxonomy: {
            categoryId:
              "catA",

            categoryName:
              "Alpha",
          },
        });

      const result =
        await callSetCategories(
          scenario,
          [],
        );

      assert.strictEqual(
        result.changed,
        true,
      );

      assert.deepStrictEqual(
        result.categoryIds,
        [],
      );

      assert.strictEqual(
        result.categoryId,
        null,
      );

      assert.strictEqual(
        result.categoryName,
        null,
      );

      const fresh =
        (
          await scenario
            .productRef
            .get()
        ).data();

      assert.deepStrictEqual(
        fresh.categoryIds,
        [],
      );

      assert.strictEqual(
        fresh.categoryId,
        null,
      );

      assert.strictEqual(
        fresh.categoryName,
        null,
      );
    },
  );

  await runTest(
    "first category defines temporary legacy projection",
    async () => {
      const scenario =
        await seedScenario({
          productTaxonomy: {
            categoryId:
              null,

            categoryName:
              null,
          },
        });

      const result =
        await callSetCategories(
          scenario,
          [
            "catB",
            "catA",
          ],
        );

      assert.deepStrictEqual(
        result.categoryIds,
        [
          "catB",
          "catA",
        ],
      );

      assert.strictEqual(
        result.categoryId,
        "catB",
      );

      assert.strictEqual(
        result.categoryName,
        "Beta",
      );
    },
  );

  await runTest(
    "already desired state is idempotent and creates no audit",
    async () => {
      const scenario =
        await seedScenario({
          productTaxonomy: {
            categoryIds: [
              "catA",
              "catB",
            ],

            categoryId:
              "catA",

            categoryName:
              "Alpha",
          },
        });

      const result =
        await callSetCategories(
          scenario,
          [
            "catA",
            "catB",
          ],
        );

      assert.strictEqual(
        result.changed,
        false,
      );

      const logs =
        await auditEntries(
          scenario,
        );

      assert.strictEqual(
        logs.length,
        0,
      );
    },
  );

  await runTest(
    "stale expectedTaxonomy causes taxonomy-conflict",
    async () => {
      const scenario =
        await seedScenario({
          productTaxonomy: {
            categoryIds: [
              "catA",
            ],

            categoryId:
              "catA",

            categoryName:
              "Alpha",
          },
        });

      await expectError(
        () =>
          callSetCategories(
            scenario,
            [
              "catB",
            ],
            {},
          ),
        "aborted",
        "taxonomy-conflict",
      );

      const fresh =
        (
          await scenario
            .productRef
            .get()
        ).data();

      assert.deepStrictEqual(
        fresh.categoryIds,
        [
          "catA",
        ],
      );

      const logs =
        await auditEntries(
          scenario,
        );

      assert.strictEqual(
        logs.length,
        0,
      );
    },
  );

  await runTest(
    "presence of null differs from absence in expectedTaxonomy",
    async () => {
      const scenario =
        await seedScenario({
          productTaxonomy: {
            categoryId:
              null,

            categoryName:
              null,
          },
        });

      await expectError(
        () =>
          callSetCategories(
            scenario,
            [],
            {},
          ),
        "aborted",
        "taxonomy-conflict",
      );
    },
  );

  await runTest(
    "archived product can change categories without being restored",
    async () => {
      const scenario =
        await seedScenario({
          isArchived:
            true,

          productTaxonomy: {
            categoryIds: [
              "catA",
            ],

            categoryId:
              "catA",

            categoryName:
              "Alpha",
          },
        });

      const result =
        await callSetCategories(
          scenario,
          [
            "catB",
          ],
        );

      assert.strictEqual(
        result.changed,
        true,
      );

      const fresh =
        (
          await scenario
            .productRef
            .get()
        ).data();

      assert.strictEqual(
        fresh.isArchived,
        true,
      );

      assert.strictEqual(
        fresh.quantidade,
        17,
      );

      assert.strictEqual(
        fresh.price,
        19.9,
      );

      assert.deepStrictEqual(
        fresh.categoryIds,
        [
          "catB",
        ],
      );

      assert.strictEqual(
        fresh.categoryId,
        "catB",
      );

      assert.strictEqual(
        fresh.categoryName,
        "Beta",
      );
    },
  );

  await runTest(
    "successful change writes minimal audit preserving legacy absence",
    async () => {
      const scenario =
        await seedScenario({
          productTaxonomy: {
            categoryId:
              "catA",

            categoryName:
              "Alpha",
          },
        });

      await callSetCategories(
        scenario,
        [
          "catA",
          "catB",
        ],
      );

      const logs =
        await auditEntries(
          scenario,
        );

      assert.strictEqual(
        logs.length,
        1,
      );

      const log =
        logs[0];

      assert.strictEqual(
        log.entityType,
        "product",
      );

      assert.strictEqual(
        log.entityId,
        scenario.productId,
      );

      assert.strictEqual(
        log.storeId,
        scenario.storeId,
      );

      assert.strictEqual(
        log.performedBy.uid,
        scenario.uid,
      );

      assert.deepStrictEqual(
        log.before.categoryIds,
        {
          present:
            false,
        },
      );

      assert.strictEqual(
        log.before.categoryId.present,
        true,
      );

      assert.strictEqual(
        log.before.categoryId.value,
        "catA",
      );

      assert.strictEqual(
        log.after.categoryIds.present,
        true,
      );

      assert.deepStrictEqual(
        log.after.categoryIds.value,
        [
          "catA",
          "catB",
        ],
      );
    },
  );

  await runTest(
    "concurrent taxonomy edits serialize and one conflicts",
    async () => {
      const scenario =
        await seedScenario({
          productTaxonomy: {
            categoryIds: [
              "catA",
            ],

            categoryId:
              "catA",

            categoryName:
              "Alpha",
          },
        });

      const expectedTaxonomy = {
        categoryIds: [
          "catA",
        ],

        categoryId:
          "catA",

        categoryName:
          "Alpha",
      };

      const results =
        await Promise.allSettled([
          callSetCategories(
            scenario,
            [
              "catB",
            ],
            expectedTaxonomy,
          ),

          callSetCategories(
            scenario,
            [],
            expectedTaxonomy,
          ),
        ]);

      const fulfilled =
        results.filter(
          (result) =>
            result.status ===
            "fulfilled",
        );

      const rejected =
        results.filter(
          (result) =>
            result.status ===
            "rejected",
        );

      assert.strictEqual(
        fulfilled.length,
        1,
      );

      assert.strictEqual(
        rejected.length,
        1,
      );

      assert.strictEqual(
        fulfilled[0].value.changed,
        true,
      );

      assert.strictEqual(
        errorCode(
          rejected[0].reason,
        ),
        "aborted",
      );

      assert.strictEqual(
        rejected[0]
          .reason
          .details
          ?.reason,
        "taxonomy-conflict",
      );

      const fresh =
        (
          await scenario
            .productRef
            .get()
        ).data();

      const endedWithCatB =
        Array.isArray(
          fresh.categoryIds,
        ) &&
        fresh.categoryIds.length === 1 &&
        fresh.categoryIds[0] ===
          "catB";

      const endedEmpty =
        Array.isArray(
          fresh.categoryIds,
        ) &&
        fresh.categoryIds.length === 0;

      assert.ok(
        endedWithCatB ||
        endedEmpty,
      );

      const logs =
        await auditEntries(
          scenario,
        );

      assert.strictEqual(
        logs.length,
        1,
      );
    },
  );

  await runTest(
    "invalid current categoryIds is not repaired automatically",
    async () => {
      const scenario =
        await seedScenario({
          productTaxonomy: {
            categoryIds:
              "corrompido",

            categoryId:
              "catA",

            categoryName:
              "Alpha",
          },
        });

      await expectError(
        () =>
          callSetCategories(
            scenario,
            [
              "catA",
            ],
            {
              categoryId:
                "catA",

              categoryName:
                "Alpha",
            },
          ),
        "failed-precondition",
        "invalid-current-taxonomy",
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
})().catch(
  (error) => {
    console.error(
      error?.stack ||
      error,
    );

    process.exitCode = 1;
  },
);
