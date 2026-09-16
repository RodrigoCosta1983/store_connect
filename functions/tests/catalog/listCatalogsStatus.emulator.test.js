"use strict";

const assert = require("assert");
const admin = require("firebase-admin");

const {
  listCatalogs,
} = require("../../catalog/createCatalog");

if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId:
      process.env.GCLOUD_PROJECT ||
      "store-connect-app",
  });
}

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

async function main() {
  console.log("");
  console.log("============================================================");
  console.log("F7 - LIST CATALOGS / STATUS EFETIVO");
  console.log("============================================================");

  const suffix =
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const uid =
    `list-status-user-${suffix}`;

  const storeId =
    `list-status-store-${suffix}`;

  const userRef =
    db.collection("users").doc(uid);

  const storeRef =
    db.collection("stores").doc(storeId);

  const catalogsRef =
    storeRef.collection("catalogs");

  const activeFutureId =
    `active-future-${suffix}`;

  const activeExpiredId =
    `active-expired-${suffix}`;

  const inactiveFutureId =
    `inactive-future-${suffix}`;

  const now = Date.now();

  const futureExpiration =
    Timestamp.fromMillis(
      now + (24 * 60 * 60 * 1000),
    );

  const pastExpiration =
    Timestamp.fromMillis(
      now - (24 * 60 * 60 * 1000),
    );

  const createdAt =
    Timestamp.fromMillis(
      now - (60 * 1000),
    );

  try {
    await userRef.set({
      storeId,
      role: "admin",
      accessStatus: "active",
    });

    await storeRef.set({
      ownerId: uid,
      publicSlug: `status-${suffix}`,
      subscriptionStatus: "active",
    });

    await catalogsRef
      .doc(activeFutureId)
      .set({
        title: "Ativo futuro",
        status: "active",
        createdAt,
        expiresAt: futureExpiration,
        productCount: 1,
      });

    await catalogsRef
      .doc(activeExpiredId)
      .set({
        title: "Ativo vencido",
        status: "active",
        createdAt,
        expiresAt: pastExpiration,
        productCount: 1,
      });

    await catalogsRef
      .doc(inactiveFutureId)
      .set({
        title: "Inativo futuro",
        status: "inactive",
        createdAt,
        expiresAt: futureExpiration,
        productCount: 1,
      });

    const result =
      await listCatalogs.run({
        auth: {
          uid,
        },
        data: {},
      });

    assert.strictEqual(
      result.success,
      true,
    );

    assert(
      Array.isArray(result.catalogs),
      "catalogs deveria ser uma lista.",
    );

    const byId =
      new Map(
        result.catalogs.map(
          (catalog) => [
            catalog.catalogId,
            catalog,
          ],
        ),
      );

    const activeFuture =
      byId.get(activeFutureId);

    const activeExpired =
      byId.get(activeExpiredId);

    const inactiveFuture =
      byId.get(inactiveFutureId);

    assert(
      activeFuture,
      "Catalogo ativo futuro nao foi listado.",
    );

    assert(
      activeExpired,
      "Catalogo ativo vencido nao foi listado.",
    );

    assert(
      inactiveFuture,
      "Catalogo inativo nao foi listado.",
    );

    assert.strictEqual(
      activeFuture.status,
      "active",
    );

    console.log(
      "OK - active futuro permaneceu active",
    );

    assert.strictEqual(
      activeExpired.status,
      "expired",
    );

    console.log(
      "OK - active vencido retornou expired",
    );

    assert.strictEqual(
      inactiveFuture.status,
      "inactive",
    );

    console.log(
      "OK - inactive permaneceu inactive",
    );

    console.log("");
    console.log("============================================================");
    console.log("F7 LIST CATALOGS / STATUS EFETIVO PASSOU");
    console.log("============================================================");
  } finally {
    await Promise.all([
      catalogsRef.doc(activeFutureId).delete(),
      catalogsRef.doc(activeExpiredId).delete(),
      catalogsRef.doc(inactiveFutureId).delete(),
    ]);

    await storeRef.delete();
    await userRef.delete();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("");
    console.error(
      "F7 LIST CATALOGS / STATUS EFETIVO FALHOU",
    );
    console.error(error);
    process.exit(1);
  });