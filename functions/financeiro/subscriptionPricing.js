// =============================================================================
// ARQUIVO: financeiro/subscriptionPricing.js
// =============================================================================
//
// OBJETIVO:
//
// Centralizar os preços oficiais das assinaturas do Store Connect e manter
// as assinaturas existentes no Asaas sincronizadas com esses valores.
//
// PROBLEMA QUE ESTE ARQUIVO RESOLVE:
//
// Uma assinatura criada quando o Plano Pro custava R$ 15,90 continuava
// sendo cobrada nesse valor mesmo depois de o plano passar para R$ 39,90.
//
// Isso acontecia porque alterar o preço utilizado na criação de novas
// assinaturas NÃO atualizava automaticamente assinaturas que já existiam
// no Asaas.
//
// RESPONSABILIDADES:
//
// • Definir os preços oficiais dos planos.
// • Consultar uma assinatura existente no Asaas.
// • Comparar o preço real do Asaas com o preço oficial.
// • Atualizar assinaturas divergentes.
// • Atualizar o valor armazenado no Firestore.
// • Permitir sincronização em massa de todas as lojas.
// • Evitar chamadas PUT desnecessárias quando o preço já estiver correto.
//
// FONTE ÚNICA DE VERDADE:
//
// Os preços dos planos DEVEM ser obtidos através de:
//
// SUBSCRIPTION_PLANS.pro.price
// SUBSCRIPTION_PLANS.business.price
//
// NÃO criar constantes como:
//
// const PRO_PRICE = 39.90;
//
// espalhadas por outros arquivos.
//
// ALTERAÇÃO FUTURA:
//
// Para alterar o preço de um plano no futuro, basta alterar:
//
// SUBSCRIPTION_PLANS
//
// Exemplo:
//
// pro: {
//   price: 44.90,
//   name: "Store Connect Pro",
// }
//
// A rotina automática de sincronização será responsável por detectar e
// corrigir assinaturas existentes que ainda estejam com o preço anterior.
//
// POLÍTICA DE COBRANÇAS PENDENTES:
//
// SANDBOX:
// updatePendingPayments = true
//
// Isso permite corrigirmos agora as faturas de teste que ainda estão
// em R$ 15,90.
//
// PRODUÇÃO:
// updatePendingPayments = false
//
// Assim, uma alteração futura atualiza a assinatura e as PRÓXIMAS cobranças,
// mas não altera silenciosamente uma fatura que já tenha sido emitida.
//
// Caso desejemos alterar também cobranças pendentes em produção no futuro,
// essa opção poderá ser sobrescrita explicitamente.
//
// =============================================================================

const admin = require("firebase-admin");
const axios = require("./provider");
const {getAsaasApiKey} = require("./asaasSecrets");

// =============================================================================
// AMBIENTE ASAAS
// =============================================================================

const {resolveAsaasConfig} = require("./asaasConfig");

// =============================================================================
// PREÇOS OFICIAIS
//
// ESTE É O ÚNICO LOCAL ONDE OS PREÇOS DOS PLANOS DEVEM SER DEFINIDOS.
// =============================================================================

const SUBSCRIPTION_PLANS = {
  pro: {
    price: 39.90,
    name: "Store Connect Pro",
  },

  business: {
    price: 99.90,
    name: "Store Connect Business",
  },
};

// =============================================================================
// POLÍTICA DE ATUALIZAÇÃO
//
// Sandbox:
//   atualiza também cobranças pendentes.
//
// Produção:
//   atualiza a assinatura, mas preserva cobranças já emitidas.
// =============================================================================

const SUBSCRIPTION_PRICE_POLICY = {
  get updatePendingPayments() {
    return resolveAsaasConfig().environment === "sandbox";
  },
};

// A2/01 - Bloqueio preventivo: a sincronizacao automatica de precos
// opera SOMENTE no Sandbox enquanto nao houver politica de alteracao
// de assinaturas/cobrancas PROD aprovada, isolamento de vinculos e testes.
// Este guard tambem protege chamadas diretas, nao apenas o agendador.
function assertSandboxPriceSyncOnly() {
  const config = resolveAsaasConfig();
  if (config.environment !== "sandbox" || config.operationsEnabled !== true) {
    throw new Error("A2/01: sincronizacao de precos bloqueada fora do Sandbox");
  }
  return config;
}

