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

  console.log("");
  console.log("============================================================");
  console.log("F7.2-D — CREATE CATALOG / AUTORIZAÇÃO");
  console.log("============================================================");

  // ========================================================================
  // 1. NÃO AUTENTICADO
  // ========================================================================

  await expectHttpsError(
      () => createCatalog.run({
        data: {
          title: "Catálogo sem autenticação",
          productIds: ["produto-x"],
          expiresInDays: 7,
        },
      }),
      "unauthenticated",
  );

  console.log("✅ usuário não autenticado foi bloqueado");

  // ========================================================================
  // 2. USUÁRIO REVOGADO
  // ========================================================================

  const revokedUid = `catalog-revoked-${suffix}`;
  const revokedStoreId = `catalog-store-revoked-${suffix}`;

  await db.collection("users").doc(revokedUid).set({
    role: "operador",
    storeId: revokedStoreId,
    accessStatus: "revoked",
  });

  await expectHttpsError(
      () => createCatalog.run({
        auth: {uid: revokedUid},
        data: {
          title: "Catálogo revogado",
          productIds: ["produto-x"],
          expiresInDays: 7,
        },
      }),
      "permission-denied",
  );

  console.log("✅ usuário revogado foi bloqueado");

  // ========================================================================
  // 3. ROLE DESCONHECIDA
  // ========================================================================

  const invalidRoleUid = `catalog-invalid-role-${suffix}`;
  const invalidRoleStoreId = `catalog-store-invalid-role-${suffix}`;

  await db.collection("users").doc(invalidRoleUid).set({
    role: "superusuario",
    storeId: invalidRoleStoreId,
    accessStatus: "active",
  });

  await expectHttpsError(
      () => createCatalog.run({
        auth: {uid: invalidRoleUid},
        data: {
          title: "Catálogo role inválida",
          productIds: ["produto-x"],
          expiresInDays: 7,
        },
      }),
      "permission-denied",
  );

  console.log("✅ role desconhecida falhou fechada");

  // ========================================================================
  // 4. ASSINATURA INATIVA
  // ========================================================================

  const inactiveUid = `catalog-inactive-${suffix}`;
  const inactiveStoreId = `catalog-store-inactive-${suffix}`;

  await db.collection("users").doc(inactiveUid).set({
    role: "operador",
    storeId: inactiveStoreId,
    accessStatus: "active",
  });

  await db.collection("stores").doc(inactiveStoreId).set({
    ownerId: inactiveUid,
    subscriptionStatus: "inactive",
  });

  await expectHttpsError(
      () => createCatalog.run({
        auth: {uid: inactiveUid},
        data: {
          title: "Catálogo assinatura inativa",
          productIds: ["produto-x"],
          expiresInDays: 7,
        },
      }),
      "failed-precondition",
  );

  console.log("✅ assinatura inativa foi bloqueada");

  console.log("");
  console.log("============================================================");
  console.log("✅ F7.2-D CREATE CATALOG / AUTORIZAÇÃO PASSOU");
  console.log("============================================================");
  console.log("");
}

run().catch((error) => {
  console.error("");
  console.error("❌ F7.2-D CREATE CATALOG / AUTORIZAÇÃO FALHOU");
  console.error(error);
  process.exit(1);
});
