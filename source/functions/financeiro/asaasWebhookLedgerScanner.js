"use strict";

// Store&Connect - A2/03e LEDGER02a (READ ONLY)
// Descoberta paginada de eventos do Ledger 01. NAO reivindica eventos,
// nao altera Firestore, nao importa Admin/Cloud Functions/Asaas e nao agenda jobs.
// A etapa LEDGER02b implementara o processador apos a auditoria de negocio.
const PROJECTS = Object.freeze({
  sandbox: "store-connect-hml",
  production: "store-connect-app",
});
const STATUSES = Object.freeze(["pending", "processing", "needs_review"]);
const KEY_RE = /^[a-f0-9]{64}$/;
const CURSOR_RE = /^[A-Za-z0-9_-]{1,256}$/;

function validInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
function validCursor(cursor) {
  if (cursor === undefined || cursor === null) return null;
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) ||
      !STATUSES.includes(cursor.status) ||
      (cursor.afterId !== null && cursor.afterId !== undefined &&
        (typeof cursor.afterId !== "string" || !CURSOR_RE.test(cursor.afterId)))) {
    throw new TypeError("invalid_ledger_scan_cursor");
  }
  return {status:cursor.status,afterId:cursor.afterId || null};
}

function classifyLedgerItem(id, data, status, clock, environment, projectId) {
  if (!KEY_RE.test(id) || !data || typeof data !== "object" ||
      data.environment !== environment || data.projectId !== projectId ||
      data.status !== status) return "skip_untrusted";
  if (status === "needs_review") return "review";
  if (!validInteger(data.attempts) ||
      typeof data.eventId !== "string" || !data.eventId ||
      typeof data.eventType !== "string" || !data.eventType) return "review";
  if (status === "pending") {
    if (data.phase !== "local" || !validInteger(data.nextAttemptAtMs)) return "review";
    return data.nextAttemptAtMs <= clock ? "ready" : "waiting";
  }
  if (!validInteger(data.leaseUntilMs)) return "review";
  if (data.leaseUntilMs > clock) return "busy";
  return data.phase === "local" ? "ready" : "review";
}

function createAsaasWebhookLedgerScanner({db, config, now = Date.now}) {
  if (!db || typeof db.collection !== "function" || typeof now !== "function") {
    throw new TypeError("invalid_scanner_dependencies");
  }
  const environment = config?.environment;
  const projectId = config?.projectId;
  if (PROJECTS[environment] !== projectId || config?.operationsEnabled !== true) {
    throw new Error("ledger_scanner_environment_disabled_or_invalid");
  }
  const collection = db.collection("asaasWebhookEvents");

  async function scan({cursor = null, maxReads = 100, pageSize = 25} = {}) {
    if (!Number.isSafeInteger(maxReads) || maxReads < 1 || maxReads > 500 ||
        !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new TypeError("invalid_ledger_scan_limits");
    }
    const beginning = validCursor(cursor);
    const clock = now();
    if (!Number.isSafeInteger(clock) || clock <= 0) throw new TypeError("invalid_scanner_clock");
    const startStatus = beginning ? STATUSES.indexOf(beginning.status) : 0;
    const result = {
      scanned:0,ready:[],review:[],busy:0,waiting:0,skippedContext:0,
      nextCursor:null,exhausted:true,
    };
    for (let s = startStatus; s < STATUSES.length; s++) {
      const status = STATUSES[s];
      let afterId = s === startStatus ? beginning?.afterId || null : null;
      while (result.scanned < maxReads) {
        const remaining = maxReads - result.scanned;
        const limit = Math.min(pageSize,remaining);
        let query = collection.where("status","==",status).orderBy("__name__");
        if (afterId) query = query.startAfter(afterId);
        const snapshot = await query.limit(limit).get();
        if (!snapshot || !Array.isArray(snapshot.docs)) throw new Error("invalid_ledger_scan_response");
        if (snapshot.docs.length > limit) throw new Error("unbounded_ledger_scan_response");
        for (const doc of snapshot.docs) {
          if (!doc || typeof doc.id !== "string" || typeof doc.data !== "function") {
            throw new Error("invalid_ledger_scan_document");
          }
          const category = classifyLedgerItem(doc.id,doc.data(),status,clock,environment,projectId);
          if (category === "ready") result.ready.push({eventKey:doc.id,status});
          else if (category === "review") result.review.push({eventKey:doc.id,status});
          else if (category === "busy") result.busy++;
          else if (category === "waiting") result.waiting++;
          else result.skippedContext++;
          afterId = doc.id;
          result.scanned++;
        }
        if (snapshot.docs.length < limit) break;
        if (result.scanned === maxReads) {
          result.nextCursor = {status,afterId};
          result.exhausted = false;
          return result;
        }
      }
    }
    return result;
  }

  return Object.freeze({scan,collectionName:"asaasWebhookEvents"});
}
module.exports = {createAsaasWebhookLedgerScanner};
