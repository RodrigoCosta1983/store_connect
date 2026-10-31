"use strict";

// Commercial endpoints exported by index; remote destination remains HML only.
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {Timestamp, FieldValue} = require("firebase-admin/firestore");
const {createHash} = require("node:crypto");
const {createStoreWriterAdmission} = require("./storeWriterAdmission");
const roles = new Set(["admin", "gerente", "operador", "caixa", "vendedor"]);
const fail = (reason, code = "failed-precondition") => {
  throw new HttpsError(code, "Recebimento não confirmado: " + reason, {reason});
};
const id = v => typeof v === "string" && v.length > 0 && v.length <= 128 &&
  v.trim() === v && !/[\/\x00-\x1f]/.test(v) && ![".", ".."].includes(v);
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function parse(raw) {
  if (!raw || Array.isArray(raw) || Object.keys(raw).some(k =>
    !["schemaVersion", "requestId", "scope", "customerId", "saleId", "amountCents"].includes(k)) ||
    raw.schemaVersion !== 1 || !id(raw.requestId) || !raw.scope ||
    Object.keys(raw.scope).sort().join() !== "projectId,storeId,uid" ||
    !Object.values(raw.scope).every(id) ||
    !Number.isSafeInteger(raw.amountCents) || raw.amountCents <= 0 || raw.amountCents > 100000000000 ||
    !((id(raw.customerId) && raw.saleId === null) || (id(raw.saleId) && raw.customerId === null))) {
    fail("invalid-command", "invalid-argument");
  }
  return {schemaVersion: 1, requestId: raw.requestId,
    scope: {projectId: raw.scope.projectId, storeId: raw.scope.storeId, uid: raw.scope.uid},
    customerId: raw.customerId, saleId: raw.saleId, amountCents: raw.amountCents};
}
function destination() {
  const project = admin.app().options.projectId;
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    if (/^demo-/.test(project) && process.env.GCLOUD_PROJECT === project &&
        /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) return;
  } else if (project === "store-connect-hml" &&
      process.env.GCLOUD_PROJECT === project && !process.env.FIRESTORE_EMULATOR_HOST &&
      process.env.F9_COMMERCIAL_RECEIVABLES_PROJECT === project) return;
  fail("commercial-receivables-disabled");
}
function cents(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
      !Number.isSafeInteger(Math.round(value * 100)) ||
      Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) fail("invalid-historical-balance");
  return Math.round(value * 100);
}
function obligationsFor(snapshot) {
  const data = snapshot.data();
  if (data.isPaid === true) return [];
  if (data.isPaid !== false || !["Fiado", "A prazo"].includes(data.paymentMethod)) fail("invalid-deferred-sale");
  const total = cents(data.totalAmount);
  if (!total) fail("invalid-historical-balance");
  const list = data.installments;
  if (list != null && !Array.isArray(list)) fail("invalid-historical-balance");
  const rows = list?.length ? list : [data];
  let sum = 0, paidSum = 0;
  const result = rows.map((row, index) => {
    const amount = list?.length ? cents(row.amount) : total;
    const paid = cents(row.paidAmount ?? (list?.length ? 0 : data.totalPaidAmount ?? 0));
    if (paid > amount || (row.isPaid === true && paid !== amount)) fail("invalid-historical-balance");
    sum += amount; paidSum += paid;
    const due = row.dueDate ?? data.dueDate ?? data.createdAt;
    return {snapshot, index: list?.length ? index : null, amount, paid,
      due: due instanceof Timestamp ? due : Timestamp.fromMillis(4102444800000)};
  });
  if (sum !== total || !Number.isSafeInteger(sum) || !Number.isSafeInteger(paidSum) ||
      (data.totalPaidAmount != null && cents(data.totalPaidAmount) !== paidSum)) {
    fail("inconsistent-historical-balance");
  }
  return result.filter(row => row.paid < row.amount);
}
async function execute(request, queryOnly = false) {
  destination();
  if (!request.auth?.uid) fail("authentication-required", "unauthenticated");
  const input = parse(request.data), requestHash = hash(input);
  const db = admin.firestore();
  const admission = createStoreWriterAdmission(db, "receiveDebtPaymentV1", request.auth.uid);
  return db.runTransaction(async tx => {
    const profile = await tx.get(db.collection("users").doc(request.auth.uid));
    const user = profile.data() || {};
    const role = String(user.role || "").trim().toLowerCase();
    if (!profile.exists || !roles.has(role) || String(user.accessStatus || "").trim().toLowerCase() === "revoked" ||
        input.scope.uid !== request.auth.uid || user.storeId !== input.scope.storeId ||
        input.scope.projectId !== admin.app().options.projectId) fail("payment-access-denied", "permission-denied");
    const store = db.collection("stores").doc(user.storeId);
    const storeSnap = await tx.get(store);
    if (!storeSnap.exists) fail("store-unavailable", "permission-denied");
    const receiptRef = store.collection("auditLogs").doc("debt-payment-v1-" + hash(input.requestId));
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      const saved = receipt.data();
      if (saved.actorUid !== request.auth.uid) fail("result-access-denied", "permission-denied");
      if (saved.requestHash !== requestHash || saved.protocol !== "receiveDebtPaymentV1") {
        return {status: "identity-conflict", requestId: input.requestId};
      }
      return {...saved.result, replayed: true};
    }
    if (queryOnly) return {status: "not-recorded", requestId: input.requestId, definitive: false};
    await admission(tx, store.id);
    // Do not introduce a new subscription restriction on debt already incurred.
    let snapshots;
    if (input.saleId) {
      const sale = await tx.get(store.collection("sales").doc(input.saleId));
      if (!sale.exists) fail("sale-unavailable");
      snapshots = [sale];
    } else {
      const query = store.collection("sales").where("customerId", "==", input.customerId).where("isPaid", "==", false);
      const sales = await tx.get(query.limit(201));
      if (sales.size > 200) fail("too-many-open-sales");
      snapshots = sales.docs;
    }
    let result, updates = new Map();
    try {
      const obligations = snapshots.flatMap(obligationsFor).sort((a, b) =>
        a.due.seconds - b.due.seconds || a.due.nanoseconds - b.due.nanoseconds ||
        a.snapshot.id.localeCompare(b.snapshot.id) || (a.index ?? 0) - (b.index ?? 0));
      const debt = obligations.reduce((sum, row) => sum + row.amount - row.paid, 0);
      if (!Number.isSafeInteger(debt) || input.amountCents > debt) fail("amount-exceeds-current-debt");
      if (input.saleId && input.amountCents !== debt) fail("settlement-balance-changed");
      let remaining = input.amountCents;
      const applied = [], now = Timestamp.now();
      for (const row of obligations) {
        if (!remaining) break;
        const value = Math.min(remaining, row.amount - row.paid);
        const data = row.snapshot.data();
        let entry = updates.get(row.snapshot.id);
        if (!entry) {
          entry = {ref: row.snapshot.ref, patch: row.index === null ? {} :
            {installments: data.installments.map(item => ({...item}))}};
          updates.set(row.snapshot.id, entry);
        }
        const paid = row.paid + value;
        if (row.index === null) Object.assign(entry.patch, {paidAmount: paid / 100, totalPaidAmount: paid / 100,
          isPaid: paid === row.amount, paidAt: paid === row.amount ? now : null});
        else Object.assign(entry.patch.installments[row.index], {paidAmount: paid / 100,
          isPaid: paid === row.amount, paidAt: paid === row.amount ? now : null});
        applied.push({saleId: row.snapshot.id, installmentIndex: row.index, amountCents: value});
        remaining -= value;
      }
      for (const entry of updates.values()) {
        if (entry.patch.installments) {
          entry.patch.totalPaidAmount = entry.patch.installments.reduce((sum, row) => sum + cents(row.paidAmount ?? 0), 0) / 100;
          entry.patch.isPaid = entry.patch.installments.every(row => cents(row.paidAmount ?? 0) === cents(row.amount));
          if (entry.patch.isPaid) entry.patch.paidAt = now;
        }
      }
      result = {status: "confirmed", requestId: input.requestId, amountCents: input.amountCents,
        remainingDebtCents: debt - input.amountCents, applied, replayed: false};
    } catch (e) {
      if (!(e instanceof HttpsError) || e.code !== "failed-precondition") throw e;
      updates = new Map();
      result = {status: "rejected", requestId: input.requestId, reason: e.details.reason, replayed: false};
    }
    // No side effect precedes this point; failure of ANY write rolls everything back.
    const cashRef = store.collection("cash_flow").doc("debt-payment-v1-" + hash(input.requestId));
    if (result.status === "confirmed") {
      const customerName = snapshots.map(snapshot => snapshot.data().customerName)
        .find(name => typeof name === "string" && name.trim());
      for (const entry of updates.values()) tx.update(entry.ref, entry.patch);
      tx.create(cashRef, {description: input.customerId ? `Recebimento de ${customerName || input.customerId}` :
        `Recebimento Venda #${input.saleId}`, amount: input.amountCents / 100,
      type: "Entrada", createdAt: FieldValue.serverTimestamp()});
    }
    tx.create(receiptRef, {protocol: "receiveDebtPaymentV1", schemaVersion: 1, actorUid: request.auth.uid,
      role, storeId: store.id, requestHash, command: input, result, cashFlowId: result.status === "confirmed" ? cashRef.id : null,
      createdAt: FieldValue.serverTimestamp()});
    return result;
  });
}
const options = {timeoutSeconds: 60, memory: "256MiB", enforceAppCheck: true};
module.exports = {
  receiveDebtPaymentV1: onCall(options, request => execute(request)),
  getDebtPaymentResultV1: onCall(options, request => execute(request, true)),
};
