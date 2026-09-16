"use strict";

const assert = require("assert");

const EXPECTED_FIRESTORE_HOST =
  "127.0.0.1:8080";

const PROJECT_ID =
  "store-connect-app";

function assertEmulatorEnvironment() {
  const host = String(
    process.env.FIRESTORE_EMULATOR_HOST || "",
  ).trim();

  if (host !== EXPECTED_FIRESTORE_HOST) {
    throw new Error(
      "SEGURANCA: este teste so pode executar no Firestore Emulator.",
    );
  }
}

assertEmulatorEnvironment();

process.env.GCLOUD_PROJECT =
  process.env.GCLOUD_PROJECT ||
  PROJECT_ID;

process.env.GOOGLE_CLOUD_PROJECT =
  process.env.GOOGLE_CLOUD_PROJECT ||
  PROJECT_ID;

process.env.ASAAS_ENV =
  "sandbox";

process.env.ASAAS_API_KEY =
  "integration-test-only";

const axios = require("axios");

const originalAxios = {
  get: axios.get,
  post: axios.post,
  put: axios.put,
  delete: axios.delete,
};

let currentScenario = null;
let axiosCalls = [];

function clone(value) {
  return JSON.parse(
    JSON.stringify(value),
  );
}

function requestPath(url) {
  return new URL(url).pathname;
}

function recordCall(
  method,
  url,
  config = {},
  body = null,
) {
  axiosCalls.push({
    method,
    path: requestPath(url),
    params: clone(
      config?.params || {},
    ),
    body:
      body === null
        ? null
        : clone(body),
  });
}

axios.get = async (
  url,
  config = {},
) => {
  if (!currentScenario) {
    throw new Error(
      "Mock Asaas executado sem scenario ativo.",
    );
  }

  recordCall(
    "GET",
    url,
    config,
  );

  const path =
    requestPath(url);

  const customer =
    currentScenario.customer;

  const subscription =
    currentScenario.subscription;

  if (
    path.endsWith(
      `/customers/${customer.id}`,
    )
  ) {
    return {
      data: clone(customer),
    };
  }

  if (
    path.endsWith(
      `/subscriptions/${subscription.id}`,
    )
  ) {
    if (
      typeof currentScenario
        .beforeSubscriptionProofReturn ===
      "function"
    ) {
      const hook =
        currentScenario
          .beforeSubscriptionProofReturn;

      // Executa apenas uma vez.
      currentScenario
        .beforeSubscriptionProofReturn =
        null;

      await hook();
    }

    return {
      data: clone(subscription),
    };
  }

  if (
    path.endsWith("/subscriptions")
  ) {
    return {
      data: {
        data: clone(
          currentScenario
            .activeSubscriptions,
        ),
        hasMore: false,
        totalCount:
          currentScenario
            .activeSubscriptions
            .length,
      },
    };
  }

  if (
    path.endsWith("/payments")
  ) {
    const status = String(
      config?.params?.status || "",
    )
      .trim()
      .toUpperCase();

    // subscriptionPricing pode consultar
    // especificamente pagamentos OVERDUE.
    if (status) {
      return {
        data: {
          data: [],
          hasMore: false,
          totalCount: 0,
        },
      };
    }

    return {
      data: {
        data: clone(
          currentScenario.payments,
        ),
        hasMore: false,
        totalCount:
          currentScenario
            .payments
            .length,
      },
    };
  }

  throw new Error(
    `GET Asaas inesperado no teste: ${path}`,
  );
};

axios.put = async (
  url,
  body = {},
  config = {},
) => {
  if (!currentScenario) {
    throw new Error(
      "Mock Asaas executado sem scenario ativo.",
    );
  }

  recordCall(
    "PUT",
    url,
    config,
    body,
  );

  const path =
    requestPath(url);

  if (
    path.endsWith(
      `/customers/${currentScenario.customer.id}`,
    )
  ) {
    return {
      data: {
        ...clone(
          currentScenario.customer,
        ),
        ...clone(body),
      },
    };
  }

  if (
    path.endsWith(
      `/subscriptions/${currentScenario.subscription.id}`,
    )
  ) {
    return {
      data: {
        ...clone(
          currentScenario.subscription,
        ),
        ...clone(body),
      },
    };
  }

  if (path.includes("/payments/")) {
    return {
      data: clone(body),
    };
  }

  throw new Error(
    `PUT Asaas inesperado no teste: ${path}`,
  );
};

