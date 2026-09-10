"use strict";

const assert = require("assert");
const admin = require("firebase-admin");

const {
  bootstrapStore,
} = require("../../auth/bootstrapStore");

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
  const uid = `bootstrap-user-${suffix}`;
  const document = suffix.slice(-11);

  const storeName =
    `Farmácia São José ${suffix}`;

  const expectedPublicSlug =
    `farmacia-sao-jose-${suffix}`;

  const result = await bootstrapStore.run({
    auth: {
      uid,
      token: {
        email: `${uid}@example.com`,
        name: "Usuário Teste",
      },
    },
    data: {
      name: storeName,
      phone: "21999999999",
      document,
    },
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(typeof result.storeId, "string");
  assert(result.storeId.length > 0);

  assert.strictEqual(
      result.publicSlug,
      expectedPublicSlug,
  );

  const storeSnapshot = await db
      .collection("stores")
      .doc(result.storeId)
      .get();

  assert.strictEqual(storeSnapshot.exists, true);

  const storeData = storeSnapshot.data();

  assert.strictEqual(storeData.name, storeName);
  assert.strictEqual(
      storeData.publicSlug,
      expectedPublicSlug,
  );
  assert.strictEqual(storeData.ownerId, uid);
  assert.strictEqual(
      storeData.subscriptionStatus,
      "trial",
  );

  const slugSnapshot = await db
      .collection("storePublicSlugs")
      .doc(expectedPublicSlug)
      .get();

  assert.strictEqual(slugSnapshot.exists, true);

  const slugData = slugSnapshot.data();

  assert.strictEqual(
      slugData.storeId,
      result.storeId,
  );
  assert.strictEqual(
      slugData.publicSlug,
      expectedPublicSlug,
  );

  const userSnapshot = await db
      .collection("users")
      .doc(uid)
      .get();

  assert.strictEqual(userSnapshot.exists, true);
  assert.strictEqual(
      userSnapshot.data().storeId,
      result.storeId,
  );
  assert.strictEqual(userSnapshot.data().role, "admin");

  const cpfSnapshot = await db
      .collection("cpfs_cadastrados")
      .doc(document)
      .get();

  assert.strictEqual(cpfSnapshot.exists, true);
  assert.strictEqual(
      cpfSnapshot.data().storeId,
      result.storeId,
  );

  console.log("✅ Loja criada no Emulator");
  console.log("✅ publicSlug salvo em stores/{storeId}");
  console.log("✅ storePublicSlugs/{publicSlug} reservado");
  console.log("✅ publicSlug retornado pelo bootstrapStore");
  console.log("✅ usuário e CPF/CNPJ vinculados");
}

run().catch((error) => {
  console.error("");
  console.error("❌ BOOTSTRAP STORE / HAPPY PATH FALHOU");
  console.error(error);
  process.exit(1);
});