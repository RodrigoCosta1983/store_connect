// =============================================================================
// ARQUIVO: financeiro/asaasWebhook.js
// =============================================================================
//
// OBJETIVO:
//
// Receber e processar os webhooks enviados pelo Asaas, mantendo o estado
// financeiro das lojas sincronizado no Firestore e protegendo o acesso do
// Store Connect contra eventos antigos, cobranças soltas e inconsistências.
//
// RESPONSABILIDADES:
//
// • Localizar a loja correta pelo ID da assinatura ou externalReference.
// • Ignorar eventos pertencentes a assinaturas antigas.
// • Detectar cobranças vencidas e pendentes da assinatura atual.
// • Atualizar subscriptionStatus, nextDueDate e overdueSince no Firestore.
// • Ativar a loja após pagamento confirmado quando não houver outro atraso.
// • Inativar/remover o vínculo quando a assinatura oficial for excluída.
// • Não alterar o acesso quando apenas uma cobrança individual for removida.
// • Finalizar downgrade Business -> Pro após o pagamento Business previsto.
//
// INTEGRAÇÃO COM PREÇOS:
//
// Os preços NÃO devem ser definidos diretamente neste arquivo.
// A fonte única de verdade é:
//
//   financeiro/subscriptionPricing.js
//
// Portanto, sempre utilizar:
//
//   SUBSCRIPTION_PLANS.pro.price
//   SUBSCRIPTION_PLANS.business.price
//
// Isso evita que um reajuste futuro fique inconsistente entre criação de
// assinatura, troca de plano, webhook e rotina automática de sincronização.
//
// FLUXO PRINCIPAL:
//
// Asaas -> webhook -> identifica assinatura -> identifica loja
//       -> valida se é a assinatura oficial da loja
//       -> consulta estado financeiro real
//       -> processa evento
//       -> atualiza Firestore
//
// CUIDADOS DE MANUTENÇÃO:
//
// • Não remover o "guardião da assinatura" sem revisar todo o fluxo.
// • Não liberar uma loja apenas porque uma cobrança foi paga: primeiro deve ser
//   confirmado que não existe outra cobrança OVERDUE na mesma assinatura.
// • Não reiniciar overdueSince em eventos repetidos de atraso.
// • Não voltar a declarar valores como const PRO_PRICE = 39.90.
// • O downgrade Business -> Pro deve continuar alterando A MESMA assinatura.
// • Falha ao concluir downgrade não deve apagar pendingPlanChange.
//
// =============================================================================

const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("./provider");
const {completeListResponse}=require("./asaasCompleteList");
const readBillingList=(url,options)=>completeListResponse(axios.get,url,options);
const {asaasApiKey, getAsaasApiKey, asaasWebhookToken} = require("./asaasSecrets");
const {authenticateAsaasWebhook} = require("./asaasWebhookAuth");

const {
  SUBSCRIPTION_PLANS,
} = require("./subscriptionPricing");

// -----------------------------------------------------------------------------
// AMBIENTE ASAAS
// -----------------------------------------------------------------------------

const {resolveAsaasConfig} = require("./asaasConfig");
const {classifyAsaasBindingOrigin} = require("./asaasBindingOrigin");
const {checkStoreFinancialAdmission} = require("./storeFinancialAdmission");


// A2/03c: cada escrita deve usar a versao do documento lida antes da
// consulta ao Asaas; nao sobrescrever mudanca de outro webhook, reconciliador
// ou outro processo. Em conflito, devolver erro transitorio, nunca HTTP 200.
function isConcurrentStoreChange(error) {
  const code = String(error?.code || "").toUpperCase();
  return code === "9" || code === "FAILED-PRECONDITION" ||
    code === "FAILED_PRECONDITION";
}

async function updateStoreAtSnapshot(storeRef, snapshot, updateData) {
  if (!snapshot || !snapshot.updateTime) {
    const error = new Error("Versao do documento indisponivel para escrita financeira.");
    error.code = "FAILED_PRECONDITION";
    throw error;
  }
  await storeRef.update(updateData, {lastUpdateTime: snapshot.updateTime});
}

