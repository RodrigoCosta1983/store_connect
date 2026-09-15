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
  console.log("F7.7-C2 — SUBMIT PUBLIC CATALOG SELECTION / TESTE FUNCIONAL");
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
        validatedItemCount: 1,
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

  const finalCatalog =
    await catalogRef.get();

  assert.strictEqual(
      finalCatalog.data().status,
      "active",
  );

  console.log("✅ Estoque permaneceu 7");
  console.log("✅ Catálogo restaurado para ativo");

  console.log("");
  console.log("============================================================");
  console.log("✅ F7.7-C2 SUBMIT PUBLIC CATALOG SELECTION PASSOU");
  console.log("============================================================");
  console.log("");
}

run().catch((error) => {
  console.error("");
  console.error(
      "❌ F7.7-C2 SUBMIT PUBLIC CATALOG SELECTION FALHOU",
  );
  console.error(error);
  process.exit(1);
});