"use strict";

const assert = require("node:assert/strict");
const contract = require("../../catalog/catalogRequestContract");
const {
  CATALOG_REQUEST_STATUSES: statuses,
  CATALOG_REQUEST_ACTIONS: actions,
  CatalogRequestContractError,
  validateCatalogRequestStatus: status,
  validateCatalogRequestAction: action,
  normalizeCatalogRequestRole: role,
  normalizeCatalogRequestCustomerName: name,
  normalizeCatalogRequestCustomerPhone: phone,
  normalizeCatalogRequestNote: note,
  classifyCatalogRequestVersion: version,
  validateCatalogRequestPublicPayload: payload,
  resolveCatalogRequestActorName: actorName,
  decideCatalogRequestTransition: decide,
  validateCatalogRequestLifecycle: lifecycle,
  projectCatalogRequestListFields: listFields,
  projectCatalogRequestDetailFields: detailFields,
} = contract;

let passed = 0;
const groups = {};
function test(group, label, run) {
  try {
    run();
    passed += 1;
    groups[group] = (groups[group] || 0) + 1;
  } catch (error) {
    console.error("FALHOU: " + group + " / " + label);
    throw error;
  }
}
function rejects(run, reason, code = "validation") {
  assert.throws(run, (error) => {
    assert(error instanceof CatalogRequestContractError);
    assert.equal(error.name, "CatalogRequestContractError");
    assert.equal(error.reason, reason);
    assert.equal(error.code, code);
    assert.equal(error.message, reason); // Nunca ecoa o valor de entrada.
    return true;
  });
}
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test("A", "constantes imutaveis", () => {
  assert.deepEqual(statuses, ["pending", "in_progress", "completed", "cancelled"]);
  assert.deepEqual(actions, ["start", "complete", "cancel"]);
  assert(Object.isFrozen(statuses));
  assert(Object.isFrozen(actions));
  assert(Object.isFrozen(contract));
  assert.throws(() => statuses.push("new"), TypeError);
  assert.throws(() => { actions[0] = "other"; }, TypeError);
});
for (const value of ["pending", "in_progress", "completed", "cancelled"]) {
  test("A", value, () => assert.equal(status(value), value));
}
for (const value of ["Pending", "NEW", "new", " pending ", "", null,
  undefined, 1, {}, [], true, new String("pending")]) {
  test("A", "status invalido", () => rejects(() => status(value), "invalid-status"));
}
for (const value of ["start", "complete", "cancel"]) {
  test("B", value, () => assert.equal(action(value), value));
}
for (const value of ["START", " start ", "", null, undefined, 1, {}, [], "other"]) {
  test("B", "action invalida", () => rejects(() => action(value), "invalid-action"));
}
for (const [input, expected] of [["admin", "admin"], ["gerente", "gerente"],
  ["operador", "operador"], ["caixa", "operador"], ["vendedor", "operador"],
  [" ADMIN ", "admin"], [" GerEnTe ", "gerente"], [" CAIXA ", "operador"],
  [" Vendedor ", "operador"]]) {
  test("C", input, () => assert.equal(role(input), expected));
}
for (const value of ["owner", "", " ", null, undefined, 1, {}, []]) {
  test("C", "role invalida", () => rejects(() => role(value), "invalid-role"));
}
for (const [input, expected] of [[" A ", "A"], ["a", "a"],
  ["a".repeat(120), "a".repeat(120)], ["😀".repeat(60), "😀".repeat(60)]]) {
  test("D", "nome valido", () => assert.equal(name(input), expected));
}
for (const value of ["a".repeat(121), "😀".repeat(60) + "a", "", " \n\t ",
  null, undefined, 1, true, [], {}, new String("A")]) {
  test("D", "nome invalido", () => rejects(() => name(value), "invalid-customer-name"));
}
const phoneCases = [
  ["(21) 98505-0120", "5521985050120"],
  ["21 98505-0120", "5521985050120"],
  ["+55 (21) 98505-0120", "5521985050120"],
  ["21 3505-0120", "552135050120"],
  ["5521985050120", "5521985050120"],
  ["552135050120", "552135050120"],
  ["5535050120", "555535050120"], // DDD 55 nacional nao e DDI.
  ["  abc21 98505-0120  ", "5521985050120"],
  ["0000000000", "550000000000"], // Sem validacao real de DDD/linha.
];
for (const [input, expected] of phoneCases) {
  test("E", "telefone e idempotencia", () => {
    assert.equal(phone(input), expected);
    assert.equal(phone(phone(input)), expected);
  });
}
for (const value of ["4421985050120", "442135050120", "123", "1".repeat(14),
  "005521985050120", "１２３４５６７８９０", "", null, undefined, 21985050120,
  true, {}, []]) {
  test("E", "telefone invalido", () => rejects(() => phone(value), "invalid-customer-phone"));
}
test("F", "ausencia real", () => assert.equal(note(), null));
for (const [input, expected] of [["", null], [" \n ", null], [" nota ", "nota"],
  ["a".repeat(500), "a".repeat(500)], ["😀".repeat(250), "😀".repeat(250)]]) {
  test("F", "note valida", () => assert.equal(note(input), expected));
}
for (const value of ["a".repeat(501), "😀".repeat(250) + "a", null, undefined,
  1, false, [], {}]) {
  test("F", "note invalida", () => rejects(() => note(value), "invalid-note"));
}
test("G", "ausencia V1", () => assert.equal(version({}), 1));
for (const value of [2, 2.0]) {
  test("G", "V2", () => assert.equal(version({requestVersion: value}), 2));
}
for (const value of [1, 3, "2", null, undefined, true, false, 2.5, [], {}, NaN, Infinity]) {
  test("G", "sem fallback", () => rejects(
      () => version({requestVersion: value}), "unsupported-request-version"));
}