// -----------------------------------------------------------------------------
// FUNÇÃO AUXILIAR
//
// Descobre a situação financeira REAL da assinatura.
//
// REGRA:
//
// 1. Se existe cobrança OVERDUE:
//      ela tem prioridade.
//
// 2. Se não existe OVERDUE:
//      busca a próxima PENDING.
//
// 3. Se não existe nenhuma:
//      consulta nextDueDate da assinatura.
// -----------------------------------------------------------------------------

async function getSubscriptionBillingState(
  subscriptionId,
  headers, storeId, customerId
) {
  let hasOverdue = false;
  let nextDueDate = null;

  // ---------------------------------------------------------------------------
  // 1. PROCURA COBRANÇA VENCIDA
  // ---------------------------------------------------------------------------

  const overdueRes = await readBillingList(
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

  // A2/03a: resposta ausente ou malformada nao equivale a zero atrasos.
  if (!Array.isArray(overdueRes.data?.data) || overdueRes.data.hasMore !== false || overdueRes.data.data.some(p=>p.subscription!==subscriptionId||p.customer!==customerId||(p.externalReference&&p.externalReference!==storeId))) {
    throw new Error("asaas_overdue_payload_invalid");
  }

  const overduePayments = overdueRes.data.data;

  if (overduePayments.length > 0) {
    overduePayments.sort(
      (a, b) =>
        new Date(a.dueDate) -
        new Date(b.dueDate)
    );

    hasOverdue = true;
    nextDueDate = overduePayments[0].dueDate;

    console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":151});

    return {
      hasOverdue,
      nextDueDate,
    };
  }

  // ---------------------------------------------------------------------------
  // 2. SE NÃO HÁ VENCIDA, PROCURA A PRÓXIMA PENDENTE
  // ---------------------------------------------------------------------------

  const pendingRes = await readBillingList(
    `${resolveAsaasConfig().baseUrl}/payments`,
    {
      headers,
      params: {
        subscription: subscriptionId,
        status: "PENDING",
        limit: 100,
      },
    }
  );

  // A2/03a: nao presumir adimplencia diante de payload inesperado.
  if (!Array.isArray(pendingRes.data?.data) || pendingRes.data.hasMore !== false || pendingRes.data.data.some(p=>p.subscription!==subscriptionId||p.customer!==customerId||(p.externalReference&&p.externalReference!==storeId))) {
    throw new Error("asaas_pending_payload_invalid");
  }

  const pendingPayments = pendingRes.data.data;

  if (pendingPayments.length > 0) {
    pendingPayments.sort(
      (a, b) =>
        new Date(a.dueDate) -
        new Date(b.dueDate)
    );

    nextDueDate =
      pendingPayments[0].dueDate;

    // -------------------------------------------------------------------------
    // PROTEÇÃO CONTRA PENDING VENCIDA
    //
    // O Asaas pode manter temporariamente uma cobrança como PENDING mesmo
    // após o vencimento. Para a regra de acesso do Store&Connect, qualquer
    // PENDING com dueDate anterior ao dia atual já representa inadimplência.
    //
    // No próprio dia do vencimento ela continua regular.
    // -------------------------------------------------------------------------

    const todayParts =
      new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone: "America/Sao_Paulo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }
      ).formatToParts(new Date());

    const todayMap =
      Object.fromEntries(
        todayParts
          .filter(
            (part) =>
              part.type !== "literal"
          )
          .map(
            (part) => [
              part.type,
              part.value,
            ]
          )
      );

    const todaySaoPaulo =
      `${todayMap.year}-${todayMap.month}-${todayMap.day}`;

    if (
      nextDueDate &&
      nextDueDate < todaySaoPaulo
    ) {
      hasOverdue = true;

      console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":239});

      console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":243});

      return {
        hasOverdue,
        nextDueDate,
      };
    }

    console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":253});

    return {
      hasOverdue,
      nextDueDate,
    };
  }

  // ---------------------------------------------------------------------------
  // 3. PLANO B:
  // NÃO EXISTE COBRANÇA OVERDUE NEM PENDING.
  // CONSULTA O PRÓXIMO CICLO DA ASSINATURA.
  // ---------------------------------------------------------------------------

  try {
    const subRes = await axios.get(
      `${resolveAsaasConfig().baseUrl}/subscriptions/${subscriptionId}`,
      { headers }
    );

    if (subRes.data?.nextDueDate) {
      nextDueDate =
        subRes.data.nextDueDate;

      console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":279});
    }
  } catch (error) {
    // A2/03a: a consulta de fallback faz parte da conciliacao. Se falhar,
    // nenhum evento de pagamento pode assumir que a loja esta regular.
    console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":286});
    throw new Error("asaas_subscription_fallback_unavailable");
  }

  return {
    hasOverdue,
    nextDueDate,
  };
}


