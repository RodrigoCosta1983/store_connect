const {
  onSchedule,
} = require(
  "firebase-functions/v2/scheduler"
);

const admin =
  require("firebase-admin");

const axios =
  require("axios");


if (!admin.apps.length) {
  admin.initializeApp();
}


const db =
  admin.firestore();


const ASAAS_ENV =
  process.env.ASAAS_ENV ||
  "sandbox";


const ASAAS_URL =
  ASAAS_ENV === "production"
    ? "https://www.asaas.com/api/v3"
    : "https://sandbox.asaas.com/api/v3";


const PAYMENT_PAGE_SIZE =
  100;


const MAX_PAYMENT_PAGES =
  20;


// =============================================================================
// DATA CIVIL DE SAO PAULO
// =============================================================================

function getTodaySaoPaulo() {

  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "America/Sao_Paulo",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      }
    )
      .formatToParts(
        new Date()
      );


  const values = {};


  for (
    const part of parts
  ) {

    if (
      part.type !==
      "literal"
    ) {

      values[part.type] =
        part.value;
    }
  }


  return (
    values.year +
    "-" +
    values.month +
    "-" +
    values.day
  );
}


// =============================================================================
// ASAAS
// =============================================================================

function getAsaasHeaders() {

  const apiKey =
    process.env
      .ASAAS_API_KEY;


  if (!apiKey) {

    throw new Error(
      "ASAAS_API_KEY ausente."
    );
  }


  return {
    access_token:
      apiKey,

    "User-Agent":
      "StoreConnect-BillingReconciliation/1.0",
  };
}


async function fetchPaymentsByStatus(
  subscriptionId,
  status,
  headers
) {

  const payments =
    [];


  for (
    let page = 0;
    page < MAX_PAYMENT_PAGES;
    page++
  ) {

    const offset =
      page *
      PAYMENT_PAGE_SIZE;


    const response =
      await axios.get(
        `${ASAAS_URL}/payments`,
        {
          headers,

          params: {
            subscription:
              subscriptionId,

            status,

            limit:
              PAYMENT_PAGE_SIZE,

            offset,
          },
        }
      );


    const pagePayments =
      response.data &&
      Array.isArray(
        response.data.data
      )
        ? response.data.data
        : [];


    payments.push(
      ...pagePayments
    );


    if (
      pagePayments.length <
      PAYMENT_PAGE_SIZE
    ) {

      return payments;
    }
  }


  throw new Error(
    `Limite de paginacao excedido para ${status} da assinatura ${subscriptionId}.`
  );
}


function isEffectiveOverdue(
  payment,
  today
) {

  const status =
    String(
      payment.status || ""
    )
      .trim()
      .toUpperCase();


  const dueDate =
    String(
      payment.dueDate || ""
    )
      .trim();


  if (
    status !== "OVERDUE" &&
    status !== "PENDING"
  ) {

    return false;
  }


  if (
    !/^\d{4}-\d{2}-\d{2}$/
      .test(dueDate)
  ) {

    return false;
  }


  // No proprio dia do vencimento ainda esta regular.
  return dueDate < today;
}


function sortByDueDate(
  a,
  b
) {

  return String(
    a.dueDate || ""
  )
    .localeCompare(
      String(
        b.dueDate || ""
      )
    );
}


async function getSubscriptionBillingState(
  subscriptionId,
  headers,
  today
) {

  const results =
    await Promise.all([
      fetchPaymentsByStatus(
        subscriptionId,
        "OVERDUE",
        headers
      ),

      fetchPaymentsByStatus(
        subscriptionId,
        "PENDING",
        headers
      ),
    ]);


  const overduePayments =
    results[0];


  const pendingPayments =
    results[1];


  const effectiveMap =
    new Map();


  for (
    const payment of
    [
      ...overduePayments,
      ...pendingPayments,
    ]
  ) {

    if (
      !isEffectiveOverdue(
        payment,
        today
      )
    ) {

      continue;
    }


    const key =
      payment.id ||
      (
        String(
          payment.status || ""
        ) +
        "|" +
        String(
          payment.dueDate || ""
        ) +
        "|" +
        String(
          payment.value || ""
        )
      );


    effectiveMap.set(
      key,
      payment
    );
  }


  const effectiveOverdue =
    Array.from(
      effectiveMap.values()
    )
      .sort(
        sortByDueDate
      );


  const futurePending =
    pendingPayments
      .filter(
        (payment) => {

          const dueDate =
            String(
              payment.dueDate ||
              ""
            );


          return (
            /^\d{4}-\d{2}-\d{2}$/
              .test(dueDate) &&
            dueDate >= today
          );
        }
      )
      .sort(
        sortByDueDate
      );


  return {
    hasOverdue:
      effectiveOverdue.length >
      0,

    overdueDueDate:
      effectiveOverdue.length >
      0
        ? effectiveOverdue[0]
            .dueDate
        : null,

    nextPendingDueDate:
      futurePending.length >
      0
        ? futurePending[0]
            .dueDate
        : null,
  };
}


