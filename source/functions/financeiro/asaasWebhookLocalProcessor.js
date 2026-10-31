"use strict";

// Store&Connect - A2/03e LEDGER02b (local-only processing core).
// Inactive until explicitly wired to a separately audited worker.
// No Firebase initialization, schedules, HTTP handlers, or Asaas write calls.
// Asaas billing state MUST be obtained by a read-only, fail-closed adapter.
const {classifyAsaasBindingOrigin} = require("./asaasBindingOrigin");
const {mayRecoverInactive} = require("./financialStatusPolicy");

const PROJECTS = Object.freeze({sandbox: "store-connect-hml", production: "store-connect-app"});
const SUPPORTED = new Set([
  "SUBSCRIPTION_DELETED", "PAYMENT_DELETED", "PAYMENT_CREATED",
  "PAYMENT_OVERDUE", "PAYMENT_RECEIVED", "PAYMENT_CONFIRMED",
]);
const BILLING_EVENTS = new Set([
  "PAYMENT_CREATED", "PAYMENT_OVERDUE", "PAYMENT_RECEIVED", "PAYMENT_CONFIRMED",
]);
const RESTRICTED_RESULTS = new Set(["done", "already_done"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDay(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const t = new Date(Date.UTC(year, month - 1, day));
  return t.getUTCFullYear() === year && t.getUTCMonth() + 1 === month && t.getUTCDate() === day;
}
function safeErrorCode(error) {
  // Do not log or persist remote financial response bodies or credentials.
  if (error && error.code === "invalid_billing_state") return "invalid_billing_state";
  if (error && error.code === "invalid_store_query") return "invalid_store_query";
  return "local_processing_failed";
}
function checkBillingState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.hasOverdue !== "boolean" ||
      (value.nextDueDate !== null && value.nextDueDate !== undefined && !validDay(value.nextDueDate)) ||
      (value.hasOverdue && !validDay(value.overdueDueDate)) ||
      (!value.hasOverdue && value.overdueDueDate !== null && value.overdueDueDate !== undefined)) {
    const err = new Error("invalid_billing_state"); err.code = "invalid_billing_state";
    throw err;
  }
  return value;
}
function hasPendingPlanChange(store) {
  return store.pendingPlanChange !== null && store.pendingPlanChange !== undefined &&
    store.pendingPlanChange !== "";
}
function computeLocalPlan({eventType, store, billing, FieldValue}) {
  if (eventType === "SUBSCRIPTION_DELETED") {
    if (billing?.officialSubscriptionDeleted !== true) return {deferCode: "deletion_requires_current_proof"};
    return {resultCode: "subscription_deleted", update: {
      subscriptionStatus: "inactive", subscriptionInactiveReason: "cancelled", nextDueDate: FieldValue.delete(),
      overdueSince: FieldValue.delete(), overdueDueDate: FieldValue.delete(),
      // Preserve official identity and history even after cancellation.
    }};
  }
  if (eventType === "PAYMENT_DELETED") {
    return {resultCode: "payment_deleted_no_access_change", update: null};
  }
  if (!BILLING_EVENTS.has(eventType)) {
    return {resultCode: "ignored_unsupported_event", update: null};
  }
  if (store.subscriptionStatus === "inactive" && !mayRecoverInactive(store, billing)) {
    return {deferCode: "inactive_requires_conclusive_recovery"};
  }
  if (hasPendingPlanChange(store) &&
      (eventType === "PAYMENT_RECEIVED" || eventType === "PAYMENT_CONFIRMED")) {
    // Do not mark the event done: unresolved Asaas PUT requires its own saga.
    return {deferCode: "downgrade_requires_resolution"};
  }
  if (eventType === "PAYMENT_OVERDUE") {
    if (!billing.hasOverdue) return {resultCode: "ignored_stale_overdue", update: null};
    const dueDate = billing.overdueDueDate;
    if (store.subscriptionStatus === "overdue" && store.overdueSince &&
        store.nextDueDate === dueDate && store.overdueDueDate === dueDate) {
      return {resultCode: "overdue_unchanged", update: null};
    }
    const update = {subscriptionStatus: "overdue", nextDueDate: dueDate, overdueDueDate: dueDate};
    if (!store.overdueSince) update.overdueSince = FieldValue.serverTimestamp();
    return {resultCode: "overdue", update};
  }
  if (eventType === "PAYMENT_RECEIVED" || eventType === "PAYMENT_CONFIRMED") {
    if (billing.hasOverdue) {
      const update = {subscriptionStatus: "overdue", nextDueDate: billing.overdueDueDate,
        overdueDueDate: billing.overdueDueDate};
      if (!store.overdueSince) update.overdueSince = FieldValue.serverTimestamp();
      return {resultCode: "still_overdue", update};
    }
    if (billing.officialSubscriptionActive !== true || billing.hasSettledPayment !== true) return {deferCode: "payment_requires_current_proof"};
    const update = {subscriptionStatus: "active", subscriptionInactiveReason: FieldValue.delete(), blockedAt: FieldValue.delete(), lastPaymentDate: FieldValue.serverTimestamp(),
      overdueSince: FieldValue.delete(), overdueDueDate: FieldValue.delete()};
    if (billing.nextDueDate) update.nextDueDate = billing.nextDueDate;
    return {resultCode: "active", update};
  }
  if (eventType === "PAYMENT_CREATED") {
    const update = {};
    if (billing.hasOverdue) {
      update.subscriptionStatus = "overdue";
      update.nextDueDate = billing.overdueDueDate;
      update.overdueDueDate = billing.overdueDueDate;
      if (!store.overdueSince) update.overdueSince = FieldValue.serverTimestamp();
    } else if (billing.nextDueDate && store.nextDueDate !== billing.nextDueDate) {
      update.nextDueDate = billing.nextDueDate;
    }
    return Object.keys(update).length ?
      {resultCode: billing.hasOverdue ? "date_synced_overdue" : "date_synced", update} :
      {resultCode: "ignored_no_change", update: null};
  }
  return {resultCode: "ignored_unsupported_event", update: null};
}

