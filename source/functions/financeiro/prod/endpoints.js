"use strict";

const {onCall, onRequest} = require("firebase-functions/v2/https");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const asaasApiKey = defineSecret("ASAAS_API_KEY"), asaasWebhookToken = defineSecret("ASAAS_WEBHOOK_TOKEN");
const {resolveProductionConfig, readBoundSecret, fail} = require("./asaasProductionConfig");
const {createProductionFinance} = require("./productionFinance");
function buildProductionEndpoints({admin, transport}) {
  const finance = createProductionFinance({db: () => admin.firestore(), FieldValue: admin.firestore.FieldValue,
    configuration: resolveProductionConfig, apiKey: () => readBoundSecret(asaasApiKey),
    webhookToken: () => readBoundSecret(asaasWebhookToken, true), transport});
  const callable = {enforceAppCheck: true};
  const providerCallable = {...callable, secrets: [asaasApiKey], timeoutSeconds: 120};
  const scheduled = schedule => ({schedule, timeZone: "America/Sao_Paulo", secrets: [asaasApiKey], timeoutSeconds: 540});
  return {
    getAsaasSubscriptionStateV1: onCall(callable, finance.state),
    createAsaasSubscription: onCall(providerCallable, finance.create),
    listAsaasInvoices: onCall(providerCallable, request => finance.invoices(request)),
    getAsaasPortalUrl: onCall(providerCallable, request => finance.invoices(request, true)),
    asaasWebhook: onRequest({secrets: [asaasWebhookToken], timeoutSeconds: 10}, finance.webhook),
    processAsaasWebhookEventV1: onDocumentCreated({document: "asaasWebhookEvents/{eventKey}", secrets: [asaasApiKey], retry: true},
      event => resolveProductionConfig().operationsEnabled ? finance.processEvent(event.params.eventKey) : {status: "disabled"}),
    reconcileAsaasSubscriptionV1: onCall(providerCallable, request => finance.reconcile(request)),
    reconcileAsaasBilling: onSchedule(scheduled("30 1 * * *"), async () => {
      const result = await finance.reconcile();await finance.drainPending();return result;
    }),
    checkOverdueSubscriptions: onSchedule(scheduled("0 2 * * *"), () => finance.reconcile(null, "subscription.overdue")),
    expireTrials: onSchedule({schedule: "0 * * * *", timeZone: "America/Sao_Paulo"}, finance.expireTrial),
    // No production price/plan mutation contract is approved for this first pilot.
    syncAsaasSubscriptionPrices: onSchedule({schedule: "0 3 * * *", timeZone: "America/Sao_Paulo"}, () => ({status: "disabled"})),
    changeAsaasPlan: onCall(callable, () => fail("plan_change_not_enabled_for_pilot")),
  };
}
module.exports = {buildProductionEndpoints};
