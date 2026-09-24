"use strict";

const assert =
  require("node:assert/strict");

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
  "demo-category-hierarchy-backend";

if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId,
  });
}

const {
  upsertCategoryHandler,
} = require(
  "../../categories/upsertCategory",
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

function suffix() {
  sequence += 1;

  return (
    `${Date.now()}-` +
    `${process.pid}-` +
    `${sequence}`
  );
}

async function seedScenario({
  role = "admin",
  accessStatus = "active",
  createUser = true,
  createStore = true,
  categories = [],
} = {}) {
  const id =
    suffix();

  const uid =
    `user-${id}`;

  const storeId =
    `store-${id}`;

  const userRef =
    db.collection("users")
      .doc(uid);

  const storeRef =
    db.collection("stores")
      .doc(storeId);

  if (createUser) {
    await userRef.set({
      storeId,
      role,
      accessStatus,
    });
  }

  if (createStore) {
    await storeRef.set({
      name:
        `Loja ${id}`,
    });
  }

  for (const category of categories) {
    const data = {
      name:
        category.name,

      imageUrl:
        category.imageUrl ?? "",
    };

    if (
      Object.prototype.hasOwnProperty.call(
        category,
        "parentCategoryId",
      )
    ) {
      data.parentCategoryId =
        category.parentCategoryId;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        category,
        "createdAt",
      )
    ) {
      data.createdAt =
        category.createdAt;
    }

    await storeRef
      .collection("categories")
      .doc(category.id)
      .set(data);
  }

  return {
    uid,
    storeId,
    userRef,
    storeRef,
  };
}

function requestFor(
  uid,
  data,
) {
  return {
    auth: {
      uid,
    },
    data,
  };
}

function rootPayload(
  name = "Feminino",
) {
  return {
    name,
    imageUrl: "",
    parentCategoryId: null,
  };
}