function createAsaasWebhookLocalProcessor({db, ledger, FieldValue, config, readBillingState}) {
  if (!db || typeof db.collection !== "function" ||
      !ledger || typeof ledger.claim !== "function" ||
      typeof ledger.completeLocal !== "function" || typeof ledger.fail !== "function" ||
      !FieldValue || typeof FieldValue.delete !== "function" ||
      typeof FieldValue.serverTimestamp !== "function" ||
      typeof readBillingState !== "function") {
    throw new TypeError("invalid_processor_dependencies");
  }
  // Deliberately do not support production execution in this isolated phase.
  if (config?.environment !== "sandbox" ||
      PROJECTS[config?.environment] !== config?.projectId ||
      config.operationsEnabled !== true) {
    throw new Error("processor_not_enabled_in_this_environment");
  }
  async function process(eventKey) {
    const claim = await ledger.claim(eventKey, {leaseMs: 120000});
    if (claim.outcome !== "claimed") return {outcome: claim.outcome};
    const {token, event} = claim;
    async function retry(code) {
      const state = await ledger.fail(eventKey, token, code);
      return {outcome: state.outcome, reason: code};
    }
    async function finish(plan, doc = null) {
      const opts = {resultCode: plan.resultCode};
      if (plan.update) {
        if (!doc || !doc.updateTime || !doc.ref || !event.subscriptionId) {
          return retry("store_snapshot_incomplete");
        }
        opts.storeRef = doc.ref;
        opts.storeUpdate = plan.update;
        opts.expectedStoreUpdateTime = doc.updateTime;
        opts.expectedSubscriptionId = event.subscriptionId;
      }
      const result = await ledger.completeLocal(eventKey, token, opts);
      if (RESTRICTED_RESULTS.has(result.outcome)) return {outcome: "done", resultCode: plan.resultCode};
      // A lost lease / missing document is NOT an event success.
      if (result.outcome === "store_changed") return retry("store_changed");
      return {outcome: result.outcome, reason: "local_completion_not_committed"};
    }
    try {
      if (!event || typeof event.eventType !== "string") return retry("invalid_event_record");
      if (!SUPPORTED.has(event.eventType)) {
        return await finish({resultCode: "ignored_unsupported_event", update: null});
      }
      if (typeof event.subscriptionId !== "string" || !event.subscriptionId.trim()) {
        return await finish({resultCode: "ignored_missing_official_subscription", update: null});
      }
      const snap = await db.collection("stores")
        .where("asaasSubscriptionId", "==", event.subscriptionId).limit(2).get();
      if (!snap || !Array.isArray(snap.docs)) {
        const err = new Error("invalid_store_query"); err.code = "invalid_store_query"; throw err;
      }
      if (snap.docs.length !== 1) {
        // Missing or ambiguous identity must not be permanently marked done.
        return retry(snap.docs.length ? "ambiguous_store_binding" : "store_binding_not_found");
      }
      const doc = snap.docs[0];
      if (!doc.exists || !doc.ref || !doc.updateTime || typeof doc.data !== "function") {
        return retry("store_snapshot_incomplete");
      }
      const store = doc.data() || {};
      if (store.asaasSubscriptionId !== event.subscriptionId ||
          !classifyAsaasBindingOrigin(store, config).allowed) {
        return retry("unverified_official_subscription");
      }
      if (event.externalReference && event.externalReference !== doc.id) return retry("event_reference_mismatch");
      if (event.eventType === "PAYMENT_DELETED") {
        return await finish(computeLocalPlan({eventType:event.eventType, store, FieldValue}), doc);
      }
      const billing = checkBillingState(await readBillingState(event.subscriptionId, event, store, doc.id));
      const plan = computeLocalPlan({eventType:event.eventType, store, billing, FieldValue});
      if (plan.deferCode) return retry(plan.deferCode);
      return await finish(plan, doc);
    } catch (error) {
      // Attempt backoff only for local operations; never masks uncertain remote effects.
      return retry(safeErrorCode(error));
    }
  }
  return Object.freeze({process});
}
module.exports = {createAsaasWebhookLocalProcessor, computeLocalPlan, checkBillingState};
