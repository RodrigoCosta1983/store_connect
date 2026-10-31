import assert from "node:assert/strict";
import fs from "node:fs";
import {before, after, test} from "node:test";
import {initializeTestEnvironment, assertSucceeds} from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField,
  Timestamp, runTransaction,
} from "firebase/firestore";

// No credentials, production IDs or fallback endpoint. The SDK uses only this emulator.
const endpoint = process.env.FIRESTORE_EMULATOR_HOST || "";
assert.match(endpoint, /^(127\.0\.0\.1|localhost):\d+$/);
const [host, port] = endpoint.split(":");
const projectId = "demo-prod-p0-02";
const roles = ["admin", "gerente", "operador", "caixa", "vendedor"];
const time = Timestamp.fromDate(new Date("2026-10-19T12:00:00Z"));
const sale = () => ({storeId: "a", createdAt: time, localSaleId: "original",
  syncOrigin: "online", totalAmount: 10, isPaid: false,
  products: [{productId: "p", name: "Synthetic", price: 10, quantity: 1}]});
const cash = () => ({description: "Recebimento sintético", amount: 4,
  type: "Entrada", createdAt: time});
const deniedProfiles = [
  ["revoked", {role: "admin", storeId: "a", accessStatus: "revoked"}],
  ["revoked-normalized", {role: "caixa", storeId: "a", accessStatus: " \tReVoKeD\r\n"}],
  ["missing-role", {storeId: "a"}],
  ...[null, "", "   ", "owner", 1, true, [], {}].map((role, i) =>
    [`invalid-role-${i}`, {role, storeId: "a"}]),
  ["other-store", {role: "admin", storeId: "b"}],
  ["missing-store", {role: "admin"}],
  ["missing-profile", null],
  ["anonymous", null],
];
let env;
let serial = 0;
const path = (collection = "sales") => `stores/a/${collection}/probe-${++serial}`;
const client = uid => uid === "anonymous" ? env.unauthenticatedContext().firestore()
  : env.authenticatedContext(uid, {storeId: "a", role: "admin"}).firestore();
async function seed(at, data) {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), at), data));
  return at;
}
async function saved(at) {
  let data;
  await env.withSecurityRulesDisabled(async context => {
    const result = await getDoc(doc(context.firestore(), at));
    data = result.exists() ? result.data() : null;
  });
  return data;
}
async function denied(promise) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, "permission-denied");
    return true;
  });
}
before(async () => {
  env = await initializeTestEnvironment({projectId, firestore: {
    host, port: Number(port),
    rules: fs.readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8"),
  }});
  await env.clearFirestore();
  await seed("stores/a", {ownerId: "separate-owner", name: "Synthetic A"});
  await seed("stores/b", {ownerId: "other-owner", name: "Synthetic B"});
  for (const storeId of ["a", "b"]) await seed(`storeWriterAdmission/${storeId}`, {
    schemaVersion: 1, mode: "legacy", epoch: 1, policyRevision: "f9-commercial-admission-1",
    changedBy: "fixture", changedAt: time, lastTransitionId: "fixture",
  });
  for (const role of roles) {
    await seed(`users/${role}`, {role, storeId: "a", accessStatus: "active"});
    await seed(`users/legacy-${role}`, {role, storeId: "a"});
    await seed(`users/normalized-${role}`, {role: ` \t${role.toUpperCase()}\r\n`, storeId: "a"});
  }
  for (const [uid, profile] of deniedProfiles) if (profile) await seed(`users/${uid}`, profile);
});
after(async () => { if (env) await env.cleanup(); });

// These SAME denial expectations must fail before the Rules patch and pass after it.
for (const [uid] of deniedProfiles) {
  test(`deny sales/create [${uid}]`, async () => {
    const at = path();
    await denied(setDoc(doc(client(uid), at), sale()));
    assert.equal(await saved(at), null);
  });
  test(`deny sales/update [${uid}]`, async () => {
    const at = await seed(path(), sale());
    await denied(updateDoc(doc(client(uid), at), {isPaid: true, paidAmount: 4}));
    assert.deepEqual(await saved(at), sale());
  });
  test(`deny cash_flow/create [${uid}]`, async () => {
    const at = path("cash_flow");
    await denied(setDoc(doc(client(uid), at), cash()));
    assert.equal(await saved(at), null);
  });
}