const v1 = freeze({publicSlug: "loja", publicToken: "token-placeholder",
  items: [{productId: "p1", quantity: 1}]});
const v2 = freeze({...v1, requestVersion: 2, customerName: " Cliente ",
  customerPhone: "(21) 98505-0120"});
test("H", "V1 exato", () => assert.deepEqual(payload(v1), {version: 1}));
test("H", "V2 sem note", () => assert.deepEqual(payload(v2), {
  version: 2, customerName: "Cliente", customerPhone: "5521985050120", note: null,
}));
test("H", "V2 com note", () => assert.equal(payload({...v2, note: " nota "}).note, "nota"));
test("H", "V2 note vazia", () => assert.equal(payload({...v2, note: " "}).note, null));
for (const value of [null, undefined, 1, [], {}]) {
  test("H", "note presente invalida", () => rejects(
      () => payload({...v2, note: value}), "invalid-note"));
}
for (const key of ["customerName", "customerPhone", "note"]) {
  test("H", "cliente sem versao", () => rejects(
      () => payload({...v1, [key]: null}), "customer-fields-require-version"));
}
for (const base of [v1, v2]) {
  for (const key of ["storeId", "catalogId", "status", "actor", "timestamp",
    "total", "customerId", "customerPhoneNormalized", "attendedByUid"]) {
    test("H", "extra pai " + key, () => rejects(
        () => payload({...base, [key]: "forjado"}), "unexpected-fields"));
  }
  for (const key of ["price", "name", "subtotal", "quantidade"]) {
    test("H", "extra item " + key, () => rejects(() => payload({...base,
      items: [{productId: "p1", quantity: 1, [key]: 999}]}), "unexpected-item-fields"));
  }
  for (const key of Object.keys(base)) {
    test("H", "obrigatorio " + key, () => {
      const copy = {...base};
      delete copy[key];
      rejects(() => payload(copy), key === "requestVersion" ?
        "customer-fields-require-version" : "invalid-payload");
    });
  }
}
for (const value of [null, undefined, [], "text", 1, Object.create(null),
  Object.create(v1), new Date(0)]) {
  test("H", "objeto nao simples", () => rejects(() => payload(value), "invalid-payload"));
}
for (const value of [null, {}, "items"]) {
  test("H", "items nao array", () => rejects(() => payload({...v1, items: value}), "invalid-payload"));
}
for (const item of [null, [], Object.create(null), Object.create({productId: "p"}),
  {productId: "p"}, {quantity: 1}]) {
  test("H", "item invalido", () => rejects(() => payload({...v1, items: [item]}), "invalid-payload"));
}
test("H", "simbolo extra", () => rejects(
    () => payload({...v1, [Symbol("extra")]: 1}), "unexpected-fields"));