async function auditEntries(
  storeRef,
) {
  const snapshot =
    await storeRef
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

async function main() {
  await runTest(
    "01 exige autenticacao",
    async () => {
      await expectError(
        () =>
          upsertCategoryHandler({
            auth: null,
            data:
              rootPayload(),
          }),
        "unauthenticated",
      );
    },
  );

  await runTest(
    "02 rejeita payload sem parentCategoryId",
    async () => {
      const scenario =
        await seedScenario();

      await expectError(
        () =>
          upsertCategoryHandler(
            requestFor(
              scenario.uid,
              {
                name:
                  "Feminino",
                imageUrl:
                  "",
              },
            ),
          ),
        "invalid-argument",
      );
    },
  );

  await runTest(
    "03 rejeita storeId no payload",
    async () => {
      const scenario =
        await seedScenario();

      await expectError(
        () =>
          upsertCategoryHandler(
            requestFor(
              scenario.uid,
              {
                ...rootPayload(),
                storeId:
                  scenario.storeId,
              },
            ),
          ),
        "invalid-argument",
      );
    },
  );

  await runTest(
    "04 exige perfil existente",
    async () => {
      const scenario =
        await seedScenario({
          createUser: false,
        });

      await expectError(
        () =>
          upsertCategoryHandler(
            requestFor(
              scenario.uid,
              rootPayload(),
            ),
          ),
        "permission-denied",
      );
    },
  );

  await runTest(
    "05 bloqueia usuario revogado",
    async () => {
      const scenario =
        await seedScenario({
          accessStatus:
            "revoked",
        });

      await expectError(
        () =>
          upsertCategoryHandler(
            requestFor(
              scenario.uid,
              rootPayload(),
            ),
          ),
        "permission-denied",
      );
    },
  );

  await runTest(
    "06 bloqueia role desconhecida",
    async () => {
      const scenario =
        await seedScenario({
          role:
            "visitante",
        });

      await expectError(
        () =>
          upsertCategoryHandler(
            requestFor(
              scenario.uid,
              rootPayload(),
            ),
          ),
        "permission-denied",
      );
    },
  );

  await runTest(
    "07 exige loja existente",
    async () => {
      const scenario =
        await seedScenario({
          createStore: false,
        });

      await expectError(
        () =>
          upsertCategoryHandler(
            requestFor(
              scenario.uid,
              rootPayload(),
            ),
          ),
        "not-found",
      );
    },
  );

  await runTest(
    "08 cria categoria raiz com ID gerado",
    async () => {
      const scenario =
        await seedScenario();

      const result =
        await upsertCategoryHandler(
          requestFor(
            scenario.uid,
            rootPayload(
              "Feminino",
            ),
          ),
        );

      assert.equal(
        result.success,
        true,
      );

      assert.equal(
        result.mode,
        "create",
      );

      assert.equal(
        result.changed,
        true,
      );

      assert.equal(
        typeof result.categoryId,
        "string",
      );

      assert.ok(
        result.categoryId.length > 0,
      );

      const snapshot =
        await scenario.storeRef
          .collection("categories")
          .doc(result.categoryId)
          .get();

      assert.equal(
        snapshot.exists,
        true,
      );

      const data =
        snapshot.data();

      assert.equal(
        data.name,
        "Feminino",
      );

      assert.equal(
        data.imageUrl,
        "",
      );

      assert.equal(
        data.parentCategoryId,
        null,
      );

      assert.ok(
        data.createdAt,
      );

      const audits =
        await auditEntries(
          scenario.storeRef,
        );

      assert.equal(
        audits.length,
        1,
      );

      assert.equal(
        audits[0].action,
        "category_created",
      );

      assert.equal(
        audits[0].entityId,
        result.categoryId,
      );

      assert.equal(
        audits[0].before,
        null,
      );

      assert.deepEqual(
        audits[0].after,
        {
          name:
            "Feminino",
          imageUrl:
            "",
          parentCategoryId:
            null,
        },
      );
    },
  );

  await runTest(
    "09 categoryId null tambem cria",
    async () => {
      const scenario =
        await seedScenario();

      const result =
        await upsertCategoryHandler(
          requestFor(
            scenario.uid,
            {
              categoryId:
                null,
              name:
                "Masculino",
              imageUrl:
                "",
              parentCategoryId:
                null,
            },
          ),
        );

      assert.equal(
        result.mode,
        "create",
      );

      assert.equal(
        result.changed,
        true,
      );

      const snapshot =
        await scenario.storeRef
          .collection("categories")
          .doc(result.categoryId)
          .get();

      assert.equal(
        snapshot.data()
          .parentCategoryId,
        null,
      );
    },
  );

  await runTest(
    "10 cria subcategoria abaixo de raiz legada",
    async () => {
      const scenario =
        await seedScenario({
          categories: [
            {
              id:
                "cat_root",
              name:
                "Feminino",
              // Deliberadamente sem parentCategoryId.
            },
          ],
        });

      const result =
        await upsertCategoryHandler(
          requestFor(
            scenario.uid,
            {
              name:
                "Perfumes",
              imageUrl:
                "",
              parentCategoryId:
                "cat_root",
            },
          ),
        );

      assert.equal(
        result.mode,
        "create",
      );

      const snapshot =
        await scenario.storeRef
          .collection("categories")
          .doc(result.categoryId)
          .get();

      assert.equal(
        snapshot.data()
          .parentCategoryId,
        "cat_root",
      );
    },
  );

  await runTest(
    "11 bloqueia terceiro nivel",
    async () => {
      const scenario =
        await seedScenario({
          categories: [
            {
              id:
                "root",
              name:
                "Raiz",
              parentCategoryId:
                null,
            },
            {
              id:
                "child",
              name:
                "Filha",
              parentCategoryId:
                "root",
            },
          ],
        });

      await expectError(
        () =>
          upsertCategoryHandler(
            requestFor(
              scenario.uid,
              {
                name:
                  "Neta",
                imageUrl:
                  "",
                parentCategoryId:
                  "child",
              },
            ),
          ),
        "failed-precondition",
        "target-parent-not-root",
      );
    },
  );

  await runTest(
    "12 exige categoria pai existente",
    async () => {
      const scenario =
        await seedScenario();

      await expectError(
        () =>
          upsertCategoryHandler(
            requestFor(
              scenario.uid,
              {
                name:
                  "Perfumes",
                imageUrl:
                  "",
                parentCategoryId:
                  "nao_existe",
              },
            ),
          ),
        "not-found",
        "parent-category-not-found",
      );
    },
  );

  await runTest(
    "13 update exige categoria existente",
    async () => {
      const scenario =
        await seedScenario();

      await expectError(
        () =>
          upsertCategoryHandler(
            requestFor(
              scenario.uid,
              {
                categoryId:
                  "nao_existe",
                name:
                  "Inexistente",
                imageUrl:
                  "",
                parentCategoryId:
                  null,
              },
            ),
          ),
        "not-found",
      );
    },
  );

  await runTest(
    "14 atualiza categoria legada e materializa parentCategoryId null",
    async () => {
      const createdAt =
        admin.firestore.Timestamp.now();

      const scenario =
        await seedScenario({
          categories: [
            {
              id:
                "legacy",
              name:
                "Antigo",
              imageUrl:
                "old.jpg",
              createdAt,
              // Sem parentCategoryId.
            },
          ],
        });

      const result =
        await upsertCategoryHandler(
          requestFor(
            scenario.uid,
            {
              categoryId:
                "legacy",
              name:
                "Novo",
              imageUrl:
                "new.jpg",
              parentCategoryId:
                null,
            },
          ),
        );

      assert.equal(
        result.mode,
        "update",
      );

      assert.equal(
        result.changed,
        true,
      );

      const snapshot =
        await scenario.storeRef
          .collection("categories")
          .doc("legacy")
          .get();

      const data =
        snapshot.data();

      assert.equal(
        data.name,
        "Novo",
      );

      assert.equal(
        data.imageUrl,
        "new.jpg",
      );

      assert.equal(
        data.parentCategoryId,
        null,
      );

      assert.equal(
        data.createdAt.toMillis(),
        createdAt.toMillis(),
      );

      const audits =
        await auditEntries(
          scenario.storeRef,
        );

      assert.equal(
        audits.length,
        1,
      );

      assert.equal(
        audits[0].action,
        "category_updated",
      );

      assert.equal(
        audits[0].before
          .parentCategoryId,
        null,
      );

      assert.equal(
        audits[0].after
          .parentCategoryId,
        null,
      );
    },
  );

  await runTest(
    "15 move subcategoria entre duas raizes",
    async () => {
      const scenario =
        await seedScenario({
          categories: [
            {
              id:
                "root_a",
              name:
                "A",
              parentCategoryId:
                null,
            },
            {
              id:
                "root_b",
              name:
                "B",
              parentCategoryId:
                null,
            },
            {
              id:
                "child",
              name:
                "Perfumes",
              parentCategoryId:
                "root_a",
            },
          ],
        });

      const result =
        await upsertCategoryHandler(
          requestFor(
            scenario.uid,
            {
              categoryId:
                "child",
              name:
                "Perfumes",
              imageUrl:
                "",
              parentCategoryId:
                "root_b",
            },
          ),
        );

      assert.equal(
        result.changed,
        true,
      );

      const snapshot =
        await scenario.storeRef
          .collection("categories")
          .doc("child")
          .get();

      assert.equal(
        snapshot.data()
          .parentCategoryId,
        "root_b",
      );
    },
  );

  await runTest(
    "16 promove subcategoria para raiz",
    async () => {
      const scenario =
        await seedScenario({
          categories: [
            {
              id:
                "root",
              name:
                "Raiz",
              parentCategoryId:
                null,
            },
            {
              id:
                "child",
              name:
                "Filha",
              parentCategoryId:
                "root",
            },
          ],
        });

      await upsertCategoryHandler(
        requestFor(
          scenario.uid,
          {
            categoryId:
              "child",
            name:
              "Filha",
            imageUrl:
              "",
            parentCategoryId:
              null,
          },
        ),
      );

      const snapshot =
        await scenario.storeRef
          .collection("categories")
          .doc("child")
          .get();

      assert.equal(
        snapshot.data()
          .parentCategoryId,
        null,
      );
    },
  );

  await runTest(
    "17 categoria com filhos nao pode virar subcategoria",
    async () => {
      const scenario =
        await seedScenario({
          categories: [
            {
              id:
                "root_a",
              name:
                "A",
              parentCategoryId:
                null,
            },
            {
              id:
                "child",
              name:
                "Filha",
              parentCategoryId:
                "root_a",
            },
            {
              id:
                "root_b",
              name:
                "B",
              parentCategoryId:
                null,
            },
          ],
        });

      await expectError(
        () =>
          upsertCategoryHandler(
            requestFor(
              scenario.uid,
              {
                categoryId:
                  "root_a",
                name:
                  "A",
                imageUrl:
                  "",
                parentCategoryId:
                  "root_b",
              },
            ),
          ),
        "failed-precondition",
        "category-has-children",
      );
    },
  );

  await runTest(
    "18 categoria com filhos pode permanecer raiz",
    async () => {
      const scenario =
        await seedScenario({
          categories: [
            {
              id:
                "root",
              name:
                "Antiga",
              parentCategoryId:
                null,
            },
            {
              id:
                "child",
              name:
                "Filha",
              parentCategoryId:
                "root",
            },
          ],
        });

      const result =
        await upsertCategoryHandler(
          requestFor(
            scenario.uid,
            {
              categoryId:
                "root",
              name:
                "Renomeada",
              imageUrl:
                "",
              parentCategoryId:
                null,
            },
          ),
        );

      assert.equal(
        result.changed,
        true,
      );

      const snapshot =
        await scenario.storeRef
          .collection("categories")
          .doc("root")
          .get();

      assert.equal(
        snapshot.data().name,
        "Renomeada",
      );

      assert.equal(
        snapshot.data()
          .parentCategoryId,
        null,
      );
    },
  );

  await runTest(
    "19 bloqueia auto-parent",
    async () => {
      const scenario =
        await seedScenario({
          categories: [
            {
              id:
                "cat_a",
              name:
                "A",
              parentCategoryId:
                null,
            },
          ],
        });

      await expectError(
        () =>
          upsertCategoryHandler(
            requestFor(
              scenario.uid,
              {
                categoryId:
                  "cat_a",
                name:
                  "A",
                imageUrl:
                  "",
                parentCategoryId:
                  "cat_a",
              },
            ),
          ),
        "invalid-argument",
      );
    },
  );

  await runTest(
    "20 operador pode criar categoria",
    async () => {
      const scenario =
        await seedScenario({
          role:
            "operador",
        });

      const result =
        await upsertCategoryHandler(
          requestFor(
            scenario.uid,
            rootPayload(
              "Operador",
            ),
          ),
        );

      assert.equal(
        result.success,
        true,
      );
    },
  );

  await runTest(
    "21 caixa e normalizado para operador",
    async () => {
      const scenario =
        await seedScenario({
          role:
            "caixa",
        });

      const result =
        await upsertCategoryHandler(
          requestFor(
            scenario.uid,
            rootPayload(
              "Caixa",
            ),
          ),
        );

      assert.equal(
        result.success,
        true,
      );

      const audits =
        await auditEntries(
          scenario.storeRef,
        );

      assert.equal(
        audits.length,
        1,
      );

      assert.equal(
        audits[0].performedBy.role,
        "operador",
      );
    },
  );

  await runTest(
    "22 update identico e idempotente",
    async () => {
      const scenario =
        await seedScenario({
          categories: [
            {
              id:
                "root",
              name:
                "Feminino",
              imageUrl:
                "",
              parentCategoryId:
                null,
            },
          ],
        });

      const result =
        await upsertCategoryHandler(
          requestFor(
            scenario.uid,
            {
              categoryId:
                "root",
              name:
                "Feminino",
              imageUrl:
                "",
              parentCategoryId:
                null,
            },
          ),
        );

      assert.equal(
        result.success,
        true,
      );

      assert.equal(
        result.changed,
        false,
      );

      const audits =
        await auditEntries(
          scenario.storeRef,
        );

      assert.equal(
        audits.length,
        0,
      );
    },
  );

  console.log("");
  console.log(
    "============================================================",
  );

  if (failed === 0) {
    console.log(
      `PASS T2-B1: ${passed} casos de Emulator passaram.`,
    );
    console.log(
      "Nenhuma escrita de producao foi executada.",
    );
    console.log(
      "============================================================",
    );
  } else {
    console.error(
      `FAIL T2-B1: ${failed} falha(s), ${passed} passou/passaram.`,
    );
    console.error(
      "============================================================",
    );

    process.exitCode = 1;
  }
}

main()
  .catch(
    (error) => {
      console.error(
        error?.stack ||
        error,
      );

      process.exitCode = 1;
    },
  );