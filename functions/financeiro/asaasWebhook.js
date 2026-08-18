const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

// -----------------------------------------------------------------------------
// AMBIENTE ASAAS
// -----------------------------------------------------------------------------

const ASAAS_ENV = process.env.ASAAS_ENV || "sandbox";

const ASAAS_URL =
  ASAAS_ENV === "production"
    ? "https://www.asaas.com/api/v3"
    : "https://sandbox.asaas.com/api/v3";


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
  headers
) {
  let hasOverdue = false;
  let nextDueDate = null;

  // ---------------------------------------------------------------------------
  // 1. PROCURA COBRANÇA VENCIDA
  // ---------------------------------------------------------------------------

  const overdueRes = await axios.get(
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
    overdueRes.data?.data || [];

  if (overduePayments.length > 0) {
    overduePayments.sort(
      (a, b) =>
        new Date(a.dueDate) -
        new Date(b.dueDate)
    );

    hasOverdue = true;
    nextDueDate = overduePayments[0].dueDate;

    console.log(
      `🔴 Cobrança vencida encontrada: ${nextDueDate}`
    );

    return {
      hasOverdue,
      nextDueDate,
    };
  }

  // ---------------------------------------------------------------------------
  // 2. SE NÃO HÁ VENCIDA, PROCURA A PRÓXIMA PENDENTE
  // ---------------------------------------------------------------------------

  const pendingRes = await axios.get(
    `${ASAAS_URL}/payments`,
    {
      headers,
      params: {
        subscription: subscriptionId,
        status: "PENDING",
        limit: 100,
      },
    }
  );

  const pendingPayments =
    pendingRes.data?.data || [];

  if (pendingPayments.length > 0) {
    pendingPayments.sort(
      (a, b) =>
        new Date(a.dueDate) -
        new Date(b.dueDate)
    );

    nextDueDate =
      pendingPayments[0].dueDate;

    console.log(
      `📅 Próxima cobrança pendente: ${nextDueDate}`
    );

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
      `${ASAAS_URL}/subscriptions/${subscriptionId}`,
      { headers }
    );

    if (subRes.data?.nextDueDate) {
      nextDueDate =
        subRes.data.nextDueDate;

      console.log(
        `📅 Próximo vencimento via assinatura: ${nextDueDate}`
      );
    }
  } catch (error) {
    console.log(
      `ℹ️ Não foi possível consultar a assinatura ${subscriptionId}:`,
      error.response?.data || error.message
    );
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
  async (req, res) => {

    console.log(
      "\n\n╔════════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║  🔔 WEBHOOK ASAAS RECEBIDO                                ║"
    );
    console.log(
      "╚════════════════════════════════════════════════════════════╝"
    );

    if (req.method !== "POST") {
      return res
        .status(405)
        .send("Method Not Allowed");
    }

    try {

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

      console.log(`📌 Evento: ${event}`);
      console.log(
        `📌 Assinatura do evento: ${
          eventSubscriptionId || "SEM ID"
        }`
      );
      console.log(
        `📌 External Reference: ${
          targetId || "SEM REFERÊNCIA"
        }`
      );

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

          console.log(
            `✅ Loja encontrada pela assinatura atual: ${storeIdParaAtualizar}`
          );
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

          console.log(
            `ℹ️ Loja localizada via UID: ${storeIdParaAtualizar}`
          );

        } else {

          storeIdParaAtualizar =
            targetId;

          console.log(
            `ℹ️ Tentando External Reference como StoreID: ${storeIdParaAtualizar}`
          );
        }
      }

      // -----------------------------------------------------------------------
      // NÃO LOCALIZOU LOJA
      // -----------------------------------------------------------------------

      if (!storeIdParaAtualizar) {

        console.log(
          "⚠️ Nenhuma loja encontrada. Evento ignorado."
        );

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

        console.log(
          `⚠️ Loja ${storeIdParaAtualizar} não existe.`
        );

        return res.json({
          received: true,
          status: "ignored_not_found",
        });
      }

      const storeData =
        storeSnap.data();

      const currentSubscriptionId =
        storeData.asaasSubscriptionId ||
        null;


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

        console.log(
          "🛡️ EVENTO DE ASSINATURA ANTIGA IGNORADO"
        );

        console.log(
          `   Evento veio de: ${eventSubscriptionId}`
        );

        console.log(
          `   Assinatura oficial: ${currentSubscriptionId}`
        );

        console.log(
          `   Loja protegida: ${storeIdParaAtualizar}`
        );

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

        console.log(
          "⚠️ Evento de pagamento sem assinatura. Ignorado."
        );

        return res.json({
          received: true,
          status:
            "ignored_payment_without_subscription",
        });
      }


      const ASAAS_API_KEY =
        process.env.ASAAS_API_KEY;

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

        console.log(
          `🗑️ Assinatura oficial removida: ${eventSubscriptionId}`
        );

        await storeRef.update({

          subscriptionStatus:
            "inactive",

          // A assinatura acabou.
          // Não existe mais vencimento válido.
          nextDueDate:
            admin.firestore.FieldValue.delete(),

          // Limpamos o atraso antigo.
          overdueSince:
            admin.firestore.FieldValue.delete(),

          // Também removemos o vínculo.
          asaasSubscriptionId:
            admin.firestore.FieldValue.delete(),
        });

        console.log(
          `🚫 Loja ${storeIdParaAtualizar} INATIVADA após remoção da assinatura.`
        );

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

        console.log(
          `ℹ️ Cobrança removida da assinatura ${eventSubscriptionId}.`
        );

        console.log(
          "ℹ️ Nenhuma alteração no acesso da loja."
        );

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
              headers
            );

        } catch (error) {

          console.error(
            "⚠️ Não foi possível sincronizar cobranças:",
            error.response?.data ||
              error.message
          );
        }
      }


      // =======================================================================
      // PAYMENT_OVERDUE
      // =======================================================================

      if (
        event === "PAYMENT_OVERDUE"
      ) {

        const updateData = {
          subscriptionStatus:
            "overdue",
        };


        // ---------------------------------------------------------------------
        // A DATA VENCIDA TEM PRIORIDADE
        //
        // Primeiro usamos a própria cobrança que gerou o webhook.
        // Depois usamos a conciliação da assinatura.
        // ---------------------------------------------------------------------

        if (payment?.dueDate) {

          updateData.nextDueDate =
            payment.dueDate;

        } else if (
          billingState.nextDueDate
        ) {

          updateData.nextDueDate =
            billingState.nextDueDate;
        }


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

          console.log(
            "⏱️ Grace Period iniciado."
          );

        } else {

          console.log(
            "⏱️ Grace Period já estava ativo. Data preservada."
          );
        }


        await storeRef.update(
          updateData
        );

        console.log(
          `⚠️ Loja ${storeIdParaAtualizar} entrou/permanece em ATRASO.`
        );

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
          }

          // Só cria overdueSince caso ainda não exista.
          if (
            !storeData.overdueSince
          ) {

            updateData.overdueSince =
              admin.firestore.FieldValue
                .serverTimestamp();
          }

          await storeRef.update(
            updateData
          );

          // =======================================================================
          // 🔄 FINALIZA DOWNGRADE BUSINESS -> PRO
          //
          // Se o cliente estava no Business,
          // pediu downgrade,
          // e agora acabou de pagar a mensalidade Business,
          // podemos reduzir a PRÓXIMA cobrança para o valor do PRO.
          // =======================================================================

          if (
            storeData.subscriptionType === "business" &&
            storeData.pendingPlanChange === "pro" &&
            eventSubscriptionId
          ) {
            try {
              const PRO_PRICE = 39.90;

              console.log(
                `🔄 Pagamento Business confirmado. Efetivando downgrade para PRO da loja ${storeIdParaAtualizar}...`
              );

              // ---------------------------------------------------------------
              // Atualiza A MESMA assinatura.
              //
              // Não usamos updatePendingPayments,
              // portanto a cobrança Business que acabou de ser paga não muda.
              // Próximas cobranças passam para R$ 39.90.
              // ---------------------------------------------------------------

              await axios.put(
                `${ASAAS_URL}/subscriptions/${eventSubscriptionId}`,
                {
                  value: PRO_PRICE,
                  description: "Assinatura Store Connect Pro",
                  externalReference: storeIdParaAtualizar,
                },
                { headers }
              );

              // ---------------------------------------------------------------
              // Agora sim altera o plano interno.
              // ---------------------------------------------------------------

              await storeRef.update({
                subscriptionType: "pro",
                subscriptionPlanPrice: PRO_PRICE,

                pendingPlanChange:
                  admin.firestore.FieldValue.delete(),

                pendingPlanChangeRequestedAt:
                  admin.firestore.FieldValue.delete(),

                subscriptionPlanChangedAt:
                  admin.firestore.FieldValue.serverTimestamp(),
              });

              console.log(
                `✅ Downgrade concluído: BUSINESS -> PRO. Assinatura mantida: ${eventSubscriptionId}`
              );

            } catch (downgradeError) {
              // IMPORTANTE:
              // Se o Asaas falhar, NÃO removemos pendingPlanChange.
              // Assim podemos tentar novamente em outro processamento.
              console.error(
                "⚠️ Pagamento confirmado, mas falhou ao concluir downgrade:",
                downgradeError.response?.data ||
                downgradeError.message
              );
            }
          }

          console.log(
            "⚠️ Pagamento recebido, mas ainda existe cobrança vencida."
          );

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
          subscriptionStatus: "active",

          // NÃO alteramos mais o plano aqui.
          // O plano já está definido no Firestore pela contratação/upgrade.
          lastPaymentDate:
            admin.firestore.FieldValue.serverTimestamp(),

          overdueSince:
            admin.firestore.FieldValue.delete(),
        };


        if (
          billingState.nextDueDate
        ) {

          updateData.nextDueDate =
            billingState.nextDueDate;
        }


        await storeRef.update(
          updateData
        );

        console.log(
          `🎉 Loja ${storeIdParaAtualizar} ATIVADA.`
        );

        console.log(
          `📅 Próximo vencimento: ${
            billingState.nextDueDate ||
            "não encontrado"
          }`
        );

        return res.json({
          received: true,
          status: "active",
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
            storeData.subscriptionStatus !==
              "overdue" ||
            !storeData.overdueSince
          ) {

            updateData.overdueSince =
              admin.firestore.FieldValue
                .serverTimestamp();
          }

          console.log(
            "🔧 AUTO-CURA: cobrança vencida detectada durante PAYMENT_CREATED."
          );
        }


        if (
          Object.keys(updateData)
            .length > 0
        ) {

          await storeRef.update(
            updateData
          );
        }


        console.log(
          `ℹ️ Loja ${storeIdParaAtualizar} sincronizada pelo PAYMENT_CREATED.`
        );

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

      console.log(
        `ℹ️ Evento ${event} ignorado: não altera o acesso.`
      );

      return res.json({
        received: true,
        status:
          "ignored_event",
        event,
      });

    } catch (error) {

      console.error(
        "❌ Erro crítico no webhook:",
        error.response?.data ||
          error
      );

      return res
        .status(500)
        .send("Erro interno");
    }
  }
);