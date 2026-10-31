"use strict";

const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");
const {resolveAsaasConfig} = require("./asaasConfig");
const {asaasApiKey, getAsaasApiKey, asaasWebhookToken} = require("./asaasSecrets");
const {authenticateAsaasWebhook} = require("./asaasWebhookAuth");
const {createAsaasWebhookLedger} = require("./asaasWebhookLedger");
const {createAsaasWebhookLocalProcessor} = require("./asaasWebhookLocalProcessor");
const {checkStoreFinancialAdmission} = require("./storeFinancialAdmission");
const {readCompleteAsaasList} = require("./asaasCompleteList");

function billingReader({get, config, headers}) {
  return async (subscriptionId, event, store, storeId) => {
    const response = await get(`${config.baseUrl}/subscriptions/${subscriptionId}`, {headers});
    const sub = response.data;
    if (!sub || sub.id !== subscriptionId || sub.customer !== store.asaasCustomerId || sub.externalReference !== storeId) throw Error("official_binding_unverified");
    if (event.eventType === "SUBSCRIPTION_DELETED") return {hasOverdue: false, nextDueDate: null,
      officialSubscriptionDeleted: sub.deleted === true};
    if (sub.status !== "ACTIVE" || sub.deleted === true) throw Error("official_subscription_not_active");
    async function payments(status) {
      const rows = await readCompleteAsaasList({get, url: `${config.baseUrl}/payments`, headers,
        params: {subscription: subscriptionId, status}});
      if (rows.some(p => !p?.id ||
          p.subscription !== subscriptionId || p.customer !== store.asaasCustomerId || p.status !== status ||
          (p.externalReference && p.externalReference !== storeId))) throw Error("billing_list_incomplete_or_foreign");
      return rows;
    }
    const [overdue, pending, received, confirmed] = await Promise.all([
      payments("OVERDUE"), payments("PENDING"), payments("RECEIVED"), payments("CONFIRMED"),
    ]);
    overdue.sort((a,b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    pending.sort((a,b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    return {hasOverdue: overdue.length > 0, overdueDueDate: overdue[0]?.dueDate || null,
      nextDueDate: pending[0]?.dueDate || sub.nextDueDate || null,
      officialSubscriptionActive: true, hasSettledPayment: received.length + confirmed.length > 0};
  };
}
function createDurableWebhookHandler({authenticate, configuration, db, FieldValue, reader}) {
  return async (req, res) => {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    const auth = authenticate(req);
    if (auth !== 200) return res.status(auth).send(auth === 401 ? "Unauthorized" : "Unavailable");
    try {
      const config = configuration();
      // This integration remains HML-only until the independent PROD gates pass.
      if (!config.operationsEnabled || config.environment !== "sandbox") return res.status(503).send("Unavailable");
      const raw = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const ledger = createAsaasWebhookLedger({db, FieldValue, config});
      const saved = await ledger.persist(raw);
      if (saved.outcome === "conflict") return res.status(409).send("Event identity conflict");
      const processor = createAsaasWebhookLocalProcessor({db, FieldValue, config, ledger,
        readBillingState: async (id, event, store, storeId) => {
          const admission = await checkStoreFinancialAdmission({db, config, storeId, storeData: store, operation: "subscription.webhook"});
          if (!admission.allowed) throw Error("store_not_admitted");
          return reader(id, event, store, storeId);
        }});
      const outcome = await processor.process(saved.eventKey);
      console.info("asaas_webhook_result", {eventKey: saved.eventKey, outcome: outcome.outcome});
      return res.status(outcome.outcome === "done" ? 200 : 503).send(outcome.outcome === "done" ? "Persisted" : "Pending review or retry");
    } catch (error) {
      console.warn("asaas_webhook_not_committed", {code: error instanceof SyntaxError || error instanceof TypeError ? "invalid_event" : "processing_failed"});
      return res.status(error instanceof SyntaxError || error instanceof TypeError ? 400 : 503).send("Not committed");
    }
  };
}
exports.asaasWebhook = onRequest({secrets: [asaasApiKey, asaasWebhookToken]}, (req, res) => {
  // Resolve dependencies at invocation only; no secret access during discovery.
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    const auth = authenticateAsaasWebhook(req);
    if (auth !== 200) return res.status(auth).send(auth === 401 ? "Unauthorized" : "Service Unavailable");
    const config = resolveAsaasConfig();
    if (!config.operationsEnabled || config.environment !== "sandbox") return res.status(503).send("Service Unavailable");
    const key = getAsaasApiKey();
    const reader = billingReader({config, get: axios.get, headers: {access_token: key, "User-Agent": "StoreConnectApp/1.0"}});
    return createDurableWebhookHandler({authenticate: () => 200, configuration: () => config,
      db: admin.firestore(), FieldValue: admin.firestore.FieldValue, reader})(req, res);
  } catch (_) { return res.status(503).send("Service Unavailable"); }
});
exports.createDurableWebhookHandler = createDurableWebhookHandler;
exports.billingReader = billingReader;