// =============================================================================
// ESCRITA PROTEGIDA
//
// Usa o updateTime observado pela reconciliacao.
// Se o webhook modificar a loja durante a execucao,
// esta escrita falha em vez de sobrescrever um estado mais novo.
// =============================================================================

async function updateStoreSafely(
  doc,
  updateData
) {

  try {

    await doc.ref.update(
      updateData,
      {
        lastUpdateTime:
          doc.updateTime,
      }
    );


    return {
      updated:
        true,

      concurrentChange:
        false,
    };

  }
  catch (error) {

    const code =
      error &&
      error.code !== undefined
        ? String(error.code)
        : "";


    if (
      code === "9" ||
      code === "failed-precondition" ||
      code === "FAILED_PRECONDITION"
    ) {

      console.warn(
        `⚠️ Loja ${doc.id} mudou durante a reconciliacao. ` +
        "Atualizacao ignorada com seguranca."
      );


      return {
        updated:
          false,

        concurrentChange:
          true,
      };
    }


    throw error;
  }
}


// =============================================================================
// RECONCILIAR UMA LOJA
// =============================================================================

async function reconcileStore(
  doc,
  today,
  headers
) {

  const storeId =
    doc.id;


  const store =
    doc.data() || {};


  const currentStatus =
    String(
      store.subscriptionStatus ||
      ""
    )
      .trim()
      .toLowerCase();


  const plan =
    String(
      store.subscriptionType ||
      ""
    )
      .trim()
      .toLowerCase();


  const subscriptionId =
    String(
      store.asaasSubscriptionId ||
      ""
    )
      .trim();


  const customerId =
    String(
      store.asaasCustomerId ||
      ""
    )
      .trim();


  if (
    currentStatus !== "active" &&
    currentStatus !== "overdue"
  ) {

    return {
      storeId,
      action:
        "SKIP_STATUS",
    };
  }


  if (
    plan !== "pro" &&
    plan !== "business"
  ) {

    return {
      storeId,
      action:
        "SKIP_NOT_PAID_PLAN",
    };
  }


  if (!subscriptionId) {

    return {
      storeId,
      action:
        "SKIP_NO_OFFICIAL_SUBSCRIPTION",
    };
  }


  // ===========================================================================
  // GUARDIAO DA ASSINATURA OFICIAL
  // ===========================================================================

  const subscriptionResponse =
    await axios.get(
      `${ASAAS_URL}/subscriptions/${subscriptionId}`,
      {
        headers,
      }
    );


  const subscription =
    subscriptionResponse.data ||
    {};


  if (
    String(
      subscription.id || ""
    ) !== subscriptionId
  ) {

    return {
      storeId,
      action:
        "SKIP_SUBSCRIPTION_ID_MISMATCH",
    };
  }


  if (
    String(
      subscription.externalReference ||
      ""
    ) !== storeId
  ) {

    return {
      storeId,
      action:
        "SKIP_EXTERNAL_REFERENCE_MISMATCH",
    };
  }


  if (
    customerId &&
    String(
      subscription.customer ||
      ""
    ) !== customerId
  ) {

    return {
      storeId,
      action:
        "SKIP_CUSTOMER_MISMATCH",
    };
  }


  if (
    String(
      subscription.status || ""
    )
      .trim()
      .toUpperCase() !==
      "ACTIVE"
  ) {

    return {
      storeId,
      action:
        "SKIP_ASAAS_SUBSCRIPTION_NOT_ACTIVE",

      asaasStatus:
        subscription.status ||
        null,
    };
  }


  const billingState =
    await getSubscriptionBillingState(
      subscriptionId,
      headers,
      today
    );


  // ===========================================================================
  // EXISTE ATRASO REAL
  // ===========================================================================

  if (
    billingState.hasOverdue
  ) {

    const dueDate =
      String(
        billingState.overdueDueDate ||
        ""
      );


    if (
      !/^\d{4}-\d{2}-\d{2}$/
        .test(dueDate)
    ) {

      return {
        storeId,
        action:
          "SKIP_INVALID_OVERDUE_DATE",
      };
    }


    const storedNextDueDate =
      typeof store.nextDueDate ===
        "string"
        ? store.nextDueDate.trim()
        : "";


    const storedOverdueDueDate =
      typeof store.overdueDueDate ===
        "string"
        ? store.overdueDueDate.trim()
        : "";


    const needsUpdate =
      currentStatus !==
        "overdue" ||
      storedNextDueDate !==
        dueDate ||
      storedOverdueDueDate !==
        dueDate ||
      !store.overdueSince;


    if (!needsUpdate) {

      return {
        storeId,
        action:
          "NO_CHANGE_OVERDUE",
      };
    }


    const updateData = {
      subscriptionStatus:
        "overdue",

      nextDueDate:
        dueDate,

      overdueDueDate:
        dueDate,
    };


    if (
      !store.overdueSince
    ) {

      updateData.overdueSince =
        admin.firestore
          .FieldValue
          .serverTimestamp();
    }


    const writeResult =
      await updateStoreSafely(
        doc,
        updateData
      );


    if (
      writeResult.concurrentChange
    ) {

      return {
        storeId,
        action:
          "SKIP_CONCURRENT_CHANGE",
      };
    }


    console.log(
      `⚠️ Reconciliacao: loja ${storeId} overdue, ` +
      `vencimento=${dueDate}.`
    );


    return {
      storeId,

      action:
        currentStatus === "active"
          ? "MARKED_OVERDUE"
          : "REPAIRED_OVERDUE_METADATA",

      dueDate,
    };
  }


  // ===========================================================================
  // NAO EXISTE MAIS ATRASO
  //
  // Somente lojas OVERDUE sao reativadas aqui.
  // INACTIVE nao faz parte desta reconciliacao.
  // ===========================================================================

  if (
    currentStatus === "overdue"
  ) {

    const nextDueDate =
      billingState.nextPendingDueDate ||
      subscription.nextDueDate ||
      null;


    const updateData = {
      subscriptionStatus:
        "active",

      overdueSince:
        admin.firestore
          .FieldValue
          .delete(),

      overdueDueDate:
        admin.firestore
          .FieldValue
          .delete(),
    };


    if (nextDueDate) {

      updateData.nextDueDate =
        nextDueDate;
    }
    else {

      updateData.nextDueDate =
        admin.firestore
          .FieldValue
          .delete();
    }


    const writeResult =
      await updateStoreSafely(
        doc,
        updateData
      );


    if (
      writeResult.concurrentChange
    ) {

      return {
        storeId,
        action:
          "SKIP_CONCURRENT_CHANGE",
      };
    }


    console.log(
      `✅ Reconciliacao: loja ${storeId} voltou para ACTIVE.`
    );


    return {
      storeId,

      action:
        "REACTIVATED_OVERDUE",

      nextDueDate,
    };
  }


  return {
    storeId,
    action:
      "NO_CHANGE_REGULAR",
  };
}