test("H", "nao executar getter", () => {
  const input = {...v1};
  Object.defineProperty(input, "requestVersion", {get() { throw Error("getter executado"); }});
  rejects(() => payload(input), "invalid-payload");
});
test("H", "fronteira operacional explicita", () => {
  // O helper nao valida token, quantidade, IDs ou limite operacional.
  assert.deepEqual(payload({publicSlug: null, publicToken: null,
    items: [{productId: null, quantity: -1}]}), {version: 1});
  assert.deepEqual(payload({...v1, items: []}), {version: 1});
});
test("H", "falha de versao precede extras", () => rejects(
    () => payload({...v2, requestVersion: 1, storeId: "forjado"}), "unsupported-request-version"));

for (const [profile, expected] of [
  [{name: " Nome ", username: "User", fullName: "Full"}, "Nome"],
  [{name: " ", username: " User ", fullName: "Full"}, "User"],
  [{name: {}, username: 1, fullName: " Full "}, "Full"],
  [{name: " ", username: [], fullName: false}, null],
  [{}, null], [null, null], [undefined, null], [1, null],
]) {
  test("I", "prioridade de nome", () => assert.equal(actorName(freeze(profile)), expected));
}

// Oraculo explicito: linhas da matriz aprovada, sem gerar expectativa
// pela mesma logica da funcao de producao.
const everyone = ["admin", "gerente", "operador", "caixa", "vendedor"];
const operators = ["operador", "caixa", "vendedor"];
const managers = ["admin", "gerente"];
const matrix = [
  ["pending", "start", everyone, {}, "in_progress", true],
  ["pending", "complete", everyone, {}, "catalog-request-not-in-progress", "precondition"],
  ["pending", "cancel", everyone, {}, "cancelled", true],
  ["in_progress", "start", everyone, {attendedByUid: "u"}, "in_progress", false],
  ["in_progress", "start", everyone, {attendedByUid: "other"}, "catalog-request-already-attended", "conflict"],
  ["in_progress", "complete", operators, {attendedByUid: "u"}, "completed", true],
  ["in_progress", "complete", operators, {attendedByUid: "other"}, "catalog-request-not-assignee", "permission"],
  ["in_progress", "complete", managers, {attendedByUid: "u"}, "completed", true],
  ["in_progress", "complete", managers, {attendedByUid: "other"}, "completed", true],
  ["in_progress", "cancel", operators, {attendedByUid: "u"}, "cancelled", true],
  ["in_progress", "cancel", operators, {attendedByUid: "other"}, "catalog-request-not-assignee", "permission"],
  ["in_progress", "cancel", managers, {attendedByUid: "u"}, "cancelled", true],
  ["in_progress", "cancel", managers, {attendedByUid: "other"}, "cancelled", true],
  ["completed", "start", everyone, {attendedByUid: "u"}, "catalog-request-terminal", "precondition"],
  ["completed", "complete", everyone, {completedByUid: "u"}, "completed", false],
  ["completed", "complete", everyone, {attendedByUid: "u", completedByUid: "other"}, "catalog-request-terminal", "precondition"],
  ["completed", "cancel", everyone, {cancelledByUid: "u"}, "catalog-request-terminal", "precondition"],
  ["cancelled", "start", everyone, {attendedByUid: "u"}, "catalog-request-terminal", "precondition"],
  ["cancelled", "complete", everyone, {completedByUid: "u"}, "catalog-request-terminal", "precondition"],
  ["cancelled", "cancel", everyone, {cancelledByUid: "u"}, "cancelled", false],
  ["cancelled", "cancel", everyone, {attendedByUid: "u", cancelledByUid: "other"}, "catalog-request-terminal", "precondition"],
];
for (const [current, requested, roles, actors, expected, result] of matrix) {
  for (const userRole of roles) {
    test("JKL", current + "/" + requested + "/" + userRole, () => {
      const input = freeze({status: current, action: requested,
        role: userRole, authUid: "u", ...actors});
      const before = {...input};
      if (typeof result === "boolean") {
        assert.deepEqual(decide(input), {allowed: true, changed: result, status: expected});
      } else {
        rejects(() => decide(input), expected, result);
      }
      assert.deepEqual(input, before);
    });
  }
}
const replay = {status: "in_progress", action: "start", role: "operador",
  authUid: "u", attendedByUid: "u"};
