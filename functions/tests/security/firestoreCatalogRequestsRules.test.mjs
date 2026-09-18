import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

const endpoint = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(endpoint || "", /^(127\.0\.0\.1|localhost):\d+$/);
const [host, port] = endpoint.split(":");
const projectId = "demo-taxonomy-rules";
const storeA = "store-a";
const storeB = "store-b";
let adminDb;
let env;

const profiles = [
  ["admin", {storeId: storeA, role: "admin", accessStatus: "active"}],
  ["gerente", {storeId: storeA, role: "gerente", accessStatus: "active"}],
  ["operador", {storeId: storeA, role: "operador", accessStatus: "active"}],
  ["caixa", {storeId: storeA, role: "caixa", accessStatus: "active"}],
  ["vendedor", {storeId: storeA, role: "vendedor", accessStatus: "active"}],
  ["revoked-operador", {storeId: storeA, role: "operador", accessStatus: "revoked"}],
  ["revoked-admin", {storeId: storeA, role: "admin", accessStatus: "revoked"}],
  ["unknown-role", {storeId: storeA, role: "desconhecida", accessStatus: "active"}],
  ["other-store-admin", {storeId: storeB, role: "admin", accessStatus: "active"}],
];

const paths = [
  ["parent", `stores/${storeA}/catalogRequests/request-1`],
  ["item", `stores/${storeA}/catalogRequests/request-1/items/item-1`],
  ["descendant", `stores/${storeA}/catalogRequests/request-1/futureChildren/child-1`],
  ["deep", `stores/${storeA}/catalogRequests/request-1/items/item-1/events/event-1`],
];

const denied = async (label, operation) => {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.code, "permission-denied", label);
    return true;
  });
};

function dbFor(uid) {
  if (uid === "anonymous") return env.unauthenticatedContext().firestore();
  return env.authenticatedContext(uid).firestore();
}

async function seedRequest(storeId, requestId = "request-1") {
  const root = adminDb.collection("stores").doc(storeId)
      .collection("catalogRequests").doc(requestId);
  await root.set({status: "pending", itemCount: 1});
  await root.collection("items").doc("item-1").set({productId: "p1", quantity: 1});
  await root.collection("futureChildren").doc("child-1").set({value: true});
  await root.collection("items").doc("item-1").collection("events")
      .doc("event-1").set({value: true});
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host,
      port: Number(port),
      rules: fs.readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8"),
    },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    adminDb = db;
    for (const [uid, profile] of profiles) await setDoc(doc(db, `users/${uid}`), profile);
    await setDoc(doc(db, `stores/${storeA}`), {name: "A"});
    await setDoc(doc(db, `stores/${storeB}`), {name: "B"});
    await seedRequest(storeA);
    await seedRequest(storeB);
    await setDoc(doc(db, `stores/${storeA}/rulesProbe/doc-1`), {value: 1});
    await setDoc(doc(db, `stores/${storeA}/rulesProbe/doc-1/deep/child-1`), {value: 2});
  });
});

after(async () => { if (env) await env.cleanup(); });

test("catalogRequests bloqueia get/list/create/update/delete em todos os perfis e níveis", async () => {
  const operations = (db, ref) => ({
    get: () => getDoc(ref),
    list: () => getDocs(query(collection(db, ref.path.substring(0, ref.path.lastIndexOf("/"))))),
    create: () => setDoc(doc(db, `${ref.path}-new`), {created: true}),
    update: () => updateDoc(ref, {changed: true}),
    delete: () => deleteDoc(ref),
  });
  for (const [uid] of profiles.concat([["missing-profile", null], ["anonymous", null]])) {
    const db = dbFor(uid);
    for (const [level, path] of paths) {
      const ref = doc(db, path);
      for (const [operation, action] of Object.entries(operations(db, ref))) {
        await denied(`${uid}/${level}/${operation}`, action);
      }
    }
  }
});

test("substituição, merge e batch não escrevem parcialmente", async () => {
  for (const [uid] of profiles.concat([["missing-profile", null], ["anonymous", null]])) {
    const db = dbFor(uid);
    const parent = doc(db, `stores/${storeA}/catalogRequests/request-1`);
    await denied(`${uid}/replace`, () => setDoc(parent, {replaced: true}));
    await denied(`${uid}/merge`, () => setDoc(parent, {merged: true}, {merge: true}));
    const batch = writeBatch(db);
    batch.set(doc(db, `stores/${storeA}/catalogRequests/new-batch`), {created: true});
    batch.set(doc(db, `stores/${storeA}/catalogRequests/new-batch/items/item-1`), {created: true});
    await denied(`${uid}/batch`, () => batch.commit());
  }
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await assertSucceeds(getDoc(doc(db, `stores/${storeA}/catalogRequests/request-1`)));
    assert.equal((await getDoc(doc(db, `stores/${storeA}/catalogRequests/new-batch`))).exists(), false);
  });
});

test("collectionGroup não oferece leitura indireta", async () => {
  for (const [uid] of profiles.concat([["missing-profile", null], ["anonymous", null]])) {
    const db = dbFor(uid);
    for (const collectionId of ["catalogRequests", "items", "futureChildren", "events"]) {
      await denied(`${uid}/collectionGroup/${collectionId}`, () =>
        getDocs(query(collectionGroup(db, collectionId))));
    }
  }
});

test("coleção genérica não relacionada continua permitida na própria loja", async () => {
  for (const [uid] of profiles) {
    if (uid === "other-store-admin") continue;
    const db = dbFor(uid);
    const ref = doc(db, `stores/${storeA}/rulesProbe/doc-1`);
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(getDocs(query(collection(db, `stores/${storeA}/rulesProbe`))));
    await assertSucceeds(setDoc(doc(db, `stores/${storeA}/rulesProbe/probe-${uid}`), {ok: true}));
    await assertSucceeds(updateDoc(ref, {value: 3}));
  }
  await denied("other-store/probe", () => getDoc(doc(dbFor("other-store-admin"),
      `stores/${storeA}/rulesProbe/doc-1`)));
  await env.withSecurityRulesDisabled(async (context) => {
    await assertSucceeds(getDoc(doc(context.firestore(), `stores/${storeA}/rulesProbe/doc-1/deep/child-1`)));
  });
});