// =============================================================================
// CARREGAR CANDIDATAS
// =============================================================================

async function loadCandidateStores(
  targetStoreIds
) {

  if (
    Array.isArray(
      targetStoreIds
    ) &&
    targetStoreIds.length >
      0
  ) {

    const docs =
      [];


    for (
      const storeId of
      targetStoreIds
    ) {

      const snap =
        await db
          .collection("stores")
          .doc(storeId)
          .get();


      if (snap.exists) {
        docs.push(snap);
      }
    }


    return docs;
  }


  const snapshot =
    await db
      .collection("stores")
      .where(
        "subscriptionStatus",
        "in",
        [
          "active",
          "overdue",
        ]
      )
      .get();


  return snapshot.docs;
}


// =============================================================================
// EXECUCAO DA RECONCILIACAO
// =============================================================================

async function runAsaasBillingReconciliation(
  options
) {

  const config =
    options || {};


  const today =
    getTodaySaoPaulo();


  const headers =
    getAsaasHeaders();


  const docs =
    await loadCandidateStores(
      config.targetStoreIds
    );


  const summary = {
    todaySaoPaulo:
      today,

    candidates:
      docs.length,

    markedOverdue:
      0,

    repairedOverdueMetadata:
      0,

    reactivatedOverdue:
      0,

    unchanged:
      0,

    skipped:
      0,

    errors:
      0,
  };


  for (
    const doc of docs
  ) {

    try {

      const result =
        await reconcileStore(
          doc,
          today,
          headers
        );


      switch (
        result.action
      ) {

        case "MARKED_OVERDUE":
          summary.markedOverdue++;
          break;

        case "REPAIRED_OVERDUE_METADATA":
          summary.repairedOverdueMetadata++;
          break;

        case "REACTIVATED_OVERDUE":
          summary.reactivatedOverdue++;
          break;

        case "NO_CHANGE_REGULAR":
        case "NO_CHANGE_OVERDUE":
          summary.unchanged++;
          break;

        default:
          summary.skipped++;

          console.warn(
            `⚠️ Reconciliacao ignorou ${doc.id}: ${result.action}`
          );
          break;
      }

    }
    catch (error) {

      summary.errors++;

      console.error(
        `❌ Reconciliacao falhou para loja ${doc.id}:`,
        error.response &&
        error.response.data
          ? error.response.data
          : error
      );
    }
  }


  console.log(
    "✅ Reconciliacao financeira concluida:",
    JSON.stringify(
      summary
    )
  );


  return summary;
}


// Export auxiliar para execucao controlada/testes.
exports.runAsaasBillingReconciliation =
  runAsaasBillingReconciliation;


// =============================================================================
// SCHEDULER
//
// 01:30 Sao Paulo:
// reconcilia realidade Asaas -> Firestore.
//
// 02:00:
// checkOverdueSubscriptions pode entao bloquear dia 4+.
// =============================================================================

exports.reconcileAsaasBilling =
  onSchedule(
    {
      schedule:
        "30 1 * * *",

      timeZone:
        "America/Sao_Paulo",

      timeoutSeconds:
        300,
    },

    async () => {

      await runAsaasBillingReconciliation();
    }
  );