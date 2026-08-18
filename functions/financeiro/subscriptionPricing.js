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
const axios = require("axios");

// =============================================================================
// AMBIENTE ASAAS
// =============================================================================

const ASAAS_ENV =
    process.env.ASAAS_ENV || "sandbox";

const ASAAS_URL =
    ASAAS_ENV === "production"
? "https://www.asaas.com/api/v3"
    : "https://sandbox.asaas.com/api/v3";

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
  updatePendingPayments:
  ASAAS_ENV !== "production",
};

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
  const apiKey =
      process.env.ASAAS_API_KEY;

  if (!apiKey) {
    throw new Error(
        "ASAAS_API_KEY não configurada."
    );
  }

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
  console.log(
    `🔎 Procurando cobranças vencidas da assinatura ${subscriptionId}...`
  );

  const overdueResponse =
    await axios.get(
      `${ASAAS_URL}/payments`,
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
    console.log(
      `✅ Loja ${storeId}: nenhuma cobrança vencida encontrada.`
    );

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
      console.log(
        `✅ Cobrança ${payment.id} já está em R$ ${expectedPrice.toFixed(2)}`
      );

      continue;
    }

    console.log(
      `🔄 Atualizando cobrança vencida ${payment.id}: ` +
        `R$ ${currentPaymentPrice.toFixed(2)} -> ` +
        `R$ ${expectedPrice.toFixed(2)}`
    );

    await axios.put(
      `${ASAAS_URL}/payments/${payment.id}`,
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

    console.log(
      `✅ Cobrança vencida ${payment.id} atualizada para R$ ${expectedPrice.toFixed(2)}`
    );
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
      `${ASAAS_URL}/subscriptions/${subscriptionId}`,
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

  console.log(
    `💰 Loja ${storeId}: ` +
      `Asaas R$ ${currentPrice.toFixed(2)} | ` +
      `Oficial R$ ${expectedPrice.toFixed(2)}`
  );

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
    console.log(
      `✅ Loja ${storeId}: assinatura já está com o preço correto.`
    );

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

  console.log(
    `🔄 Corrigindo assinatura ${subscriptionId}: ` +
      `R$ ${currentPrice.toFixed(2)} -> ` +
      `R$ ${expectedPrice.toFixed(2)}`
  );

  console.log(
    `🧾 Atualizar cobranças pendentes: ${updatePendingPayments}`
  );

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
    `${ASAAS_URL}/subscriptions/${subscriptionId}`,
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

  console.log(
    `✅ Assinatura ${subscriptionId} atualizada no Asaas.`
  );

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

  console.log(
    `✅ Loja ${storeId} totalmente sincronizada.`
  );

  console.log(
    `💰 Assinatura: R$ ${currentPrice.toFixed(2)} -> ` +
      `R$ ${expectedPrice.toFixed(2)}`
  );

  console.log(
    `🔴 Cobranças vencidas verificadas: ${overdueSync.checked}`
  );

  console.log(
    `🔄 Cobranças vencidas atualizadas: ${overdueSync.updated}`
  );

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
const db =
admin.firestore();

console.log(
"\n\n============================================================"
);

console.log(
"💰 INICIANDO SINCRONIZAÇÃO DE PREÇOS ASAAS"
);

console.log(
`🌐 Ambiente: ${ASAAS_ENV}`
);

console.log(
`🧾 Atualizar cobranças pendentes: ${updatePendingPayments}`
);

console.log(
`💎 PRO: R$ ${SUBSCRIPTION_PLANS.pro.price.toFixed(2)}`
);

console.log(
`🏢 BUSINESS: R$ ${SUBSCRIPTION_PLANS.business.price.toFixed(2)}`
);

console.log(
"============================================================"
);

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
console.warn(
`⚠️ Loja ${storeId}: plano desconhecido "${plan}".`
);

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

console.error(
`❌ Falha ao sincronizar loja ${storeId}:`,
error.response?.data ||
error.message ||
error
);

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
ASAAS_ENV,

updatePendingPayments,
};

console.log(
"============================================================"
);

console.log(
"✅ SINCRONIZAÇÃO DE PREÇOS CONCLUÍDA"
);

console.log(
`🏪 Lojas encontradas: ${result.totalStores}`
);

console.log(
`🔎 Assinaturas verificadas: ${checked}`
);

console.log(
`🔄 Assinaturas atualizadas: ${updated}`
);

console.log(
`✅ Já estavam corretas: ${alreadyCorrect}`
);

console.log(
`⏭️ Ignoradas: ${skipped}`
);

console.log(
`❌ Erros: ${errors}`
);

console.log(
"============================================================\n"
);

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