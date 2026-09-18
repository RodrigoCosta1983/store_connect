"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const admin = require("firebase-admin");
const {getCatalogRequest} = require("../../catalog/createCatalog");

async function main() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080",
      "Este teste exige o Firestore Emulator local.");
  admin.initializeApp({projectId: "store-connect-app"});
  const db = admin.firestore();
  const {Timestamp} = admin.firestore;
  const uid = "get-request-" + crypto.randomBytes(8).toString("hex");
  const user = db.collection("users").doc(uid);
  const store = db.collection("stores").doc(uid);
  const otherStore = db.collection("stores").doc(uid + "-other");
  const parent = store.collection("catalogRequests").doc("pedido-curto");
  const otherParent = otherStore.collection("catalogRequests").doc(parent.id);
  const onlyOther = otherStore.collection("catalogRequests").doc("only-other");
  const bulk = store.collection("catalogRequests").doc("bulk");
  const product = store.collection("products").doc("p1");
  const catalog = store.collection("catalogs").doc("c1");
  const profile = {storeId: store.id, role: "admin", accessStatus: "active"};
  const base = {
    catalogId: catalog.id, status: "pending", source: "public_catalog",
    itemCount: 2, totalUnits: 3, totalAmount: 12.34,
    createdAt: Timestamp.fromMillis(1700000000000),
    updatedAt: Timestamp.fromMillis(1700000000123),
  };
  const first = {productId: "p1", name: "Nome historico",
    quantity: 2, price: 5, subtotal: 10};
  const second = {productId: "p2", name: "Outro historico",
    quantity: 1, price: 2.34, subtotal: 2.34};
  const fails = (action, code, message) => assert.rejects(action, (error) => {
    assert.equal(error.code, code);
    if (message) assert.equal(error.message, message);
    if (code === "internal") {
      assert.equal(error.message, "Não foi possível carregar a solicitação.");
    }
    return true;
  });

  // Guarda de transporte: nenhuma escrita, consulta global ou leitura atual.
  // Caminhos permitidos variam conforme o ponto de autorizacao testado.
  const originalRequest = db.request;
  const originalStream = db.requestStream;
  let guard = null;
  function inspect(method, request) {
    if (!guard) return;
    if (method === "batchGetDocuments") {
      for (const path of request.documents) {
        assert(guard.documents.some((p) => path.endsWith("/documents/" + p)), path);
      }
    } else {
      assert.equal(method, "runQuery", "Operacao proibida: " + method);
      assert(guard.items, "Itens nao podem ser consultados nesta chamada");
      assert(request.parent.endsWith("/documents/" + guard.items));
      assert.deepEqual(request.structuredQuery.from, [{collectionId: "items"}]);
    }
  }
  db.request = function(method, request, ...rest) {
    inspect(method, request);
    return originalRequest.call(this, method, request, ...rest);
  };
  db.requestStream = function(method, bidirectional, request, ...rest) {
    inspect(method, request);
    return originalStream.call(this, method, bidirectional, request, ...rest);
  };
  const read = async (data, ref = parent, options = {}) => {
    guard = {
      documents: options.documents || [user.path, store.path, ref.path],
      items: options.noItems ? null : ref.path,
    };
    try {
      return await getCatalogRequest.run({auth: {uid}, data});
    } finally {
      guard = null;
    }
  };
  const detail = () => read({requestId: parent.id});
  const authOnly = {documents: [user.path, store.path], noItems: true};
  async function seed(ref, data = base) {
    await ref.set({...data, requestId: "forged", privateField: "private"});
    await ref.collection("items").doc("z-item").set({...second, itemId: "forged"});
    await ref.collection("items").doc("a-item").set({...first, costPrice: 99});
  }
  async function persisted() {
    const doc = await parent.get();
    const items = await parent.collection("items").get();
    return [doc.data(), doc.updateTime,
      items.docs.map((item) => [item.id, item.data(), item.updateTime])];
  }

  try {
    guard = {documents: [], items: null};
    await fails(() => getCatalogRequest.run({data: {requestId: parent.id}}),
        "unauthenticated");
    guard = null;
    await fails(() => read({}, parent, authOnly), "permission-denied");
    await user.set({...profile, accessStatus: " ReVoKeD "});
    await fails(() => read({}, parent, authOnly), "permission-denied");
    for (const role of ["owner", "", null]) {
      await user.set({...profile, role});
      await fails(() => read({}, parent, authOnly), "permission-denied");
    }
    await user.set({role: "admin"});
    await fails(() => read({}, parent, authOnly), "failed-precondition");
    await user.set(profile);
    await fails(() => read({}, parent, authOnly), "not-found");
    await store.set({subscriptionStatus: "canceled"});
    await otherStore.set({});
    await seed(parent);
    const before = await persisted();
    const expected = {success: true, request: {
      requestId: parent.id, ...base,
      createdAt: base.createdAt.toDate().toISOString(),
      updatedAt: base.updatedAt.toDate().toISOString(),
      requestVersion: null,
      customerName: null, customerPhone: null, note: null,
      attendedByUid: null, attendedByName: null, attendedAt: null,
      completedByUid: null, completedByName: null, completedAt: null,
      cancelledByUid: null, cancelledByName: null, cancelledAt: null,
      items: [{itemId: "a-item", ...first}, {itemId: "z-item", ...second}],
    }};
    for (const role of ["admin", "gerente", "operador", " CAIXA ", "Vendedor"]) {
      await user.set({...profile, role});
      assert.deepEqual(await detail(), expected);
    }
    for (const accessStatus of [undefined, "", "pending"]) {
      const next = {...profile};
      if (accessStatus !== undefined) next.accessStatus = accessStatus;
      else delete next.accessStatus;
      await user.set(next);
      assert.deepEqual(await detail(), expected);
    }
    for (const data of [undefined, null, false, 1, "pedido", [], {},
      {requestId: null}, {requestId: 1}, {requestId: []}, {requestId: ""},
      {requestId: " "}, {requestId: "a/b"}, {requestId: parent.path},
      {requestId: "."}, {requestId: ".."}, {requestId: "__reserved__"},
      {requestId: "x".repeat(1501)}, {requestId: parent.id, storeId: otherStore.id},
      {requestId: parent.id, extra: null}]) {
      await fails(() => read(data, parent, authOnly), "invalid-argument");
    }
    assert.deepEqual(await read({requestId: "  " + parent.id + "  "}), expected);
    const absent = store.collection("catalogRequests").doc("absent");
    await fails(() => read({requestId: absent.id}, absent, {noItems: true}),
        "not-found", "Solicitação não encontrada.");
    await seed(onlyOther);
    const localOther = store.collection("catalogRequests").doc(onlyOther.id);
    await fails(() => read({requestId: onlyOther.id}, localOther, {noItems: true}),
        "not-found", "Solicitação não encontrada.");
    await seed(otherParent, {...base, totalAmount: 999});
    assert.deepEqual(await detail(), expected);

    await product.set({name: "Atual", price: 99, quantidade: 0});
    await catalog.set({status: "active", expiresAt: Timestamp.fromMillis(0)});
    assert.deepEqual(await detail(), expected);
    await product.update({name: "Alterado", price: 199, isArchived: true});
    assert.deepEqual(await detail(), expected);
    await product.delete();
    assert.deepEqual(await detail(), expected);
    await catalog.delete();
    assert.deepEqual(await detail(), expected);
    assert.deepEqual(await persisted(), before); // Inclui status e updatedAt.

    const batch = db.batch();
    batch.set(bulk, {...base, itemCount: 200, totalUnits: 200, totalAmount: 200});
    for (let i = 199; i >= 0; i -= 1) {
      batch.set(bulk.collection("items").doc(String(i).padStart(3, "0")), {
        productId: "p" + i, name: "Produto " + i, quantity: 1, price: 1, subtotal: 1,
      });
    }
    await batch.commit();
    const all = (await read({requestId: bulk.id}, bulk)).request.items;
    assert.equal(all.length, 200);
    assert.deepEqual(all.map((item) => item.itemId),
        Array.from({length: 200}, (_, i) => String(i).padStart(3, "0")));

    for (const timestamps of [{}, {createdAt: null, updatedAt: "invalid"},
      {createdAt: {seconds: 123}, updatedAt: null}]) {
      const data = {...base};
      delete data.createdAt;
      delete data.updatedAt;
      await parent.set({...data, ...timestamps});
      const response = (await detail()).request;
      assert.equal(response.createdAt, null);
      assert.equal(response.updatedAt, null);
    }
    for (const count of [1, 3]) {
      await parent.set({...base, itemCount: count});
      await fails(detail, "internal");
    }
    const invalidParents = {
      catalogId: [undefined, 1, "", "a/b"], status: [undefined, null, " "],
      source: [undefined, 1, " "], itemCount: [undefined, 0, 201, 1.5, "2"],
      totalUnits: [undefined, 1, -1, 1.5, 2 ** 53],
      totalAmount: [undefined, null, "12", -1, NaN, Infinity, 1e20],
    };
    for (const [field, values] of Object.entries(invalidParents)) {
      for (const value of values) {
        const data = {...base, [field]: value};
        if (value === undefined) delete data[field];
        await parent.set(data);
        await fails(detail, "internal");
      }
    }
    await parent.set(base);
    const invalidItems = {
      productId: [undefined, null, 1, " ", "a/b", first.productId],
      name: [undefined, 1, " "], quantity: [undefined, "1", 0, -1, 1.5, 2 ** 53],
      price: [undefined, null, "2.34", -1, NaN, Infinity, 1e20],
      subtotal: [undefined, null, "2.34", -1, NaN, Infinity, 1e20],
    };
    // Ultimo item invalido: nunca devolver apenas o primeiro item valido.
    for (const [field, values] of Object.entries(invalidItems)) {
      for (const value of values) {
        const data = {...second, [field]: value};
        if (value === undefined) delete data[field];
        await parent.collection("items").doc("z-item").set(data);
        await fails(detail, "internal");
      }
    }
    await parent.collection("items").doc("z-item").set({...second, price: 0, subtotal: 0});
    await parent.set({...base, totalAmount: 10});
    assert.equal((await detail()).request.items[1].price, 0);
    await parent.collection("items").doc("z-item").delete();
    await fails(detail, "internal");
    await parent.collection("items").doc("a-item").delete();
    await fails(detail, "internal");
    console.log("F7.8-C2: autorizacao, isolamento, snapshot, 200 itens e fail-closed OK");
  } finally {
    guard = null;
    db.request = originalRequest;
    db.requestStream = originalStream;
    // Somente fixtures exclusivas deste teste, no Emulator local.
    for (const ref of [parent, otherParent, onlyOther, bulk]) {
      const items = await ref.collection("items").get();
      const batch = db.batch();
      for (const item of items.docs) batch.delete(item.ref);
      batch.delete(ref);
      await batch.commit();
    }
    for (const ref of [product, catalog, user, store, otherStore]) await ref.delete();
    await admin.app().delete();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
