"use strict";

const assert = require("assert");
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
        "SEGURANÇA: este teste só pode executar no Firestore Emulator.",
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

async function run() {
  assertEmulatorEnvironment();

  const db = initializeFirebase();

  const suffix = Date.now().toString();
  const uid = `slug-migration-user-${suffix}`;
  const storeId = `slug-migration-store-${suffix}`;
  const productId = `slug-product-${suffix}`;

  const storeName = `Farmácia Catálogo ${suffix}`;
  const expectedPublicSlug =
    `farmacia-catalogo-${suffix}`;

  const storeRef = db
      .collection("stores")
      .doc(storeId);

  // Loja legada: existe antes da criação do campo publicSlug.
  await db.collection("users").doc(uid).set({
    role: "admin",
    storeId,
    accessStatus: "active",
  });

  await storeRef.set({
    name: storeName,
    ownerId: uid,
    subscriptionStatus: "active",
  });

  await storeRef
      .collection("products")
      .doc(productId)
      .set({
        name: "Produto Teste",
        quantidade: 10,
        isArchived: false,
      });

  const beforeSnapshot = await storeRef.get();

  assert.strictEqual(
      "publicSlug" in beforeSnapshot.data(),
      false,
  );

  const result = await createCatalog.run({
    auth: {
      uid,
    },
    data: {
      title: "Catálogo Migração Slug",
      productIds: [productId],
      expiresInDays: 7,
    },
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(
      result.publicSlug,
      expectedPublicSlug,
  );

  const afterSnapshot = await storeRef.get();

  assert.strictEqual(
      afterSnapshot.data().publicSlug,
      expectedPublicSlug,
  );

  const slugSnapshot = await db
      .collection("storePublicSlugs")
      .doc(expectedPublicSlug)
      .get();

  assert.strictEqual(slugSnapshot.exists, true);
  assert.strictEqual(
      slugSnapshot.data().storeId,
      storeId,
  );

  const catalogSnapshot = await storeRef
      .collection("catalogs")
      .doc(result.catalogId)
      .get();

  assert.strictEqual(catalogSnapshot.exists, true);

  console.log("✅ Loja legada iniciou sem publicSlug");
  console.log("✅ createCatalog gerou publicSlug automaticamente");
  console.log("✅ publicSlug foi salvo na loja");
  console.log("✅ storePublicSlugs foi reservado");
  console.log("✅ catálogo foi criado normalmente");
}

run().catch((error) => {
  console.error("");
  console.error("❌ MIGRAÇÃO PUBLIC SLUG / CREATE CATALOG FALHOU");
  console.error(error);
  process.exit(1);
});