// =============================================================================
// NORMALIZA VALOR MONETÁRIO
//
// Evita diferenças como:
//
// 39.9
// 39.90
// "39.90"
//
// Todos passam a ser tratados como 39.90.
// =============================================================================

function normalizeMoney(value) {
  const number = Number(value ?? 0);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.round(number * 100) / 100;
}

// =============================================================================
// CABEÇALHOS ASAAS
// =============================================================================

function getAsaasHeaders() {
  resolveAsaasConfig();
  const apiKey =
      getAsaasApiKey();

  return {
    access_token: apiKey,
    "Content-Type": "application/json",
    "User-Agent": "StoreConnectApp/1.0",
  };
}

// =============================================================================
// OBTÉM PLANO OFICIAL
// =============================================================================

function getSubscriptionPlan(plan) {
  const normalizedPlan =
  String(plan || "pro")
      .trim()
      .toLowerCase();

  const selectedPlan =
  SUBSCRIPTION_PLANS[
  normalizedPlan
  ];

  if (!selectedPlan) {
    throw new Error(
    `Plano inválido: ${normalizedPlan}`
    );
  }

  return {
    key: normalizedPlan,
    ...selectedPlan,
  };
}

// =============================================================================
// SINCRONIZA COBRANÇAS VENCIDAS DA ASSINATURA
// =============================================================================
//
// MOTIVO:
//
// updatePendingPayments=true atualiza cobranças PENDING,
// mas NÃO altera cobranças OVERDUE.
//
// Como uma assinatura antiga pode possuir uma cobrança vencida de R$ 15,90,
// precisamos tratar essas cobranças individualmente.
//
// O Asaas permite atualizar uma cobrança vencida através de:
//
// PUT /payments/{paymentId}
//
// IMPORTANTE:
//
// • Cobranças já pagas NÃO são alteradas.
// • Cobranças canceladas NÃO são alteradas.
// • Somente OVERDUE é tratado aqui.
// • O vencimento original é preservado.
// =============================================================================

async function syncOverdueSubscriptionPayments({
  storeId,
  subscriptionId,
  expectedPrice,
  headers,
}) {
  assertSandboxPriceSyncOnly();

  console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":230});

  const overdueResponse =
    await axios.get(
      `${resolveAsaasConfig().baseUrl}/payments`,
      {
        headers,
        params: {
          subscription: subscriptionId,
          status: "OVERDUE",
          limit: 100,
        },
      }
    );

  const overduePayments =
    overdueResponse.data?.data || [];

  if (overduePayments.length === 0) {
    console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":251});

    return {
      checked: 0,
      updated: 0,
    };
  }

  let updated = 0;

  for (const payment of overduePayments) {
    const currentPaymentPrice =
      normalizeMoney(payment.value);

    if (
      currentPaymentPrice ===
      expectedPrice
    ) {
      console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":271});

      continue;
    }

    console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":278});

    await axios.put(
      `${resolveAsaasConfig().baseUrl}/payments/${payment.id}`,
      {
        billingType:
          payment.billingType || "UNDEFINED",

        value:
          expectedPrice,

        dueDate:
          payment.dueDate,

        description:
          payment.description ||
          "Assinatura Store Connect",

        externalReference:
          payment.externalReference ||
          storeId,
      },
      {
        headers,
      }
    );

    updated++;

    console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":311});
  }

  return {
    checked:
      overduePayments.length,

    updated,
  };
}

// =============================================================================
// SINCRONIZA UMA ÚNICA ASSINATURA
// =============================================================================
//
// OBJETIVO:
//
// Garantir que:
// • o valor da assinatura no Asaas esteja igual ao preço oficial do plano;
// • cobranças PENDING sejam atualizadas quando permitido;
// • cobranças OVERDUE antigas também sejam corrigidas individualmente;
// • o Firestore permaneça sincronizado com o valor oficial.
//
// EXEMPLO:
//
// Plano Pro oficial:
// R$ 39,90
//
// Assinatura antiga:
// R$ 15,90
//
// Cobrança PENDING:
// R$ 15,90
//
// Cobrança OVERDUE:
// R$ 15,90
//
// RESULTADO:
//
// Assinatura      -> R$ 39,90
// PENDING         -> R$ 39,90
// OVERDUE         -> R$ 39,90
// Firestore       -> R$ 39,90
//
// IMPORTANTE:
//
// Mesmo que a assinatura já esteja com o preço correto, ainda procuramos
// cobranças OVERDUE antigas, pois elas podem continuar com um valor anterior.
//
// =============================================================================

