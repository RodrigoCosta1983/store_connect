import assert from "node:assert/strict";
import fs from "node:fs";
import {before, after, test} from "node:test";
import {initializeTestEnvironment, assertSucceeds} from "@firebase/rules-unit-testing";
import {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField,
  increment, arrayUnion, Timestamp, runTransaction, writeBatch,
} from "firebase/firestore";

// Same Rules harness as the existing security suites; never use real credentials.
const endpoint = process.env.FIRESTORE_EMULATOR_HOST || "";
assert.match(endpoint, /^(127\.0\.0\.1|localhost):\d+$/);
const projectId = "demo-f10-e4b-rules";
const [host, port] = endpoint.split(":");
const roles = ["admin", "gerente", "operador", "caixa", "vendedor"];
const protectedFields = {
  productKind: "variantParent", variantSchemaVersion: 1, productId: "parent",
  variantId: "variant", attributes: {color: "blue"},
  attributeDefinitions: [{name: "color", values: ["blue"]}],
  priceCents: 1000, costCents: 500, commercial: {priceCents: 1000},
  commercialProfiles: {current: {priceCents: 1000}},
};
const simple = {name: "Simple", price: 10, quantidade: 5};
let env;
let serial = 0;
const client = (uid = "admin") => env.authenticatedContext(uid).firestore();
async function seed(data = simple) {
  const path = `stores/a/products/probe-${++serial}`;
  await env.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), path), data));
  return path;
}
async function denied(promise) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, "permission-denied");
    return true;
  });
}
async function unchanged(path, expected) {
  await env.withSecurityRulesDisabled(async context => {
    assert.deepEqual((await getDoc(doc(context.firestore(), path))).data(), expected);
  });
}
before(async () => {
  env = await initializeTestEnvironment({projectId, firestore: {
    host, port: Number(port), rules: fs.readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8"),
  }});
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "stores/a"), {name: "A"});
    await setDoc(doc(db, "stores/b"), {name: "B"});
    // This suite characterizes structural immutability under permitted legacy
    // writes. Current Rules deny all stock writes without a valid admission.
    // Absent/draining/authoritative denial remains covered by admission suites.
    for (const storeId of ["a", "b"]) await setDoc(doc(db, `storeWriterAdmission/${storeId}`), {
      schemaVersion: 1, mode: "legacy", epoch: 1, policyRevision: "f9-commercial-admission-1",
      changedBy: "fixture", changedAt: Timestamp.fromMillis(2000000000000), lastTransitionId: "fixture",
    });
    for (const role of roles) await setDoc(doc(db, `users/${role}`), {role, storeId: "a"});
    for (const [uid, profile] of [
      ["other", {role: "admin", storeId: "b"}],
      ["unknown", {role: "unknown", storeId: "a"}],
      ["revoked", {role: "admin", storeId: "a", accessStatus: " REVOKED "}],
    ]) await setDoc(doc(db, `users/${uid}`), profile);
  });
});
after(async () => { if (env) await env.cleanup(); });

for (const role of roles) {
  test(`A/G legitimate simple updates and unchanged protected fields [${role}]`, async () => {
    for (const markers of [{}, {productKind: "simple", variantSchemaVersion: 1}, protectedFields]) {
      const original = {...simple, ...markers};
      const path = await seed(original);
      const ref = doc(client(role), path);
      await assertSucceeds(updateDoc(ref, {quantidade: increment(-1)}));
      await assertSucceeds(setDoc(ref, {...original, quantidade: 4, price: 12}));
      await unchanged(path, {...original, quantidade: 4, price: 12});
    }
  });
  test(`B all protected additions denied, including merge [${role}]`, async () => {
    const path = await seed();
    const ref = doc(client(role), path);
    for (const [field, value] of Object.entries(protectedFields)) {
      await denied(updateDoc(ref, {[field]: value}));
      await denied(setDoc(ref, {[field]: null}, {merge: true}));
    }
    await unchanged(path, simple);
  });
  test(`C/D/F individual deleteField and total marker removal denied [${role}]`, async () => {
    const original = {...simple, ...protectedFields};
    const path = await seed(original);
    const ref = doc(client(role), path);
    for (const field of Object.keys(protectedFields)) {
      await denied(updateDoc(ref, {[field]: deleteField()}));
      const replacement = {...original};
      delete replacement[field];
      await denied(setDoc(ref, replacement));
    }
    await denied(updateDoc(ref, Object.fromEntries(Object.keys(protectedFields).map(k => [k, deleteField()]))));
    await denied(setDoc(ref, simple));
    await unchanged(path, original);
    // Actual parent without monetary markers: removal of every structural marker alone.
    const parent = {...simple, productKind: "variantParent", variantSchemaVersion: 1,
      attributeDefinitions: [{name: "color", values: ["blue"]}]};
    const parentPath = await seed(parent);
    await denied(updateDoc(doc(client(role), parentPath), {
      productKind: deleteField(), variantSchemaVersion: deleteField(), attributeDefinitions: deleteField(),
    }));
    await denied(setDoc(doc(client(role), parentPath), simple));
    await unchanged(parentPath, parent);
  });
}

