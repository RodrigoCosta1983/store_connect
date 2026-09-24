import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, beforeEach, test as nodeTest } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  deleteDoc, deleteField, doc, getDoc, increment, runTransaction,
  setDoc, Timestamp, updateDoc, writeBatch,
} from "firebase/firestore";

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
const roles = ["admin", "gerente", "operador", "caixa", "vendedor"];
const timestamp = Timestamp.fromDate(new Date("2030-01-01T00:00:00.000Z"));
const archiveFields = {
  isArchived: true, archivedAt: timestamp, archivedBy: "admin", archiveReason: "Teste",
};

// Exercise each boundary with all currently supported roles, sequentially.
function test(name, run) {
  for (const role of roles) {
    nodeTest(`${name} [${role}]`, async () => {
      db = env.authenticatedContext(role).firestore();
      await run(role);
    });
  }
}

async function assertDenied(request) {
  const error = await assertFails(request);
  assert.equal(error.code, "permission-denied");
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
  db = env.authenticatedContext("operador").firestore();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const seed = context.firestore();
    await setDoc(doc(seed, "stores/a"), { name: "Loja A" });
    await setDoc(doc(seed, "stores/b"), { name: "Loja B" });
    for (const role of roles) {
      await setDoc(doc(seed, `users/${role}`), { storeId: "a", role });
    }
    await setDoc(doc(seed, "users/other"), { storeId: "b", role: "admin" });
    await setDoc(product("plain", seed), operational);
    await setDoc(product("legacy", seed), legacy);
    await setDoc(product("multi", seed), multi);
    await setDoc(product("archived", seed), { ...multi, ...archiveFields });
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

test("12 rejeita CREATE sem taxonomia", async () => {
  await assertDenied(setDoc(product("new"), operational));
  assert.equal((await getDoc(product("new"))).exists(), false);
});

test("12b rejeita CREATE com taxonomia preenchida", async () => {
  await assertDenied(setDoc(product("new"), multi));
  assert.equal((await getDoc(product("new"))).exists(), false);
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

test("15 DELETE de categoria continua bloqueado", async () => {
  await assertDenied(deleteDoc(category()));
  assert.equal((await getDoc(category())).exists(), true);
});

test("18 leitura de categoria continua permitida", async () => {
  assert.equal((await assertSucceeds(getDoc(category()))).data().name, "Categoria");
});
test("19 CREATE de categoria bloqueado", async () => {
  const ref = doc(db, "stores/a/categories/new");
  await assertDenied(setDoc(ref, { name: "Nova", imageUrl: "", parentCategoryId: null }));
  assert.equal((await getDoc(ref)).exists(), false);
});
test("20 UPDATE/rename de categoria bloqueado", async () => {
  await assertDenied(updateDoc(category(), { name: "Renomeada" }));
  assert.equal((await getDoc(category())).data().name, "Categoria");
});
test("20b UPDATE hierarquico e set substitutivo de categoria bloqueados", async () => {
  await assertDenied(updateDoc(category(), { parentCategoryId: "c2" }));
  await assertDenied(setDoc(category(), { name: "Outra", parentCategoryId: null }));
  assert.deepEqual((await getDoc(category())).data(), { name: "Categoria" });
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
  await assertDenied(setDoc(doc(anonymous, "stores/a/categories/new"), { name: "Nova" }));
});

// T6-A2-A1: real operational payloads; no new stock, fiscal or plan contract.
const commercialEdit = {
  name: "Produto editado", name_lowercase: "produto editado", price: 12,
  lotes: [{ quantidade: 4, validade: timestamp }], quantidade: 4,
  minimumStock: 2, imageUrl: "https://example.invalid/product.jpg",
};
const fiscalEdit = {
  ncm: "33051000", origem: "0", cfop: "5102", unidade: "UN", cest: null,
  icmsSituacaoTributaria: "102", pisSituacaoTributaria: "49",
  cofinsSituacaoTributaria: "49", ibsCbsSituacaoTributaria: "000",
  ibsCbsClassificacaoTributaria: "000001", updatedAt: timestamp,
};

for (const [writer, changes] of [
  ["W1 comercial", commercialEdit],
  ["W1 Business", { ...commercialEdit, fiscal: fiscalEdit }],
  ["W2/W4 incremento", { quantidade: increment(-1) }],
  ["W3 lotes", { quantidade: 4, lotes: [{ quantidade: 4, validade: timestamp }] }],
]) {
  test(`25 ${writer} preserva taxonomia ausente, legada, canonica e arquivamento`, async () => {
    for (const [id, original] of [
      ["plain", operational], ["legacy", legacy], ["multi", multi],
      ["archived", { ...multi, ...archiveFields }],
    ]) {
      await assertSucceeds(updateDoc(product(id), changes));
      assert.deepEqual((await getDoc(product(id))).data(), {
        ...original, ...changes, quantidade: 4,
      });
    }
  });
}

for (const field of Object.keys(archiveFields)) {
  test(`26 arquivamento: adicionar/alterar/remover ${field} continua negado`, async () => {
    await assertDenied(updateDoc(product("plain"), { [field]: archiveFields[field] }));
    await assertDenied(updateDoc(product("archived"), {
      [field]: field === "isArchived" ? false : null,
    }));
    await assertDenied(updateDoc(product("archived"), { [field]: deleteField() }));
    assert.deepEqual((await getDoc(product("archived"))).data(), { ...multi, ...archiveFields });
  });
}

async function clientWithProfile(profile) {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users/probe"), profile);
  });
  // Claims never replace the authoritative profile checked by these Rules.
  return env.authenticatedContext("probe", { role: "admin", storeId: "a" }).firestore();
}

for (const role of [" ADMIN ", " GerEnTe ", " OPERADOR ", " CaIxA ", " VENDEDOR ", "\tCaIxA\r\n"]) {
  nodeTest(`27 role normalizada ${JSON.stringify(role)} permitida`, async () => {
    const client = await clientWithProfile({ storeId: "a", role, accessStatus: "active" });
    await assertSucceeds(updateDoc(product("plain", client), commercialEdit));
    assert.deepEqual((await getDoc(product("plain", client))).data(), commercialEdit);
  });
}

for (const [label, profileRole] of [
  ["ausente", {}], ["null", { role: null }], ["vazia", { role: "" }],
  ["espacos", { role: "   " }], ["desconhecida", { role: "superuser" }],
  ["numero", { role: 1 }], ["boolean", { role: true }],
  ["array", { role: ["admin"] }], ["map", { role: { name: "admin" } }],
]) {
  nodeTest(`28 role ${label} negada mesmo com claims admin`, async () => {
    const client = await clientWithProfile({ storeId: "a", accessStatus: "active", ...profileRole });
    await assertDenied(updateDoc(product("plain", client), { price: 12 }));
    // READ is deliberately unchanged, even when this profile cannot UPDATE.
    assert.deepEqual((await assertSucceeds(getDoc(product("plain", client)))).data(), operational);
    await assertSucceeds(getDoc(category(client)));
  });
}

for (const [label, status] of [
  ["ausente", {}], ["null", { accessStatus: null }], ["vazio", { accessStatus: "" }],
  ["active", { accessStatus: "active" }], ["outro", { accessStatus: "pending" }],
  ["numero", { accessStatus: 7 }], ["boolean", { accessStatus: false }],
  ["array", { accessStatus: ["revoked"] }], ["map", { accessStatus: { value: "revoked" } }],
]) {
  test(`29 accessStatus ${label} mantem compatibilidade`, async (role) => {
    const client = await clientWithProfile({ storeId: "a", role, ...status });
    await assertSucceeds(updateDoc(product("plain", client), { quantidade: increment(-1) }));
    assert.equal((await getDoc(product("plain", client))).data().quantidade, 4);
  });
}

for (const accessStatus of ["revoked", " REVOKED ", "\tReVoKeD\r\n"]) {
  test(`30 accessStatus ${JSON.stringify(accessStatus)} bloqueia UPDATE e preserva READ`, async (role) => {
    const client = await clientWithProfile({ storeId: "a", role, accessStatus });
    for (const changes of [commercialEdit, { quantidade: increment(-1) }]) {
      await assertDenied(updateDoc(product("plain", client), changes));
    }
    assert.deepEqual((await assertSucceeds(getDoc(product("plain", client)))).data(), operational);
    await assertSucceeds(getDoc(category(client)));
  });
}

test("31 loja pai obrigatoria somente para UPDATE", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(doc(context.firestore(), "stores/a"));
  });
  await assertDenied(updateDoc(product("plain"), { price: 12 }));
  assert.deepEqual((await assertSucceeds(getDoc(product("plain")))).data(), operational);
  await assertSucceeds(getDoc(category()));
});