axios.post = async (
  url,
  body = {},
  config = {},
) => {
  recordCall(
    "POST",
    url,
    config,
    body,
  );

  throw new Error(
    `FALHA DE SEGURANCA: o fluxo legado tentou criar recurso no Asaas: ${requestPath(url)}`,
  );
};

axios.delete = async (
  url,
  config = {},
) => {
  recordCall(
    "DELETE",
    url,
    config,
  );

  throw new Error(
    `DELETE Asaas inesperado no teste: ${requestPath(url)}`,
  );
};

// IMPORTANTE:
// axios precisa estar mockado ANTES de carregar index.js.
const {
  createAsaasSubscription,
} = require("../../index");

const admin =
  require("firebase-admin");

const {
  SUBSCRIPTION_PLANS,
} = require(
  "../../financeiro/subscriptionPricing",
);

const db =
  admin.firestore();

function setScenario(scenario) {
  currentScenario =
    scenario;

  axiosCalls = [];
}

function assertNoAsaasPost() {
  const posts =
    axiosCalls.filter(
      (call) =>
        call.method === "POST",
    );

  assert.strictEqual(
    posts.length,
    0,
    "Nenhum fluxo legado pode criar nova assinatura/customer no Asaas.",
  );
}

function hasOwn(obj, key) {
  return Object.prototype
    .hasOwnProperty
    .call(obj, key);
}

async function createFixture({
  label,
  registryMode,
  plan = "business",
  customerExternalReference,
}) {
  const suffix =
    `${Date.now()}${Math.floor(
      Math.random() * 100000,
    )}`;

  const numeric =
    suffix.replace(/\D/g, "");

  const document =
    numeric
      .padStart(11, "0")
      .slice(-11);

  const currentUid =
    `owner-${label}-${suffix}`;

  const legacyUid =
    `legacy-${label}-${suffix}`;

  const storeId =
    `store-${label}-${suffix}`;

  const customerId =
    `cus_${label}_${suffix}`;

  const subscriptionId =
    `sub_${label}_${suffix}`;

  const userRef = db
    .collection("users")
    .doc(currentUid);

  const storeRef = db
    .collection("stores")
    .doc(storeId);

  const registryRef = db
    .collection("cpfs_cadastrados")
    .doc(document);

  await userRef.set({
    storeId,
    role: "admin",
    accessStatus: "active",
    email:
      `${currentUid}@example.com`,
  });

  await storeRef.set({
    ownerId:
      currentUid,

    name:
      `Loja ${label}`,

    phone:
      "21999999999",

    document,

    subscriptionType:
      plan,

    subscriptionStatus:
      "inactive",

    asaasCustomerId:
      customerId,

    asaasSubscriptionId:
      subscriptionId,

    nextDueDate:
      "2026-09-12",
  });

  const registryUid =
    registryMode ===
    "same-owner"
      ? currentUid
      : legacyUid;

  await registryRef.set({
    uid:
      registryUid,

    motivo:
      "Registro legado de teste",

    cadastradoEm:
      admin.firestore
        .FieldValue
        .serverTimestamp(),
  });

  const externalReference =
    customerExternalReference ===
    undefined
      ? storeId
      : customerExternalReference;

  const customer = {
    id:
      customerId,

    cpfCnpj:
      document,

    externalReference,
  };

  const subscription = {
    id:
      subscriptionId,

    customer:
      customerId,

    externalReference:
      storeId,

    status:
      "ACTIVE",

    value:
      SUBSCRIPTION_PLANS[
        plan
      ].price,

    nextDueDate:
      "2026-10-12",

    dateCreated:
      "2026-01-01",
  };

  const payment = {
    id:
      `pay_${label}_${suffix}`,

    subscription:
      subscriptionId,

    status:
      "OVERDUE",

    dueDate:
      "2026-09-12",

    invoiceUrl:
      `https://example.test/${label}/payment`,
  };

  return {
    currentUid,
    legacyUid,
    storeId,
    document,
    userRef,
    storeRef,
    registryRef,
    customer,
    subscription,

    scenario: {
      customer,
      subscription,
      activeSubscriptions: [
        subscription,
      ],
      payments: [
        payment,
      ],
    },
  };
}

async function callSubscription(
  fixture,
) {
  return await createAsaasSubscription
    .run({
      auth: {
        uid:
          fixture.currentUid,

        token: {
          email:
            `${fixture.currentUid}@example.com`,
        },
      },

      // Sem storeId propositalmente:
      // reproduz o fluxo da tela raiz,
      // deixando o backend resolver
      // users/{uid}.storeId.
      data: {
        cpfCnpj:
          fixture.document,
      },
    });
}

