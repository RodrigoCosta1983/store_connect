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

async function expectHttpsError(action, expectedCode) {
  let receivedError = null;

  try {
    await action();
  } catch (error) {
    receivedError = error;
  }

  assert(receivedError, `Era esperado erro ${expectedCode}.`);
  assert.strictEqual(receivedError.code, expectedCode);
}

async function run() {
  assertEmulatorEnvironment();

  const db = initializeFirebase();
  const suffix = Date.now().toString();
  const uid = `catalog-validation-user-${suffix}`;
  const storeId = `catalog-validation-store-${suffix}`;
  const activeProductId = `active-product-${suffix}`;
  const archivedProductId = `archived-product-${suffix}`;
  const zeroStockProductId = `zero-stock-product-${suffix}`;

  console.log("");
  console.log("============================================================");
  console.log("F7.2-D — CREATE CATALOG / VALIDAÇÕES");
  console.log("============================================================");

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

  await storeRef.collection("products").doc(activeProductId).set({
    name: "Produto Ativo",
    price: 10,
    quantidade: 5,
  });

  await storeRef.collection("products").doc(archivedProductId).set({
    name: "Produto Arquivado",
    price: 20,
    quantidade: 3,
    isArchived: true,
  });

  await storeRef.collection("products").doc(zeroStockProductId).set({
    name: "Produto Sem Estoque",
    price: 30,
    quantidade: 0,
  });

  const call = (data) => createCatalog.run({
    auth: {uid},
    data,
  });

  // ========================================================================
  // 1. TÍTULO
  // ========================================================================

  await expectHttpsError(
      () => call({
        title: "   ",
        productIds: [activeProductId],
        expiresInDays: 7,
      }),
      "invalid-argument",
  );

  console.log("✅ título vazio foi bloqueado");

  // ========================================================================
  // 2. PRODUCT IDS VAZIO
  // ========================================================================

  await expectHttpsError(
      () => call({
        title: "Teste",
        productIds: [],
        expiresInDays: 7,
      }),
      "invalid-argument",
  );

  console.log("✅ catálogo sem produtos foi bloqueado");

  // ========================================================================
  // 3. PRODUCT ID COM BARRA
  // ========================================================================

  await expectHttpsError(
      () => call({
        title: "Teste",
        productIds: ["products/produto-injetado"],
        expiresInDays: 7,
      }),
      "invalid-argument",
  );

  console.log("✅ productId com barra foi bloqueado");

  // ========================================================================
  // 4. EXPIRAÇÃO INVÁLIDA
  // ========================================================================

  await expectHttpsError(
      () => call({
        title: "Teste",
        productIds: [activeProductId],
        expiresInDays: 31,
      }),
      "invalid-argument",
  );

  console.log("✅ expiração acima do limite foi bloqueada");

  // ========================================================================
  // 5. PRODUTO INEXISTENTE
  // ========================================================================

  await expectHttpsError(
      () => call({
        title: "Teste",
        productIds: [`missing-${suffix}`],
        expiresInDays: 7,
      }),
      "not-found",
  );

  console.log("✅ produto inexistente foi bloqueado");

  // ========================================================================
  // 6. PRODUTO ARQUIVADO
  // ========================================================================

  await expectHttpsError(
      () => call({
        title: "Teste",
        productIds: [archivedProductId],
        expiresInDays: 7,
      }),
      "failed-precondition",
  );

  console.log("✅ produto arquivado foi bloqueado");

  // ========================================================================
  // 7. PRODUTO SEM ESTOQUE
  // ========================================================================

  await expectHttpsError(
      () => call({
        title: "Teste",
        productIds: [zeroStockProductId],
        expiresInDays: 7,
      }),
      "failed-precondition",
  );

  console.log("✅ produto sem estoque foi bloqueado");

  // ========================================================================
  // 8. NENHUMA ESCRITA APÓS AS FALHAS
  // ========================================================================

  const catalogsAfterFailures = await storeRef
      .collection("catalogs")
      .get();

  assert.strictEqual(catalogsAfterFailures.empty, true);

  console.log("✅ falhas de validação não criaram catálogo parcial");

  // ========================================================================
  // 9. DUPLICADOS
  // ========================================================================

  const duplicateResult = await call({
    title: "Catálogo sem duplicação",
    productIds: [
      activeProductId,
      activeProductId,
      activeProductId,
    ],
    expiresInDays: 7,
  });

  assert.strictEqual(duplicateResult.success, true);
  assert.strictEqual(duplicateResult.productCount, 1);

  const duplicateItems = await storeRef
      .collection("catalogs")
      .doc(duplicateResult.catalogId)
      .collection("items")
      .get();

  assert.strictEqual(duplicateItems.size, 1);

  console.log("✅ productIds duplicados foram normalizados para 1 item");

  console.log("");
  console.log("============================================================");
  console.log("✅ F7.2-D CREATE CATALOG / VALIDAÇÕES PASSOU");
  console.log("============================================================");
  console.log("");
}

run().catch((error) => {
  console.error("");
  console.error("❌ F7.2-D CREATE CATALOG / VALIDAÇÕES FALHOU");
  console.error(error);
  process.exit(1);
});
