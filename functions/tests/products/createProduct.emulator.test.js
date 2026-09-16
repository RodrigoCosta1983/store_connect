"use strict";

const assert =
  require("node:assert/strict");

const {
  createHash,
} = require("node:crypto");

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
  "demo-taxonomy-create-backend";

if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId,
  });
}

const {
  createProduct,
} = require(
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

  assert.equal(
    errorCode(caught),
    expectedCode,
  );

  if (expectedReason !== null) {
    assert.equal(
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

function basePayload(
  requestId =
    `request-${Date.now()}-${sequence}`,
) {
  return {
    requestId,

    product: {
      name:
        "  Produto Teste  ",

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

async function seedScenario({
  role = "admin",
  accessStatus = "active",
  createStore = true,
  subscriptionType = "pro",
  subscriptionStatus = "inactive",
  categories = [
    {
      id:
        "catA",

      name:
        "Alpha",
    },
    {
      id:
        "catB",

      name:
        "Beta",
    },
  ],
} = {}) {
  sequence += 1;

  const suffix =
    `${Date.now()}-${process.pid}-${sequence}`;

  const uid =
    `user-${suffix}`;

  const storeId =
    `store-${suffix}`;

  const userRef =
    db.collection("users")
      .doc(uid);

  const storeRef =
    db.collection("stores")
      .doc(storeId);

  await userRef.set({
    storeId,
    role,
    accessStatus,
  });

  if (createStore) {
    await storeRef.set({
      name:
        `Store ${suffix}`,

      subscriptionType,
      subscriptionStatus,
    });

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
        });
    }
  }

  return {
    uid,
    storeId,
    userRef,
    storeRef,
  };
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

async function productDocs(
  scenario,
) {
  const snapshot =
    await scenario.storeRef
      .collection("products")
      .get();

  return snapshot.docs;
}

async function auditDocs(
  scenario,
) {
  const snapshot =
    await scenario.storeRef
      .collection("auditLogs")
      .get();

  return snapshot.docs;
}

function expectedReceiptId(
  scenario,
  requestId,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "createProduct",
        scenario.storeId,
        scenario.uid,
        requestId,
      ]),
      "utf8",
    )
    .digest("hex");
}

(async () => {
  await runTest(
    "unauthenticated is denied",
    async () => {
      await expectError(
        () =>
          createProduct.run({
            data:
              basePayload(
                "unauthenticated",
              ),
          }),
        "unauthenticated",
      );
    },
  );

  await runTest(
    "payload rejects client storeId",
    async () => {
      const scenario =
        await seedScenario();

      const payload =
        basePayload(
          "forbidden-store-id",
        );

      payload.storeId =
        scenario.storeId;

      await expectError(
        () =>
          callCreate(
            scenario,
            payload,
          ),
        "invalid-argument",
      );
    },
  );

  await runTest(
    "missing user profile is denied",
    async () => {
      const fakeScenario = {
        uid:
          `missing-${Date.now()}`,
      };

      await expectError(
        () =>
          callCreate(
            fakeScenario,
            basePayload(
              "missing-profile",
            ),
          ),
        "permission-denied",
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
          callCreate(
            scenario,
            basePayload(
              "missing-store",
            ),
          ),
        "not-found",
      );
    },
  );

  const allowedRoles = [
    [
      "admin",
      "admin",
    ],
    [
      "gerente",
      "gerente",
    ],
    [
      "operador",
      "operador",
    ],
    [
      "caixa",
      "operador",
    ],
    [
      "vendedor",
      "operador",
    ],
  ];

  for (
    const [
      role,
      expectedStoredRole,
    ]
    of allowedRoles
  ) {
    await runTest(
      `${role} can create a normal product`,
      async () => {
        const scenario =
          await seedScenario({
            role,

            subscriptionType:
              "free",

            subscriptionStatus:
              "inactive",
          });

        const payload =
          basePayload(
            `role-${role}`,
          );

        payload.categoryIds = [
          "catA",
        ];

        const result =
          await callCreate(
            scenario,
            payload,
          );

        assert.equal(
          result.success,
          true,
        );

        assert.equal(
          result.replayed,
          false,
        );

        assert.equal(
          typeof result.productId,
          "string",
        );

        const productSnapshot =
          await scenario.storeRef
            .collection("products")
            .doc(result.productId)
            .get();

        assert.equal(
          productSnapshot.exists,
          true,
        );

        const data =
          productSnapshot.data();

        assert.equal(
          data.name,
          "Produto Teste",
        );

        assert.equal(
          data.name_lowercase,
          "produto teste",
        );

        assert.deepEqual(
          data.categoryIds,
          [
            "catA",
          ],
        );

        assert.equal(
          data.categoryId,
          "catA",
        );

        assert.equal(
          data.categoryName,
          "Alpha",
        );

        assert.ok(
          data.createdAt instanceof
            admin.firestore.Timestamp,
        );

        assert.equal(
          Object.prototype.hasOwnProperty.call(
            data,
            "requestId",
          ),
          false,
        );

        const receiptId =
          expectedReceiptId(
            scenario,
            payload.requestId,
          );

        const receiptSnapshot =
          await scenario.storeRef
            .collection("auditLogs")
            .doc(receiptId)
            .get();

        assert.equal(
          receiptSnapshot.exists,
          true,
        );

        const receipt =
          receiptSnapshot.data();

        assert.equal(
          receipt.action,
          "product_created",
        );

        assert.equal(
          receipt.entityType,
          "product",
        );

        assert.equal(
          receipt.entityId,
          result.productId,
        );

        assert.equal(
          receipt.resultId,
          result.productId,
        );

        assert.equal(
          receipt.performedBy.uid,
          scenario.uid,
        );

        assert.equal(
          receipt.performedBy.role,
          expectedStoredRole,
        );

        assert.match(
          receipt.requestHash,
          /^[a-f0-9]{64}$/,
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
          callCreate(
            scenario,
            basePayload(
              "unknown-role",
            ),
          ),
        "permission-denied",
      );

      assert.equal(
        (
          await productDocs(
            scenario,
          )
        ).length,
        0,
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
          callCreate(
            scenario,
            basePayload(
              "revoked-user",
            ),
          ),
        "permission-denied",
      );
    },
  );

  await runTest(
    "non fiscal product does not require active subscription",
    async () => {
      const scenario =
        await seedScenario({
          subscriptionType:
            "free",

          subscriptionStatus:
            "inactive",
        });

      const result =
        await callCreate(
          scenario,
          basePayload(
            "no-subscription-gate",
          ),
        );

      assert.equal(
        result.success,
        true,
      );

      assert.equal(
        result.replayed,
        false,
      );
    },
  );

  await runTest(
    "business active can persist fiscal data with server updatedAt",
    async () => {
      const scenario =
        await seedScenario({
          subscriptionType:
            "business",

          subscriptionStatus:
            "active",
        });

      const payload =
        basePayload(
          "business-fiscal",
        );

      payload.product.fiscal = {
        ncm:
          "12345678",

        origem:
          "0",

        cfop:
          "5102",
      };

      const result =
        await callCreate(
          scenario,
          payload,
        );

      const snapshot =
        await scenario.storeRef
          .collection("products")
          .doc(result.productId)
          .get();

      const data =
        snapshot.data();

      assert.equal(
        data.fiscal.ncm,
        "12345678",
      );

      assert.equal(
        data.fiscal.origem,
        "0",
      );

      assert.equal(
        data.fiscal.cfop,
        "5102",
      );

      assert.ok(
        data.fiscal.updatedAt instanceof
          admin.firestore.Timestamp,
      );
    },
  );

  await runTest(
    "pro active cannot persist fiscal data",
    async () => {
      const scenario =
        await seedScenario({
          subscriptionType:
            "pro",

          subscriptionStatus:
            "active",
        });

      const payload =
        basePayload(
          "pro-fiscal-denied",
        );

      payload.product.fiscal = {
        ncm:
          "12345678",
      };

      await expectError(
        () =>
          callCreate(
            scenario,
            payload,
          ),
        "failed-precondition",
        "fiscal-business-required",
      );

      assert.equal(
        (
          await productDocs(
            scenario,
          )
        ).length,
        0,
      );

      assert.equal(
        (
          await auditDocs(
            scenario,
          )
        ).length,
        0,
      );
    },
  );

  await runTest(
    "business inactive cannot persist fiscal data",
    async () => {
      const scenario =
        await seedScenario({
          subscriptionType:
            "business",

          subscriptionStatus:
            "inactive",
        });

      const payload =
        basePayload(
          "inactive-business-fiscal",
        );

      payload.product.fiscal = {
        ncm:
          "12345678",
      };

      await expectError(
        () =>
          callCreate(
            scenario,
            payload,
          ),
        "failed-precondition",
        "fiscal-business-required",
      );
    },
  );

  await runTest(
    "missing category is rejected atomically",
    async () => {
      const scenario =
        await seedScenario();

      const payload =
        basePayload(
          "missing-category",
        );

      payload.categoryIds = [
        "does-not-exist",
      ];

      await expectError(
        () =>
          callCreate(
            scenario,
            payload,
          ),
        "failed-precondition",
        "category-unavailable",
      );

      assert.equal(
        (
          await productDocs(
            scenario,
          )
        ).length,
        0,
      );

      assert.equal(
        (
          await auditDocs(
            scenario,
          )
        ).length,
        0,
      );
    },
  );

  await runTest(
    "category existing only in another store is rejected",
    async () => {
      const scenario =
        await seedScenario({
          categories:
            [],
        });

      const foreignStore =
        db.collection("stores")
          .doc(
            `foreign-${Date.now()}-${sequence}`,
          );

      await foreignStore.set({
        name:
          "Foreign",
      });

      await foreignStore
        .collection("categories")
        .doc("catForeign")
        .set({
          name:
            "Foreign",
        });

      const payload =
        basePayload(
          "foreign-category",
        );

      payload.categoryIds = [
        "catForeign",
      ];

      await expectError(
        () =>
          callCreate(
            scenario,
            payload,
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

      const payload =
        basePayload(
          "invalid-category-name",
        );

      payload.categoryIds = [
        "catA",
      ];

      await expectError(
        () =>
          callCreate(
            scenario,
            payload,
          ),
        "failed-precondition",
        "invalid-category-data",
      );
    },
  );

  await runTest(
    "empty categoryIds writes explicit canonical empty projection",
    async () => {
      const scenario =
        await seedScenario();

      const payload =
        basePayload(
          "empty-taxonomy",
        );

      const result =
        await callCreate(
          scenario,
          payload,
        );

      const data =
        (
          await scenario.storeRef
            .collection("products")
            .doc(result.productId)
            .get()
        ).data();

      assert.deepEqual(
        data.categoryIds,
        [],
      );

      assert.equal(
        data.categoryId,
        null,
      );

      assert.equal(
        data.categoryName,
        null,
      );

      const receipt =
        (
          await scenario.storeRef
            .collection("auditLogs")
            .doc(
              expectedReceiptId(
                scenario,
                payload.requestId,
              ),
            )
            .get()
        ).data();

      assert.deepEqual(
        receipt.before.categoryIds,
        {
          present:
            false,
        },
      );

      assert.deepEqual(
        receipt.before.categoryId,
        {
          present:
            false,
        },
      );

      assert.deepEqual(
        receipt.before.categoryName,
        {
          present:
            false,
        },
      );

      assert.equal(
        receipt.after.categoryIds.present,
        true,
      );

      assert.deepEqual(
        receipt.after.categoryIds.value,
        [],
      );

      assert.equal(
        receipt.after.categoryId.value,
        null,
      );

      assert.equal(
        receipt.after.categoryName.value,
        null,
      );
    },
  );

  await runTest(
    "category order controls temporary legacy projection",
    async () => {
      const scenario =
        await seedScenario();

      const payload =
        basePayload(
          "ordered-taxonomy",
        );

      payload.categoryIds = [
        "catB",
        "catA",
      ];

      const result =
        await callCreate(
          scenario,
          payload,
        );

      const data =
        (
          await scenario.storeRef
            .collection("products")
            .doc(result.productId)
            .get()
        ).data();

      assert.deepEqual(
        data.categoryIds,
        [
          "catB",
          "catA",
        ],
      );

      assert.equal(
        data.categoryId,
        "catB",
      );

      assert.equal(
        data.categoryName,
        "Beta",
      );
    },
  );

  await runTest(
    "lots are converted from validadeMs to Firestore Timestamp",
    async () => {
      const scenario =
        await seedScenario();

      const firstMs =
        1798761600000;

      const secondMs =
        1801439999000;

      const payload =
        basePayload(
          "lots-conversion",
        );

      payload.product.quantidade =
        5;

      payload.product.lotes = [
        {
          quantidade:
            2,

          validadeMs:
            firstMs,
        },
        {
          quantidade:
            3,

          validadeMs:
            secondMs,
        },
      ];

      const result =
        await callCreate(
          scenario,
          payload,
        );

      const data =
        (
          await scenario.storeRef
            .collection("products")
            .doc(result.productId)
            .get()
        ).data();

      assert.equal(
        data.quantidade,
        5,
      );

      assert.equal(
        data.lotes.length,
        2,
      );

      assert.equal(
        data.lotes[0].quantidade,
        2,
      );

      assert.ok(
        data.lotes[0].validade instanceof
          admin.firestore.Timestamp,
      );

      assert.equal(
        data.lotes[0].validade.toMillis(),
        firstMs,
      );

      assert.equal(
        Object.prototype.hasOwnProperty.call(
          data.lotes[0],
          "validadeMs",
        ),
        false,
      );

      assert.equal(
        data.lotes[1].validade.toMillis(),
        secondMs,
      );
    },
  );

  await runTest(
    "validadeMs outside Firestore range is invalid-argument",
    async () => {
      const scenario =
        await seedScenario();

      const payload =
        basePayload(
          "invalid-firestore-date",
        );

      payload.product.quantidade =
        1;

      payload.product.lotes = [
        {
          quantidade:
            1,

          validadeMs:
            Number.MAX_SAFE_INTEGER,
        },
      ];

      await expectError(
        () =>
          callCreate(
            scenario,
            payload,
          ),
        "invalid-argument",
        "invalid-validade-ms",
      );

      assert.equal(
        (
          await productDocs(
            scenario,
          )
        ).length,
        0,
      );
    },
  );

  await runTest(
    "same requestId and same normalized content replays original product",
    async () => {
      const scenario =
        await seedScenario();

      const payload =
        basePayload(
          "replay-identical",
        );

      payload.product.barcode =
        "  789123  ";

      const first =
        await callCreate(
          scenario,
          payload,
        );

      const replayPayload =
        basePayload(
          "replay-identical",
        );

      replayPayload.product.barcode =
        "789123";

      const second =
        await callCreate(
          scenario,
          replayPayload,
        );

      assert.equal(
        first.replayed,
        false,
      );

      assert.equal(
        second.replayed,
        true,
      );

      assert.equal(
        second.productId,
        first.productId,
      );

      assert.equal(
        (
          await productDocs(
            scenario,
          )
        ).length,
        1,
      );

      assert.equal(
        (
          await auditDocs(
            scenario,
          )
        ).length,
        1,
      );
    },
  );

  await runTest(
    "canonical request hash ignores fiscal object key order",
    async () => {
      const scenario =
        await seedScenario({
          subscriptionType:
            "business",

          subscriptionStatus:
            "active",
        });

      const firstPayload =
        basePayload(
          "canonical-fiscal-order",
        );

      firstPayload.product.fiscal = {
        ncm:
          "12345678",

        origem:
          "0",
      };

      const first =
        await callCreate(
          scenario,
          firstPayload,
        );

      const replayPayload =
        basePayload(
          "canonical-fiscal-order",
        );

      replayPayload.product.fiscal = {
        origem:
          "0",

        ncm:
          "12345678",
      };

      const replay =
        await callCreate(
          scenario,
          replayPayload,
        );

      assert.equal(
        replay.replayed,
        true,
      );

      assert.equal(
        replay.productId,
        first.productId,
      );
    },
  );

  await runTest(
    "same requestId with different content is rejected",
    async () => {
      const scenario =
        await seedScenario();

      const firstPayload =
        basePayload(
          "request-id-reused",
        );

      const first =
        await callCreate(
          scenario,
          firstPayload,
        );

      const changedPayload =
        basePayload(
          "request-id-reused",
        );

      changedPayload.product.price =
        999;

      await expectError(
        () =>
          callCreate(
            scenario,
            changedPayload,
          ),
        "already-exists",
        "request-id-reused",
      );

      const docs =
        await productDocs(
          scenario,
        );

      assert.equal(
        docs.length,
        1,
      );

      assert.equal(
        docs[0].id,
        first.productId,
      );

      assert.equal(
        (
          await auditDocs(
            scenario,
          )
        ).length,
        1,
      );
    },
  );

  await runTest(
    "replay does not recreate a product deleted after original creation",
    async () => {
      const scenario =
        await seedScenario();

      const payload =
        basePayload(
          "deleted-product-replay",
        );

      const first =
        await callCreate(
          scenario,
          payload,
        );

      const productRef =
        scenario.storeRef
          .collection("products")
          .doc(first.productId);

      await productRef.delete();

      const replay =
        await callCreate(
          scenario,
          payload,
        );

      assert.equal(
        replay.replayed,
        true,
      );

      assert.equal(
        replay.productId,
        first.productId,
      );

      assert.equal(
        (
          await productRef.get()
        ).exists,
        false,
      );

      assert.equal(
        (
          await auditDocs(
            scenario,
          )
        ).length,
        1,
      );
    },
  );

  await runTest(
    "replay is resolved before category and fiscal state changes",
    async () => {
      const scenario =
        await seedScenario({
          subscriptionType:
            "business",

          subscriptionStatus:
            "active",
        });

      const payload =
        basePayload(
          "historical-replay",
        );

      payload.product.fiscal = {
        ncm:
          "12345678",
      };

      payload.categoryIds = [
        "catA",
      ];

      const first =
        await callCreate(
          scenario,
          payload,
        );

      await scenario.storeRef.update({
        subscriptionStatus:
          "inactive",
      });

      await scenario.storeRef
        .collection("categories")
        .doc("catA")
        .delete();

      const replay =
        await callCreate(
          scenario,
          payload,
        );

      assert.equal(
        replay.replayed,
        true,
      );

      assert.equal(
        replay.productId,
        first.productId,
      );
    },
  );

  await runTest(
    "authorization is revalidated on replay",
    async () => {
      const scenario =
        await seedScenario();

      const payload =
        basePayload(
          "replay-reauthorize",
        );

      await callCreate(
        scenario,
        payload,
      );

      await scenario.userRef.update({
        accessStatus:
          "revoked",
      });

      await expectError(
        () =>
          callCreate(
            scenario,
            payload,
          ),
        "permission-denied",
      );

      assert.equal(
        (
          await productDocs(
            scenario,
          )
        ).length,
        1,
      );

      assert.equal(
        (
          await auditDocs(
            scenario,
          )
        ).length,
        1,
      );
    },
  );

  await runTest(
    "concurrent identical requests create exactly one product",
    async () => {
      const scenario =
        await seedScenario();

      const payload =
        basePayload(
          "concurrent-replay",
        );

      payload.categoryIds = [
        "catA",
      ];

      const results =
        await Promise.all([
          callCreate(
            scenario,
            payload,
          ),

          callCreate(
            scenario,
            payload,
          ),
        ]);

      assert.equal(
        results.length,
        2,
      );

      assert.equal(
        results[0].productId,
        results[1].productId,
      );

      const replayFlags =
        results
          .map(
            (result) =>
              result.replayed,
          )
          .sort();

      assert.deepEqual(
        replayFlags,
        [
          false,
          true,
        ],
      );

      const products =
        await productDocs(
          scenario,
        );

      assert.equal(
        products.length,
        1,
      );

      assert.equal(
        products[0].id,
        results[0].productId,
      );

      const audits =
        await auditDocs(
          scenario,
        );

      assert.equal(
        audits.length,
        1,
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