for (const field of Object.keys(protectedFields)) {
  test(`E/F add/remove/change and malformed values remain immutable: ${field}`, async () => {
    for (const value of [null, "", {}, [], {partial: true}, ["partial"], 7]) {
      const original = {...simple, [field]: value};
      const path = await seed(original);
      const ref = doc(client(), path);
      await denied(updateDoc(ref, {[field]: value === null ? "changed" : null}));
      await denied(updateDoc(ref, {[field]: deleteField()}));
      await denied(setDoc(ref, simple));
      await assertSucceeds(updateDoc(ref, {[field]: value, quantidade: 4}));
      await unchanged(path, {...original, quantidade: 4});
    }
  });
}
test("F nested partial updates and transforms cannot change protected roots", async () => {
  const original = {...simple, ...protectedFields};
  const path = await seed(original);
  const ref = doc(client(), path);
  for (const patch of [
    {"attributes.color": "red"}, {"commercial.priceCents": 1},
    {"commercialProfiles.current": deleteField()}, {"attributes.color": deleteField()},
    {variantSchemaVersion: increment(1)}, {priceCents: increment(1)},
    {attributeDefinitions: arrayUnion({name: "size"})},
  ]) await denied(updateDoc(ref, patch));
  await unchanged(path, original);
});
test("H/I/J authentication, store, role and revocation remain enforced", async () => {
  const path = await seed();
  for (const db of [client("other"), client("unknown"), client("revoked"), client("missing"),
    env.unauthenticatedContext().firestore()]) {
    await denied(updateDoc(doc(db, path), {quantidade: 4}));
    await denied(updateDoc(doc(db, path), {productKind: "simple"}));
  }
  await unchanged(path, simple);
});
test("K product create/delete remain denied for every operational role", async () => {
  const path = await seed();
  for (const role of roles) {
    await denied(setDoc(doc(client(role), `${path}-new-${role}`), simple));
    await denied(deleteDoc(doc(client(role), path)));
  }
  await unchanged(path, simple);
});
test("L/M descendants, code reservations and audit writes keep their permissions", async () => {
  const paths = [
    "stores/a/products/p/variants/v", "stores/a/products/p/variantCombinations/c",
    "stores/a/products/p/commercialProfiles/current",
    "stores/a/products/p/variants/v/commercialProfiles/current",
    "stores/a/productCodes/code", "stores/a/auditLogs/receipt",
  ];
  await env.withSecurityRulesDisabled(async context => {
    for (const path of paths) await setDoc(doc(context.firestore(), path), {value: 1});
  });
  for (const role of roles) {
    const db = client(role);
    for (const path of paths) {
      const ref = doc(db, path);
      await denied(setDoc(doc(db, `${path}-new`), {value: 2}));
      await denied(updateDoc(ref, {value: 2}));
      await denied(deleteDoc(ref));
      if (path.includes("/auditLogs/")) {
        await assertSucceeds(getDoc(ref));
      } else {
        await denied(getDoc(ref));
        await denied(getDocs(collection(db, path.slice(0, path.lastIndexOf("/")))));
      }
    }
  }
});
test("N COD, taxonomy and archive add/change/remove remain denied", async () => {
  const existing = {cod: "OLD", categoryIds: ["c"], categoryId: "c", categoryName: "C",
    isArchived: false, archivedAt: Timestamp.fromMillis(1000), archivedBy: "admin", archiveReason: "history"};
  for (const role of roles) {
    const plainPath = await seed();
    const original = {...simple, ...existing};
    const path = await seed(original);
    for (const [field, value] of Object.entries(existing)) {
      await denied(updateDoc(doc(client(role), plainPath), {[field]: value}));
      await denied(updateDoc(doc(client(role), path), {[field]: null}));
      await denied(updateDoc(doc(client(role), path), {[field]: deleteField()}));
    }
    await assertSucceeds(updateDoc(doc(client(role), path), {...existing, quantidade: 4}));
    await unchanged(path, {...original, quantidade: 4});
  }
});
for (const mode of ["transaction", "batch"]) {
  test(`A F9 simple stock/lots plus sale still commits atomically: ${mode}`, async () => {
    const path = await seed({...simple, lotes: [{quantidade: 5, validade: Timestamp.fromMillis(1000)}]});
    const db = client();
    const ref = doc(db, path);
    const saleRef = doc(db, `stores/a/sales/${mode}`);
    const sale = {storeId: "a", products: [{productId: ref.id, quantity: 1}], totalAmount: 10};
    if (mode === "transaction") {
      await assertSucceeds(runTransaction(db, async tx => {
        const data = (await tx.get(ref)).data();
        tx.update(ref, {quantidade: 4, lotes: [{...data.lotes[0], quantidade: 4}]});
        tx.set(saleRef, sale);
      }));
    } else {
      const batch = writeBatch(db);
      batch.update(ref, {quantidade: increment(-1)});
      batch.set(saleRef, sale);
      await assertSucceeds(batch.commit());
    }
    assert.equal((await getDoc(ref)).data().quantidade, 4);
    assert.deepEqual((await getDoc(saleRef)).data(), sale);
  });
}
