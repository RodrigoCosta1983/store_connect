"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const admin = require("firebase-admin");
const {listCatalogRequests} = require("../../catalog/createCatalog");

async function main() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080",
      "Este teste exige o Firestore Emulator local.");
  admin.initializeApp({projectId: "store-connect-app"});
  const db = admin.firestore();
  const {Timestamp} = admin.firestore;
  const suffix = crypto.randomBytes(8).toString("hex");
  const uid = "list-requests-" + suffix;
  const user = db.collection("users").doc(uid);
  const store = db.collection("stores").doc(uid);
  const otherStore = db.collection("stores").doc(uid + "-other");
  const requests = store.collection("catalogRequests");
  const profile = {storeId: store.id, role: "admin", accessStatus: "active"};
  const call = (data) => listCatalogRequests.run({auth: {uid}, data});
  const fails = (action, code) => assert.rejects(action, (error) => {
    assert.equal(error.code, code);
    if (code === "internal") {
      assert.equal(error.message, "Não foi possível carregar as solicitações.");
    }
    return true;
  });
  const base = {
    catalogId: "catalogo-removido", status: "pending", source: "public_catalog",
    itemCount: 2, totalUnits: 3, totalAmount: 12.34,
    createdAt: Timestamp.fromMillis(1700000000000),
    updatedAt: Timestamp.fromMillis(1700000000123),
  };

  // Intercepta o transporte apenas durante as chamadas da funcao:
  // qualquer escrita ou leitura fora dos caminhos permitidos falha no teste.
  const originalRequest = db.request;
  const originalStream = db.requestStream;
  let guarded = false;
  let allowedStore = store;
  db.request = function(method, request, ...rest) {
    if (guarded) {
      assert.equal(method, "batchGetDocuments", "Operacao inesperada: " + method);
      for (const path of request.documents) {
        assert([user.path, allowedStore.path].some(
            (allowed) => path.endsWith("/documents/" + allowed)), path);
      }
    }
    return originalRequest.call(this, method, request, ...rest);
  };
  db.requestStream = function(method, bidirectional, request, ...rest) {
    if (guarded) {
      if (method === "batchGetDocuments") {
        for (const path of request.documents) {
          assert([user.path, allowedStore.path].some(
              (allowed) => path.endsWith("/documents/" + allowed)), path);
        }
      } else {
        assert.equal(method, "runQuery", "Operacao inesperada: " + method);
        assert(request.parent.endsWith("/documents/" + allowedStore.path));
        assert.deepEqual(request.structuredQuery.from,
            [{collectionId: "catalogRequests"}]);
      }
    }
    return originalStream.call(this, method, bidirectional, request, ...rest);
  };
  const read = async (data) => {
    guarded = true;
    try {
      return await call(data);
    } finally {
      guarded = false;
    }
  };

  try {
    await fails(() => listCatalogRequests.run({data: {}}), "unauthenticated");
    await fails(() => read({}), "permission-denied");
    await user.set({...profile, accessStatus: " ReVoKeD "});
    await fails(() => read({}), "permission-denied");
    for (const role of ["owner", "", null]) {
      await user.set({...profile, role});
      await fails(() => read({}), "permission-denied");
    }
    await user.set({role: "admin"});
    await fails(() => read({}), "failed-precondition");
    await user.set(profile);
    await fails(() => read({}), "not-found");
    await store.set({subscriptionStatus: "canceled"});
    for (const role of ["admin", "gerente", "operador", " CAIXA ", "Vendedor"]) {
      await user.set({...profile, role});
      assert.deepEqual(await read({}), {success: true, requests: []});
    }
    // Ausencia/outros estados de acesso e assinatura nao criam novos bloqueios.
    for (const accessStatus of [undefined, "", "pending"]) {
      const next = {...profile};
      if (accessStatus === undefined) delete next.accessStatus;
      else next.accessStatus = accessStatus;
      await user.set(next);
      assert.deepEqual(await read(null), {success: true, requests: []});
    }
    assert.deepEqual(await read(), {success: true, requests: []});
    for (const data of [false, 0, "", "text", [], [1],
      {storeId: otherStore.id}, {limit: 1}, {extra: null}]) {
      await fails(() => read(data), "invalid-argument");
    }

    await otherStore.set({});
    await otherStore.collection("catalogRequests").doc("other").set(base);
    const batch = db.batch();
    for (let i = 0; i < 55; i += 1) {
      batch.set(requests.doc("request-" + i), {
        ...base, createdAt: Timestamp.fromMillis(1700000000000 + i * 1000),
        items: ["nao-retornar"], privateField: "nao-retornar",
      });
    }
    const missingDate = {...base};
    delete missingDate.createdAt;
    batch.set(requests.doc("missing-date"), missingDate);
    await batch.commit();
    // Nao existem catalogos, produtos ou itens: leitura nao depende deles.
    const before = await requests.get();
    const result = await read({});
    assert.deepEqual(Object.keys(result).sort(), ["requests", "success"]);
    assert.equal(result.requests.length, 50);
    assert.deepEqual(result.requests.map((entry) => entry.requestId),
        Array.from({length: 50}, (_, i) => "request-" + (54 - i)));
    const keys = ["requestId", "catalogId", "status", "itemCount", "totalUnits",
      "totalAmount", "createdAt", "updatedAt", "source", "customerName",
      "customerPhone", "attendedByName"].sort();
    for (const entry of result.requests) {
      assert.deepEqual(Object.keys(entry).sort(), keys);
      assert.equal(entry.totalAmount, 12.34);
      assert.equal(entry.itemCount, 2);
      assert.equal(entry.totalUnits, 3);
      assert.equal(entry.status, "pending");
      assert.equal(entry.source, "public_catalog");
      assert.equal(entry.catalogId, base.catalogId);
      assert.equal(entry.updatedAt, base.updatedAt.toDate().toISOString());
    }
    assert.equal(result.requests[0].createdAt,
        new Date(1700000054000).toISOString());
    // orderBy exclui documentos sem createdAt, mesmo existentes no banco.
    assert((await requests.doc("missing-date").get()).exists);
    assert(!result.requests.some((entry) => entry.requestId === "missing-date"));
    const after = await requests.get();
    assert.deepEqual(after.docs.map((doc) => [doc.id, doc.data(), doc.updateTime]),
        before.docs.map((doc) => [doc.id, doc.data(), doc.updateTime]));

    await user.set({...profile, storeId: otherStore.id});
    allowedStore = otherStore;
    assert.deepEqual((await read({})).requests.map((entry) => entry.requestId),
        ["other"]);
    const probe = otherStore.collection("catalogRequests").doc("other");
    for (const timestamps of [
      {createdAt: null, updatedAt: "invalido"},
      {createdAt: "invalido", updatedAt: null},
      {createdAt: {seconds: 123}, updatedAt: {seconds: 123}},
    ]) {
      await probe.set({...base, ...timestamps});
      const entry = (await read({})).requests[0];
      assert.equal(entry.createdAt, null);
      assert.equal(entry.updatedAt, null);
    }
    const noUpdatedAt = {...base};
    delete noUpdatedAt.updatedAt;
    await probe.set(noUpdatedAt);
    assert.equal((await read({})).requests[0].updatedAt, null);
    await probe.set({...base, totalAmount: 0});
    assert.equal((await read({})).requests[0].totalAmount, 0);

    const invalidValues = {
      catalogId: [undefined, null, 1, " ", "a/b"],
      status: [undefined, null, 1, " "],
      source: [undefined, null, 1, " "],
      itemCount: [undefined, "2", 0, -1, 1.5, 201, 2 ** 53],
      totalUnits: [undefined, "3", 0, 1, 1.5, 2 ** 53],
      totalAmount: [undefined, null, "12.34", -1, NaN, Infinity, 1e20],
    };
    for (const [field, values] of Object.entries(invalidValues)) {
      for (const value of values) {
        const saved = {...base, [field]: value};
        if (value === undefined) delete saved[field];
        await probe.set(saved);
        await fails(() => read({}), "internal");
      }
    }
    console.log("F7.8-C1: autorizacao, isolamento, limite, snapshot e leitura OK");
  } finally {
    guarded = false;
    db.request = originalRequest;
    db.requestStream = originalStream;
    // Limpeza limitada aos documentos exclusivos deste teste no Emulator.
    for (const ref of [store, otherStore]) {
      const docs = await ref.collection("catalogRequests").get();
      const cleanup = db.batch();
      for (const doc of docs.docs) cleanup.delete(doc.ref);
      cleanup.delete(ref);
      await cleanup.commit();
    }
    await user.delete();
    await admin.app().delete();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
