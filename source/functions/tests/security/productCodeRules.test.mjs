import assert from "node:assert/strict";
import fs from "node:fs";
import {before, after, beforeEach, test} from "node:test";
import {initializeTestEnvironment, assertFails, assertSucceeds} from "@firebase/rules-unit-testing";
import {doc, collection, query, where, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField} from "firebase/firestore";

assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
let env;
const roles = ["admin", "gerente", "operador", "caixa", "vendedor"];
before(async () => {
  env = await initializeTestEnvironment({projectId: "demo-f9-cod-rules", firestore: {
    host, port: Number(port), rules: fs.readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8"),
  }});
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "stores/a"), {name: "A"});
    await setDoc(doc(db, "stores/b"), {name: "B"});
    for (const role of roles) await setDoc(doc(db, `users/${role}`), {role, storeId: "a"});
    await setDoc(doc(db, "users/revoked"), {role: "admin", storeId: "a", accessStatus: "revoked"});
    await setDoc(doc(db, "stores/a/products/p"), {name: "Product", cod: "OLD", quantidade: 2});
    await setDoc(doc(db, "stores/a/products/legacy"), {name: "Legacy", quantidade: 2});
    await setDoc(doc(db, "stores/a/productCodes/k"), {cod: "OLD", productId: "p"});
    await setDoc(doc(db, "stores/a/products/archived"), {name: "Archived", cod: "ARCHIVED", isArchived: true});
    await setDoc(doc(db, "stores/a/productCodes/archived-code"), {cod: "ARCHIVED", productId: "archived"});
  });
});
after(async () => { if (env) await env.cleanup(); });

for (const role of roles) {
  test(`COD and reservations are backend-only; stock and precheck stay accessible [${role}]`, async () => {
    const db = env.authenticatedContext(role).firestore();
    const p = doc(db, "stores/a/products/p");
    const reservation = doc(db, "stores/a/productCodes/k");
    await assertFails(updateDoc(p, {cod: "NEW"}));
    await assertFails(updateDoc(p, {cod: deleteField()}));
    await assertFails(updateDoc(doc(db, "stores/a/products/legacy"), {cod: "NEW"}));
    await assertFails(setDoc(p, {name: "Replacement"}));
    await assertFails(setDoc(doc(db, "stores/a/products/new"), {cod: "NEW"}));
    await assertFails(getDoc(reservation));
    await assertFails(getDocs(collection(db, "stores/a/productCodes")));
    await assertFails(setDoc(doc(db, "stores/a/productCodes/new"), {cod: "NEW", productId: "p"}));
    await assertFails(updateDoc(reservation, {productId: "attacker"}));
    await assertFails(deleteDoc(reservation));
    await assertFails(setDoc(doc(db, "stores/a/productCodes/k/nested/new"), {cod: "NEW"}));
    await assertFails(deleteDoc(p));
    const archived = doc(db, "stores/a/products/archived");
    await assertFails(updateDoc(archived, {cod: "REUSED"}));
    await assertFails(updateDoc(archived, {cod: deleteField()}));
    await assertFails(updateDoc(archived, {isArchived: false}));
    await assertFails(updateDoc(p, {isArchived: true}));
    await assertFails(deleteDoc(archived));
    await assertFails(deleteDoc(doc(db, "stores/a/productCodes/archived-code")));
    await assertSucceeds(updateDoc(p, {quantidade: 1}));
    await assertSucceeds(updateDoc(p, {cod: "OLD", price: 10}));
    assert.equal((await getDocs(query(collection(db, "stores/a/products"), where("cod", "==", "OLD")))).size, 1);
    await assertFails(updateDoc(doc(db, "stores/b/products/p"), {cod: "THEFT"}));
  });
}
test("revoked and unauthenticated users cannot mutate COD or reservations", async () => {
  for (const db of [env.authenticatedContext("revoked").firestore(), env.unauthenticatedContext().firestore()]) {
    await assertFails(updateDoc(doc(db, "stores/a/products/p"), {cod: "NEW"}));
    await assertFails(setDoc(doc(db, "stores/a/productCodes/k"), {cod: "NEW", productId: "p"}));
  }
});