nodeTest("32 sem perfil nao pode UPDATE apesar de claims", async () => {
  const client = env.authenticatedContext("no-profile", { role: "admin", storeId: "a" }).firestore();
  await assertDenied(updateDoc(product("plain", client), { price: 12 }));
  await env.withSecurityRulesDisabled(async (context) => {
    assert.deepEqual((await getDoc(product("plain", context.firestore()))).data(), operational);
  });
});

for (const storeId of ["b", " a ", "", null, 1]) {
  nodeTest(`33 vinculo de loja exato ${JSON.stringify(storeId)}`, async () => {
    const client = await clientWithProfile({ storeId, role: "admin" });
    await assertDenied(updateDoc(product("plain", client), { price: 12 }));
  });
}

test("34 revogacao do perfil apos primeiro UPDATE vale para o mesmo cliente", async (role) => {
  await assertSucceeds(updateDoc(product("plain"), { price: 12 }));
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), `users/${role}`), { accessStatus: "revoked" });
  });
  await assertDenied(updateDoc(product("plain"), { price: 13 }));
  assert.equal((await getDoc(product("plain"))).data().price, 12);
});

// Twelve product writes plus a sale exercise shared profile/store access checks
// in one atomic commit, not twelve independent requests.
const cartSize = 12;
const cartOriginal = (index) => ({
  ...[operational, legacy, multi][index % 3],
  ...(index % 2 ? { lotes: [{ quantidade: 5, validade: timestamp }] } : {}),
});
const sale = (client) => doc(client, "stores/a/sales/cart-sale");

