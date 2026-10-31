import assert from "node:assert/strict";
import fs from "node:fs";
import {test, before, after} from "node:test";
import {initializeTestEnvironment, assertSucceeds, assertFails} from "@firebase/rules-unit-testing";
import {doc, setDoc, updateDoc} from "firebase/firestore";

// Characterization of RESIDUAL bypasses, not acceptance of a completed fence.
const endpoint = process.env.FIRESTORE_EMULATOR_HOST || "";
assert.match(endpoint, /^(127\.0\.0\.1|localhost):\d+$/);
const [host, port] = endpoint.split(":");
let env;
before(async () => {
  env = await initializeTestEnvironment({projectId: "demo-admission-residual-02", firestore: {
    host, port: Number(port), rules: fs.readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8"),
  }});
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "users/u"), {role: "admin", storeId: "a", accessStatus: "active"});
    await setDoc(doc(db, "stores/a"), {ownerId: "u", subscriptionStatus: "active"});
    await setDoc(doc(db, "stores/a/products/p"), {name: "Synthetic", price: 1, quantidade: 5});
    await setDoc(doc(db, "localAdmissionTestFixtures/a"), {fixtureWriter: "paused", fixtureEpoch: 2});
  });
});
after(async () => { if (env) await env.cleanup(); });
const client = () => env.authenticatedContext("u").firestore();
test("existing rules deny direct client edits to this root-level fixture control", async () => {
  await assertFails(updateDoc(doc(client(), "localAdmissionTestFixtures/a"), {fixtureWriter: "v2"}));
});
test("RESIDUAL: arbitrary control subcollection under stores is client-writable via overlapping generic match", async () => {
  await assertSucceeds(setDoc(doc(client(), "stores/a/localAdmissionTestFixtures/control"),
    {fixtureWriter: "v2", fixtureEpoch: 999}));
});
test("official control absent now denies direct sales create and stock update despite unrelated fixture", async () => {
  const db = client();
  await assertFails(setDoc(doc(db, "stores/a/sales/direct"),
    {storeId: "a", totalAmount: 1, isPaid: true}));
  await assertFails(updateDoc(doc(db, "stores/a/products/p"), {quantidade: 4}));
});
