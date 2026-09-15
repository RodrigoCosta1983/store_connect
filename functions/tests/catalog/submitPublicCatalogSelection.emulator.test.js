"use strict";

const assert = require("assert");
const crypto = require("crypto");
const admin = require("firebase-admin");

const {
  submitPublicCatalogSelection,
} = require("../../catalog/createCatalog");

const EXPECTED_FIRESTORE_HOST = "127.0.0.1:8080";
const PROJECT_ID = "store-connect-app";

function assertEmulatorEnvironment() {
  const firestoreHost = String(
      process.env.FIRESTORE_EMULATOR_HOST || "",
  ).trim();

  if (firestoreHost !== EXPECTED_FIRESTORE_HOST) {
    throw new Error(
        "SEGURANÇA: este teste só pode executar no Firestore Emulator. " +
        `Esperado ${EXPECTED_FIRESTORE_HOST}; atual "${firestoreHost}".`,
    );
  }
}

function initializeFirebase() {
  if (admin.apps.length === 0) {
    admin.initializeApp({
      projectId: PROJECT_ID,
    });
  }

  return admin.firestore();
}

function sha256(value) {
  return crypto
      .createHash("sha256")
      .update(value, "utf8")
      .digest("hex");
}

async function expectHttpsError(
    action,
    expectedCode,
    expectedReason = null,
    expectedAvailableQuantity = undefined,
) {
  let receivedError = null;

  try {
    await action();
  } catch (error) {
    receivedError = error;
  }

  assert(
      receivedError,
      `Era esperado erro ${expectedCode}.`,
  );

  assert.strictEqual(
      receivedError.code,
      expectedCode,
  );

  if (expectedReason !== null) {
    assert.strictEqual(
        receivedError.details?.reason,
        expectedReason,
    );
  }

  if (expectedAvailableQuantity !== undefined) {
    assert.strictEqual(
        receivedError.details?.availableQuantity,
        expectedAvailableQuantity,
    );
  }

  return receivedError;
}