async function getMigrationAudits(
  storeRef,
) {
  const snapshot =
    await storeRef
      .collection("auditLogs")
      .get();

  return snapshot.docs
    .map(
      (doc) =>
        doc.data(),
    )
    .filter(
      (data) =>
        data.action ===
        "legacy_cpf_registry_owner_migrated",
    );
}

async function testLegacyDifferentUidValidProof() {
  const fixture =
    await createFixture({
      label:
        "legacy-different-valid",

      registryMode:
        "different-owner",

      plan:
        "business",
    });

  setScenario(
    fixture.scenario,
  );

  const result =
    await callSubscription(
      fixture,
    );

  assert.strictEqual(
    result.success,
    true,
  );

  assert.strictEqual(
    result.alreadyExists,
    true,
  );

  assert.strictEqual(
    result.subscriptionId,
    fixture.subscription.id,
  );

  assert.strictEqual(
    result.paymentUrl,
    fixture.scenario
      .payments[0]
      .invoiceUrl,
  );

  const registrySnapshot =
    await fixture.registryRef.get();

  const registry =
    registrySnapshot.data();

  assert.strictEqual(
    registry.uid,
    fixture.currentUid,
  );

  assert.strictEqual(
    registry.storeId,
    fixture.storeId,
  );

  assert.strictEqual(
    registry.legacyUid,
    fixture.legacyUid,
  );

  assert.strictEqual(
    registry
      .legacyUidMigrationReason,
    "subscription_legacy_financial_proof",
  );

  assert(
    registry.legacyUidMigratedAt,
    "legacyUidMigratedAt precisa existir.",
  );

  const storeSnapshot =
    await fixture.storeRef.get();

  const store =
    storeSnapshot.data();

  assert.strictEqual(
    store.asaasSubscriptionId,
    fixture.subscription.id,
  );

  assert.strictEqual(
    store.asaasCustomerId,
    fixture.customer.id,
  );

  assert.strictEqual(
    store.subscriptionType,
    "business",
  );

  // Regularizacao nao deve fingir
  // pagamento confirmado.
  assert.strictEqual(
    store.subscriptionStatus,
    "inactive",
  );

  assert.strictEqual(
    hasOwn(
      store,
      "subscriptionCreationStatus",
    ),
    false,
  );

  assert.strictEqual(
    hasOwn(
      store,
      "subscriptionCreationStartedAt",
    ),
    false,
  );

  const audits =
    await getMigrationAudits(
      fixture.storeRef,
    );

  assert.strictEqual(
    audits.length,
    1,
  );

  assert.strictEqual(
    audits[0].before.uid,
    fixture.legacyUid,
  );

  assert.strictEqual(
    audits[0].after.uid,
    fixture.currentUid,
  );

  assert.strictEqual(
    audits[0]
      .financialProof
      .customerId,
    fixture.customer.id,
  );

  assert.strictEqual(
    audits[0]
      .financialProof
      .subscriptionId,
    fixture.subscription.id,
  );

  assertNoAsaasPost();

  console.log(
    "✅ legado UID diferente valido: prova Asaas migra reserva e preserva Business",
  );
}

async function testLegacyDifferentUidInvalidProof() {
  const fixture =
    await createFixture({
      label:
        "legacy-different-invalid",

      registryMode:
        "different-owner",

      plan:
        "business",

      customerExternalReference:
        "outra-store",
    });

  setScenario(
    fixture.scenario,
  );

  let error = null;

  try {
    await callSubscription(
      fixture,
    );
  } catch (caught) {
    error = caught;
  }

  assert(
    error,
    "Prova financeira invalida deveria falhar.",
  );

  assert(
    String(error.code || "")
      .includes(
        "failed-precondition",
      ),
    `Codigo inesperado: ${error.code}`,
  );

  const registrySnapshot =
    await fixture.registryRef.get();

  const registry =
    registrySnapshot.data();

  // Nenhuma reivindicacao/migracao.
  assert.strictEqual(
    registry.uid,
    fixture.legacyUid,
  );

  assert.strictEqual(
    hasOwn(
      registry,
      "storeId",
    ),
    false,
  );

  assert.strictEqual(
    hasOwn(
      registry,
      "legacyUid",
    ),
    false,
  );

  const storeSnapshot =
    await fixture.storeRef.get();

  const store =
    storeSnapshot.data();

  // A primeira transacao nao pode
  // ter deixado lock.
  assert.strictEqual(
    hasOwn(
      store,
      "subscriptionCreationStatus",
    ),
    false,
  );

  assert.strictEqual(
    hasOwn(
      store,
      "subscriptionCreationStartedAt",
    ),
    false,
  );

  assert.strictEqual(
    store.asaasSubscriptionId,
    fixture.subscription.id,
  );

  const audits =
    await getMigrationAudits(
      fixture.storeRef,
    );

  assert.strictEqual(
    audits.length,
    0,
  );

  const listSubscriptionCalls =
    axiosCalls.filter(
      (call) =>
        call.method === "GET" &&
        call.path.endsWith(
          "/subscriptions",
        ),
    );

  // Prova falhou antes da reconciliacao normal.
  assert.strictEqual(
    listSubscriptionCalls.length,
    0,
  );

  assertNoAsaasPost();

  console.log(
    "✅ legado UID diferente invalido: prova recusada sem migrar CPF e sem lock",
  );
}

