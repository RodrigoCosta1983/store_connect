"use strict";

// Store&Connect A2/03e LEDGER01: nucleo transacional, NAO conectado ao webhook.
// Nao invoca Asaas, nao exporta Cloud Functions e nao executa efeitos ao importar.
const {createHash, randomUUID} = require("node:crypto");

const COLLECTION = "asaasWebhookEvents";
const PROJECTS = Object.freeze({
  sandbox: "store-connect-hml",
  production: "store-connect-app",
});
const MAX_LEASE_MS = 300000;
const ALLOWED_STORE_FIELDS = new Set([
  "subscriptionStatus", "subscriptionType", "subscriptionPlanPrice",
  "nextDueDate", "lastPaymentDate", "overdueSince", "overdueDueDate",
  "asaasSubscriptionId", "pendingPlanChange", "pendingPlanChangeRequestedAt",
  "subscriptionPlanChangedAt",
  "subscriptionInactiveReason", "blockedAt",
]);
const NO_STORE_RESULTS = new Set([
  "overdue_unchanged", "payment_deleted_no_access_change", "still_overdue",
]);

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requiredString(value, field, maxLength = 180) {
  if (typeof value !== "string" || !value.trim() ||
      value.length > maxLength || /[\x00-\x1f\x7f]/.test(value)) {
    throw new TypeError(`invalid_${field}`);
  }
  return value.trim();
}

function optionalString(value, field, maxLength = 180) {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, field, maxLength);
}

function normalizedEvent(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("invalid_webhook_body");
  }
  const eventId = requiredString(raw.id, "event_id");
  const eventType = requiredString(raw.event, "event_type", 100);
  if (!/^[A-Z][A-Z0-9_]*$/.test(eventType)) {
    throw new TypeError("invalid_event_type");
  }
  const payment = raw.payment === undefined || raw.payment === null ? null : raw.payment;
  const subscription = raw.subscription === undefined || raw.subscription === null ? null : raw.subscription;
  if ((payment && (typeof payment !== "object" || Array.isArray(payment))) ||
      (subscription && (typeof subscription !== "object" || Array.isArray(subscription)))) {
    throw new TypeError("invalid_webhook_resource");
  }
  const paymentId = optionalString(payment?.id, "payment_id");
  const paymentSubscriptionId = optionalString(payment?.subscription, "payment_subscription_id");
  const subscriptionId = optionalString(subscription?.id, "subscription_id");
  const paymentReference = optionalString(payment?.externalReference, "payment_external_reference");
  const subscriptionReference = optionalString(subscription?.externalReference, "subscription_external_reference");
  if (paymentSubscriptionId && subscriptionId && paymentSubscriptionId !== subscriptionId) {
    throw new TypeError("conflicting_subscription_ids");
  }
  if (paymentReference && subscriptionReference && paymentReference !== subscriptionReference) {
    throw new TypeError("conflicting_external_references");
  }
  const identity = {
    eventId,
    eventType,
    paymentId,
    subscriptionId: paymentSubscriptionId || subscriptionId,
    externalReference: paymentReference || subscriptionReference,
  };
  // Same event ID with a changed body is a conflict, not a harmless replay.
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
    return value;
  }
  return {...identity, fingerprint: sha256(JSON.stringify(canonical(raw)))};
}

function knownEventKey(key) {
  if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) {
    throw new TypeError("invalid_event_key");
  }
  return key;
}

function isAlreadyExists(error) {
  const code = String(error?.code ?? "").toLowerCase();
  return code === "6" || code === "already-exists" || code === "already_exists";
}

function equalTimestamp(left, right) {
  if (!left || !right) return false;
  if (typeof left.isEqual === "function") return left.isEqual(right);
  return left.seconds === right.seconds && left.nanoseconds === right.nanoseconds;
}

