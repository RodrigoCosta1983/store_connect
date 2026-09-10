"use strict";

const assert = require("assert");
const crypto = require("crypto");
const admin = require("firebase-admin");

const {
  createCatalog,
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

async function run() {
  assertEmulatorEnvironment();

  const db = initializeFirebase();

  const suffix = Date.now().toString();
  const uid = `catalog-user-${suffix}`;
  const storeId = `catalog-store-${suffix}`;
  const productId1 = `product-1-${suffix}`;
  const productId2 = `product-2-${suffix}`;

  console.log("");
  console.log("============================================================");
  console.log("F7.2-D — CREATE CATALOG / HAPPY PATH");
  console.log("============================================================");

  // ========================================================================
  // 1. FIXTURES
  // ========================================================================

  await db.collection("users").doc(uid).set({
    role: "operador",
    storeId,
    accessStatus: "active",
  });

  const storeRef = db.collection("stores").doc(storeId);

  await storeRef.set({
    ownerId: uid,
    subscriptionStatus: "active",
  });

  await storeRef.collection("products").doc(productId1).set({
    name: "Produto Teste 1",
    price: 10.50,
    quantidade: 5,
    isArchived: false,
  });

  await storeRef.collection("products").doc(productId2).set({
    name: "Produto Teste 2",
    price: 20.00,
    quantidade: 8,
  });

  // ========================================================================
  // 2. EXECUTA A CALLABLE DIRETAMENTE
  // ========================================================================

  const result = await createCatalog.run({
    auth: {
      uid,
    },
    data: {
      title: "Catálogo de Teste",
      productIds: [
        productId1,
        productId2,
      ],
      expiresInDays: 7,
    },
  });

  // ========================================================================
  // 3. RETORNO
  // ========================================================================

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.productCount, 2);
  assert.strictEqual(typeof result.catalogId, "string");
  assert(result.catalogId.length > 0);
  assert.strictEqual(typeof result.publicToken, "string");
  assert(result.publicToken.length >= 40);

  const publicTokenHash = sha256(result.publicToken);

  // ========================================================================
  // 4. CATÁLOGO
  // ========================================================================

  const catalogRef = storeRef
      .collection("catalogs")
      .doc(result.catalogId);

  const catalogSnapshot = await catalogRef.get();

  assert.strictEqual(catalogSnapshot.exists, true);

  const catalogData = catalogSnapshot.data();

  assert.strictEqual(catalogData.status, "active");
  assert.strictEqual(catalogData.title, "Catálogo de Teste");
  assert.strictEqual(catalogData.createdByUid, uid);
  assert.strictEqual(catalogData.publicTokenHash, publicTokenHash);
  assert.strictEqual("publicToken" in catalogData, false);
  assert(catalogData.createdAt);
  assert(catalogData.expiresAt);

  // ========================================================================
  // 5. ITENS
  // ========================================================================

  const itemsSnapshot = await catalogRef
      .collection("items")
      .orderBy("position")
      .get();

  assert.strictEqual(itemsSnapshot.size, 2);

  const items = itemsSnapshot.docs.map((doc) => doc.data());

  assert.deepStrictEqual(
      items.map((item) => item.productId),
      [productId1, productId2],
  );

  assert.deepStrictEqual(
      items.map((item) => item.position),
      [0, 1],
  );

  // ========================================================================
  // 6. ÍNDICE PRIVADO DO TOKEN
  // ========================================================================

  const tokenSnapshot = await db
      .collection("catalogPublicTokens")
      .doc(publicTokenHash)
      .get();

  assert.strictEqual(tokenSnapshot.exists, true);

  const tokenData = tokenSnapshot.data();

  assert.strictEqual(tokenData.storeId, storeId);
  assert.strictEqual(tokenData.catalogId, result.catalogId);
  assert.strictEqual("publicToken" in tokenData, false);
  assert(tokenData.createdAt);

  console.log("✅ createCatalog retornou catálogo válido");
  console.log("✅ Catalog persistido");
  console.log("✅ 2 CatalogItems persistidos");
  console.log("✅ índice SHA-256 persistido");
  console.log("✅ publicToken puro não foi persistido");
  console.log("");
  console.log("============================================================");
  console.log("✅ F7.2-D CREATE CATALOG / HAPPY PATH PASSOU");
  console.log("============================================================");
  console.log("");
}

run().catch((error) => {
  console.error("");
  console.error("❌ F7.2-D CREATE CATALOG / HAPPY PATH FALHOU");
  console.error(error);
  process.exit(1);
});