async function run() {
  assertEmulatorEnvironment();

  const db = initializeFirebase();

  const suffix =
    `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  const storeId =
    `submit-store-${suffix}`;

  const catalogId =
    `submit-catalog-${suffix}`;

  const publicSlug =
    `loja-submit-${suffix}`.toLowerCase();

  const publicToken =
    crypto.randomBytes(32).toString("base64url");

  const publicTokenHash =
    sha256(publicToken);

  const activeProductId =
    `active-product-${suffix}`;

  const archivedProductId =
    `archived-product-${suffix}`;

  const zeroStockProductId =
    `zero-stock-product-${suffix}`;

  const missingProductId =
    `missing-product-${suffix}`;

  const outsideProductId =
    `outside-product-${suffix}`;

  console.log("");
  console.log("============================================================");
  console.log("F7.7-D — SUBMIT PUBLIC CATALOG SELECTION / TESTE FUNCIONAL");
  console.log("============================================================");

  const storeRef = db
      .collection("stores")
      .doc(storeId);

  const catalogRef = storeRef
      .collection("catalogs")
      .doc(catalogId);

  const productsRef =
    storeRef.collection("products");

  // ========================================================================
  // 1. FIXTURES
  // ========================================================================

  await storeRef.set({
    name: "Loja Submit Teste",
    publicSlug,
    subscriptionStatus: "active",
  });

  await productsRef
      .doc(activeProductId)
      .set({
        name: "Produto Ativo",
        price: 49.90,
        quantidade: 7,
        isArchived: false,
      });

  await productsRef
      .doc(archivedProductId)
      .set({
        name: "Produto Arquivado",
        price: 99.90,
        quantidade: 5,
        isArchived: true,
      });

  await productsRef
      .doc(zeroStockProductId)
      .set({
        name: "Produto Sem Estoque",
        price: 10,
        quantidade: 0,
        isArchived: false,
      });

  await productsRef
      .doc(outsideProductId)
      .set({
        name: "Produto Fora do Catálogo",
        price: 30,
        quantidade: 3,
        isArchived: false,
      });

  const futureExpiration =
    admin.firestore.Timestamp.fromMillis(
        Date.now() + (7 * 24 * 60 * 60 * 1000),
    );

  await catalogRef.set({
    status: "active",
    title: "Catálogo Submit Teste",
    expiresAt: futureExpiration,
    publicTokenHash,
    productCount: 4,
  });

  const catalogProductIds = [
    activeProductId,
    archivedProductId,
    zeroStockProductId,
    missingProductId,
  ];

  for (
    let index = 0;
    index < catalogProductIds.length;
    index += 1
  ) {
    await catalogRef
        .collection("items")
        .doc(`item-${index}`)
        .set({
          productId: catalogProductIds[index],
          position: index,
          addedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        });
  }

  await db
      .collection("catalogPublicTokens")
      .doc(publicTokenHash)
      .set({
        storeId,
        catalogId,
        createdAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });

  // ========================================================================
  // 2. HAPPY PATH
  // ========================================================================

  const validResult =
    await submitPublicCatalogSelection.run({
      data: {
        publicSlug,
        publicToken,
        items: [
          {
            productId: activeProductId,
            quantity: 2,
          },
        ],
      },
    });

  assert.deepStrictEqual(
      validResult,
      {
        success: true,
        requestId: validResult.requestId,
        validatedItemCount: 1,
        totalUnits: 2,
        totalAmount: 99.8,
      },
  );

  const activeAfterValidation =
    await productsRef
        .doc(activeProductId)
        .get();

  assert.strictEqual(
      activeAfterValidation.data().quantidade,
      7,
  );

  console.log("✅ Seleção válida aceita");
  console.log("✅ Estoque não foi decrementado");

  // ========================================================================
  // 3. ITEMS VAZIO
  // ========================================================================

  await expectHttpsError(
      () => submitPublicCatalogSelection.run({
        data: {
          publicSlug,
          publicToken,
          items: [],
        },
      }),
      "invalid-argument",
  );

  console.log("✅ Seleção vazia rejeitada");

  // ========================================================================
  // 4. MAIS DE 200 ITENS
  // ========================================================================

  const tooManyItems =
    Array.from(
        {length: 201},
        (_, index) => ({
          productId:
            `bulk-${index}-${suffix}`,
          quantity: 1,
        }),
    );

  await expectHttpsError(
      () => submitPublicCatalogSelection.run({
        data: {
          publicSlug,
          publicToken,
          items: tooManyItems,
        },
      }),
      "invalid-argument",
  );

  console.log("✅ Seleção acima de MAX_PRODUCTS rejeitada");

  // ========================================================================
  // 5. QUANTIDADES INVALIDAS
  // ========================================================================

  for (const invalidQuantity of [0, -1, 1.5]) {
    await expectHttpsError(
        () => submitPublicCatalogSelection.run({
          data: {
            publicSlug,
            publicToken,
            items: [
              {
                productId: activeProductId,
                quantity: invalidQuantity,
              },
            ],
          },
        }),
        "invalid-argument",
    );
  }

  console.log("✅ Quantidades zero, negativa e decimal rejeitadas");

  // ========================================================================
  // 6. PRODUTO DUPLICADO
  // ========================================================================

  await expectHttpsError(
      () => submitPublicCatalogSelection.run({
        data: {
          publicSlug,
          publicToken,
          items: [
            {
              productId: activeProductId,
              quantity: 1,
            },
            {
              productId: activeProductId,
              quantity: 2,
            },
          ],
        },
      }),
      "invalid-argument",
  );

  console.log("✅ Produto duplicado rejeitado");

  // ========================================================================
  // 7. TOKEN MALFORMADO
  // ========================================================================

  await expectHttpsError(
      () => submitPublicCatalogSelection.run({
        data: {
          publicSlug,
          publicToken: "token-invalido",
          items: [
            {
              productId: activeProductId,
              quantity: 1,
            },
          ],
        },
      }),
      "invalid-argument",
  );

  console.log("✅ Token malformado rejeitado");

  // ========================================================================
  // 8. TOKEN INEXISTENTE
  // ========================================================================

  const unknownToken =
    crypto.randomBytes(32).toString("base64url");

  await expectHttpsError(
      () => submitPublicCatalogSelection.run({
        data: {
          publicSlug,
          publicToken: unknownToken,
          items: [
            {
              productId: activeProductId,
              quantity: 1,
            },
          ],
        },
      }),
      "not-found",
  );

  console.log("✅ Token inexistente rejeitado");

  // ========================================================================
  // 9. SLUG INCOMPATIVEL
  // ========================================================================

  await expectHttpsError(
      () => submitPublicCatalogSelection.run({
        data: {
          publicSlug:
            `outra-loja-${suffix}`,
          publicToken,
          items: [
            {
              productId: activeProductId,
              quantity: 1,
            },
          ],
        },
      }),
      "not-found",
  );

  console.log("✅ Slug incompatível rejeitado");

  // ========================================================================
  // 10. PRODUTO FORA DO CATALOGO
  // ========================================================================

  await expectHttpsError(
      () => submitPublicCatalogSelection.run({
        data: {
          publicSlug,
          publicToken,
          items: [
            {
              productId: outsideProductId,
              quantity: 1,
            },
          ],
        },
      }),
      "failed-precondition",
      "product-not-in-catalog",
  );

  console.log("✅ Produto fora do catálogo rejeitado");

  // ========================================================================
  // 11. PRODUTO ARQUIVADO
  // ========================================================================

  await expectHttpsError(
      () => submitPublicCatalogSelection.run({
        data: {
          publicSlug,
          publicToken,
          items: [
            {
              productId: archivedProductId,
              quantity: 1,
            },
          ],
        },
      }),
      "failed-precondition",
      "product-archived",
      0,
  );

  console.log("✅ Produto arquivado rejeitado");

  // ========================================================================
  // 12. PRODUTO REMOVIDO DA LOJA
  // ========================================================================

  await expectHttpsError(
      () => submitPublicCatalogSelection.run({
        data: {
          publicSlug,
          publicToken,
          items: [
            {
              productId: missingProductId,
              quantity: 1,
            },
          ],
        },
      }),
      "failed-precondition",
      "product-unavailable",
      0,
  );

  console.log("✅ Produto removido da loja rejeitado");

  // ========================================================================
  // 13. ESTOQUE ZERO
  // ========================================================================

  await expectHttpsError(
      () => submitPublicCatalogSelection.run({
        data: {
          publicSlug,
          publicToken,
          items: [
            {
              productId: zeroStockProductId,
              quantity: 1,
            },
          ],
        },
      }),
      "failed-precondition",
      "insufficient-stock",
      0,
  );

  console.log("✅ Produto sem estoque rejeitado");

  // ========================================================================
  // 14. QUANTIDADE ACIMA DO ESTOQUE
  // ========================================================================

  await expectHttpsError(
      () => submitPublicCatalogSelection.run({
        data: {
          publicSlug,
          publicToken,
          items: [
            {
              productId: activeProductId,
              quantity: 8,
            },
          ],
        },
      }),
      "failed-precondition",
      "insufficient-stock",
      7,
  );

  console.log("✅ Quantidade acima do estoque rejeitada");
  console.log("✅ Disponibilidade atual retornada no erro");

  // ========================================================================
  // 15. CATALOGO EXPIRADO
  // ========================================================================

  await catalogRef.update({
    expiresAt:
      admin.firestore.Timestamp.fromMillis(
          Date.now() - 1000,
      ),
  });

  await expectHttpsError(
      () => submitPublicCatalogSelection.run({
        data: {
          publicSlug,
          publicToken,
          items: [
            {
              productId: activeProductId,
              quantity: 1,
            },
          ],
        },
      }),
      "failed-precondition",
  );

  await catalogRef.update({
    expiresAt: futureExpiration,
  });

  console.log("✅ Catálogo expirado bloqueado");

  // ========================================================================
  // 16. CATALOGO INATIVO
  // ========================================================================

  await catalogRef.update({
    status: "inactive",
  });

  await expectHttpsError(
      () => submitPublicCatalogSelection.run({
        data: {
          publicSlug,
          publicToken,
          items: [
            {
              productId: activeProductId,
              quantity: 1,
            },
          ],
        },
      }),
      "failed-precondition",
  );

  await catalogRef.update({
    status: "active",
  });

  console.log("✅ Catálogo inativo bloqueado");

  // ========================================================================
  // 17. LOJA SEM ASSINATURA VALIDA
  // ========================================================================

  await storeRef.update({
    subscriptionStatus: "inactive",
  });

  await expectHttpsError(
      () => submitPublicCatalogSelection.run({
        data: {
          publicSlug,
          publicToken,
          items: [
            {
              productId: activeProductId,
              quantity: 1,
            },
          ],
        },
      }),
      "failed-precondition",
  );

  await storeRef.update({
    subscriptionStatus: "active",
  });

  console.log("✅ Loja sem assinatura válida bloqueada");

  // ========================================================================
  // 18. GARANTIA FINAL DE NAO MUTACAO
  // ========================================================================

  const finalProduct =
    await productsRef
        .doc(activeProductId)
        .get();

  assert.strictEqual(
      finalProduct.data().quantidade,
      7,
  );


  const requestsRef = storeRef.collection("catalogRequests");
  assert.strictEqual((await requestsRef.get()).size, 1);
  assert.strictEqual((await storeRef.collection("sales").get()).size, 0);
  const savedRef = requestsRef.doc(validResult.requestId);
  const saved = (await savedRef.get()).data();
  assert.deepStrictEqual(Object.keys(saved).sort(), [
    "catalogId", "createdAt", "itemCount", "source", "status",
    "totalAmount", "totalUnits", "updatedAt",
  ].sort());
  assert.strictEqual(saved.catalogId, catalogId);
  assert.strictEqual(saved.status, "pending");
  assert.strictEqual(saved.source, "public_catalog");
  assert.strictEqual(saved.itemCount, 1);
  assert.strictEqual(saved.totalUnits, 2);
  assert.strictEqual(saved.totalAmount, 99.8);
  assert(saved.createdAt instanceof admin.firestore.Timestamp);
  assert(saved.createdAt.isEqual(saved.updatedAt));
  assert.deepStrictEqual(
      (await savedRef.collection("items").get()).docs.map((doc) => doc.data()),
      [{
        productId: activeProductId, name: "Produto Ativo",
        quantity: 2, price: 49.9, subtotal: 99.8,
      }],
  );
  const submit = (items, extra = {}) => submitPublicCatalogSelection.run({
    data: {publicSlug, publicToken, items, ...extra},
  });

  // Dados atuais do servidor prevalecem sobre campos forjados.
  await productsRef.doc(activeProductId).update({
    name: "Nome Atual", price: 0.1, quantidade: 10,
  });
  await productsRef.doc(zeroStockProductId).update({
    price: 0.2, quantidade: 10,
  });
  const forgedItems = [
    {
      productId: activeProductId, quantity: 3,
      name: "Forjado", price: 999, subtotal: 999,
      imageUrl: "https://invalid.example/image", quantidade: 999,
    },
    {productId: zeroStockProductId, quantity: 1, price: 999},
  ];
  const fresh = await submit(forgedItems, {
    storeId: "forged-store", catalogId: "forged-catalog", totalAmount: 999,
  });
  assert.strictEqual(fresh.totalAmount, 0.5);
  assert.strictEqual(fresh.totalUnits, 4);
  const freshItems = (await requestsRef.doc(fresh.requestId)
      .collection("items").get()).docs.map((doc) => doc.data());
  assert.deepStrictEqual(
      freshItems.find((item) => item.productId === activeProductId),
      {
        productId: activeProductId, name: "Nome Atual",
        quantity: 3, price: 0.1, subtotal: 0.3,
      },
  );
  assert.strictEqual((await savedRef.get()).data().totalAmount, 99.8);
  const repeated = await submit(forgedItems);
  assert.notStrictEqual(repeated.requestId, fresh.requestId);

  // Falha em item posterior nao pode persistir solicitacao parcial.
  const countBeforeFailures = (await requestsRef.get()).size;
  await expectHttpsError(
      () => submit([
        {productId: activeProductId, quantity: 1},
        {productId: archivedProductId, quantity: 1},
      ]),
      "failed-precondition", "product-archived", 0,
  );
  for (const price of [-1, NaN, Infinity, null, "12.00", 1e20]) {
    await productsRef.doc(activeProductId).update({price});
    await expectHttpsError(
        () => submit([{productId: activeProductId, quantity: 1}]),
        "failed-precondition", "invalid-product-data",
    );
  }
  await productsRef.doc(activeProductId).update({
    price: admin.firestore.FieldValue.delete(),
  });
  await expectHttpsError(
      () => submit([{productId: activeProductId, quantity: 1}]),
      "failed-precondition", "invalid-product-data",
  );
  await productsRef.doc(activeProductId).update({price: 1, name: " "});
  await expectHttpsError(
      () => submit([{productId: activeProductId, quantity: 1}]),
      "failed-precondition", "invalid-product-data",
  );
  await expectHttpsError(
      () => submit([{productId: activeProductId, quantity: 2 ** 53}]),
      "invalid-argument",
  );
  assert.strictEqual((await requestsRef.get()).size, countBeforeFailures);

  // Zero explicito e arredondamento monetario existente.
  await productsRef.doc(activeProductId).update({price: 0, name: "Atual"});
  assert.strictEqual((await submit([
    {productId: activeProductId, quantity: 1},
  ])).totalAmount, 0);
  await productsRef.doc(activeProductId).update({price: 1.236});
  assert.strictEqual((await submit([
    {productId: activeProductId, quantity: 3},
  ])).totalAmount, 3.72);


  // Limites numericos: subtotal e soma nao podem exceder inteiros seguros.
  await productsRef.doc(activeProductId).update({
    price: 50000000000000, quantidade: 10,
  });
  await expectHttpsError(
      () => submit([{productId: activeProductId, quantity: 2}]),
      "failed-precondition", "invalid-product-data",
  );
  await productsRef.doc(zeroStockProductId).update({price: 50000000000000});
  await expectHttpsError(
      () => submit([
        {productId: activeProductId, quantity: 1},
        {productId: zeroStockProductId, quantity: 1},
      ]),
      "failed-precondition", "invalid-product-data",
  );
  await productsRef.doc(activeProductId).update({price: 1});
  await productsRef.doc(zeroStockProductId).update({price: 1});

  // Falha real de precondicao no Emulator: o batch inteiro deve reverter.
  // Adiciona create de documento existente ao mesmo batch da funcao.
  const originalBatch = db.batch;
  const beforeAtomicFailure = (await requestsRef.get()).size;
  const beforeItemFailure = (await db.collectionGroup("items").get()).size;
  db.batch = function() {
    const batch = originalBatch.call(this);
    batch.create(storeRef, {shouldNeverPersist: true});
    return batch;
  };
  try {
    await assert.rejects(
        () => submit([{productId: activeProductId, quantity: 1}]),
        (error) => error.code === 6,
    );
  } finally {
    db.batch = originalBatch;
  }
  assert.strictEqual((await requestsRef.get()).size, beforeAtomicFailure);
  assert.strictEqual((await db.collectionGroup("items").get()).size,
      beforeItemFailure);
  assert.strictEqual((await storeRef.get()).data().shouldNeverPersist, undefined);

  // Limite oficial: 200 itens, 201 documentos atomicos.
  const fixtures = db.batch();
  const bulkItems = [];
  for (let i = 0; i < 200; i += 1) {
    const productId = "bulk-valid-" + i + "-" + suffix;
    fixtures.set(productsRef.doc(productId), {
      name: "Produto " + i, price: 0.01, quantidade: 1,
    });
    fixtures.set(catalogRef.collection("items").doc("bulk-" + i), {productId});
    bulkItems.push({productId, quantity: 1});
  }
  await fixtures.commit();
  const bulk = await submit(bulkItems);
  assert.strictEqual(bulk.validatedItemCount, 200);
  assert.strictEqual(bulk.totalUnits, 200);
  assert.strictEqual(bulk.totalAmount, 2);
  assert.strictEqual((await requestsRef.doc(bulk.requestId)
      .collection("items").get()).size, 200);
  assert.strictEqual((await productsRef.doc(activeProductId).get())
      .data().quantidade, 10);
  assert.strictEqual((await storeRef.collection("sales").get()).size, 0);
  const allRequests = await requestsRef.get();
  for (const doc of allRequests.docs) {
    assert.strictEqual((await doc.ref.collection("items").get()).size,
        doc.data().itemCount);
    assert(!JSON.stringify(doc.data()).includes(publicToken));
  }
  console.log("Persistencia F7.7-D: snapshot, totais e limite OK");

  const finalCatalog =
    await catalogRef.get();

  assert.strictEqual(
      finalCatalog.data().status,
      "active",
  );

  console.log("Estoque preservado em todos os envios");
  console.log("✅ Catálogo restaurado para ativo");

  console.log("");
  console.log("============================================================");
  console.log("✅ F7.7-D SUBMIT PUBLIC CATALOG SELECTION PASSOU");
  console.log("============================================================");
  console.log("");
}

run().catch((error) => {
  console.error("");
  console.error(
      "❌ F7.7-D SUBMIT PUBLIC CATALOG SELECTION FALHOU",
  );
  console.error(error);
  process.exit(1);
});