// =============================================================================
// 🔔 WEBHOOK DO ASAAS
// =============================================================================

exports.asaasWebhook = onRequest(
  {secrets: [asaasApiKey, asaasWebhookToken]},
  async (req, res) => {

    if (req.method === "POST") {
      const status = authenticateAsaasWebhook(req);
      if (status !== 200) {
        return res.status(status).send(status === 401 ? "Unauthorized" : "Service Unavailable");
      }
      if (!resolveAsaasConfig().operationsEnabled) {
        return res.status(503).send("Service Unavailable");
      }
    }

    console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":318});

    console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":322});

    console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":326});

    if (req.method !== "POST") {
      return res
        .status(405)
        .send("Method Not Allowed");
    }

    try {

      resolveAsaasConfig();
      const ASAAS_API_KEY = getAsaasApiKey();
      const body =
        typeof req.body === "string"
          ? JSON.parse(req.body)
          : req.body;

      const event = body.event;

      // -----------------------------------------------------------------------
      // O ASAAS PODE ENVIAR:
      //
      // body.payment
      //
      // OU
      //
      // body.subscription
      //
      // dependendo do tipo de evento.
      // -----------------------------------------------------------------------

      const payment =
        body.payment || null;

      const subscription =
        body.subscription || null;

      // ID da assinatura responsável pelo evento.
      const eventSubscriptionId =
        payment?.subscription ||
        subscription?.id ||
        null;

      // External Reference pode estar na cobrança
      // ou na própria assinatura.
      const targetId =
        payment?.externalReference ||
        subscription?.externalReference ||
        null;

      console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":378});

      console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":380});

      console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":386});

      const db = admin.firestore();

      let storeIdParaAtualizar = null;

      // -----------------------------------------------------------------------
      // 1ª TENTATIVA
      //
      // PROCURA A LOJA PELO ID DA ASSINATURA.
      //
      // Esse é o método mais confiável.
      // -----------------------------------------------------------------------

      if (eventSubscriptionId) {

        const snapshot =
          await db
            .collection("stores")
            .where(
              "asaasSubscriptionId",
              "==",
              eventSubscriptionId
            )
            .limit(1)
            .get();

        if (!snapshot.empty) {

          storeIdParaAtualizar =
            snapshot.docs[0].id;

          console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":422});
        }
      }

      // -----------------------------------------------------------------------
      // 2ª TENTATIVA
      //
      // USA EXTERNAL REFERENCE SOMENTE PARA LOCALIZAR A LOJA.
      //
      // ATENÇÃO:
      // isso NÃO significa ainda que o evento será aceito.
      //
      // Logo abaixo vamos conferir se a assinatura do evento
      // é realmente a assinatura oficial da loja.
      // -----------------------------------------------------------------------

      if (
        !storeIdParaAtualizar &&
        targetId
      ) {

        const userDoc =
          await db
            .collection("users")
            .doc(targetId)
            .get();

        if (
          userDoc.exists &&
          userDoc.data().storeId
        ) {

          storeIdParaAtualizar =
            userDoc.data().storeId;

          console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":459});

        } else {

          storeIdParaAtualizar =
            targetId;

          console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":468});
        }
      }

      // -----------------------------------------------------------------------
      // NÃO LOCALIZOU LOJA
      // -----------------------------------------------------------------------

      if (!storeIdParaAtualizar) {

        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":480});

        return res.json({
          received: true,
          status: "ignored_no_store",
        });
      }

      const storeRef =
        db
          .collection("stores")
          .doc(storeIdParaAtualizar);

      const storeSnap =
        await storeRef.get();

      if (!storeSnap.exists) {

        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":500});

        return res.json({
          received: true,
          status: "ignored_not_found",
        });
      }

      const storeData =
        storeSnap.data();

      // A2/02c: IDs sem origem comprovada ou de outro ambiente nao
      // podem modificar acesso, vencimentos ou vinculos financeiros.
      // Nenhuma chamada Asaas ou escrita Firestore ocorre apos rejeicao.
      const bindingOrigin = classifyAsaasBindingOrigin(
        storeData,
        resolveAsaasConfig()
      );
      if (!bindingOrigin.allowed) {
        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":521});
        return res.json({
          received: true,
          status: "ignored_unverified_binding_origin",
        });
      }

      const admission = await checkStoreFinancialAdmission({
        db, storeId: storeIdParaAtualizar, storeData, config: resolveAsaasConfig(),
        operation: "subscription.webhook",
      });
      if (!admission.allowed) {
        return res.status(503).json({received: false, status: "financial_admission_denied"});
      }

      const currentSubscriptionId =
        storeData.asaasSubscriptionId ||
        null;


      // A2/02a: eventos com efeitos em acesso/vinculo exigem que a loja
      // possua uma assinatura oficial, mesmo na busca por externalReference.
      // A comparacao de IDs divergentes continua no guardiao abaixo.
      const requiresOfficialSubscription =
        event === "SUBSCRIPTION_DELETED" ||
        event === "PAYMENT_OVERDUE" ||
        event === "PAYMENT_CONFIRMED" ||
        event === "PAYMENT_RECEIVED" ||
        event === "PAYMENT_CREATED";

      if (requiresOfficialSubscription &&
          (!eventSubscriptionId || !currentSubscriptionId)) {
        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":555});

        return res.json({
          received: true,
          status: "ignored_missing_official_subscription",
        });
      }


      // =======================================================================
      // 🛡️ GUARDIÃO DA ASSINATURA
      //
      // ESTE É O PONTO PRINCIPAL DA CORREÇÃO.
      //
      // Se o evento veio de uma assinatura diferente
      // da atualmente vinculada à loja:
      //
      // IGNORA.
      // =======================================================================

      if (
        eventSubscriptionId &&
        currentSubscriptionId &&
        eventSubscriptionId !==
          currentSubscriptionId
      ) {

        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":584});

        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":588});

        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":592});

        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":596});

        return res.json({
          received: true,

          status:
            "ignored_old_subscription",

          storeId:
            storeIdParaAtualizar,

          eventSubscriptionId,

          currentSubscriptionId,
        });
      }


      // -----------------------------------------------------------------------
      // EVENTOS DE PAGAMENTO PRECISAM TER ID DA ASSINATURA
      //
      // Evitamos que uma cobrança solta ou mal associada
      // altere a assinatura da loja.
      // -----------------------------------------------------------------------

      if (
        event?.startsWith("PAYMENT_") &&
        !eventSubscriptionId
      ) {

        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":628});

        return res.json({
          received: true,

          status:
            "ignored_payment_without_subscription",
        });
      }


      const headers = {
        access_token:
          ASAAS_API_KEY,

        "User-Agent":
          "StoreConnectApp/1.0",
      };


      // =======================================================================
      // SUBSCRIPTION_DELETED
      // =======================================================================

      if (
        event === "SUBSCRIPTION_DELETED"
      ) {

        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":658});

        await updateStoreAtSnapshot(storeRef, storeSnap, {

          subscriptionStatus:
            "inactive",

          // A assinatura acabou.
          // Não existe mais vencimento válido.
          nextDueDate:
            admin.firestore.FieldValue.delete(),

          // Limpamos o atraso antigo.
          overdueSince:
            admin.firestore.FieldValue.delete(),

          overdueDueDate:
            admin.firestore.FieldValue.delete(),

          // Também removemos o vínculo.
          asaasSubscriptionId:
            admin.firestore.FieldValue.delete(),
        });

        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":684});

        return res.json({
          received: true,

          status:
            "subscription_deleted",

          updatedStore:
            storeIdParaAtualizar,
        });
      }


      // =======================================================================
      // PAYMENT_DELETED
      //
      // IMPORTANTE:
      //
      // NÃO inativamos a loja simplesmente porque uma cobrança
      // foi deletada.
      //
      // Uma cobrança pode ser removida individualmente.
      // =======================================================================

      if (
        event === "PAYMENT_DELETED"
      ) {

        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":715});

        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":719});

        return res.json({
          received: true,

          status:
            "payment_deleted_no_access_change",
        });
      }


      // =======================================================================
      // CONSULTA O ESTADO FINANCEIRO REAL DA ASSINATURA ATUAL
      // =======================================================================

      let billingState = {
        hasOverdue: false,
        nextDueDate: null,
      };

      if (eventSubscriptionId) {

        try {

          billingState =
            await getSubscriptionBillingState(
              eventSubscriptionId,
              headers, storeIdParaAtualizar, storeData.asaasCustomerId
            );

        } catch (error) {
          // A2/03a FAIL-CLOSED: nao transformar falha de API Asaas
          // em billingState.hasOverdue=false para ativar/desbloquear loja.
          // HTTP 503 permite tratar a entrega como nao processada.
          // Nao registrar payload financeiro, token ou stack da resposta.
          console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":756});
          return res.status(503).json({
            received: false,
            status: "billing_state_unavailable",
          });
        }
      }


      // =======================================================================
      // PAYMENT_OVERDUE
      // =======================================================================

      if (
        event === "PAYMENT_OVERDUE"
      ) {

        // A2/03b: o evento pode ter chegado depois da regularizacao.
        // A fonte de verdade e a situacao atual consultada no Asaas,
        // nunca o dueDate de um payload antigo.
        if (!billingState.hasOverdue) {
          console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":780});
          return res.json({
            received: true,
            status: "ignored_stale_overdue",
          });
        }

        const canonicalOverdueDueDate = billingState.nextDueDate;
        if (
          typeof canonicalOverdueDueDate !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(canonicalOverdueDueDate)
        ) {
          // Sem vencimento canonico valido nao alteramos o acesso.
          // Falha temporaria para que a entrega nao seja dada como concluida.
          console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":794});
          return res.status(503).json({
            received: false,
            status: "invalid_overdue_date",
          });
        }

        // Eventos OVERDUE duplicados com metadados ja sincronizados
        // nao geram novas escritas nem reiniciam o periodo de tolerancia.
        if (
          storeData.subscriptionStatus === "overdue" &&
          storeData.overdueSince &&
          storeData.nextDueDate === canonicalOverdueDueDate &&
          storeData.overdueDueDate === canonicalOverdueDueDate
        ) {
          return res.json({
            received: true,
            status: "overdue_unchanged",
            updatedStore: storeIdParaAtualizar,
          });
        }

        const updateData = {
          subscriptionStatus: "overdue",
          nextDueDate: canonicalOverdueDueDate,
          overdueDueDate: canonicalOverdueDueDate,
        };


        // ---------------------------------------------------------------------
        // NÃO REINICIA O GRACE PERIOD
        //
        // Se já estava overdue e já existe overdueSince,
        // mantemos a data original.
        // ---------------------------------------------------------------------

        if (
          storeData.subscriptionStatus !==
            "overdue" ||
          !storeData.overdueSince
        ) {

          updateData.overdueSince =
            admin.firestore.FieldValue
              .serverTimestamp();

          console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":840});

        } else {

          console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":846});
        }


        await updateStoreAtSnapshot(storeRef, storeSnap, updateData);

        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":854});

        return res.json({
          received: true,

          status: "overdue",

          updatedStore:
            storeIdParaAtualizar,
        });
      }


      // =======================================================================
      // PAYMENT_CONFIRMED / PAYMENT_RECEIVED
      // =======================================================================

      if (
        event === "PAYMENT_CONFIRMED" ||
        event === "PAYMENT_RECEIVED"
      ) {
        // The same existing downgrade operation applies to a paid Business
        // invoice both with and without other overdue invoices.
        async function finalizeRequestedDowngrade(){
if (
            storeData.subscriptionType === "business" &&
            storeData.pendingPlanChange === "pro" &&
            eventSubscriptionId &&
            Number(payment?.value) === SUBSCRIPTION_PLANS.business.price
          ) {

            try {

              // Um outro evento pode ter alterado vinculo/plano depois da
              // escrita de atraso. Releia antes de um PUT remoto.
              const downgradeSnap = await storeRef.get();
              const downgradeStore = downgradeSnap.exists
                ? downgradeSnap.data() || {}
                : {};
              if (!downgradeSnap.exists ||
                  downgradeStore.asaasSubscriptionId !== eventSubscriptionId ||
                  downgradeStore.subscriptionType !== "business" ||
                  downgradeStore.pendingPlanChange !== "pro" ||
                  !classifyAsaasBindingOrigin(
                    downgradeStore, resolveAsaasConfig()
                  ).allowed) {
                const changed = new Error("Downgrade requer nova verificacao da loja.");
                changed.code = "FAILED_PRECONDITION";
                throw changed;
              }

              const PRO_PRICE =
                SUBSCRIPTION_PLANS.pro.price;

              console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":965});

              // ---------------------------------------------------------------
              // Atualiza A MESMA assinatura.
              //
              // Não usamos updatePendingPayments.
              //
              // Portanto:
              //
              // • a cobrança Business que acabou de ser paga não muda;
              // • as próximas cobranças passam a utilizar o preço oficial
              //   atual do Plano Pro.
              // ---------------------------------------------------------------

              await axios.put(
                `${resolveAsaasConfig().baseUrl}/subscriptions/${eventSubscriptionId}`,
                {
                  value:
                    PRO_PRICE,

                  description:
                    "Assinatura Store Connect Pro",

                  externalReference:
                    storeIdParaAtualizar,
                },
                {
                  headers,
                }
              );

              // ---------------------------------------------------------------
              // Agora sim altera o plano interno.
              //
              // Firestore só é atualizado depois que o Asaas respondeu
              // com sucesso.
              // ---------------------------------------------------------------

              await updateStoreAtSnapshot(storeRef, downgradeSnap, {
                subscriptionType:
                  "pro",

                subscriptionPlanPrice:
                  PRO_PRICE,

                pendingPlanChange:
                  admin.firestore.FieldValue.delete(),

                pendingPlanChangeRequestedAt:
                  admin.firestore.FieldValue.delete(),

                subscriptionPlanChangedAt:
                  admin.firestore.FieldValue
                    .serverTimestamp(),
              });

              console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":1023});

              console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":1027});

            } catch (downgradeError) {
              // Conflito de versao nao pode ser reconhecido como evento processado.
              // Se o Asaas ja respondeu ao PUT, pendingPlanChange continua
              // preservado e sera conciliado em etapa propria antes do PROD.
              if (isConcurrentStoreChange(downgradeError)) {
                throw downgradeError;
              }

              // ---------------------------------------------------------------
              // IMPORTANTE:
              //
              // Se o Asaas falhar, NÃO removemos pendingPlanChange.
              //
              // Assim o Firestore não diz que o cliente virou PRO enquanto
              // a assinatura no Asaas ainda estiver como Business.
              // ---------------------------------------------------------------

              // A2/03d: falha no downgrade NAO pode resultar em HTTP 200.
              // Preservar pendingPlanChange e solicitar nova tentativa;
              // nao expor payload/credenciais da resposta financeira nos logs.
              console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":1051});
              return res.status(503).json({
                received: false,
                status: "pending_downgrade_unresolved",
              });
            }
          }
        }


        // ---------------------------------------------------------------------
        // PROTEÇÃO EXTRA
        //
        // Se ainda existe OUTRA cobrança vencida nessa mesma assinatura,
        // não podemos liberar a loja.
        // ---------------------------------------------------------------------

        if (
          billingState.hasOverdue
        ) {

          const updateData = {
            subscriptionStatus:
              "overdue",
          };

          if (
            billingState.nextDueDate
          ) {

            updateData.nextDueDate =
              billingState.nextDueDate;

            updateData.overdueDueDate =
              billingState.nextDueDate;
          }

          // Só cria overdueSince caso ainda não exista.
          if (
            !storeData.overdueSince
          ) {

            updateData.overdueSince =
              admin.firestore.FieldValue
                .serverTimestamp();
          }

          await updateStoreAtSnapshot(storeRef, storeSnap, updateData);

          // ===================================================================
          // 🔄 FINALIZA DOWNGRADE BUSINESS -> PRO
          //
          // Se o cliente estava no Business,
          // pediu downgrade,
          // e agora acabou de pagar a mensalidade Business,
          // podemos reduzir a PRÓXIMA cobrança para o valor do PRO.
          //
          // IMPORTANTE:
          //
          // O preço NÃO é definido aqui.
          //
          // Utilizamos:
          //
          // SUBSCRIPTION_PLANS.pro.price
          //
          // cuja fonte oficial é subscriptionPricing.js.
          // ===================================================================

          const downgradeResponse=await finalizeRequestedDowngrade();
          if(downgradeResponse)return downgradeResponse;


          console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":1063});

          return res.json({
            received: true,

            status:
              "still_overdue",

            updatedStore:
              storeIdParaAtualizar,
          });
        }


        // ---------------------------------------------------------------------
        // TUDO REGULARIZADO
        // ---------------------------------------------------------------------

        const updateData = {
          subscriptionStatus:
            "active",

          // NÃO alteramos mais o plano aqui.
          //
          // O plano já está definido no Firestore
          // pela contratação/upgrade/downgrade.
          lastPaymentDate:
            admin.firestore.FieldValue
              .serverTimestamp(),

          overdueSince:
            admin.firestore.FieldValue.delete(),

          overdueDueDate:
            admin.firestore.FieldValue.delete(),
        };


        if (
          billingState.nextDueDate
        ) {

          updateData.nextDueDate =
            billingState.nextDueDate;
        }


        await updateStoreAtSnapshot(storeRef, storeSnap, updateData);

        const downgradeResponse=await finalizeRequestedDowngrade();
          if(downgradeResponse)return downgradeResponse;
        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":1114});

        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":1118});

        return res.json({
          received: true,

          status:
            "active",

          updatedStore:
            storeIdParaAtualizar,
        });
      }


      // =======================================================================
      // PAYMENT_CREATED
      //
      // Além de sincronizar a data, ele também pode corrigir automaticamente
      // uma situação em que o PAYMENT_OVERDUE não tenha sido processado.
      // =======================================================================

      if (
        event === "PAYMENT_CREATED"
      ) {

        const updateData = {};


        if (
          billingState.nextDueDate
        ) {

          updateData.nextDueDate =
            billingState.nextDueDate;
        }


        // ---------------------------------------------------------------------
        // AUTO-CURA
        //
        // Existe cobrança vencida?
        //
        // Então NÃO deixa uma cobrança futura esconder o atraso.
        // ---------------------------------------------------------------------

        if (
          billingState.hasOverdue
        ) {

          updateData.subscriptionStatus =
            "overdue";

          if (
            billingState.nextDueDate
          ) {

            updateData.overdueDueDate =
              billingState.nextDueDate;
          }

          if (
            storeData.subscriptionStatus !==
              "overdue" ||
            !storeData.overdueSince
          ) {

            updateData.overdueSince =
              admin.firestore.FieldValue
                .serverTimestamp();
          }

          console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":1194});
        }


        if (
          Object.keys(updateData)
            .length > 0
        ) {

          await updateStoreAtSnapshot(storeRef, storeSnap, updateData);
        }


        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":1209});

        return res.json({
          received: true,

          status:
            billingState.hasOverdue
              ? "date_synced_overdue"
              : "date_synced",

          updatedStore:
            storeIdParaAtualizar,
        });
      }


      // =======================================================================
      // OUTROS EVENTOS
      // =======================================================================

      console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":1231});

      return res.json({
        received: true,

        status:
          "ignored_event",

        event,
      });

    } catch (error) {
      if (isConcurrentStoreChange(error)) {
        console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":1246});
        return res.status(503).json({
          received: false,
          status: "store_concurrent_change",
        });
      }

      console.info('finance_event',{"file":"financeiro/asaasWebhook.js","line":1253});

      return res
        .status(500)
        .send("Erro interno");
    }
  }
);