async function seedCart() {
  await env.withSecurityRulesDisabled(async (context) => {
    for (let index = 0; index < cartSize; index++) {
      await setDoc(product(`cart-${index}`, context.firestore()), cartOriginal(index));
    }
  });
}

async function commitCart(client, mode) {
  const refs = Array.from({ length: cartSize }, (_, index) => product(`cart-${index}`, client));
  const saleData = {
    storeId: "a", createdAt: timestamp, totalAmount: cartSize * 10,
    products: refs.map((ref) => ({ productId: ref.id, quantity: 1, price: 10 })),
    paymentMethod: mode === "transaction" ? "Dinheiro" : "A prazo",
    isPaid: mode === "transaction",
  };
  if (mode === "transaction") {
    await runTransaction(client, async (transaction) => {
      const snapshots = [];
      for (const ref of refs) snapshots.push(await transaction.get(ref));
      for (const snapshot of snapshots) {
        const data = snapshot.data();
        transaction.update(snapshot.ref, data.lotes ? {
          quantidade: data.quantidade - 1,
          lotes: [{ ...data.lotes[0], quantidade: data.lotes[0].quantidade - 1 }],
        } : { quantidade: increment(-1) });
      }
      transaction.set(sale(client), saleData);
    });
  } else {
    const batch = writeBatch(client);
    for (const ref of refs) batch.update(ref, { quantidade: increment(-1) });
    batch.set(sale(client), saleData);
    await batch.commit();
  }
}

async function assertCartState(mode, committed) {
  await env.withSecurityRulesDisabled(async (context) => {
    const reader = context.firestore();
    const saleSnapshot = await getDoc(sale(reader));
    assert.equal(saleSnapshot.exists(), committed);
    if (committed) {
      assert.equal(saleSnapshot.data().products.length, cartSize);
      assert.equal(saleSnapshot.data().totalAmount, cartSize * 10);
    }
    for (let index = 0; index < cartSize; index++) {
      const expected = cartOriginal(index);
      if (committed) {
        expected.quantidade = 4;
        if (mode === "transaction" && expected.lotes) expected.lotes[0].quantidade = 4;
      }
      assert.deepEqual((await getDoc(product(`cart-${index}`, reader))).data(), expected);
    }
  });
}

for (const mode of ["transaction", "batch"]) {
  test(`35 ${mode} de 12 produtos e venda autorizados atomicamente`, async () => {
    await seedCart();
    await assertSucceeds(commitCart(db, mode));
    await assertCartState(mode, true);
  });
  for (const [label, profile] of [
    ["revogado", { storeId: "a", role: "operador", accessStatus: "revoked" }],
    ["role invalida", { storeId: "a", role: "unknown", accessStatus: "active" }],
  ]) {
    nodeTest(`36 ${mode} de 12 produtos: ${label} nao persiste produtos nem venda`, async () => {
      await seedCart();
      const client = await clientWithProfile(profile);
      await assertDenied(commitCart(client, mode));
      await assertCartState(mode, false);
    });
  }
}
