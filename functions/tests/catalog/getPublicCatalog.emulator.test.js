"use strict";

const assert = require("assert");
const crypto = require("crypto");
const admin = require("firebase-admin");

const {
  getPublicCatalog,
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

  return receivedError;
}

async function run() {
  assertEmulatorEnvironment();

  const db = initializeFirebase();

  const suffix =
    `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  const storeId =
    `public-catalog-store-${suffix}`;

  const catalogId =
    `public-catalog-${suffix}`;

  const publicSlug =
    `loja-publica-${suffix}`.toLowerCase();

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

  console.log("");
  console.log("============================================================");
  console.log("F7.5-B2 — GET PUBLIC CATALOG / TESTE FUNCIONAL");
  console.log("============================================================");

  const storeRef = db
      .collection("stores")
      .doc(storeId);

  const catalogRef = storeRef
      .collection("catalogs")
      .doc(catalogId);

  // ========================================================================
  // 1. FIXTURES
  // ========================================================================

  await storeRef.set({
    name: "Loja Pública Teste",
    phone: "21999999999",
    logoUrl: "https://example.com/logo.png",
    publicSlug,
    subscriptionStatus: "active",
  });

  await storeRef
      .collection("products")
      .doc(activeProductId)
      .set({
        name: "Produto Público",
        price: 49.90,
        quantidade: 7,
        imageUrl: "https://example.com/produto.png",
        categoryName: "Categoria Teste",
        isArchived: false,
      });

  await storeRef
      .collection("products")
      .doc(archivedProductId)
      .set({
        name: "Produto Arquivado",
        price: 99.90,
        quantidade: 5,
        isArchived: true,
      });

  await storeRef
      .collection("products")
      .doc(zeroStockProductId)
      .set({
        name: "Produto Sem Estoque",
        price: 10,
        quantidade: 0,
        isArchived: false,
      });

  const futureExpiration =
    admin.firestore.Timestamp.fromMillis(
        Date.now() + (7 * 24 * 60 * 60 * 1000),
    );

  await catalogRef.set({
    status: "active",
    title: "Catálogo Público Teste",
    expiresAt: futureExpiration,
    publicTokenHash,
    productCount: 3,
  });

  await catalogRef
      .collection("items")
      .doc("item-0")
      .set({
        productId: activeProductId,
        position: 0,
        addedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });

  await catalogRef
      .collection("items")
      .doc("item-1")
      .set({
        productId: archivedProductId,
        position: 1,
        addedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });

  await catalogRef
      .collection("items")
      .doc("item-2")
      .set({
        productId: zeroStockProductId,
        position: 2,
        addedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });

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
  // 2. HAPPY PATH — SEM AUTH
  // ========================================================================

  const result = await getPublicCatalog.run({
    data: {
      publicSlug,
      publicToken,
    },
  });

  assert.strictEqual(
      result.success,
      true,
  );

  assert.deepStrictEqual(
      result.store,
      {
        name: "Loja Pública Teste",
        logoUrl: "https://example.com/logo.png",
        phone: "21999999999",
      },
  );

  assert.strictEqual(
      result.catalog.title,
      "Catálogo Público Teste",
  );

  assert.strictEqual(
      result.catalog.productCount,
      1,
  );

  assert.strictEqual(
      typeof result.catalog.expiresAt,
      "string",
  );

  assert.strictEqual(
      Array.isArray(result.products),
      true,
  );

  assert.strictEqual(
      result.products.length,
      1,
  );

  assert.deepStrictEqual(
      result.products[0],
      {
        productId: activeProductId,
        name: "Produto Público",
        price: 49.90,
        imageUrl: "https://example.com/produto.png",
        quantidade: 7,
        categoryName: "Categoria Teste",
        position: 0,
      },
  );

  console.log("✅ Catálogo válido retornado sem autenticação");
  console.log("✅ Dados públicos da loja retornados");
  console.log("✅ Produto ativo retornado");
  console.log("✅ Produto arquivado omitido");
  console.log("✅ Produto sem estoque omitido");

  // ========================================================================
  // 3. GARANTIA DE NÃO EXPOSIÇÃO
  // ========================================================================

  const serializedResult =
    JSON.stringify(result);

  assert.strictEqual(
      serializedResult.includes(
          publicToken,
      ),
      false,
  );

  assert.strictEqual(
      serializedResult.includes(
          publicTokenHash,
      ),
      false,
  );

  assert.strictEqual(
      serializedResult.includes(
          "publicTokenEncrypted",
      ),
      false,
  );

  assert.strictEqual(
      serializedResult.includes(
          storeId,
      ),
      false,
  );

  assert.strictEqual(
      serializedResult.includes(
          catalogId,
      ),
      false,
  );

  console.log("✅ Token puro não retornado");
  console.log("✅ Hash não retornado");
  console.log("✅ IDs internos não retornados");

  // ========================================================================
  // 4. TOKEN COM FORMATO INVÁLIDO
  // ========================================================================

  await expectHttpsError(
      () => getPublicCatalog.run({
        data: {
          publicSlug,
          publicToken: "token-invalido",
        },
      }),
      "invalid-argument",
  );

  console.log("✅ Token malformado rejeitado");

  // ========================================================================
  // 5. TOKEN BEM FORMADO, MAS INEXISTENTE
  // ========================================================================

  const unknownToken =
    crypto.randomBytes(32).toString("base64url");

  await expectHttpsError(
      () => getPublicCatalog.run({
        data: {
          publicSlug,
          publicToken: unknownToken,
        },
      }),
      "not-found",
  );

  console.log("✅ Token inexistente rejeitado");

  // ========================================================================
  // 6. SLUG INCORRETO
  // ========================================================================

  await expectHttpsError(
      () => getPublicCatalog.run({
        data: {
          publicSlug: `outra-loja-${suffix}`,
          publicToken,
        },
      }),
      "not-found",
  );

  console.log("✅ Slug incompatível com o token rejeitado");

  // ========================================================================
  // 7. CATÁLOGO EXPIRADO
  // ========================================================================

  await catalogRef.update({
    expiresAt:
      admin.firestore.Timestamp.fromMillis(
          Date.now() - 1000,
      ),
  });

  await expectHttpsError(
      () => getPublicCatalog.run({
        data: {
          publicSlug,
          publicToken,
        },
      }),
      "failed-precondition",
  );

  console.log("✅ Catálogo expirado bloqueado");

  // Restaura expiração.
  await catalogRef.update({
    expiresAt: futureExpiration,
  });

  // ========================================================================
  // 8. CATÁLOGO INATIVO
  // ========================================================================

  await catalogRef.update({
    status: "inactive",
  });

  await expectHttpsError(
      () => getPublicCatalog.run({
        data: {
          publicSlug,
          publicToken,
        },
      }),
      "failed-precondition",
  );

  console.log("✅ Catálogo inativo bloqueado");

  // Restaura status.
  await catalogRef.update({
    status: "active",
  });

  // ========================================================================
  // 9. LOJA SEM ACESSO
  // ========================================================================

  await storeRef.update({
    subscriptionStatus: "inactive",
  });

  await expectHttpsError(
      () => getPublicCatalog.run({
        data: {
          publicSlug,
          publicToken,
        },
      }),
      "failed-precondition",
  );

  console.log("✅ Loja sem assinatura válida bloqueada");

  console.log("");
  console.log("============================================================");
  console.log("✅ F7.5-B2 GET PUBLIC CATALOG / TESTE FUNCIONAL PASSOU");
  console.log("============================================================");
  console.log("");
}

run().catch((error) => {
  console.error("");
  console.error(
      "❌ F7.5-B2 GET PUBLIC CATALOG / TESTE FUNCIONAL FALHOU",
  );
  console.error(error);
  process.exit(1);
});