async function testSameUidLegacyBackfill() {
  const fixture =
    await createFixture({
      label:
        "legacy-same-owner",

      registryMode:
        "same-owner",

      plan:
        "pro",
    });

  setScenario(
    fixture.scenario,
  );

  const result =
    await callSubscription(
      fixture,
    );

  assert.strictEqual(
    result.success,
    true,
  );

  assert.strictEqual(
    result.alreadyExists,
    true,
  );

  assert.strictEqual(
    result.subscriptionId,
    fixture.subscription.id,
  );

  const registrySnapshot =
    await fixture.registryRef.get();

  const registry =
    registrySnapshot.data();

  assert.strictEqual(
    registry.uid,
    fixture.currentUid,
  );

  assert.strictEqual(
    registry.storeId,
    fixture.storeId,
  );

  assert.strictEqual(
    registry.document,
    fixture.document,
  );

  // legado mesmo UID e backfill simples,
  // nao migracao de proprietario.
  assert.strictEqual(
    hasOwn(
      registry,
      "legacyUid",
    ),
    false,
  );

  assert.strictEqual(
    registry.storeIdLinkReason,
    "subscription_legacy_cpf_registry_backfill",
  );

  const audits =
    await getMigrationAudits(
      fixture.storeRef,
    );

  assert.strictEqual(
    audits.length,
    0,
  );

  const storeSnapshot =
    await fixture.storeRef.get();

  const store =
    storeSnapshot.data();

  assert.strictEqual(
    store.subscriptionType,
    "pro",
  );

  assert.strictEqual(
    store.subscriptionStatus,
    "inactive",
  );

  assert.strictEqual(
    hasOwn(
      store,
      "subscriptionCreationStatus",
    ),
    false,
  );

  assertNoAsaasPost();

  console.log(
    "✅ legado mesmo UID: mesmo UID faz somente backfill de storeId",
  );
}

async function testRegistryChangedDuringFinancialProof() {
  const fixture =
    await createFixture({
      label:
        "registry-race",

      registryMode:
        "different-owner",

      plan:
        "business",
    });

  fixture.scenario
    .beforeSubscriptionProofReturn =
    async () => {
      await fixture.registryRef.set(
        {
          uid:
            "outro-uid-concorrente",

          storeId:
            "outra-store-concorrente",
        },
        {
          merge: true,
        },
      );
    };

  setScenario(
    fixture.scenario,
  );

  let error = null;

  try {
    await callSubscription(
      fixture,
    );
  } catch (caught) {
    error = caught;
  }

  assert(
    error,
    "Mudanca concorrente da reserva deveria abortar.",
  );

  assert(
    String(error.code || "")
      .includes(
        "failed-precondition",
      ),
    `Codigo inesperado: ${error.code}`,
  );

  const registrySnapshot =
    await fixture.registryRef.get();

  const registry =
    registrySnapshot.data();

  // A segunda transacao NAO pode sobrescrever
  // a mudanca concorrente.
  assert.strictEqual(
    registry.uid,
    "outro-uid-concorrente",
  );

  assert.strictEqual(
    registry.storeId,
    "outra-store-concorrente",
  );

  assert.strictEqual(
    hasOwn(
      registry,
      "legacyUid",
    ),
    false,
  );

  const audits =
    await getMigrationAudits(
      fixture.storeRef,
    );

  assert.strictEqual(
    audits.length,
    0,
  );

  const storeSnapshot =
    await fixture.storeRef.get();

  const store =
    storeSnapshot.data();

  assert.strictEqual(
    hasOwn(
      store,
      "subscriptionCreationStatus",
    ),
    false,
  );

  assertNoAsaasPost();

  console.log(
    "✅ corrida de reserva: mudanca entre prova e transacao impede migracao",
  );
}