function createAsaasWebhookLedger({db, FieldValue, config, now = Date.now, tokenFactory = randomUUID}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function" ||
      !FieldValue || typeof FieldValue.serverTimestamp !== "function" ||
      typeof now !== "function" || typeof tokenFactory !== "function") {
    throw new TypeError("invalid_ledger_dependencies");
  }
  const environment = config?.environment;
  const projectId = config?.projectId;
  if (PROJECTS[environment] !== projectId || config?.operationsEnabled !== true) {
    throw new Error("ledger_environment_disabled_or_invalid");
  }
  const collection = db.collection(COLLECTION);
  const refForKey = (key) => collection.doc(knownEventKey(key));
  const eventKeyForId = (eventId) => sha256(`${environment}\0${projectId}\0${requiredString(eventId, "event_id")}`);
  const ts = () => FieldValue.serverTimestamp();

  async function persist(rawEvent) {
    const event = normalizedEvent(rawEvent);
    const eventKey = eventKeyForId(event.eventId);
    const ref = refForKey(eventKey);
    try {
      await ref.create({
        ...event,
        environment,
        projectId,
        status: "pending",
        phase: "local",
        attempts: 0,
        nextAttemptAtMs: 0,
        leaseToken: null,
        leaseUntilMs: 0,
        resultCode: null,
        lastErrorCode: null,
        remoteOperation: null,
        createdAt: ts(),
        updatedAt: ts(),
      });
      return {outcome: "created", eventKey};
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const existing = await ref.get();
      if (!existing.exists) throw new Error("ledger_duplicate_unreadable");
      const old = existing.data() || {};
      if (old.eventId !== event.eventId || old.fingerprint !== event.fingerprint ||
          old.environment !== environment || old.projectId !== projectId) {
        return {outcome: "conflict", eventKey};
      }
      return {outcome: "duplicate", eventKey, status: old.status};
    }
  }

  function assertClaim(data, token, clock) {
    return data.status === "processing" &&
      data.leaseToken === token &&
      Number.isFinite(data.leaseUntilMs) && data.leaseUntilMs > clock;
  }

  async function claim(eventKey, {leaseMs = 60000} = {}) {
    const ref = refForKey(eventKey);
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > MAX_LEASE_MS) {
      throw new TypeError("invalid_lease_duration");
    }
    const token = requiredString(tokenFactory(), "lease_token", 128);
    return db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return {outcome: "missing"};
      const data = snapshot.data() || {};
      if (data.environment !== environment || data.projectId !== projectId) {
        return {outcome: "context_mismatch"};
      }
      const clock = now();
      if (!Number.isSafeInteger(clock) || clock <= 0) throw new Error("invalid_clock");
      if (data.status === "done") return {outcome: "done"};
      if (data.status === "needs_review") return {outcome: "needs_review"};
      if (data.status === "processing" && data.leaseUntilMs > clock) {
        return {outcome: "busy"};
      }
      if (data.status === "processing" && data.phase !== "local") {
        tx.update(ref, {
          status: "needs_review",
          lastErrorCode: "expired_remote_intent",
          leaseToken: null,
          leaseUntilMs: 0,
          updatedAt: ts(),
        });
        return {outcome: "needs_review"};
      }
      if (data.status !== "pending" && data.status !== "processing") {
        return {outcome: "invalid_state"};
      }
      if (data.status === "pending" && data.nextAttemptAtMs > clock) {
        return {outcome: "backoff"};
      }
      tx.update(ref, {
        status: "processing",
        phase: "local",
        attempts: (data.attempts || 0) + 1,
        leaseToken: token,
        leaseUntilMs: clock + leaseMs,
        nextAttemptAtMs: 0,
        updatedAt: ts(),
      });
      return {outcome: "claimed", token, eventKey, event: {
        eventId: data.eventId,
        eventType: data.eventType,
        paymentId: data.paymentId,
        subscriptionId: data.subscriptionId,
        externalReference: data.externalReference,
      }};
    });
  }

  async function markRemoteIntent(eventKey, token, operation) {
    const ref = refForKey(eventKey);
    const safeOperation = requiredString(operation, "remote_operation", 80);
    if (!/^[a-z][a-z0-9_]*$/.test(safeOperation)) throw new TypeError("invalid_remote_operation");
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return {outcome: "missing"};
      const data = snap.data() || {};
      if (!assertClaim(data, token, now())) return {outcome: "stale_lease"};
      if (data.phase !== "local") return {outcome: "already_remote_intent"};
      tx.update(ref, {phase: "remote_intent", remoteOperation: safeOperation, updatedAt: ts()});
      return {outcome: "remote_intent_recorded"};
    });
  }

  async function completeLocal(eventKey, token, {storeRef, storeUpdate, expectedStoreUpdateTime, expectedSubscriptionId, resultCode}) {
    const ref = refForKey(eventKey);
    const result = requiredString(resultCode, "result_code", 80);
    if (!/^[a-z][a-z0-9_]*$/.test(result)) throw new TypeError("invalid_result_code");
    const withStore = !!storeRef;
    if (withStore && (!storeUpdate || typeof storeUpdate !== "object" ||
        Array.isArray(storeUpdate) || Object.keys(storeUpdate).length === 0 ||
        !expectedStoreUpdateTime || !expectedSubscriptionId)) {
      throw new TypeError("invalid_store_write_guard");
    }
    if (!withStore && (storeUpdate || expectedStoreUpdateTime || expectedSubscriptionId)) {
      throw new TypeError("unexpected_store_write_data");
    }
    if (withStore && Object.keys(storeUpdate).some((key) => !ALLOWED_STORE_FIELDS.has(key))) {
      throw new TypeError("unauthorized_store_update_field");
    }
    if (!withStore && !result.startsWith("ignored_") && !NO_STORE_RESULTS.has(result)) {
      throw new TypeError("unverified_no_store_completion");
    }
    return db.runTransaction(async (tx) => {
      // Todas as leituras ANTES de qualquer escrita na transacao.
      const ledgerSnap = await tx.get(ref);
      const storeSnap = withStore ? await tx.get(storeRef) : null;
      if (!ledgerSnap.exists) return {outcome: "missing"};
      const data = ledgerSnap.data() || {};
      if (!assertClaim(data, token, now()) || data.phase !== "local" ||
          data.environment !== environment || data.projectId !== projectId) {
        return {outcome: "stale_lease"};
      }
      if (withStore) {
        const store = storeSnap.exists ? storeSnap.data() || {} : null;
        if (!store || !equalTimestamp(storeSnap.updateTime, expectedStoreUpdateTime) ||
            store.asaasSubscriptionId !== expectedSubscriptionId ||
            data.subscriptionId !== expectedSubscriptionId ||
            store.asaasBindingEnvironment !== environment ||
            store.asaasBindingProjectId !== projectId) {
          return {outcome: "store_changed"};
        }
        tx.update(storeRef, storeUpdate);
      }
      tx.update(ref, {
        status: "done", phase: "local", resultCode: result,
        leaseToken: null, leaseUntilMs: 0, updatedAt: ts(),
      });
      return {outcome: "done"};
    });
  }

  async function fail(eventKey, token, errorCode) {
    const ref = refForKey(eventKey);
    const safeErrorCode = requiredString(errorCode, "error_code", 80);
    if (!/^[a-z][a-z0-9_]*$/.test(safeErrorCode)) throw new TypeError("invalid_error_code");
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return {outcome: "missing"};
      const data = snap.data() || {};
      if (!assertClaim(data, token, now())) return {outcome: "stale_lease"};
      if (data.phase !== "local") {
        tx.update(ref, {
          status: "needs_review", lastErrorCode: safeErrorCode,
          leaseToken: null, leaseUntilMs: 0, updatedAt: ts(),
        });
        return {outcome: "needs_review"};
      }
      const seconds = Math.min(1800, 10 * Math.pow(2, Math.min(8, Math.max(0, data.attempts - 1))));
      tx.update(ref, {
        status: "pending", lastErrorCode: safeErrorCode,
        leaseToken: null, leaseUntilMs: 0,
        nextAttemptAtMs: now() + seconds * 1000,
        updatedAt: ts(),
      });
      return {outcome: "retry_scheduled", waitSeconds: seconds};
    });
  }

  return Object.freeze({
    persist, claim, markRemoteIntent, completeLocal, fail, eventKeyForId,
    collectionName: COLLECTION,
  });
}

module.exports = {
  createAsaasWebhookLedger,
  normalizedEvent,
};
