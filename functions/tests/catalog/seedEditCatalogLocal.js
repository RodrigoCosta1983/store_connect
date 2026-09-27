"use strict";

// D1.4: dados sinteticos persistem somente nos Emulators em execucao.
// Defina FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 e
// FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 antes de executar.
// Exige CATALOG_TOKEN_ENCRYPTION_KEY (32 bytes em Base64), tambem definida
// no processo do Functions Emulator. Nunca gera nem imprime essa chave.
// Recria somente a loja d14 e suas subcolecoes; atualiza somente seu usuario.
// Requer tambem Functions Emulator em 127.0.0.1:5001.

const assert = require("node:assert/strict");
const admin = require("firebase-admin");

async function postLocal(url, data, token) {
  const response = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json",
      ...(token ? {Authorization: `Bearer ${token}`} : {})},
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(60000),
  });
  const body = await response.json();
  const endpoint = new URL(url).pathname.split("/").pop();
  console.log(JSON.stringify({endpoint, httpStatus: response.status,
    errorCode: body.error?.status || null}));
  if (!response.ok || body.error) {
    const error = new Error("Endpoint local falhou.");
    error.code = body.error?.status || `HTTP_${response.status}`;
    throw error;
  }
  return body;
}

async function run() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080",
      "Seed permitido somente no Firestore Emulator local.");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099",
      "Seed permitido somente no Auth Emulator local.");

  const key = process.env.CATALOG_TOKEN_ENCRYPTION_KEY?.trim();
  assert.ok(key, "Defina CATALOG_TOKEN_ENCRYPTION_KEY antes de criar dados.");
  assert.equal(Buffer.from(key, "base64").length, 32,
      "CATALOG_TOKEN_ENCRYPTION_KEY deve conter 32 bytes em Base64.");
  const app = admin.initializeApp({projectId: "store-connect-app"});
  const db = admin.firestore();
  const uid = "d14-catalog-editor";
  const email = "teste.catalogo@storeconnect.local";
  const password = "Teste123456!";
  const store = db.collection("stores").doc("d14-catalog-store");
  try {
    const profile = {email, password, emailVerified: true,
      disabled: false, displayName: "Operador local D1.4"};
    try {
      await admin.auth().getUser(uid);
      await admin.auth().updateUser(uid, profile);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
      await admin.auth().createUser({uid, ...profile});
    }
    await db.recursiveDelete(store);
    const batch = db.batch();
    batch.set(db.collection("users").doc(uid), {
      name: "Operador local D1.4", email, role: "admin",
      accessStatus: "active", storeId: store.id,
    });
    batch.set(store, {
      name: "Loja local D1.4", ownerId: uid,
      subscriptionStatus: "active", subscriptionType: "business",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const products = [
      {id: "produto-a", name: "Produto A local", price: 10, quantidade: 10},
      {id: "produto-b", name: "Produto B local", price: 20, quantidade: 5},
      {id: "produto-c", name: "Produto C local", price: 30, quantidade: 8},
      {id: "produto-d", name: "Produto D para adicionar", price: 40, quantidade: 6},
      {id: "produto-e", name: "Produto E para adicionar", price: 50, quantidade: 3},
    ];
    for (const {id, ...product} of products) {
      batch.set(store.collection("products").doc(id), {
        ...product, name_lowercase: product.name.toLowerCase(),
        imageUrl: "", minimumStock: 0, isArchived: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    const login = await postLocal(
        "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-test",
        {email, password, returnSecureToken: true});
    assert.equal(login.localId, uid);
    const callable = async (name, data) => {
      const body = await postLocal(
          `http://127.0.0.1:5001/${app.options.projectId}/us-central1/${name}`,
          {data}, login.idToken);
      assert.equal(body.result?.success, true, `${name} deve retornar sucesso.`);
      return body.result;
    };
    const productIds = ["produto-a", "produto-b", "produto-c"];
    const title = "Catalogo local D1.4";
    const created = await callable("createCatalog", {
      title, productIds, expiresInDays: 7,
    });
    assert.equal(created.success, true);
    const catalogId = created.catalogId;
    const read = await callable("getCatalogForEdit", {catalogId});
    assert.equal(read.success, true);
    assert.deepEqual(read.catalog.productIds, productIds);
    assert.equal(read.catalog.productCount, 3);
    const listed = await callable("listCatalogs", {});
    assert.equal(listed.catalogs.length, 1);
    assert.equal(listed.catalogs[0].catalogId, catalogId);
    assert.equal(listed.catalogs[0].linkAvailable, true,
        "Functions Emulator deve usar a mesma chave local para recuperar o link.");
    const catalogRef = store.collection("catalogs").doc(catalogId);
    const before = (await catalogRef.get()).data();
    const editedProductIds = ["produto-c", "produto-a", "produto-d"];
    const editedTitle = `${title} editado`;
    const updated = await callable("updateCatalog", {
      catalogId, title: editedTitle, productIds: editedProductIds,
    });
    assert.equal(updated.catalogId, catalogId);
    assert.equal(updated.productCount, editedProductIds.length);
    const edited = await callable("getCatalogForEdit", {catalogId});
    assert.equal(edited.catalog.title, editedTitle);
    assert.deepEqual(edited.catalog.productIds, editedProductIds);
    assert.equal(edited.catalog.expiresAt, read.catalog.expiresAt);
    const after = (await catalogRef.get()).data();
    for (const field of ["publicTokenHash", "publicTokenEncrypted",
      "createdAt", "createdByUid"]) {
      assert.deepEqual(after[field], before[field]);
    }
    const editedList = await callable("listCatalogs", {});
    assert.equal(editedList.catalogs.length, 1);
    assert.equal(editedList.catalogs[0].catalogId, catalogId);
    assert.equal(editedList.catalogs[0].title, editedTitle);
    assert.equal(editedList.catalogs[0].linkAvailable, true);
    assert.equal(editedList.catalogs[0].publicUrl, listed.catalogs[0].publicUrl);
    await callable("updateCatalog", {catalogId, title, productIds});
    const restored = await callable("getCatalogForEdit", {catalogId});
    assert.equal(restored.catalog.title, title);
    assert.deepEqual(restored.catalog.productIds, productIds);
    assert.equal(restored.catalog.productCount, productIds.length);
    const visibleProducts = await store.collection("products")
        .orderBy("name_lowercase").get();
    assert.equal(visibleProducts.size, 5);
    assert.deepEqual(visibleProducts.docs.map((product) => product.id).sort(),
        products.map((product) => product.id).sort());
    for (const product of visibleProducts.docs) {
      assert.ok(product.data().quantidade > 0);
      assert.equal(product.data().isArchived, false);
    }
    assert.equal((await admin.auth().getUser(uid)).email, email);
    assert.equal((await db.collection("users").doc(uid).get()).data().storeId,
        store.id);
    console.log(JSON.stringify({
      success: true, projectId: app.options.projectId, uid, email,
      storeId: store.id, catalogId,
      productCount: restored.catalog.productCount,
      productIds: products.map((product) => product.id),
      initialProductIds: restored.catalog.productIds,
      expiresAt: read.catalog.expiresAt,
      endpointsValidated: ["listCatalogs", "getCatalogForEdit", "updateCatalog"],
      listCatalogsInternal: false, publicLinkPreserved: true,
      initialSelectionRestored: true,
      message: "Seed local criado e conferido; senha, token e chave omitidos.",
    }, null, 2));
  } finally {
    await app.delete();
  }
}

run().catch((error) => {
  // Nao serializar erros do SDK: podem conter dados da requisicao.
  console.error("Seed local falhou.", error.code || error.name);
  process.exitCode = 1;
});