async function syncAsaasSubscriptionPrice({
  storeId,
  subscriptionId,
  plan,
  updatePendingPayments =
    SUBSCRIPTION_PRICE_POLICY
      .updatePendingPayments,
}) {
  // Antes de ler credenciais, consultar Asaas ou alterar Firestore.
  assertSandboxPriceSyncOnly();

  // ===========================================================================
  // 1. VALIDAÇÕES
  // ===========================================================================

  if (!storeId) {
    throw new Error(
      "storeId não informado."
    );
  }

  if (!subscriptionId) {
    throw new Error(
      "subscriptionId não informado."
    );
  }

  const selectedPlan =
    getSubscriptionPlan(plan);

  const headers =
    getAsaasHeaders();

  // ===========================================================================
  // 2. CONSULTA A ASSINATURA REAL NO ASAAS
  // ===========================================================================

  const subscriptionResponse =
    await axios.get(
      `${resolveAsaasConfig().baseUrl}/subscriptions/${subscriptionId}`,
      {
        headers,
      }
    );

  const subscription =
    subscriptionResponse.data;

  if (
    !subscription ||
    subscription.deleted === true
  ) {
    throw new Error(
      `Assinatura ${subscriptionId} não encontrada ou removida.`
    );
  }

  // ===========================================================================
  // 3. COMPARA PREÇOS
  // ===========================================================================

  const currentPrice =
    normalizeMoney(
      subscription.value
    );

  const expectedPrice =
    normalizeMoney(
      selectedPlan.price
    );

  console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":435});

  // ===========================================================================
  // 4. PREÇO DA ASSINATURA JÁ ESTÁ CORRETO
  //
  // IMPORTANTE:
  //
  // Mesmo assim ainda verificamos cobranças OVERDUE antigas.
  // ===========================================================================

  if (
    currentPrice === expectedPrice
  ) {
    console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":452});

    // -------------------------------------------------------------------------
    // 4.1 VERIFICA COBRANÇAS VENCIDAS
    // -------------------------------------------------------------------------

    const overdueSync =
      await syncOverdueSubscriptionPayments({
        storeId,

        subscriptionId,

        expectedPrice,

        headers,
      });

    // -------------------------------------------------------------------------
    // 4.2 GARANTE O PREÇO CORRETO NO FIRESTORE
    // -------------------------------------------------------------------------

    await admin
      .firestore()
      .collection("stores")
      .doc(storeId)
      .update({
        subscriptionPlanPrice:
          expectedPrice,
      });

    return {
      updated:
        false,

      subscriptionUpdated:
        false,

      subscriptionId,

      plan:
        selectedPlan.key,

      oldPrice:
        currentPrice,

      newPrice:
        expectedPrice,

      overduePaymentsChecked:
        overdueSync.checked,

      overduePaymentsUpdated:
        overdueSync.updated,
    };
  }

  // ===========================================================================
  // 5. PREÇO DA ASSINATURA ESTÁ DIVERGENTE
  // ===========================================================================

  console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":514});

  console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":520});

  // ===========================================================================
  // 6. ATUALIZA ASSINATURA NO ASAAS
  //
  // updatePendingPayments:
  //
  // true:
  //   atualiza também cobranças PENDING já geradas.
  //
  // false:
  //   preserva cobranças PENDING já emitidas e aplica o preço novo
  //   apenas nas próximas cobranças.
  // ===========================================================================

  await axios.put(
    `${resolveAsaasConfig().baseUrl}/subscriptions/${subscriptionId}`,
    {
      value:
        expectedPrice,

      description:
        `Assinatura ${selectedPlan.name}`,

      externalReference:
        storeId,

      updatePendingPayments:
        updatePendingPayments,
    },
    {
      headers,
    }
  );

  console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":557});

  // ===========================================================================
  // 7. CORRIGE COBRANÇAS VENCIDAS
  //
  // updatePendingPayments NÃO resolve cobranças OVERDUE.
  //
  // Por isso procuramos e corrigimos individualmente cada cobrança vencida.
  // ===========================================================================

  const overdueSync =
    await syncOverdueSubscriptionPayments({
      storeId,

      subscriptionId,

      expectedPrice,

      headers,
    });

  // ===========================================================================
  // 8. ATUALIZA FIRESTORE
  //
  // Só fazemos isso depois que a atualização do Asaas foi concluída.
  // ===========================================================================

  await admin
    .firestore()
    .collection("stores")
    .doc(storeId)
    .update({
      subscriptionPlanPrice:
        expectedPrice,

      subscriptionPriceSyncedAt:
        admin.firestore.FieldValue
          .serverTimestamp(),
    });

  console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":599});

  console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":603});

  console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":608});

  console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":612});

  // ===========================================================================
  // 9. RETORNO
  // ===========================================================================

  return {
    updated:
      true,

    subscriptionUpdated:
      true,

    subscriptionId,

    plan:
      selectedPlan.key,

    oldPrice:
      currentPrice,

    newPrice:
      expectedPrice,

    overduePaymentsChecked:
      overdueSync.checked,

    overduePaymentsUpdated:
      overdueSync.updated,
  };
}

