import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, deleteField, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

// Refuse remote endpoints; all fixtures and requests belong to this demo only.
const projectId = "demo-taxonomy-rules";
const endpoint = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(endpoint ?? "", /^(127\.0\.0\.1|localhost):\d+$/);
const [host, port] = endpoint.split(":");
let env;
let db;
const product = (id, client = db) => doc(client, `stores/a/products/${id}`);
const category = (client = db) => doc(client, "stores/a/categories/c1");
const operational = { name: "Produto", price: 10, quantidade: 5 };
const legacy = { ...operational, categoryId: "c1", categoryName: "Categoria" };
const multi = { ...legacy, categoryIds: ["c1"] };

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host,
      port: Number(port),
      rules: fs.readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8"),
    },
  });
  db = env.authenticatedContext("operador").firestore();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const seed = context.firestore();
    for (const role of ["operador", "admin", "gerente"]) {
      await setDoc(doc(seed, `users/${role}`), { storeId: "a", role });
    }
    await setDoc(doc(seed, "users/other"), { storeId: "b", role: "admin" });
    await setDoc(product("plain", seed), operational);
    await setDoc(product("legacy", seed), legacy);
    await setDoc(product("multi", seed), multi);
    await setDoc(category(seed), { name: "Categoria" });
  });
});

after(async () => { if (env) await env.cleanup(); });

test("01 update operacional sem taxonomia", async () => {
  await assertSucceeds(updateDoc(product("plain"), { price: 12 }));
  assert.equal((await getDoc(product("plain"))).data().price, 12);
});

for (const [number, field, value, existing] of [
  ["02", "categoryIds", ["c1"], "multi"],
  ["05", "categoryId", "c2", "legacy"],
  ["07", "categoryName", "Outra", "legacy"],
]) {
  test(`${number} rejeita adicao de ${field}`, async () => {
    await assertFails(updateDoc(product("plain"), { [field]: value }));
  });
  test(`${field === "categoryIds" ? "03" : number} rejeita alteracao de ${field}`, async () => {
    await assertFails(updateDoc(product(existing), {
      [field]: field === "categoryIds" ? ["c2"] : value,
    }));
  });
}

for (const [number, field, existing] of [
  ["04", "categoryIds", "multi"],
  ["06", "categoryId", "legacy"],
  ["08", "categoryName", "legacy"],
]) {
  test(`${number} rejeita remocao de ${field}`, async () => {
    await assertFails(updateDoc(product(existing), { [field]: deleteField() }));
  });
}

for (const [number, field, value] of [
  ["09", "categoryIds", []],
  ["10", "categoryId", null],
  ["11", "categoryName", ""],
]) {
  test(`${number} rejeita CREATE contendo ${field}, inclusive vazio/null`, async () => {
    await assertFails(setDoc(product("new"), { ...operational, [field]: value }));
  });
}

test("12 permite CREATE sem taxonomia", async () => {
  await assertSucceeds(setDoc(product("new"), operational));
  assert.deepEqual((await getDoc(product("new"))).data(), operational);
});

test("13 outra loja nao pode ler/criar/editar/excluir produtos ou categorias", async () => {
  const other = env.authenticatedContext("other").firestore();
  for (const ref of [product("plain", other), category(other)]) {
    await assertFails(getDoc(ref));
    await assertFails(updateDoc(ref, { name: "Invasao" }));
    await assertFails(deleteDoc(ref));
  }
  await assertFails(setDoc(product("new", other), operational));
  await assertFails(setDoc(doc(other, "stores/a/categories/new"), { name: "Nova" }));
});

test("14 update operacional preserva campos legados", async () => {
  await assertSucceeds(updateDoc(product("legacy"), { ...legacy, price: 12 }));
  assert.deepEqual((await getDoc(product("legacy"))).data(), { ...legacy, price: 12 });
});

for (const [number, role] of [["15", "operador"], ["16", "admin"], ["17", "gerente"]]) {
  test(`${number} DELETE de categoria bloqueado para ${role}`, async () => {
    await assertFails(deleteDoc(category(env.authenticatedContext(role).firestore())));
    assert.equal((await getDoc(category())).exists(), true);
  });
}

test("18 leitura de categoria continua permitida", async () => {
  assert.equal((await assertSucceeds(getDoc(category()))).data().name, "Categoria");
});
test("19 CREATE de categoria continua permitido", async () => {
  await assertSucceeds(setDoc(doc(db, "stores/a/categories/new"), { name: "Nova" }));
});
test("20 UPDATE/rename de categoria continua permitido", async () => {
  await assertSucceeds(updateDoc(category(), { name: "Renomeada" }));
  assert.equal((await getDoc(category())).data().name, "Renomeada");
});
test("21 update operacional preserva categoryIds existente", async () => {
  await assertSucceeds(updateDoc(product("multi"), { ...multi, quantidade: 4 }));
  assert.deepEqual((await getDoc(product("multi"))).data(), { ...multi, quantidade: 4 });
});
test("22 set substitutivo nao pode remover taxonomia", async () => {
  await assertFails(setDoc(product("multi"), operational));
  assert.deepEqual((await getDoc(product("multi"))).data(), multi);
});
test("23 protecoes de arquivamento e DELETE de produto preservadas", async () => {
  for (const field of ["isArchived", "archivedAt", "archivedBy", "archiveReason"]) {
    await assertFails(setDoc(product("new"), { ...operational, [field]: true }));
    await assertFails(updateDoc(product("plain"), { [field]: true }));
  }
  await assertFails(deleteDoc(product("plain")));
});
test("24 cliente anonimo continua sem acesso", async () => {
  const anonymous = env.unauthenticatedContext().firestore();
  for (const ref of [product("plain", anonymous), category(anonymous)]) {
    await assertFails(getDoc(ref));
    await assertFails(updateDoc(ref, { name: "Anonimo" }));
    await assertFails(deleteDoc(ref));
  }
  await assertFails(setDoc(product("new", anonymous), operational));
});
