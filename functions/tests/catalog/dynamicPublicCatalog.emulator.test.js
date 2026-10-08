"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const admin = require("firebase-admin");

const {
  getPublicCatalog,
  submitPublicCatalogSelection,
} = require("../../catalog/createCatalog");

const EXPECTED_FIRESTORE_HOST =
  "127.0.0.1:8080";

function hashToken(token) {
  return crypto
      .createHash("sha256")
      .update(token, "utf8")
      .digest("hex");
}

async function expectHttpsError(
    action,
    expectedCode,
    expectedReason,
) {
  try {
    await action();
    assert.fail(
        "Era esperado um HttpsError.",
    );
  } catch (error) {
    assert.equal(
        error.code,
        expectedCode,
    );

    if (expectedReason) {
      assert.equal(
          error.details?.reason,
          expectedReason,
      );
    }
  }
}

function productIds(section) {
  return section.products
      .map((product) => product.productId)
      .sort();
}

async function run() {
  assert.equal(
      process.env.FIRESTORE_EMULATOR_HOST,
      EXPECTED_FIRESTORE_HOST,
      "Este teste exige o Firestore Emulator local.",
  );

  admin.initializeApp({
    projectId: "store-connect-app",
  });

  const db = admin.firestore();

  const suffix = `${Date.now()}`;

  const storeId =
    `dynamic-store-${suffix}`;

  const catalogId =
    "dynamic-catalog";

  const publicSlug =
    `dynamic-${suffix}`;

  const publicToken =
    `DynamicToken_${suffix}_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`;

  const publicTokenHash =
    hashToken(publicToken);

  const storeRef =
    db.collection("stores").doc(storeId);

  const productsRef =
    storeRef.collection("products");

  const catalogRef =
    storeRef
        .collection("catalogs")
        .doc(catalogId);

  const tokenIndexRef =
    db.collection("catalogPublicTokens")
        .doc(publicTokenHash);

  const mainProductId =
    `00-main-${suffix}`;

  const suggestionProductId =
    `10-suggestion-${suffix}`;

  const canonicalOfferId =
    `20-offer-canonical-${suffix}`;

  const legacyOfferId =
    `30-offer-legacy-${suffix}`;

  const overlapProductId =
    `40-overlap-${suffix}`;

  const archivedOfferId =
    `50-archived-${suffix}`;

  const zeroStockOfferId =
    `60-zero-${suffix}`;

  const canonicalWinsId =
    `70-canonical-wins-${suffix}`;

  const outsideProductId =
    `80-outside-${suffix}`;

  const futureExpiration =
    admin.firestore.Timestamp.fromMillis(
        Date.now() +
        (7 * 24 * 60 * 60 * 1000),
    );

  const submit = (items) =>
    submitPublicCatalogSelection.run({
      data: {
        publicSlug,
        publicToken,
        items,
      },
    });

  try {
    await storeRef.set({
      name: "Loja Dinâmica Teste",
      publicSlug,
      subscriptionStatus: "active",
    });

    await productsRef.doc(mainProductId).set({
      name: "Principal",
      price: 10,
      quantidade: 10,
      isArchived: false,
      categoryIds: ["promo"],
    });

    await productsRef.doc(
        suggestionProductId,
    ).set({
      name: "Sugestão",
      price: 11,
      quantidade: 5,
      isArchived: false,
      categoryIds: ["suggestion"],
    });

    await productsRef.doc(
        canonicalOfferId,
    ).set({
      name: "Oferta Canônica",
      price: 12,
      quantidade: 4,
      isArchived: false,
      categoryIds: ["promo"],
    });

    await productsRef.doc(
        legacyOfferId,
    ).set({
      name: "Oferta Legada",
      price: 13,
      quantidade: 3,
      isArchived: false,
      categoryId: "promo",
    });

    await productsRef.doc(
        overlapProductId,
    ).set({
      name: "Sobreposição",
      price: 14,
      quantidade: 2,
      isArchived: false,
      categoryIds: [
        "promo",
        "suggestion",
      ],
    });

    await productsRef.doc(
        archivedOfferId,
    ).set({
      name: "Arquivado",
      price: 15,
      quantidade: 5,
      isArchived: true,
      categoryIds: ["promo"],
    });

    await productsRef.doc(
        zeroStockOfferId,
    ).set({
      name: "Sem Estoque",
      price: 16,
      quantidade: 0,
      isArchived: false,
      categoryIds: ["promo"],
    });

    // categoryIds existe e portanto e autoridade.
    // categoryId legado NAO deve ser usado.
    await productsRef.doc(
        canonicalWinsId,
    ).set({
      name: "Canônico Vence",
      price: 17,
      quantidade: 5,
      isArchived: false,
      categoryIds: ["other"],
      categoryId: "promo",
    });

    await productsRef.doc(
        outsideProductId,
    ).set({
      name: "Fora",
      price: 18,
      quantidade: 5,
      isArchived: false,
      categoryIds: ["outside"],
    });

    await catalogRef.set({
      status: "active",
      title: "Catálogo Dinâmico",
      expiresAt: futureExpiration,
      publicTokenHash,
      productCount: 1,
      dynamicSections: {
        suggestions: {
          enabled: true,
          categoryIds: ["suggestion"],
        },
        offers: {
          enabled: true,
          categoryIds: ["promo"],
        },
        completeOrder: {
          enabled: false,
          categoryIds: [],
        },
      },
    });

    await catalogRef
        .collection("items")
        .doc("main")
        .set({
          productId: mainProductId,
          position: 0,
          addedAt:
            admin.firestore.FieldValue
                .serverTimestamp(),
        });

    await tokenIndexRef.set({
      storeId,
      catalogId,
      createdAt:
        admin.firestore.FieldValue
            .serverTimestamp(),
    });

    // ==========================================================
    // 1. GET PUBLIC
    // ==========================================================

    const result =
      await getPublicCatalog.run({
        data: {
          publicSlug,
          publicToken,
        },
      });

    assert.equal(result.success, true);

    assert.deepEqual(
        result.products.map(
            (product) => product.productId,
        ),
        [mainProductId],
    );

    assert.ok(
        Array.isArray(
            result.dynamicSections,
        ),
    );

    assert.deepEqual(
        result.dynamicSections.map(
            (section) => section.id,
        ),
        [
          "suggestions",
          "offers",
        ],
    );

    const suggestions =
      result.dynamicSections.find(
          (section) =>
            section.id === "suggestions",
      );

    const offers =
      result.dynamicSections.find(
          (section) =>
            section.id === "offers",
      );

    assert.ok(suggestions);
    assert.ok(offers);

    assert.equal(
        suggestions.title,
        "Sugestões para você",
    );

    assert.equal(
        offers.title,
        "Ofertas",
    );

    assert.deepEqual(
        productIds(suggestions),
        [
          overlapProductId,
          suggestionProductId,
        ].sort(),
    );

    assert.deepEqual(
        productIds(offers),
        [
          canonicalOfferId,
          legacyOfferId,
          overlapProductId,
        ].sort(),
    );

    // Principal pertence a promo, mas Area 1 vence.
    assert.equal(
        productIds(offers)
            .includes(mainProductId),
        false,
    );

    // Arquivado e sem estoque nao sao publicados.
    for (const hiddenId of [
      archivedOfferId,
      zeroStockOfferId,
      canonicalWinsId,
      outsideProductId,
    ]) {
      const visible =
        result.dynamicSections.some(
            (section) =>
              section.products.some(
                  (product) =>
                    product.productId === hiddenId,
              ),
        );

      assert.equal(
          visible,
          false,
          `Produto inesperado visivel: ${hiddenId}`,
      );
    }

    // Configuracao interna de categoria nao vaza.
    for (
      const section
      of result.dynamicSections
    ) {
      assert.deepEqual(
          section.products.map(
              (product) => product.position,
          ),
          section.products.map(
              (_, index) => index,
          ),
      );

      for (const product of section.products) {
        assert.equal(
            Object.prototype
                .hasOwnProperty.call(
                    product,
                    "categoryIds",
                ),
            false,
        );

        assert.equal(
            Object.prototype
                .hasOwnProperty.call(
                    product,
                    "categoryId",
                ),
            false,
        );
      }
    }

    console.log(
        "✅ GET publico resolveu Area 2 corretamente",
    );

    // ==========================================================
    // 2. SUBMIT - PRODUTO DINAMICO CANONICO
    // ==========================================================

    const canonicalSubmit =
      await submit([
        {
          productId: canonicalOfferId,
          quantity: 1,
        },
      ]);

    assert.equal(
        canonicalSubmit.success,
        true,
    );

    assert.equal(
        canonicalSubmit
            .validatedItemCount,
        1,
    );

    console.log(
        "✅ Produto dinamico categoryIds aceito",
    );

    // ==========================================================
    // 3. SUBMIT - PRODUTO LEGADO
    // ==========================================================

    const legacySubmit =
      await submit([
        {
          productId: legacyOfferId,
          quantity: 1,
        },
      ]);

    assert.equal(
        legacySubmit.success,
        true,
    );

    console.log(
        "✅ Produto dinamico categoryId legado aceito",
    );

    // ==========================================================
    // 4. AREA 1 CONTINUA AUTORIZADA
    // ==========================================================

    const mainSubmit =
      await submit([
        {
          productId: mainProductId,
          quantity: 1,
        },
      ]);

    assert.equal(
        mainSubmit.success,
        true,
    );

    console.log(
        "✅ Produto principal continua autorizado",
    );

    // ==========================================================
    // 5. CATEGORYIDS CANONICO BLOQUEIA FALLBACK LEGADO
    // ==========================================================

    await expectHttpsError(
        () => submit([
          {
            productId: canonicalWinsId,
            quantity: 1,
          },
        ]),
        "failed-precondition",
        "product-not-in-catalog",
    );

    console.log(
        "✅ categoryIds canonico venceu categoryId legado",
    );

    // ==========================================================
    // 6. PRODUTO FORA CONTINUA BLOQUEADO
    // ==========================================================

    await expectHttpsError(
        () => submit([
          {
            productId: outsideProductId,
            quantity: 1,
          },
        ]),
        "failed-precondition",
        "product-not-in-catalog",
    );

    console.log(
        "✅ Produto fora das Areas 1 e 2 bloqueado",
    );

    // ==========================================================
    // 7. ELEGIBILIDADE E REAVALIADA NO ENVIO
    // ==========================================================

    await productsRef
        .doc(canonicalOfferId)
        .update({
          categoryIds: ["other"],
        });

    await expectHttpsError(
        () => submit([
          {
            productId: canonicalOfferId,
            quantity: 1,
          },
        ]),
        "failed-precondition",
        "product-not-in-catalog",
    );

    const refreshed =
      await getPublicCatalog.run({
        data: {
          publicSlug,
          publicToken,
        },
      });

    const refreshedIds =
      refreshed.dynamicSections
          .flatMap(
              (section) =>
                section.products.map(
                    (product) =>
                      product.productId,
                ),
          );

    assert.equal(
        refreshedIds.includes(
            canonicalOfferId,
        ),
        false,
    );

    console.log(
        "✅ Mudanca de categoria removeu visibilidade e autorizacao",
    );

    console.log("");
    console.log(
        "============================================================",
    );
    console.log(
        "✅ E1-B2B2 DYNAMIC PUBLIC CATALOG PASSOU",
    );
    console.log(
        "============================================================",
    );
  } finally {
    await db.recursiveDelete(storeRef);
    await tokenIndexRef.delete();
    await admin.app().delete();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});