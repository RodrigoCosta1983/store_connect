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
  "demo-taxonomy-delete-backend";

if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId,
  });
}

const {
  deleteCategory,
} =
  require(
    "../../categories/deleteCategory",
  );

const {
  setProductCategories,
} =
  require(
    "../../products/setProductCategories",
  );

const {
  createProduct,
} =
  require(
    "../../products/createProduct",
  );

const db =
  admin.firestore();

let passed = 0;
let failed = 0;
let sequence = 0;

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

function uniqueSuffix() {
  sequence += 1;

  return (
    `${Date.now()}-` +
    `${process.pid}-` +
    `${sequence}`
  );
}

function baseProductData(
  overrides = {},
) {
  return {
    name:
      "Produto Teste",

    name_lowercase:
      "produto teste",

    price:
      10,

    quantidade:
      1,

    minimumStock:
      0,

    lotes:
      [],

    imageUrl:
      "",

    createdAt:
      admin.firestore
        .FieldValue
        .serverTimestamp(),

    ...overrides,
  };
}

function createPayload(
  requestId,
  categoryId,
) {
  return {
    requestId,

    product: {
      name:
        "Produto Concorrente",

      price:
        10,

      quantidade:
        1,

      lotes:
        [],

      minimumStock:
        0,

      imageUrl:
        "",
    },

    categoryIds: [
      categoryId,
    ],
  };
}

async function seedScenario({
  role = "admin",
  accessStatus = "active",
  createStore = true,
  createCategory = true,
  categoryData = {},
  productData = null,
} = {}) {
  const suffix =
    uniqueSuffix();

  const uid =
    `user-${suffix}`;

  const storeId =
    `store-${suffix}`;

  const categoryId =
    `category-${suffix}`;

  const productId =
    `product-${suffix}`;

  const userRef =
    db.collection("users")
      .doc(uid);

  const storeRef =
    db.collection("stores")
      .doc(storeId);

  const categoryRef =
    storeRef
      .collection("categories")
      .doc(categoryId);

  const productRef =
    storeRef
      .collection("products")
      .doc(productId);

  await userRef.set({
    storeId,
    role,
    accessStatus,
  });

  if (createStore) {
    await storeRef.set({
      name:
        `Store ${suffix}`,

      subscriptionType:
        "free",

      subscriptionStatus:
        "inactive",
    });
  }

  if (
    createStore &&
    createCategory
  ) {
    await categoryRef.set({
      name:
        "Alpha",

      imageUrl:
        "https://example.invalid/category.png",

      createdAt:
        admin.firestore
          .FieldValue
          .serverTimestamp(),

      ...categoryData,
    });
  }

  if (
    createStore &&
    productData !== null
  ) {
    await productRef.set(
      productData,
    );
  }

  return {
    uid,
    storeId,
    categoryId,
    productId,
    userRef,
    storeRef,
    categoryRef,
    productRef,
  };
}

async function callDelete(
  scenario,
  payload = null,
) {
  return await deleteCategory.run({
    auth: {
      uid:
        scenario.uid,
    },

    data:
      payload || {
        categoryId:
          scenario.categoryId,
      },
  });
}