for (const [input, reason] of [
  [{status: "bad", action: "bad", role: "bad"}, "invalid-status"],
  [{...replay, action: "bad", role: "bad"}, "invalid-action"],
  [{...replay, role: "bad", authUid: null}, "invalid-role"],
  [{...replay, authUid: null}, "invalid-auth-uid"],
  [{...replay, status: "completed", role: "bad"}, "invalid-role"],
  [{...replay, status: "completed", authUid: " "}, "invalid-auth-uid"],
]) {
  test("JKL", "precedencia", () => rejects(() => decide(input), reason));
}
for (const uid of [undefined, null, "", " ", " u ", 1, {}, []]) {
  test("JKL", "UID valido antes de replay", () => rejects(
      () => decide({...replay, authUid: uid, attendedByUid: uid}), "invalid-auth-uid"));
}
test("JKL", "alias normalizado na decisao", () => assert.deepEqual(
    decide({...replay, role: " CAIXA "}), {allowed: true, changed: false, status: "in_progress"}));
test("JKL", "UID nao e normalizado", () => rejects(
    () => decide({...replay, attendedByUid: " u "}), "catalog-request-already-attended", "conflict"));

// Marcador local para testar injetabilidade; NAO e um Timestamp Firestore.
const timestamp = Object.freeze({marker: "timestamp-test"});
const isTimestamp = (value) => value === timestamp;
const attended = {attendedByUid: "u", attendedByName: "Ator", attendedAt: timestamp};
const completed = {completedByUid: "u", completedByName: "Ator", completedAt: timestamp};
const cancelled = {cancelledByUid: "u", cancelledByName: "Ator", cancelledAt: timestamp};
for (const saved of [
  {status: "pending"},
  {status: "pending", attendedByUid: null, attendedByName: null, attendedAt: null},
  {status: "in_progress", ...attended},
  {status: "completed", ...attended, ...completed},
  {status: "cancelled", ...cancelled},
  {status: "cancelled", ...attended, ...cancelled},
  {status: "in_progress", ...attended, attendedByName: null},
  {status: "completed", ...attended, ...completed, completedByName: null},
  {status: "cancelled", ...cancelled, cancelledByName: null},
]) {
  test("M", "lifecycle valido", () => assert.equal(lifecycle(freeze(saved), isTimestamp), true));
}
for (const saved of [
  {status: "pending", ...attended},
  {status: "pending", ...completed},
  {status: "pending", ...cancelled},
  {status: "in_progress"},
  {status: "completed", ...completed},
  {status: "completed", ...attended},
  {status: "completed", ...attended, ...completed, ...cancelled},
  {status: "cancelled"},
  {status: "cancelled", ...completed, ...cancelled},
  {status: "cancelled", ...cancelled, attendedByUid: "u"},
  {status: "pending", attendedByName: "Ator"},
  {status: "pending", attendedByUid: undefined},
]) {
  test("M", "combinacao invalida", () => rejects(() => lifecycle(saved, isTimestamp), "invalid-lifecycle"));
}
for (const [group, base] of [["attended", {status: "in_progress", ...attended}],
  ["completed", {status: "completed", ...attended, ...completed}],
  ["cancelled", {status: "cancelled", ...cancelled}]]) {
  for (const suffix of ["ByUid", "ByName", "At"]) {
    test("M", "grupo parcial " + group + suffix, () => {
      const copy = {...base};
      delete copy[group + suffix];
      rejects(() => lifecycle(copy, isTimestamp), "invalid-lifecycle");
    });
  }
  for (const value of ["", " ", " u ", null, undefined, 1, {}, []]) {
    test("M", "UID de grupo invalido", () => rejects(
        () => lifecycle({...base, [group + "ByUid"]: value}, isTimestamp), "invalid-lifecycle"));
  }
  for (const value of ["", " ", " Ator ", undefined, 1, {}, []]) {
    test("M", "nome de grupo invalido", () => rejects(
        () => lifecycle({...base, [group + "ByName"]: value}, isTimestamp), "invalid-lifecycle"));
  }
  for (const value of [null, undefined, 0, "ISO", {}, {toMillis() { return 1; }}]) {
    test("M", "At nao reconhecido pelo predicate", () => rejects(
        () => lifecycle({...base, [group + "At"]: value}, isTimestamp), "invalid-lifecycle"));
  }
}
test("M", "fronteira timestamp sem SDK", () => {
  const saved = {status: "in_progress", ...attended, attendedAt: "opaco"};
  assert.equal(lifecycle(saved), true); // Presenca apenas, documentada.
  rejects(() => lifecycle(saved, isTimestamp), "invalid-lifecycle");
  rejects(() => lifecycle(saved, () => "truthy"), "invalid-lifecycle");
  rejects(() => lifecycle(saved, 1), "invalid-timestamp-validator");
});
test("M", "status antes dos grupos", () => rejects(
    () => lifecycle({status: "new", attendedByUid: ""}), "invalid-status"));