async function testConcurrentCreationLockBlocksMigration() {
  const fixture =
    await createFixture({
      label:
        "lock-race",

      registryMode:
        "different-owner",

      plan:
        "business",
    });

  fixture.scenario
    .beforeSubscriptionProofReturn =
    async () => {
      await fixture.storeRef.update({
        subscriptionCreationStatus:
          "creating",

        subscriptionCreationStartedAt:
          admin.firestore.Timestamp.now(),
      });
    };

  setScenario(
    fixture.scenario,
  );

  let error = null;

  try {
    await callSubscription(
      fixture,
    );
  } catch (caught) {
    error = caught;
  }

  assert(
    error,
    "Lock concorrente deveria bloquear migracao.",
  );

  assert(
    String(error.code || "")
      .includes(
        "already-exists",
      ),
    `Codigo inesperado: ${error.code}`,
  );

  const registrySnapshot =
    await fixture.registryRef.get();

  const registry =
    registrySnapshot.data();

  // Reserva original permanece intacta.
  assert.strictEqual(
    registry.uid,
    fixture.legacyUid,
  );

  assert.strictEqual(
    hasOwn(
      registry,
      "storeId",
    ),
    false,
  );

  assert.strictEqual(
    hasOwn(
      registry,
      "legacyUid",
    ),
    false,
  );

  const storeSnapshot =
    await fixture.storeRef.get();

  const store =
    storeSnapshot.data();

  // O lock pertence ao concorrente.
  // Esta execucao nao deve apaga-lo.
  assert.strictEqual(
    store.subscriptionCreationStatus,
    "creating",
  );

  assert(
    store.subscriptionCreationStartedAt,
    "Lock concorrente precisa continuar presente.",
  );

  const audits =
    await getMigrationAudits(
      fixture.storeRef,
    );

  assert.strictEqual(
    audits.length,
    0,
  );

  assertNoAsaasPost();

  console.log(
    "✅ corrida de lock: migracao aborta e nao remove trava concorrente",
  );
}

async function testExistingCreditCardSubscriptionIsNormalizedToUndefined() {
  const fixture =
    await createFixture({
      label:
        "billing-type-credit-card",

      registryMode:
        "different-owner",

      plan:
        "business",
    });

  // Reproduz assinatura financeira antiga:
  // a assinatura e a cobranca ja existem no Asaas
  // usando CREDIT_CARD.
  fixture.subscription.billingType =
    "CREDIT_CARD";

  fixture.scenario.subscription = {
    ...fixture.scenario.subscription,
    billingType:
      "CREDIT_CARD",
  };

  fixture.scenario.activeSubscriptions =
    fixture.scenario.activeSubscriptions.map(
      (subscription) =>
        subscription.id ===
        fixture.subscription.id
          ? {
              ...subscription,
              billingType:
                "CREDIT_CARD",
            }
          : subscription,
    );

  fixture.scenario.payments =
    fixture.scenario.payments.map(
      (payment) => ({
        ...payment,
        billingType:
          "CREDIT_CARD",
      }),
    );

  const originalPayment =
    clone(
      fixture.scenario.payments[0],
    );

  setScenario(
    fixture.scenario,
  );

  const result =
    await callSubscription(
      fixture,
    );

  assert.strictEqual(
    result.success,
    true,
  );

  assert.strictEqual(
    result.alreadyExists,
    true,
  );

  assert.strictEqual(
    result.subscriptionId,
    fixture.subscription.id,
  );

  // A cobranca existente precisa continuar sendo
  // devolvida normalmente ao aplicativo.
  assert.strictEqual(
    result.paymentUrl,
    originalPayment.invoiceUrl,
  );

  // ----------------------------------------------------------
  // PUT DA ASSINATURA
  // ----------------------------------------------------------

  const subscriptionPuts =
    axiosCalls.filter(
      (call) =>
        call.method === "PUT" &&
        call.path.endsWith(
          `/subscriptions/${fixture.subscription.id}`,
        ),
    );

  assert.strictEqual(
    subscriptionPuts.length,
    1,
    "Assinatura CREDIT_CARD deve receber exatamente um PUT de normalizacao.",
  );

  assert.deepStrictEqual(
    subscriptionPuts[0].body,
    {
      billingType:
        "UNDEFINED",
    },
    "PUT deve alterar somente billingType da assinatura.",
  );

  assert.strictEqual(
    hasOwn(
      subscriptionPuts[0].body,
      "updatePendingPayments",
    ),
    false,
    "Normalizacao nao pode alterar cobrancas ja emitidas.",
  );

  // ----------------------------------------------------------
  // COBRANCA EXISTENTE NAO PODE SER ALTERADA
  // ----------------------------------------------------------

  const paymentPuts =
    axiosCalls.filter(
      (call) =>
        call.method === "PUT" &&
        call.path.includes(
          "/payments/",
        ),
    );

  assert.strictEqual(
    paymentPuts.length,
    0,
    "Cobranca ja emitida nao pode receber PUT durante esta normalizacao.",
  );

  // Nenhuma nova assinatura/customer pode ser criada.
  assertNoAsaasPost();

  console.log(
    "✅ billingType legado: CREDIT_CARD -> UNDEFINED sem alterar cobranca emitida",
  );
}

