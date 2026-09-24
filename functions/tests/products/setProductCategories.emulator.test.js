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

        ...(Object.prototype.hasOwnProperty.call(category, "parentCategoryId")
          ? {parentCategoryId: category.parentCategoryId}
          : {}),

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


  // T6-A3-A3: desired tree validation, atomicity and no-op precedence.
  const root = (id, legacy = false) => ({
    id, name: id, ...(legacy ? {} : {parentCategoryId: null}),
  });
  const child = (id, parentCategoryId) => ({id, name: id, parentCategoryId});
  async function collectionState(ref) {
    const snapshot = await ref.orderBy("__name__").get();
    return snapshot.docs.map((doc) => ({
      id: doc.id, data: doc.data(), updateTime: doc.updateTime,
    }));
  }
  async function categoryState(scenario) {
    return collectionState(scenario.storeRef.collection("categories"));
  }
  async function writeState(scenario) {
    const product = await scenario.productRef.get();
    return {
      product: product.data(),
      updateTime: product.updateTime,
      audits: await collectionState(scenario.storeRef.collection("auditLogs")),
    };
  }
  function projection(ids) {
    return {categoryIds: ids, categoryId: ids[0] || null, categoryName: ids[0] || null};
  }
  async function traceCategoryReads(action) {
    const original = db.runTransaction;
    const reads = [];
    db.runTransaction = function(callback, ...options) {
      return original.call(this, async (transaction) => {
        const get = transaction.get.bind(transaction);
        transaction.get = async (ref, ...args) => {
          if (ref.path && ref.path.includes("/categories/")) reads.push(ref.path);
          return get(ref, ...args);
        };
        return callback(transaction);
      }, ...options);
    };
    try {
      return {result: await action(), reads};
    } finally {
      db.runTransaction = original;
    }
  }

  const positives = [
    ["root null", [root("r")], ["r"]],
    ["legacy root", [root("r", true)], ["r"]],
    ["child only null root", [root("r"), child("c", "r")], ["c"]],
    ["child only legacy root", [root("r", true), child("c", "r")], ["c"]],
    ["root child", [root("r"), child("c", "r")], ["r", "c"]],
    ["child root", [root("r"), child("c", "r")], ["c", "r"]],
    ["independent roots", [root("a"), root("b")], ["a", "b"]],
    ["independent children", [root("a"), root("b"), child("c", "a"), child("d", "b")], ["c", "d"]],
    ["rootA childB", [root("a"), root("b"), child("d", "b")], ["a", "d"]],
    ["empty", [], []],
    ["ten children ten roots",
      Array.from({length: 10}, (_, i) => [root("r" + i), child("c" + i, "r" + i)]).flat(),
      Array.from({length: 10}, (_, i) => "c" + i)],
    ["shared parent", [root("r"), child("a", "r"), child("b", "r"), child("c", "r")], ["a", "b", "c"]],
    ["explicit parent reused", [root("r"), child("a", "r"), child("b", "r")], ["a", "r", "b"]],
  ];

  positives.push(["archived product", [root("r"), child("c", "r")], ["c"], true]);
  for (const [name, categories, ids, isArchived = false] of positives) {
    await runTest("tree valid: " + name, async () => {
      const scenario = await seedScenario({categories, isArchived});
      const before = await categoryState(scenario);
      const {result, reads} = await traceCategoryReads(() => callSetCategories(scenario, ids));
      assert.strictEqual(result.changed, true);
      assert.deepStrictEqual(
        (await scenario.productRef.get()).data(),
        {...scenario.productData, ...projection(ids)},
      );
      assert.strictEqual((await auditEntries(scenario)).length, 1);
      const expectedIds = new Set(ids);
      for (const id of ids) {
        const parent = categories.find((category) => category.id === id).parentCategoryId;
        if (parent != null) expectedIds.add(parent);
      }
      assert.deepStrictEqual([...reads].sort(), [...expectedIds].map(
        (id) => scenario.storeRef.collection("categories").doc(id).path,
      ).sort());
      assert.deepStrictEqual(await categoryState(scenario), before);
    });
  }
  const negatives = [
    ["missing parent", [child("c", "missing")], ["c"]],
    ["third level", [root("r"), child("p", "r"), child("c", "p")], ["c"]],
    ["self parent", [child("c", "c")], ["c"]],
    ["two node cycle", [child("c", "p"), child("p", "c")], ["c", "p"]],
    ["malformed parent document", [child("c", "p"), child("p", 123)], ["c"]],
    ["later invalid category", [root("r"), child("c", "missing")], ["r", "c"]],
    ...[
      ["number", 1], ["boolean", true], ["array", []], ["map", {}],
      ["empty", ""], ["whitespace", " \t\r\n"], ["external whitespace", " r "],
      ["slash", "r/other"],
    ].map(([name, value]) => [name, [child("c", value)], ["c"]]),
  ];

  for (const [name, categories, ids] of negatives) {
    await runTest("tree invalid atomic: " + name, async () => {
      const scenario = await seedScenario({categories});
      const before = await writeState(scenario);
      const categoriesBefore = await categoryState(scenario);
      await expectError(() => callSetCategories(scenario, ids),
        "failed-precondition", "invalid-category-hierarchy");
      assert.deepStrictEqual(await writeState(scenario), before);
      assert.deepStrictEqual(await categoryState(scenario), categoriesBefore);
    });
  }
  for (const localState of ["absent", "invalid", "valid"]) {
    await runTest("tree parent same ID store isolation: " + localState, async () => {
      const categories = [child("c", "p")];
      if (localState === "invalid") categories.push(child("p", "missing"));
      if (localState === "valid") categories.push(root("p"));
      const scenario = await seedScenario({categories});
      const foreign = await seedScenario({
        categories: [localState === "valid" ? child("p", "missing") : root("p")],
      });
      const before = await writeState(scenario);
      const categoriesBefore = await categoryState(scenario);
      const foreignBefore = await categoryState(foreign);
      const foreignWrites = await writeState(foreign);
      if (localState === "valid") {
        const result = await callSetCategories(scenario, ["c"]);
        assert.strictEqual(result.changed, true);
        assert.deepStrictEqual((await scenario.productRef.get()).data(),
          {...scenario.productData, ...projection(["c"])});
        assert.strictEqual((await auditEntries(scenario)).length, 1);
      } else {
        await expectError(() => callSetCategories(scenario, ["c"]),
          "failed-precondition", "invalid-category-hierarchy");
        assert.deepStrictEqual(await writeState(scenario), before);
      }
      assert.deepStrictEqual(await categoryState(scenario), categoriesBefore);
      assert.deepStrictEqual(await categoryState(foreign), foreignBefore);
      assert.deepStrictEqual(await writeState(foreign), foreignWrites);
    });
  }
  for (const oldState of ["removed", "corrupt"]) {
    for (const desired of [[], ["r"], ["c"]]) {
      await runTest("repair old " + oldState + " to " + JSON.stringify(desired), async () => {
        const scenario = await seedScenario({
          categories: [root("old"), root("r"), child("c", "r")],
          productTaxonomy: projection(["old"]),
        });
        const oldRef = scenario.storeRef.collection("categories").doc("old");
        if (oldState === "removed") await oldRef.delete();
        else await oldRef.update({parentCategoryId: 123});
        const before = await categoryState(scenario);
        const {result, reads} = await traceCategoryReads(
          () => callSetCategories(scenario, desired),
        );
        assert.strictEqual(result.changed, true);
        assert.ok(!reads.includes(oldRef.path));
        assert.deepStrictEqual((await scenario.productRef.get()).data(),
          {...scenario.productData, ...projection(desired)});
        assert.strictEqual((await auditEntries(scenario)).length, 1);
        assert.deepStrictEqual(await categoryState(scenario), before);
      });
    }
  }
  for (const corrupt of [false, true]) {
    for (const staleExpected of [false, true]) {
      await runTest("tree no-op corrupt=" + corrupt + " staleExpected=" + staleExpected, async () => {
        const scenario = await seedScenario({
          categories: [corrupt ? child("r", "missing") : root("r"), child("c", "r")],
          productTaxonomy: projection(["c"]),
        });
        const before = await writeState(scenario);
        const categoriesBefore = await categoryState(scenario);
        const expected = staleExpected ? {} : projection(["c"]);
        if (corrupt) {
          await expectError(() => callSetCategories(scenario, ["c"], expected),
            "failed-precondition", "invalid-category-hierarchy");
        } else {
          const result = await callSetCategories(scenario, ["c"], expected);
          assert.strictEqual(result.changed, false);
        }
        assert.deepStrictEqual(await writeState(scenario), before);
        assert.deepStrictEqual(await categoryState(scenario), categoriesBefore);
        assert.strictEqual((await auditEntries(scenario)).length, 0);
      });
    }
  }


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
