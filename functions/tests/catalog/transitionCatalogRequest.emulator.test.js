"use strict";

const assert = require("node:assert/strict");
const admin = require("firebase-admin");
const {transitionCatalogRequest} = require("../../catalog/createCatalog");

const HOST = "127.0.0.1:8080";
const PROJECT_ID = "store-connect-app";

function db() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, HOST);
  if (admin.apps.length === 0) admin.initializeApp({projectId: PROJECT_ID});
  return admin.firestore();
}

async function main() {
  const firestore = db();
  const suffix = Date.now().toString(36);
  const storeId = "transition-store-" + suffix;
  const requestId = "request-" + suffix;
  const store = firestore.collection("stores").doc(storeId);
  const otherStore = firestore.collection("stores").doc(storeId + "-other");
  const requestRef = store.collection("catalogRequests").doc(requestId);
  const adminUid = "admin-" + suffix;
  const operatorUid = "operator-" + suffix;
  const otherOperatorUid = "operator-other-" + suffix;
  const managerUid = "manager-" + suffix;
  const namelessUid = "nameless-" + suffix;
  const caixaUid = "caixa-" + suffix;
  const vendedorUid = "vendedor-" + suffix;
  const otherUid = "other-" + suffix;
  const profile = (uid, role, extra = {}) => firestore.collection("users").doc(uid)
      .set({storeId, role, accessStatus: "active", fullName: uid, ...extra});
  const call = (uid, data) => transitionCatalogRequest.run({auth: {uid}, data});
  const expectError = async (run, code, reason) => {
    await assert.rejects(run, (error) => {
      assert.equal(error.code, code);
      if (reason) assert.equal(error.details?.reason, reason);
      return true;
    });
  };

  try {
    await store.set({name: "Teste"});
    await otherStore.set({name: "Outra"});
    await profile(adminUid, "admin", {fullName: "Administrador"});
    await profile(operatorUid, "operador", {fullName: "Operador"});
    await profile(otherOperatorUid, "operador", {fullName: "Outro Operador"});
    await profile(managerUid, "gerente", {fullName: "Gerente"});
    await profile(namelessUid, "operador", {fullName: null});
    await profile(caixaUid, "caixa", {fullName: "Caixa"});
    await profile(vendedorUid, "vendedor", {fullName: "Vendedor"});
    await profile(otherUid, "admin", {storeId: storeId + "-other"});
    await requestRef.set({
      catalogId: "catalog-1", status: "pending", source: "public_catalog",
      itemCount: 1, totalUnits: 1, totalAmount: 10,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    });
    await requestRef.collection("items").doc("item-1").set({
      productId: "p1", name: "Produto", quantity: 1, price: 10, subtotal: 10,
    });
    const seedRequest = async (id, status = "pending", fields = {}) => {
      const ref = store.collection("catalogRequests").doc(id);
      await ref.set({
        catalogId: "catalog-1", status, source: "public_catalog",
        itemCount: 1, totalUnits: 1, totalAmount: 10,
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(), ...fields,
      });
      return ref;
    };
    const auditEntries = async (ref) =>
      (await store.collection("auditLogs").where("entityId", "==", ref.id).get())
          .docs.map((snapshot) => snapshot.data());

    await expectError(() => call("missing", {requestId, action: "start"}), "permission-denied");
    await expectError(() => call(adminUid, {requestId, action: "invalid"}), "invalid-argument", "invalid-action");
    await expectError(() => call(otherUid, {requestId, action: "start"}), "not-found");

    const started = await call(operatorUid, {requestId, action: "start"});
    assert.deepEqual(started, {success: true, requestId, changed: true, status: "in_progress"});
    let saved = (await requestRef.get()).data();
    assert.equal(saved.status, "in_progress");
    assert.equal(saved.attendedByUid, operatorUid);
    assert.equal(saved.attendedByName, "Operador");
    assert(saved.attendedAt instanceof admin.firestore.Timestamp);
    const startAudits = await auditEntries(requestRef);
    assert.equal(startAudits.length, 1);
    assert.equal(startAudits[0].action, "catalog_request_started");
    assert.deepEqual(startAudits[0].before, {status: "pending"});
    assert.deepEqual(startAudits[0].after, {status: "in_progress"});
    const replay = await call(operatorUid, {requestId, action: "start"});
    assert.deepEqual(replay, {success: true, requestId, changed: false, status: "in_progress"});
    assert.equal((await store.collection("auditLogs").get()).size, 1);

    await expectError(() => call(otherOperatorUid, {requestId, action: "complete"}), "permission-denied", "catalog-request-not-assignee");
    const completed = await call(adminUid, {requestId, action: "complete"});
    assert.deepEqual(completed, {success: true, requestId, changed: true, status: "completed"});
    saved = (await requestRef.get()).data();
    assert.equal(saved.completedByUid, adminUid);
    assert(saved.completedAt instanceof admin.firestore.Timestamp);

    const completeReplay = await call(adminUid, {requestId, action: "complete"});
    assert.deepEqual(completeReplay, {success: true, requestId, changed: false, status: "completed"});
    await expectError(() => call(adminUid, {requestId, action: "cancel"}), "failed-precondition", "catalog-request-terminal");
    assert.equal((await store.collection("auditLogs").get()).size, 2);

    // pending + cancel, incluindo actor sem nome e replay sem nova escrita.
    const pendingCancel = await seedRequest("pending-cancel");
    const pendingBefore = (await pendingCancel.get()).data();
    const cancelled = await call(namelessUid, {
      requestId: pendingCancel.id, action: "cancel",
    });
    assert.deepEqual(cancelled, {
      success: true, requestId: pendingCancel.id, changed: true, status: "cancelled",
    });
    let pendingSaved = (await pendingCancel.get()).data();
    assert.equal(pendingSaved.cancelledByUid, namelessUid);
    assert.equal(pendingSaved.cancelledByName, null);
    assert(pendingSaved.cancelledAt instanceof admin.firestore.Timestamp);
    assert(pendingSaved.updatedAt instanceof admin.firestore.Timestamp);
    assert.equal(pendingSaved.updatedAt.isEqual(pendingBefore.updatedAt), false);
    assert.equal(pendingSaved.attendedByUid, undefined);
    let pendingAudits = await auditEntries(pendingCancel);
    assert.equal(pendingAudits.length, 1);
    assert.equal(pendingAudits[0].action, "catalog_request_cancelled");
    const pendingReplayBefore = (await pendingCancel.get()).data();
    const pendingReplay = await call(namelessUid, {
      requestId: pendingCancel.id, action: "cancel",
    });
    assert.deepEqual(pendingReplay, {
      success: true, requestId: pendingCancel.id, changed: false, status: "cancelled",
    });
    const pendingReplayAfter = (await pendingCancel.get()).data();
    assert.equal(pendingReplayAfter.updatedAt.toMillis(), pendingReplayBefore.updatedAt.toMillis());
    assert.equal(pendingReplayAfter.cancelledAt.toMillis(), pendingReplayBefore.cancelledAt.toMillis());
    assert.equal((await auditEntries(pendingCancel)).length, 1);

    // in_progress + cancel pelo responsável preserva attendedBy*.
    const assignedCancel = await seedRequest("assigned-cancel");
    await call(operatorUid, {requestId: assignedCancel.id, action: "start"});
    const assignedBefore = (await assignedCancel.get()).data();
    const assignedResult = await call(operatorUid, {
      requestId: assignedCancel.id, action: "cancel",
    });
    assert.equal(assignedResult.status, "cancelled");
    const assignedSaved = (await assignedCancel.get()).data();
    assert.equal(assignedSaved.attendedByUid, operatorUid);
    assert.equal(assignedSaved.cancelledByUid, operatorUid);
    assert(assignedSaved.cancelledAt instanceof admin.firestore.Timestamp);
    assert.equal(assignedSaved.attendedAt.toMillis(), assignedBefore.attendedAt.toMillis());
    assert.equal((await auditEntries(assignedCancel)).filter((x) => x.action === "catalog_request_cancelled").length, 1);

    // Operador diferente é negado sem escrita ou auditoria.
    const deniedCancel = await seedRequest("denied-cancel");
    await call(operatorUid, {requestId: deniedCancel.id, action: "start"});
    const deniedBefore = (await deniedCancel.get()).data();
    await expectError(() => call(otherOperatorUid, {
      requestId: deniedCancel.id, action: "cancel",
    }), "permission-denied", "catalog-request-not-assignee");
    assert.deepEqual((await deniedCancel.get()).data(), deniedBefore);
    assert.equal((await auditEntries(deniedCancel)).length, 1);

    // Gerente pode cancelar e concluir por override, preservando o responsável.
    const managerCancel = await seedRequest("manager-cancel");
    await call(operatorUid, {requestId: managerCancel.id, action: "start"});
    const managerCancelBefore = (await managerCancel.get()).data();
    assert.equal((await call(managerUid, {
      requestId: managerCancel.id, action: "cancel",
    })).status, "cancelled");
    const managerCancelled = (await managerCancel.get()).data();
    assert.equal(managerCancelled.attendedByUid, operatorUid);
    assert.equal(managerCancelled.cancelledByUid, managerUid);
    assert.equal(managerCancelled.attendedAt.toMillis(), managerCancelBefore.attendedAt.toMillis());
    assert.equal((await auditEntries(managerCancel)).filter((x) => x.action === "catalog_request_cancelled").length, 1);

    const managerComplete = await seedRequest("manager-complete");
    await call(operatorUid, {requestId: managerComplete.id, action: "start"});
    const managerCompleteBefore = (await managerComplete.get()).data();
    assert.equal((await call(managerUid, {
      requestId: managerComplete.id, action: "complete",
    })).status, "completed");
    const managerCompleted = (await managerComplete.get()).data();
    assert.equal(managerCompleted.attendedByUid, operatorUid);
    assert.equal(managerCompleted.completedByUid, managerUid);
    assert.equal(managerCompleted.attendedAt.toMillis(), managerCompleteBefore.attendedAt.toMillis());
    assert.equal((await auditEntries(managerComplete)).filter((x) => x.action === "catalog_request_completed").length, 1);

    // Outro ator não pode repetir ação terminal.
    const terminalCancel = await seedRequest("terminal-cancel");
    await call(namelessUid, {requestId: terminalCancel.id, action: "cancel"});
    const terminalBefore = (await terminalCancel.get()).data();
    await expectError(() => call(managerUid, {
      requestId: terminalCancel.id, action: "cancel",
    }), "failed-precondition", "catalog-request-terminal");
    assert.deepEqual((await terminalCancel.get()).data(), terminalBefore);
    assert.equal((await auditEntries(terminalCancel)).length, 1);

    // Aliases caixa/vendedor seguem a semântica de operador.
    for (const [uid, id] of [[caixaUid, "caixa-start"], [vendedorUid, "vendedor-start"]]) {
      const aliasRequest = await seedRequest(id);
      assert.equal((await call(uid, {requestId: aliasRequest.id, action: "start"})).status,
          "in_progress");
    }
    // Dois STARTs concorrentes: somente um pode assumir a solicitacao.
    const concurrentStart = await seedRequest("concurrent-start");
    const raceUids = [operatorUid, otherOperatorUid];
    const raceResults = await Promise.allSettled(
        raceUids.map((uid) => call(uid, {
          requestId: concurrentStart.id, action: "start",
        })),
    );
    const raceEntries = raceResults.map((result, index) => ({
      result, uid: raceUids[index],
    }));
    const raceWinners = raceEntries.filter(
        ({result}) => result.status === "fulfilled");
    const raceLosers = raceEntries.filter(
        ({result}) => result.status === "rejected");
    assert.equal(raceWinners.length, 1);
    assert.equal(raceLosers.length, 1);
    assert.deepEqual(raceWinners[0].result.value, {
      success: true, requestId: concurrentStart.id,
      changed: true, status: "in_progress",
    });
    assert.equal(raceLosers[0].result.reason.code, "aborted");
    assert.equal(
        raceLosers[0].result.reason.details?.reason,
        "catalog-request-already-attended",
    );
    const concurrentSaved = (await concurrentStart.get()).data();
    assert.equal(concurrentSaved.status, "in_progress");
    assert.equal(concurrentSaved.attendedByUid, raceWinners[0].uid);
    const concurrentAudits = await auditEntries(concurrentStart);
    assert.equal(concurrentAudits.length, 1);
    assert.equal(
        concurrentAudits[0].action, "catalog_request_started");
    assert.deepEqual(
        concurrentAudits[0].before, {status: "pending"});
    assert.deepEqual(
        concurrentAudits[0].after, {status: "in_progress"});

    console.log("F7.9-D1 transitionCatalogRequest: lifecycle, replay, autorização e auditoria OK");
  } finally {
    const docs = await store.collection("catalogRequests").get();
    const logs = await store.collection("auditLogs").get();
    const batch = firestore.batch();
    for (const snapshot of docs.docs) batch.delete(snapshot.ref);
    for (const snapshot of logs.docs) batch.delete(snapshot.ref);
    batch.delete(store);
    batch.delete(otherStore);
    await batch.commit();
    for (const uid of [adminUid, operatorUid, otherOperatorUid, managerUid,
      namelessUid, caixaUid, vendedorUid, otherUid]) {
      await firestore.collection("users").doc(uid).delete();
    }
    await admin.app().delete();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