async function testMultipleActiveSubscriptionsKeepVerifiedId() {
  const fixture =
    await createFixture({
      label:
        "multi-active",

      registryMode:
        "different-owner",

      plan:
        "business",
    });

  const otherSubscription = {
    id:
      `sub_outro_${Date.now()}`,

    customer:
      fixture.customer.id,

    externalReference:
      fixture.storeId,

    status:
      "ACTIVE",

    value:
      SUBSCRIPTION_PLANS
        .business
        .price,

    nextDueDate:
      "2026-11-12",

    // Mais recente de proposito.
    dateCreated:
      "2026-09-01",
  };

  fixture.scenario
    .activeSubscriptions = [
      fixture.subscription,
      otherSubscription,
    ];

  setScenario(
    fixture.scenario,
  );

  const result =
    await callSubscription(
      fixture,
    );

  assert.strictEqual(
    result.success,
    true,
  );

  assert.strictEqual(
    result.alreadyExists,
    true,
  );

  // Mesmo com outra ACTIVE mais nova,
  // a assinatura comprovada por ID
  // precisa continuar oficial.
  assert.strictEqual(
    result.subscriptionId,
    fixture.subscription.id,
  );

  const storeSnapshot =
    await fixture.storeRef.get();

  const store =
    storeSnapshot.data();

  assert.strictEqual(
    store.asaasSubscriptionId,
    fixture.subscription.id,
  );

  assert.notStrictEqual(
    store.asaasSubscriptionId,
    otherSubscription.id,
  );

  assert.strictEqual(
    store.subscriptionType,
    "business",
  );

  const registrySnapshot =
    await fixture.registryRef.get();

  const registry =
    registrySnapshot.data();

  assert.strictEqual(
    registry.uid,
    fixture.currentUid,
  );

  assert.strictEqual(
    registry.legacyUid,
    fixture.legacyUid,
  );

  const audits =
    await getMigrationAudits(
      fixture.storeRef,
    );

  assert.strictEqual(
    audits.length,
    1,
  );

  assert.strictEqual(
    audits[0]
      .financialProof
      .subscriptionId,
    fixture.subscription.id,
  );

  assertNoAsaasPost();

  console.log(
    "✅ multiplas ACTIVE: ID financeiro comprovado continua oficial",
  );
}
async function run() {
  try {
    await testLegacyDifferentUidValidProof();
    await testLegacyDifferentUidInvalidProof();
    await testSameUidLegacyBackfill();

    await testRegistryChangedDuringFinancialProof();
    await testConcurrentCreationLockBlocksMigration();
    await testExistingCreditCardSubscriptionIsNormalizedToUndefined();
    await testMultipleActiveSubscriptionsKeepVerifiedId();

    console.log("");
    console.log(
      "✅ createAsaasSubscription legado: integracao principal e corridas passaram",
    );

    console.log(
      "✅ nenhuma chamada real ao Asaas foi executada",
    );

    console.log(
      "✅ nenhum POST Asaas foi permitido",
    );
  } finally {
    axios.get =
      originalAxios.get;

    axios.post =
      originalAxios.post;

    axios.put =
      originalAxios.put;

    axios.delete =
      originalAxios.delete;
  }
}

run().catch((error) => {
  console.error("");
  console.error(
    "❌ createAsaasSubscriptionLegacy.emulator.test.js FALHOU",
  );
  console.error(error);
  process.exit(1);
});