import fs from "node:fs";
import assert from "node:assert/strict";
import {test, before, after} from "node:test";
import {initializeTestEnvironment, assertFails, assertSucceeds} from "@firebase/rules-unit-testing";
import {doc, setDoc, updateDoc, deleteField} from "firebase/firestore";
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
let env;
before(async () => {
  env = await initializeTestEnvironment({projectId: "demo-consolidation-financial", firestore: {host, port: +port,
    rules: fs.readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8")}});
  await env.withSecurityRulesDisabled(async c => {
    await setDoc(doc(c.firestore(), "stores/pilot"), {ownerId: "admin", blockedAt: "old", subscriptionInactiveReason: "overdue"});
    for (const role of ["admin", "gerente", "operador", "outsider"]) await setDoc(doc(c.firestore(), `users/${role}`), {role, storeId: role === "outsider" ? "other" : "pilot"});
  });
});
after(async () => {if (env) await env.cleanup();});
for (const role of ["admin", "gerente", "operador", "outsider"]) for (const field of ["blockedAt", "subscriptionInactiveReason", "overdueDueDate", "asaasBindingEnvironment", "asaasBindingProjectId"]) {
  test(`${role} cannot set or delete financial authority ${field}`, async () => {
    const ref = doc(env.authenticatedContext(role).firestore(), "stores/pilot");
    await assertFails(updateDoc(ref, {[field]: "forged"}));
    if (["blockedAt", "subscriptionInactiveReason"].includes(field)) await assertFails(updateDoc(ref, {[field]: deleteField()}));
  });
}
test("operational own-store update still allowed", async () => {
  await assertSucceeds(updateDoc(doc(env.authenticatedContext("admin").firestore(), "stores/pilot"), {name: "Synthetic"}));
});