for (const role of roles) {
  for (const prefix of ["", "legacy-", "normalized-"]) {
    test(`allow sale and receipt without owner-only [${prefix}${role}]`, async () => {
      const db = client(`${prefix}${role}`);
      const at = path();
      await assertSucceeds(setDoc(doc(db, at), sale()));
      await assertSucceeds(updateDoc(doc(db, at), {isPaid: true, paidAmount: 4}));
      const entry = path("cash_flow");
      await assertSucceeds(setDoc(doc(db, entry), cash()));
      assert.equal((await saved(at)).isPaid, true);
      assert.deepEqual(await saved(entry), cash());
    });
  }
  test(`sale/stock and debt receipt transactions remain authorized [${role}]`, async () => {
    const db = client(role);
    const product = await seed(path("products"), {name: "Synthetic", price: 10, quantidade: 3});
    const at = path();
    await assertSucceeds(runTransaction(db, async tx => {
      const original = await tx.get(doc(db, product));
      tx.update(doc(db, product), {quantidade: original.data().quantidade - 1});
      tx.set(doc(db, at), sale());
    }));
    const entry = path("cash_flow");
    await assertSucceeds(runTransaction(db, async tx => {
      await tx.get(doc(db, at));
      tx.update(doc(db, at), {paidAmount: 4, totalPaidAmount: 4,
        installments: [{number: 1, amount: 10, paidAmount: 4, isPaid: false, dueDate: time, paidAt: null}]});
      tx.set(doc(db, entry), cash());
    }));
    assert.equal((await saved(product)).quantidade, 2);
    assert.equal((await saved(at)).totalPaidAmount, 4);
    assert.deepEqual(await saved(entry), cash());
  });
  test(`generic match cannot reauthorize delete, immutable cash or nested paths [${role}]`, async () => {
    const db = client(role);
    const at = await seed(path(), sale());
    const entry = await seed(path("cash_flow"), cash());
    await denied(deleteDoc(doc(db, at)));
    await denied(updateDoc(doc(db, entry), {amount: 8}));
    await denied(deleteDoc(doc(db, entry)));
    for (const parent of [at, entry]) {
      const nested = `${parent}/nested/child`;
      await denied(setDoc(doc(db, nested), {value: 1}));
      await seed(nested, {value: 1});
      await denied(updateDoc(doc(db, nested), {value: 2}));
      await denied(deleteDoc(doc(db, nested)));
      assert.deepEqual(await saved(nested), {value: 1});
    }
    assert.deepEqual(await saved(at), sale());
    assert.deepEqual(await saved(entry), cash());
  });
}

for (const [field, value] of Object.entries({storeId: "b", createdAt: Timestamp.fromMillis(1),
  localSaleId: "replaced", syncOrigin: "offline"})) {
  test(`protected sales field cannot change or disappear [${field}]`, async () => {
    const at = await seed(path(), sale());
    const ref = doc(client("operador"), at);
    await denied(updateDoc(ref, {[field]: value}));
    await denied(updateDoc(ref, {[field]: deleteField()}));
    await denied(setDoc(ref, {[field]: value}, {merge: true}));
    const replacement = sale();
    delete replacement[field];
    await denied(setDoc(ref, replacement));
    assert.deepEqual(await saved(at), sale());
    await assertSucceeds(setDoc(ref, {...sale(), notes: "Preserved identity"}));
  });
}

for (const [i, status] of [null, "", "unknown", " ACTIVE ", 1, false, [], {}].entries()) {
  test(`canonical accessStatus compatibility stays unchanged [${i}]`, async () => {
    const uid = `status-${i}`;
    await seed(`users/${uid}`, {role: "operador", storeId: "a", accessStatus: status});
    const db = client(uid);
    const at = path();
    await assertSucceeds(setDoc(doc(db, at), sale()));
    await assertSucceeds(updateDoc(doc(db, at), {paidAmount: 4}));
    await assertSucceeds(setDoc(doc(db, path("cash_flow")), cash()));
  });
}

test("sales create cannot forge storeId", async () => {
  await denied(setDoc(doc(client("admin"), path()), {...sale(), storeId: "b"}));
});
test("cash schema remains strict including merge on existing entry", async () => {
  for (const invalid of [{...cash(), extra: true}, {...cash(), amount: 0},
    {...cash(), amount: -1}, {...cash(), amount: "4"}, {...cash(), type: "invalid"},
    {...cash(), createdAt: "2026-10-19"}, {amount: 4, type: "Entrada", createdAt: time}]) {
    await denied(setDoc(doc(client("admin"), path("cash_flow")), invalid));
  }
  const at = await seed(path("cash_flow"), cash());
  await denied(setDoc(doc(client("admin"), at), {amount: 5}, {merge: true}));
  assert.deepEqual(await saved(at), cash());
});
test("revoked receipt transaction leaves both debt and cash unchanged", async () => {
  const at = await seed(path(), sale());
  const entry = path("cash_flow");
  const db = client("revoked");
  await denied(runTransaction(db, async tx => {
    await tx.get(doc(db, at));
    tx.update(doc(db, at), {paidAmount: 4});
    tx.set(doc(db, entry), cash());
  }));
  assert.deepEqual(await saved(at), sale());
  assert.equal(await saved(entry), null);
});
test("live profile revocation applies to an existing authenticated context", async () => {
  const uid = "live-profile";
  await seed(`users/${uid}`, {role: "operador", storeId: "a"});
  const db = client(uid);
  const at = path();
  await assertSucceeds(setDoc(doc(db, at), sale()));
  await seed(`users/${uid}`, {role: "operador", storeId: "a", accessStatus: "revoked"});
  await denied(updateDoc(doc(db, at), {isPaid: true}));
  await denied(setDoc(doc(db, path()), sale()));
  await denied(setDoc(doc(db, path("cash_flow")), cash()));
  assert.deepEqual(await saved(at), sale());
});