for (const value of [null, [], Object.create(null)]) {
  test("M", "documento invalido", () => rejects(() => lifecycle(value), "invalid-lifecycle"));
}

const detailKeys = ["requestVersion", "customerName", "customerPhone", "note",
  "attendedByUid", "attendedByName", "attendedAt", "completedByUid",
  "completedByName", "completedAt", "cancelledByUid", "cancelledByName", "cancelledAt"];
test("N", "legado nulls sem migrar", () => {
  const saved = freeze({status: "pending", catalogId: "c", source: "public_catalog"});
  const before = {...saved};
  assert.deepEqual(listFields(saved), {customerName: null, customerPhone: null, attendedByName: null});
  assert.deepEqual(detailFields(saved), Object.fromEntries(detailKeys.map((key) => [key, null])));
  assert.deepEqual(saved, before);
  assert(!Object.hasOwn(saved, "requestVersion"));
});
test("N", "whitelists e timestamp opaco", () => {
  const saved = freeze({status: "completed", requestVersion: 2,
    customerName: "Cliente", customerPhone: "5521985050120", note: "Nota",
    ...attended, ...completed, items: [{secret: true}], privateField: "privado"});
  assert.deepEqual(listFields(saved), {customerName: "Cliente",
    customerPhone: "5521985050120", attendedByName: "Ator"});
  const result = detailFields(saved);
  assert.deepEqual(Object.keys(result).sort(), detailKeys.slice().sort());
  assert.equal(result.attendedAt, timestamp);
  assert.equal(result.completedAt, timestamp);
  assert.equal(result.cancelledAt, null);
  assert.equal(result.note, "Nota");
  result.customerName = "Mudou apenas projecao";
  assert.equal(saved.customerName, "Cliente");
});
test("N", "legado atendido continua legado", () => {
  const saved = freeze({status: "in_progress", ...attended});
  assert.equal(detailFields(saved).requestVersion, null);
  assert.equal(detailFields(saved).attendedByUid, "u");
  assert.equal(detailFields(saved).customerName, null);
});
test("N", "versao invalida nao vira legado", () => rejects(
    () => detailFields({requestVersion: null}), "unsupported-request-version"));
for (const project of [listFields, detailFields]) {
  test("N", "objeto de projecao invalido", () => rejects(() => project([]), "invalid-document"));
}

console.log("F7.9-B1: " + passed + " casos puros passaram.");
console.log("Casos por grupo: " + JSON.stringify(groups));
console.log("Sem Firebase, Emulator, rede ou escrita de dados.");