async function callSetCategories(
  scenario,
  categoryIds,
  expectedTaxonomy = {},
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

async function callCreate(
  scenario,
  payload,
) {
  return await createProduct.run({
    auth: {
      uid:
        scenario.uid,
    },

    data:
      payload,
  });
}

async function auditEntries(
  scenario,
) {
  const snapshot =
    await scenario.storeRef
      .collection("auditLogs")
      .get();

  return snapshot.docs.map(
    (doc) => ({
      id:
        doc.id,

      ...doc.data(),
    }),
  );
}

async function productEntries(
  scenario,
) {
  const snapshot =
    await scenario.storeRef
      .collection("products")
      .get();

  return snapshot.docs;
}

function fulfilledCount(
  results,
) {
  return results.filter(
    (result) =>
      result.status === "fulfilled",
  ).length;
}

function rejectedCount(
  results,
) {
  return results.filter(
    (result) =>
      result.status === "rejected",
  ).length;
}

function rejectionCodes(
  results,
) {
  return results
    .filter(
      (result) =>
        result.status === "rejected",
    )
    .map(
      (result) =>
        errorCode(
          result.reason,
        ),
    );
}

(async () => {

  // ============================================================
  // AUTH / PAYLOAD
  // ============================================================

  await runTest(
    "unauthenticated is denied",
    async () => {
      await expectError(
        () =>
          deleteCategory.run({
            data: {
              categoryId:
                "category-x",
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
          deleteCategory.run({
            auth: {
              uid:
                "irrelevant-user",
            },

            data: {
              categoryId:
                "category-x",

              storeId:
                "evil-store",
            },
          }),
        "invalid-argument",
      );
    },
  );

  await runTest(
    "payload rejects external whitespace",
    async () => {
      await expectError(
        () =>
          deleteCategory.run({
            auth: {
              uid:
                "irrelevant-user",
            },

            data: {
              categoryId:
                " category-x",
            },
          }),
        "invalid-argument",
      );
    },
  );

  await runTest(
    "missing user profile is denied",
    async () => {
      const scenario = {
        uid:
          `missing-${uniqueSuffix()}`,

        categoryId:
          "category-x",
      };

      await expectError(
        () =>
          callDelete(
            scenario,
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
          callDelete(
            scenario,
          ),
        "permission-denied",
      );

      assert.strictEqual(
        (
          await scenario
            .categoryRef
            .get()
        ).exists,
        true,
      );
    },
  );

  await runTest(
    "unknown role is denied",
    async () => {
      const scenario =
        await seedScenario({
          role:
            "unknown",
        });

      await expectError(
        () =>
          callDelete(
            scenario,
          ),
        "permission-denied",
      );
    },
  );

  for (
    const role
    of [
      "operador",
      "caixa",
      "vendedor",
    ]
  ) {
    await runTest(
      `${role} cannot delete category`,
      async () => {
        const scenario =
          await seedScenario({
            role,
          });

        await expectError(
          () =>
            callDelete(
              scenario,
            ),
          "permission-denied",
        );

        assert.strictEqual(
          (
            await scenario
              .categoryRef
              .get()
          ).exists,
          true,
        );
      },
    );
  }

  for (
    const role
    of [
      "admin",
      "gerente",
    ]
  ) {
    await runTest(
      `${role} can delete unused category`,
      async () => {
        const scenario =
          await seedScenario({
            role,
          });

        const result =
          await callDelete(
            scenario,
          );

        assert.strictEqual(
          result.success,
          true,
        );

        assert.strictEqual(
          result.deleted,
          true,
        );

        assert.strictEqual(
          result.categoryId,
          scenario.categoryId,
        );

        assert.strictEqual(
          (
            await scenario
              .categoryRef
              .get()
          ).exists,
          false,
        );
      },
    );
  }

  await runTest(
    "delete does not require active subscription",
    async () => {
      const scenario =
        await seedScenario();

      const result =
        await callDelete(
          scenario,
        );

      assert.strictEqual(
        result.success,
        true,
      );

      assert.strictEqual(
        (
          await scenario
            .categoryRef
            .get()
        ).exists,
        false,
      );
    },
  );

  await runTest(
    "missing store returns not-found",
    async () => {
      const scenario =
        await seedScenario({
          createStore:
            false,
        });

      await expectError(
        () =>
          callDelete(
            scenario,
          ),
        "not-found",
      );
    },
  );

  await runTest(
    "missing category returns category-not-found",
    async () => {
      const scenario =
        await seedScenario({
          createCategory:
            false,
        });

      await expectError(
        () =>
          callDelete(
            scenario,
          ),
        "not-found",
        "category-not-found",
      );
    },
  );

  // ============================================================
  // REFERENCIA CANONICA
  // ============================================================

  await runTest(
    "canonical categoryIds blocks deletion",
    async () => {
      const scenario =
        await seedScenario();

      await scenario.productRef.set(
        baseProductData({
          categoryIds: [
            scenario.categoryId,
          ],

          categoryId:
            scenario.categoryId,

          categoryName:
            "Alpha",
        }),
      );

      await expectError(
        () =>
          callDelete(
            scenario,
          ),
        "failed-precondition",
        "category-in-use",
      );

      assert.strictEqual(
        (
          await scenario
            .categoryRef
            .get()
        ).exists,
        true,
      );
    },
  );

  await runTest(
    "archived canonical product also blocks deletion",
    async () => {
      const scenario =
        await seedScenario();

      await scenario.productRef.set(
        baseProductData({
          isArchived:
            true,

          categoryIds: [
            scenario.categoryId,
          ],

          categoryId:
            scenario.categoryId,

          categoryName:
            "Alpha",
        }),
      );

      await expectError(
        () =>
          callDelete(
            scenario,
          ),
        "failed-precondition",
        "category-in-use",
      );
    },
  );

  // ============================================================
  // REFERENCIA LEGADA
  // ============================================================

  await runTest(
    "legacy categoryId blocks deletion",
    async () => {
      const scenario =
        await seedScenario();

      await scenario.productRef.set(
        baseProductData({
          categoryId:
            scenario.categoryId,

          categoryName:
            "Alpha",
        }),
      );

      await expectError(
        () =>
          callDelete(
            scenario,
          ),
        "failed-precondition",
        "category-in-use",
      );
    },
  );

  await runTest(
    "archived legacy product also blocks deletion",
    async () => {
      const scenario =
        await seedScenario();

      await scenario.productRef.set(
        baseProductData({
          isArchived:
            true,

          categoryId:
            scenario.categoryId,

          categoryName:
            "Alpha",
        }),
      );

      await expectError(
        () =>
          callDelete(
            scenario,
          ),
        "failed-precondition",
        "category-in-use",
      );
    },
  );

  await runTest(
    "stale legacy categoryId still blocks deletion",
    async () => {
      const scenario =
        await seedScenario();

      await scenario.productRef.set(
        baseProductData({
          categoryIds: [
            "other-category",
          ],

          categoryId:
            scenario.categoryId,

          categoryName:
            "Alpha",
        }),
      );

      await expectError(
        () =>
          callDelete(
            scenario,
          ),
        "failed-precondition",
        "category-in-use",
      );

      assert.strictEqual(
        (
          await scenario
            .categoryRef
            .get()
        ).exists,
        true,
      );
    },
  );

  // ============================================================
  // categoryName NAO E IDENTIDADE
  // ============================================================

  await runTest(
    "categoryName alone is not an identity reference",
    async () => {
      const scenario =
        await seedScenario();

      await scenario.productRef.set(
        baseProductData({
          categoryName:
            "Alpha",
        }),
      );

      const result =
        await callDelete(
          scenario,
        );

      assert.strictEqual(
        result.success,
        true,
      );

      assert.strictEqual(
        (
          await scenario
            .categoryRef
            .get()
        ).exists,
        false,
      );
    },
  );

  await runTest(
    "unrelated category reference does not block deletion",
    async () => {
      const scenario =
        await seedScenario();

      await scenario.productRef.set(
        baseProductData({
          categoryIds: [
            "other-category",
          ],

          categoryId:
            "other-category",

          categoryName:
            "Other",
        }),
      );

      const result =
        await callDelete(
          scenario,
        );

      assert.strictEqual(
        result.success,
        true,
      );
    },
  );

  // ============================================================
  // AUDIT
  // ============================================================

  await runTest(
    "successful delete writes exactly one category_deleted audit",
    async () => {
      const scenario =
        await seedScenario();

      await callDelete(
        scenario,
      );

      const audits =
        await auditEntries(
          scenario,
        );

      assert.strictEqual(
        audits.length,
        1,
      );

      const audit =
        audits[0];

      assert.strictEqual(
        audit.action,
        "category_deleted",
      );

      assert.strictEqual(
        audit.entityType,
        "category",
      );

      assert.strictEqual(
        audit.entityId,
        scenario.categoryId,
      );

      assert.strictEqual(
        audit.storeId,
        scenario.storeId,
      );

      assert.strictEqual(
        audit.performedBy.uid,
        scenario.uid,
      );

      assert.strictEqual(
        audit.performedBy.role,
        "admin",
      );

      assert.strictEqual(
        audit.before.name,
        "Alpha",
      );

      assert.strictEqual(
        audit.before.imageUrl,
        "https://example.invalid/category.png",
      );

      assert.ok(
        audit.before.createdAt,
      );

      assert.strictEqual(
        audit.after,
        null,
      );

      assert.ok(
        audit.createdAt,
      );
    },
  );

  await runTest(
    "blocked delete writes no audit",
    async () => {
      const scenario =
        await seedScenario();

      await scenario.productRef.set(
        baseProductData({
          categoryId:
            scenario.categoryId,
        }),
      );

      await expectError(
        () =>
          callDelete(
            scenario,
          ),
        "failed-precondition",
        "category-in-use",
      );

      const audits =
        await auditEntries(
          scenario,
        );

      assert.strictEqual(
        audits.length,
        0,
      );

      assert.strictEqual(
        (
          await scenario
            .categoryRef
            .get()
        ).exists,
        true,
      );
    },
  );

  // ============================================================
  // CORRIDA:
  // deleteCategory x setProductCategories
  // ============================================================

  await runTest(
    "delete races safely with setProductCategories",
    async () => {
      const scenario =
        await seedScenario();

      await scenario.productRef.set(
        baseProductData(),
      );

      const results =
        await Promise.allSettled([
          callDelete(
            scenario,
          ),

          callSetCategories(
            scenario,
            [
              scenario.categoryId,
            ],
            {},
          ),
        ]);

      assert.strictEqual(
        fulfilledCount(results),
        1,
      );

      assert.strictEqual(
        rejectedCount(results),
        1,
      );

      const categoryExists =
        (
          await scenario
            .categoryRef
            .get()
        ).exists;

      const freshProduct =
        (
          await scenario
            .productRef
            .get()
        ).data();

      const audits =
        await auditEntries(
          scenario,
        );

      if (categoryExists) {
        assert.deepStrictEqual(
          freshProduct.categoryIds,
          [
            scenario.categoryId,
          ],
        );

        assert.strictEqual(
          audits.filter(
            (audit) =>
              audit.action ===
              "product_categories_changed",
          ).length,
          1,
        );

        assert.strictEqual(
          audits.filter(
            (audit) =>
              audit.action ===
              "category_deleted",
          ).length,
          0,
        );
      } else {
        assert.strictEqual(
          Object.prototype
            .hasOwnProperty.call(
              freshProduct,
              "categoryIds",
            ),
          false,
        );

        assert.strictEqual(
          audits.filter(
            (audit) =>
              audit.action ===
              "category_deleted",
          ).length,
          1,
        );

        assert.strictEqual(
          audits.filter(
            (audit) =>
              audit.action ===
              "product_categories_changed",
          ).length,
          0,
        );
      }
    },
  );

  // ============================================================
  // CORRIDA:
  // deleteCategory x createProduct
  // ============================================================

  await runTest(
    "delete races safely with createProduct",
    async () => {
      const scenario =
        await seedScenario();

      const requestId =
        `race-create-${uniqueSuffix()}`;

      const results =
        await Promise.allSettled([
          callDelete(
            scenario,
          ),

          callCreate(
            scenario,
            createPayload(
              requestId,
              scenario.categoryId,
            ),
          ),
        ]);

      assert.strictEqual(
        fulfilledCount(results),
        1,
      );

      assert.strictEqual(
        rejectedCount(results),
        1,
      );

      const categoryExists =
        (
          await scenario
            .categoryRef
            .get()
        ).exists;

      const products =
        await productEntries(
          scenario,
        );

      const audits =
        await auditEntries(
          scenario,
        );

      if (categoryExists) {
        assert.strictEqual(
          products.length,
          1,
        );

        assert.deepStrictEqual(
          products[0]
            .data()
            .categoryIds,
          [
            scenario.categoryId,
          ],
        );

        assert.strictEqual(
          audits.filter(
            (audit) =>
              audit.action ===
              "product_created",
          ).length,
          1,
        );

        assert.strictEqual(
          audits.filter(
            (audit) =>
              audit.action ===
              "category_deleted",
          ).length,
          0,
        );
      } else {
        assert.strictEqual(
          products.length,
          0,
        );

        assert.strictEqual(
          audits.filter(
            (audit) =>
              audit.action ===
              "category_deleted",
          ).length,
          1,
        );

        assert.strictEqual(
          audits.filter(
            (audit) =>
              audit.action ===
              "product_created",
          ).length,
          0,
        );
      }
    },
  );

  // ============================================================
  // CORRIDA:
  // deleteCategory x deleteCategory
  // ============================================================

  await runTest(
    "concurrent duplicate deletes create one audit only",
    async () => {
      const scenario =
        await seedScenario();

      const results =
        await Promise.allSettled([
          callDelete(
            scenario,
          ),

          callDelete(
            scenario,
          ),
        ]);

      assert.strictEqual(
        fulfilledCount(results),
        1,
      );

      assert.strictEqual(
        rejectedCount(results),
        1,
      );

      assert.ok(
        rejectionCodes(
          results,
        ).includes(
          "not-found",
        ),
      );

      assert.strictEqual(
        (
          await scenario
            .categoryRef
            .get()
        ).exists,
        false,
      );

      const audits =
        await auditEntries(
          scenario,
        );

      assert.strictEqual(
        audits.filter(
          (audit) =>
            audit.action ===
            "category_deleted",
        ).length,
        1,
      );
    },
  );

  console.log("");
  console.log(
    `Tests: ${passed} passed; ${failed} failed`,
  );

  try {
    await admin.app().delete();
  } catch (_) {
    // Nada.
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
})();