// =============================================================================
// SINCRONIZA TODAS AS LOJAS
// =============================================================================
//
// Essa função será chamada por uma Cloud Function agendada.
//
// FLUXO:
//
// stores
//   ↓
// encontra lojas com asaasSubscriptionId
//   ↓
// identifica plano atual
//   ↓
// consulta preço real no Asaas
//   ↓
// compara com SUBSCRIPTION_PLANS
//   ↓
// corrige se necessário
//
// =============================================================================

async function syncAllAsaasSubscriptionPrices({
updatePendingPayments =
SUBSCRIPTION_PRICE_POLICY
    .updatePendingPayments,
} = {}) {
assertSandboxPriceSyncOnly();
getAsaasApiKey();
const db =
admin.firestore();

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":678});

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":682});

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":686});

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":690});

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":694});

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":698});

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":702});

// ===========================================================================
// 1. BUSCA TODAS AS LOJAS
// ===========================================================================

const storesSnapshot =
await db
    .collection("stores")
    .get();

let checked = 0;
let updated = 0;
let alreadyCorrect = 0;
let skipped = 0;
let errors = 0;

// ===========================================================================
// 2. PROCESSA UMA LOJA POR VEZ
//
// Fazemos sequencialmente para evitar disparar centenas de requisições
// simultâneas contra a API do Asaas.
// ===========================================================================

for (
const storeDoc
of storesSnapshot.docs
) {
const storeData =
storeDoc.data() || {};

const storeId =
storeDoc.id;

const subscriptionId =
storeData.asaasSubscriptionId;

// -------------------------------------------------------------------------
// SEM ASSINATURA ASAAS
// -------------------------------------------------------------------------

if (!subscriptionId) {
skipped++;

continue;
}

// -------------------------------------------------------------------------
// PLANO ATUAL
// -------------------------------------------------------------------------

const plan =
String(
storeData.subscriptionType ||
"pro"
)
    .trim()
    .toLowerCase();

if (
!SUBSCRIPTION_PLANS[
plan
]
) {
console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":768});

skipped++;

continue;
}

checked++;

// -------------------------------------------------------------------------
// SINCRONIZA
// -------------------------------------------------------------------------

try {
const result =
await syncAsaasSubscriptionPrice({
storeId,

subscriptionId,

plan,

updatePendingPayments,
});

if (result.updated) {
updated++;
} else {
alreadyCorrect++;
}
} catch (error) {
errors++;

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":803});

// Não interrompemos toda a rotina.
//
// Uma loja com erro não deve impedir a sincronização
// das demais.
}
}

// ===========================================================================
// 3. RESULTADO FINAL
// ===========================================================================

const result = {
totalStores:
storesSnapshot.size,

checked,

updated,

alreadyCorrect,

skipped,

errors,

environment:
resolveAsaasConfig().environment,

updatePendingPayments,
};

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":841});

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":845});

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":849});

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":853});

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":857});

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":861});

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":865});

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":869});

console.info('finance_event',{"file":"financeiro/subscriptionPricing.js","line":873});

return result;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
SUBSCRIPTION_PLANS,

SUBSCRIPTION_PRICE_POLICY,

syncAsaasSubscriptionPrice,

syncAllAsaasSubscriptionPrices,
};
