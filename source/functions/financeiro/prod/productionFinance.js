"use strict";

// Independent PROD composition. No initialization, secret access or I/O on import.
const {createHash, timingSafeEqual} = require("node:crypto");
const {HttpsError} = require("firebase-functions/v2/https");
const {fail, BASE_URL} = require("./asaasProductionConfig");
const {classifyAsaasBindingOrigin} = require("../asaasBindingOrigin");
const {classifySubscriptionCpfRegistry} = require("../subscriptionLegacyRegistry");
const {readCompleteAsaasList} = require("../asaasCompleteList");
const {createAsaasWebhookLedger} = require("../asaasWebhookLedger");
const {computeLocalPlan, checkBillingState} = require("../asaasWebhookLocalProcessor");
const {overdueDecision} = require("../financialStatusPolicy");
const {SUBSCRIPTION_PLANS} = require("./planCatalog");
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const millis = value => value?.toMillis ? value.toMillis() : value instanceof Date ? value.getTime() :
  typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
function civilDay(clock) {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(new Date(clock));
  const part = name => parts.find(p => p.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function billingUrl(value) {
  if (!value) return "";
  let url; try { url = new URL(value); } catch (_) { fail("invalid_billing_url"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" ||
      /sandbox/i.test(url.hostname) || !(url.hostname === "asaas.com" || url.hostname.endsWith(".asaas.com"))) fail("invalid_billing_url");
  return url.href;
}
function createProductionFinance({db, FieldValue, configuration, apiKey, webhookToken, transport, now = Date.now}) {
  const database = () => typeof db === "function" ? db() : db;
  const refStore = id => database().collection("stores").doc(id);
  const config = () => {
    const c = configuration();
    if (c.projectId !== "store-connect-app" || c.environment !== "production" || c.baseUrl !== BASE_URL) fail("financial_environment_inconsistent");
    return c;
  };
  async function owner(request) {
    const uid = request.auth?.uid, storeId = request.data?.storeId;
    if (!validId(uid)) fail("authentication_required", "unauthenticated");
    if (request.auth.token?.firebase?.tenant) fail("tenant_unsupported", "permission-denied");
    if (!validId(storeId)) fail("invalid_store", "invalid-argument");
    const [user, store] = await Promise.all([database().collection("users").doc(uid).get(), refStore(storeId).get()]);
    if (!user.exists || !store.exists || user.data().storeId !== storeId || user.data().role !== "admin" ||
        user.data().accessStatus === "revoked" || store.data().ownerId !== uid) fail("owner_required", "permission-denied");
    return {uid, storeId, store: store.data(), user: user.data()};
  }
  async function admission(c, storeId, store, operation, tx = null) {
    const write = operation !== "subscription.read";
    if (!(write ? c.operationsEnabled : c.readsEnabled) || storeId !== c.pilotStoreId) fail("financial_operations_disabled");
    const origin = classifyAsaasBindingOrigin(store, c);
    if (!origin.allowed || operation !== "subscription.create" && operation !== "subscription.trial-expire" &&
        (!store.asaasCustomerId || !store.asaasSubscriptionId)) fail("financial_origin_unverified");
    const ref = database().collection("asaasFinancialAdmission").doc(storeId);
    const snap = tx ? await tx.get(ref) : await ref.get(), grant = snap.exists ? snap.data() : null;
    const userRef = database().collection("users").doc(store.ownerId);
    const user = tx ? await tx.get(userRef) : await userRef.get();
    if (!user.exists || user.data().storeId !== storeId || user.data().role !== "admin" || user.data().accessStatus === "revoked") fail("owner_required", "permission-denied");
    if (!grant || grant.schemaVersion !== 1 || grant.enabled !== true || grant.projectId !== c.projectId ||
        grant.environment !== c.environment || grant.storeId !== storeId || grant.actorUid !== store.ownerId ||
        !Array.isArray(grant.operations) || !grant.operations.includes(operation) ||
        typeof grant.approvedBy !== "string" || !grant.approvedBy || !/^[a-f0-9]{64}$/.test(grant.evidenceSha256 || "") ||
        !Number.isFinite(millis(grant.expiresAt)) || millis(grant.expiresAt) <= now()) fail("financial_store_not_admitted");
  }
  async function provider(c, key, method, resource, data, params) {
    if (!/^\/(customers|subscriptions|payments)(\/[A-Za-z0-9_-]+)?$/.test(resource) ||
        !["GET", "POST"].includes(method) || method === "POST" && !["/customers", "/subscriptions"].includes(resource)) fail("provider_operation_forbidden");
    try {
      return await transport.request({method, url: c.baseUrl + resource, data, params,
        timeout: 15000, maxRedirects: 0, headers: {access_token: key, "Content-Type": "application/json", "User-Agent": "StoreConnectFinancialProd/1.0"}});
    } catch (error) {
      const status = error.response?.status;
      const reason = status === 401 ? "provider_credential_rejected" : status === 403 ? "provider_forbidden" :
        status === 429 ? "provider_throttled" : status >= 400 && status < 500 ? "provider_request_rejected" : "provider_unavailable";
      throw new HttpsError(status === 403 ? "permission-denied" : status === 401 || status >= 400 && status < 500 && status !== 429 ? "failed-precondition" : "unavailable",
        "Provedor financeiro indisponivel. Nenhum reenvio de contratacao autorizado.", {reason, ...(Number.isInteger(status) ? {upstreamStatus: status} : {})});
    }
  }
  const list = (c, key, resource, params) => readCompleteAsaasList({url: c.baseUrl + resource, params,
    get: (url, options) => provider(c, key, "GET", resource, undefined, options.params)});
  function quote(c) {
    return {plan: "pro", priceCents: Math.round(SUBSCRIPTION_PLANS.pro.price * 100), currency: "BRL", cycle: "MONTHLY", quoteVersion: "prod-pro-v1", firstDueDate: civilDay(now())};
  }
  const attemptRef = (c, storeId) => database().collection("asaasSubscriptionAttempts").doc(digest([c.projectId, c.environment, storeId]));
  async function state(request) {
    const c = config(), o = await owner(request), attempt = await attemptRef(c, o.storeId).get();
    let admitted = false;
    try { await admission(c, o.storeId, o.store, "subscription.create"); admitted = true; } catch (e) { if (!(e instanceof HttpsError)) throw e; }
    const bound = !!o.store.asaasCustomerId || !!o.store.asaasSubscriptionId;
    return {schemaVersion: 1, subscriptionStatus: o.store.subscriptionStatus || "unknown", subscriptionType: o.store.subscriptionType || "unknown",
      inactiveReason: o.store.subscriptionStatus === "inactive" ? o.store.subscriptionInactiveReason || "unknown" : null,
      attemptStatus: attempt.exists ? attempt.data().status : "none", requestId: attempt.exists ? attempt.data().command.requestId : null,
      billingState: o.store.asaasCustomerId && o.store.asaasSubscriptionId ? "bound" : bound ? "incomplete_binding" : "no_subscription",
      canStart: admitted && !attempt.exists && !bound, operationsEnabled: c.operationsEnabled, authority: "firestore_only",
      quote: quote(c), requiresTrialEndConsent: o.store.subscriptionStatus === "trial" && millis(o.store.trialEndDate) > now()};
  }
  async function create(request) {
    const c = config(), o = await owner(request);
    await admission(c, o.storeId, o.store, "subscription.create");
    const q = quote(c), input = request.data;
    if (input.schemaVersion !== 1 || input.consentToContract !== true || !/^[a-f0-9]{32}$/.test(input.requestId || "") ||
        input.plan !== q.plan || input.acceptedPriceCents !== q.priceCents || input.cycle !== q.cycle ||
        input.quoteVersion !== q.quoteVersion || typeof input.acceptedFirstDueDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.acceptedFirstDueDate)) fail("explicit_current_quote_required");
    const document = String(o.store.document || "").replace(/\D/g, "");
    if (![11, 14].includes(document.length) || input.cpfCnpj && String(input.cpfCnpj).replace(/\D/g, "") !== document) fail("canonical_document_required");
    const key = apiKey(); // Missing credential must not reserve an attempt.
    const command = {schemaVersion: 1, projectId: c.projectId, environment: c.environment, uid: o.uid, storeId: o.storeId,
      requestId: input.requestId, plan: q.plan, priceCents: q.priceCents, cycle: q.cycle, quoteVersion: q.quoteVersion,
      firstDueDate: input.acceptedFirstDueDate, consentToContract: true, endTrialEarly: input.endTrialEarly === true, documentHash: digest(document)};
    const fingerprint = digest(command), ref = attemptRef(c, o.storeId), cpf = database().collection("cpfs_cadastrados").doc(document);
    const reservation = await database().runTransaction(async tx => {
      const [previous, user, store, registry] = await Promise.all([tx.get(ref), tx.get(database().collection("users").doc(o.uid)), tx.get(refStore(o.storeId)), tx.get(cpf)]);
      const s = store.exists ? store.data() : {}, u = user.exists ? user.data() : {};
      if (s.ownerId !== o.uid || u.storeId !== o.storeId || u.role !== "admin" || u.accessStatus === "revoked") fail("owner_changed", "permission-denied");
      await admission(c, o.storeId, s, "subscription.create", tx);
      if (previous.exists) {
        const old = previous.data();
        if (old.fingerprint !== fingerprint) fail("original_attempt_must_be_preserved");
        if (old.status === "completed") return {replay: old.result};
        fail("financial_attempt_needs_review");
      }
      if (command.firstDueDate !== q.firstDueDate) fail("explicit_current_quote_required");
      if (s.asaasCustomerId || s.asaasSubscriptionId || s.subscriptionCreationStatus) fail("existing_financial_identity_requires_review");
      if (s.subscriptionStatus === "trial") {
        const end = millis(s.trialEndDate);
        if (!Number.isFinite(end) || end > now() && !command.endTrialEarly) fail("trial_requires_explicit_termination");
      } else if (s.subscriptionStatus !== "inactive" || s.subscriptionInactiveReason !== "trial_expired") fail("first_contract_state_requires_review");
      const ownership = classifySubscriptionCpfRegistry({exists: registry.exists, data: registry.exists ? registry.data() : {}, userId: o.uid, storeId: o.storeId});
      if (!["create", "current"].includes(ownership.action)) fail("document_ownership_requires_review");
      tx.create(ref, {schemaVersion: 1, command, fingerprint, status: "in_progress", stage: "reserved", createdAt: FieldValue.serverTimestamp()});
      if (!registry.exists) tx.create(cpf, {uid: o.uid, storeId: o.storeId, financialEnvironment: c.environment, financialProjectId: c.projectId, createdAt: FieldValue.serverTimestamp()});
      return {reserved: true};
    });
    if (reservation.replay) return reservation.replay;
    async function commit(fields, storeFields) {
      return database().runTransaction(async tx => {
        const [slot, store] = await Promise.all([tx.get(ref), tx.get(refStore(o.storeId))]);
        if (!slot.exists || slot.data().fingerprint !== fingerprint || slot.data().status !== "in_progress" || !store.exists || store.data().ownerId !== o.uid) fail("financial_attempt_changed");
        await admission(c, o.storeId, store.data(), "subscription.create", tx);
        tx.update(ref, {...fields, updatedAt: FieldValue.serverTimestamp()});
        if (storeFields) tx.update(refStore(o.storeId), storeFields);
      });
    }
    try {
      const customers = await list(c, key, "/customers", {cpfCnpj: document});
      if (customers.length) fail("existing_provider_customer_requires_review");
      await commit({stage: "customer_remote_intent"});
      if (typeof o.store.name !== "string" || !o.store.name.trim() || typeof o.user.email !== "string" || !o.user.email.includes("@")) fail("canonical_contact_required");
      const customer = (await provider(c, key, "POST", "/customers", {name: o.store.name, cpfCnpj: document, email: o.user.email,
        ...(o.store.phone ? {mobilePhone: String(o.store.phone).replace(/\D/g, "")} : {}), externalReference: o.storeId})).data;
      if (!validId(customer?.id) || customer.deleted === true || customer.externalReference !== o.storeId ||
          String(customer.cpfCnpj || "").replace(/\D/g, "") !== document) fail("customer_result_inconclusive");
      await commit({stage: "customer_confirmed", customerId: customer.id}, {asaasCustomerId: customer.id,
        asaasBindingEnvironment: c.environment, asaasBindingProjectId: c.projectId});
      const subscriptions = await list(c, key, "/subscriptions", {customer: customer.id, includeDeleted: true});
      if (subscriptions.length) fail("existing_provider_subscription_requires_review");
      await commit({stage: "subscription_remote_intent"});
      const sub = (await provider(c, key, "POST", "/subscriptions", {customer: customer.id, billingType: "UNDEFINED",
        value: q.priceCents / 100, nextDueDate: q.firstDueDate, cycle: q.cycle, description: SUBSCRIPTION_PLANS.pro.name, externalReference: o.storeId})).data;
      if (!validId(sub?.id) || sub.customer !== customer.id || sub.externalReference !== o.storeId || sub.status !== "ACTIVE" ||
          sub.deleted === true || sub.value !== q.priceCents / 100 || sub.cycle !== q.cycle) fail("subscription_result_inconclusive");
      const result = {success: true, subscriptionCreated: true, waitingPaymentLink: true, paymentUrl: null, subscriptionId: sub.id,
        isTrial: false, price: q.priceCents / 100, nextDueDate: q.firstDueDate};
      const receipt = database().collection("asaasSubscriptionExecutionReceipts").doc(fingerprint);
      await database().runTransaction(async tx => {
        const [slot, store, priorReceipt] = await Promise.all([tx.get(ref), tx.get(refStore(o.storeId)), tx.get(receipt)]);
        if (!slot.exists || slot.data().fingerprint !== fingerprint || slot.data().status !== "in_progress" ||
            !store.exists || store.data().ownerId !== o.uid || store.data().asaasCustomerId !== customer.id) fail("financial_attempt_changed");
        await admission(c, o.storeId, store.data(), "subscription.create", tx);
        if (priorReceipt.exists) fail("execution_receipt_conflict");
        tx.create(receipt, {schemaVersion: 1, command, fingerprint, result, createdAt: FieldValue.serverTimestamp()});
        tx.update(refStore(o.storeId), {asaasSubscriptionId: sub.id, subscriptionStatus: "pending", subscriptionType: "pro",
          subscriptionPlanPrice: q.priceCents / 100, nextDueDate: q.firstDueDate,
          ...(command.endTrialEarly ? {trialEndedVoluntarilyAt: FieldValue.serverTimestamp()} : {})});
      });
      await commit({status: "completed", stage: "completed", result});
      return result;
    } catch (error) {
      await database().runTransaction(async tx => {const snap = await tx.get(ref);if (snap.exists && snap.data().fingerprint === fingerprint && snap.data().status === "in_progress") tx.update(ref,
        {status: "needs_review", failureReason: error instanceof HttpsError ? error.details?.reason || "financial_precondition" : "financial_result_inconclusive", updatedAt: FieldValue.serverTimestamp()});});
      throw new HttpsError("failed-precondition", "Tentativa preservada. Consulte o estado; nao repita a contratacao.",
        {reason: "financial_attempt_needs_review", ...(error instanceof HttpsError && error.details?.upstreamStatus ? {upstreamStatus: error.details.upstreamStatus} : {})});
    }
  }
  async function official(c, key, storeId, store) {
    const sub = (await provider(c, key, "GET", "/subscriptions/" + store.asaasSubscriptionId)).data;
    if (!sub || sub.id !== store.asaasSubscriptionId || sub.customer !== store.asaasCustomerId || sub.externalReference !== storeId) fail("official_subscription_unverified");
    return sub;
  }
  async function payments(c, key, storeId, store) {
    const rows = await list(c, key, "/payments", {subscription: store.asaasSubscriptionId});
    if (rows.some(p => p.subscription !== store.asaasSubscriptionId || p.customer !== store.asaasCustomerId ||
        p.externalReference && p.externalReference !== storeId || !Number.isFinite(p.value) || p.value < 0 ||
        typeof p.status !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate))) fail("official_invoices_unverified");
    return rows;
  }
  async function invoices(request, portal = false) {
    const c = config(), o = await owner(request);
    if (!o.store.asaasCustomerId && !o.store.asaasSubscriptionId) {
      if (portal) fail("no_subscription");
      return {invoices: [], hasMore: false, billingState: "no_subscription"};
    }
    await admission(c, o.storeId, o.store, "subscription.read");
    const key = apiKey(); await official(c, key, o.storeId, o.store);
    const rows = await payments(c, key, o.storeId, o.store);
    const invoices = rows.map(p => ({id: p.id, status: p.status, dueDate: p.dueDate, value: p.value, invoiceUrl: billingUrl(p.invoiceUrl || p.billUrl)}))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (portal) {
      const outstanding = invoices.find(p => p.status === "OVERDUE") || invoices.find(p => p.status === "PENDING");
      if (!outstanding?.invoiceUrl) fail("no_outstanding_invoice");
      return {portalUrl: outstanding.invoiceUrl};
    }
    return {invoices, hasMore: false, billingState: "bound"};
  }
  async function billing(c, storeId, store, eventType) {
    const key = apiKey(), sub = await official(c, key, storeId, store);
    if (eventType === "SUBSCRIPTION_DELETED") return {hasOverdue: false, nextDueDate: null, officialSubscriptionDeleted: sub.deleted === true};
    if (sub.status !== "ACTIVE" || sub.deleted === true) fail("official_subscription_not_active");
    const rows = await payments(c, key, storeId, store), overdue = rows.filter(p => p.status === "OVERDUE").sort((a,b) => a.dueDate.localeCompare(b.dueDate));
    const pending = rows.filter(p => p.status === "PENDING").sort((a,b) => a.dueDate.localeCompare(b.dueDate));
    return checkBillingState({hasOverdue: overdue.length > 0, overdueDueDate: overdue[0]?.dueDate || null, nextDueDate: pending[0]?.dueDate || sub.nextDueDate || null,
      officialSubscriptionActive: true, hasSettledPayment: rows.some(p => ["RECEIVED", "CONFIRMED"].includes(p.status))});
  }
  function commercialPlan(eventType, store, current) {
    // Repeated/delayed events must apply the same civil-day policy as reconciliation.
    if (current?.hasOverdue) {
      if (store.subscriptionStatus === "inactive") return {resultCode: "inactive_preserved", update: null};
      const days = Math.floor((Date.parse(civilDay(now())) - Date.parse(current.overdueDueDate)) / 86400000);
      const decision = overdueDecision(days);
      if (decision === "needs_review") fail("billing_date_inconclusive");
      if (decision === "current") return {resultCode: "due_today", update: null};
      const plan = computeLocalPlan({eventType: "PAYMENT_OVERDUE", store, billing: current, FieldValue});
      if (decision === "inactive") plan.update = {...plan.update, subscriptionStatus: "inactive", subscriptionInactiveReason: "overdue", blockedAt: FieldValue.serverTimestamp()};
      return plan;
    }
    return computeLocalPlan({eventType, store, billing: current, FieldValue});
  }
  async function webhook(req, res) {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    let expected; try { expected = webhookToken(); } catch (_) { return res.status(503).send("Unavailable"); }
    let supplied;try { supplied = req.get("asaas-access-token"); } catch (_) { return res.status(401).send("Unauthorized"); }
    const hashed = value => createHash("sha256").update(value).digest();
    if (typeof supplied !== "string" || !supplied || !timingSafeEqual(hashed(expected), hashed(supplied))) return res.status(401).send("Unauthorized");
    try {
      const c = config(); if (!c.operationsEnabled) return res.status(503).send("Unavailable");
      const ledger = createAsaasWebhookLedger({db: database(), FieldValue, config: c, now});
      const saved = await ledger.persist(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
      if (saved.outcome === "conflict") return res.status(409).send("Conflict");
      // ACK only after durable commit. A separate retryable Firestore trigger processes it.
      return res.status(200).send("Persisted");
    } catch (e) { return res.status(e instanceof SyntaxError || e instanceof TypeError ? 400 : 503).send("Not committed"); }
  }
  async function processEvent(eventKey) {
    const c = config(); if (!c.operationsEnabled) fail("financial_operations_disabled");
    const ledger = createAsaasWebhookLedger({db: database(), FieldValue, config: c, now}), claim = await ledger.claim(eventKey, {leaseMs: 120000});
    if (claim.outcome === "done") return {status: "done"};
    if (claim.outcome !== "claimed") fail("webhook_retry_required", "unavailable");
    try {
      const {event, token} = claim, snap = await refStore(c.pilotStoreId).get(), store = snap.exists ? snap.data() : null;
      if (!store || event.subscriptionId !== store.asaasSubscriptionId || event.externalReference && event.externalReference !== c.pilotStoreId) {
        const done = await ledger.completeLocal(eventKey, token, {resultCode: "ignored_outside_pilot"});
        if (done.outcome !== "done") fail("webhook_retry_required", "unavailable");
        return {status: "done", result: "ignored_outside_pilot"};
      }
      await admission(c, c.pilotStoreId, store, "subscription.webhook");
      const current = ["PAYMENT_DELETED"].includes(event.eventType) ? null : await billing(c, c.pilotStoreId, store, event.eventType);
      const plan = commercialPlan(event.eventType, store, current);
      if (plan.deferCode) fail(plan.deferCode);
      const record = database().collection("asaasWebhookEvents").doc(eventKey);
      await database().runTransaction(async tx => {
        const [slot, fresh] = await Promise.all([tx.get(record), tx.get(refStore(c.pilotStoreId))]);
        if (!slot.exists || slot.data().status !== "processing" || slot.data().phase !== "local" || slot.data().environment !== c.environment ||
            slot.data().projectId !== c.projectId || slot.data().leaseToken !== token || slot.data().leaseUntilMs <= now() ||
            !fresh.exists || !fresh.updateTime.isEqual(snap.updateTime)) fail("webhook_snapshot_changed", "aborted");
        await admission(c, c.pilotStoreId, fresh.data(), "subscription.webhook", tx);
        if (plan.update) tx.update(refStore(c.pilotStoreId), plan.update);
        tx.update(record, {status: "done", resultCode: plan.resultCode, leaseToken: null, leaseUntilMs: 0, updatedAt: FieldValue.serverTimestamp()});
      });
      return {status: "done", result: plan.resultCode};
    } catch (e) { await ledger.fail(eventKey, claim.token, "production_processing_retry"); throw e; }
  }
  async function reconcile(request = null, operation = "subscription.reconcile") {
    if (!["subscription.reconcile", "subscription.overdue"].includes(operation)) fail("invalid_financial_operation");
    const c = config(); if (!c.operationsEnabled) return {status: "disabled"};
    const o = request ? await owner(request) : null, id = o ? o.storeId : c.pilotStoreId;
    const snap = await refStore(id).get(); if (!snap.exists) fail("pilot_store_missing");
    const store = snap.data(); await admission(c, id, store, operation);
    const current = await billing(c, id, store, "RECONCILIATION");
    if (store.subscriptionStatus === "inactive" && current.hasOverdue) return {status: "inactive_preserved"};
    const plan = commercialPlan(current.hasOverdue ? "PAYMENT_OVERDUE" : "PAYMENT_RECEIVED", store, current);
    if (plan.deferCode) fail(plan.deferCode);
    if (!plan.update) return {status: "unchanged"};
    const audit = database().collection("asaasFinancialReconciliations").doc(digest([id, snap.updateTime.toMillis(), plan.resultCode]));
    return database().runTransaction(async tx => {
      const [fresh, prior] = await Promise.all([tx.get(refStore(id)), tx.get(audit)]);
      if (prior.exists) return {status: "already_applied"};
      if (!fresh.exists || !fresh.updateTime.isEqual(snap.updateTime)) fail("reconciliation_snapshot_changed", "aborted");
      await admission(c, id, fresh.data(), operation, tx);
      tx.update(refStore(id), plan.update);tx.create(audit, {storeId: id, previousStatus: store.subscriptionStatus, resultCode: plan.resultCode, createdAt: FieldValue.serverTimestamp()});
      return {status: "applied"};
    });
  }
  async function drainPending() {
    const c = config();if (!c.operationsEnabled) return {status: "disabled"};
    let processed = 0;
    for (const status of ["pending", "processing"]) {
      const rows = await database().collection("asaasWebhookEvents").where("status", "==", status).limit(20).get();
      for (const row of rows.docs) if (row.data().environment === c.environment && row.data().projectId === c.projectId) {
        try { await processEvent(row.id);processed++; } catch (_) { /* Durable record remains available for the next bounded pass. */ }
      }
    }
    return {processed};
  }
  async function expireTrial() {
    const c = config(); if (!c.operationsEnabled) return {status: "disabled"};
    return database().runTransaction(async tx => {
      const ref = refStore(c.pilotStoreId), snap = await tx.get(ref);if (!snap.exists) return {status: "missing"};
      const store = snap.data();await admission(c, c.pilotStoreId, store, "subscription.trial-expire", tx);
      if (store.subscriptionStatus !== "trial" || !Number.isFinite(millis(store.trialEndDate)) || millis(store.trialEndDate) > now()) return {status: "unchanged"};
      tx.update(ref, {subscriptionStatus: "inactive", subscriptionInactiveReason: "trial_expired", blockedAt: FieldValue.serverTimestamp()});
      tx.create(ref.collection("auditLogs").doc(), {action: "trial_expired", performedBy: {role: "system"}, createdAt: FieldValue.serverTimestamp()});
      return {status: "expired"};
    });
  }
  const safe = fn => async (...args) => {try {return await fn(...args);} catch (e) {if (e instanceof HttpsError) throw e;throw new HttpsError("internal", "Operacao financeira nao concluida.", {reason: "financial_internal_failure"});}};
  return {state: safe(state), create: safe(create), invoices: safe(invoices), webhook, processEvent: safe(processEvent), reconcile: safe(reconcile), expireTrial: safe(expireTrial), drainPending: safe(drainPending)};
}
module.exports = {createProductionFinance, civilDay};
