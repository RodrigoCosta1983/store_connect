"use strict";

const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const {Firestore, DocumentReference, WriteBatch} = require("firebase-admin/firestore");
const {authorizeRestoreAdminInEmulator: authorize} = require("../../backups/storeRestoreAdminAuthorizationEmulator");

const projectId = "demo-store-connect-restore";
assert.ok(["127.0.0.1:8080", "localhost:8080", "[::1]:8080"].includes(process.env.FIRESTORE_EMULATOR_HOST));
const db = new Firestore({projectId, host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false});
after(() => db.terminate());

function request(uid, target = "R2B-A", intent = "DRY_RUN", mode = "MERGE_A1") {
  const value = {schemaVersion: 1, intent, mode,
    source: {storeId: target === "R2B-A" ? "R2B-B" : "R2B-A", checksumSha256: "a".repeat(64)},
    targetStoreId: target, requestedByUid: uid};
  if (intent === "EXECUTE") {
    value.expectedPlanHash = "b".repeat(64);
    value.confirmation = {intent, targetStoreId: target, mode, planHash: value.expectedPlanHash, confirmed: true};
    if (mode === "REPLACE") value.confirmation.destructiveActionAcknowledged = true;
  } else if (mode === "REPLACE") value.destructiveActionAcknowledged = true;
  return value;
}
const args = (uid, target, intent, mode) => ({request: request(uid, target, intent, mode),
  authenticatedRequester: {uid, disabled: false}, projectId});
async function logicalSnapshot() {
  const records = [];
  async function walk(collection) {
    const docs = await collection.get();
    for (const doc of docs.docs) records.push({path: doc.ref.path, data: doc.data()});
    // listDocuments includes missing parents that have subcollections.
    for (const doc of await collection.listDocuments()) {
      for (const child of await doc.listCollections()) await walk(child);
    }
  }
  for (const collection of await db.listCollections()) await walk(collection);
  return records.sort((a, b) => a.path.localeCompare(b.path));
}
function blockWrites() {
  const saved = [];
  for (const [prototype, methods] of [
    [DocumentReference.prototype, ["set", "create", "update", "delete"]],
    [WriteBatch.prototype, ["set", "create", "update", "delete", "commit"]],
    [Firestore.prototype, ["batch", "runTransaction", "bulkWriter", "recursiveDelete"]],
  ]) for (const method of methods) {
    saved.push([prototype, method, prototype[method]]);
    prototype[method] = () => { assert.fail("R2B attempted write API: " + method); };
  }
  return () => { for (const [prototype, method, original] of saved) prototype[method] = original; };
}

test("R2B canonical authorization read-only scenarios", async (t) => {
  const profiles = {
    "R2B-owner": {storeId: "R2B-A", role: "admin", accessStatus: "active"},
    "R2B-admin": {storeId: "R2B-A", role: "admin", accessStatus: "active"},
    "R2B-common": {storeId: "R2B-A", role: "operador", accessStatus: "active"},
    "R2B-manager": {storeId: "R2B-A", role: "gerente", accessStatus: "active"},
    "R2B-other": {storeId: "R2B-B", role: "admin", accessStatus: "active"},
    "R2B-revoked": {storeId: "R2B-A", role: "admin", accessStatus: "revoked"},
    "R2B-no-membership": {role: "admin", accessStatus: "active"},
    "R2B-unknown": {storeId: "R2B-A", role: "superadmin", accessStatus: "active"},
    "R2B-missing-target": {storeId: "R2B-missing", role: "admin", accessStatus: "active"},
    "R2B-bad-status": {storeId: "R2B-A", role: "admin", accessStatus: 1},
  };
  const batch = db.batch();
  batch.set(db.doc("stores/R2B-A"), {name: "A", ownerId: "R2B-owner", marker: {preserve: true}});
  batch.set(db.doc("stores/R2B-B"), {name: "B", ownerId: "R2B-other"});
  for (const [uid, profile] of Object.entries(profiles)) batch.set(db.doc("users/" + uid), profile);
  batch.set(db.doc("stores/R2B-A/auditLogs/sentinel"), {unchanged: true});
  batch.set(db.doc("stores/R2B-A/products/sentinel"), {stock: 5});
  batch.set(db.doc("stores/R2B-A/memberships/sentinel"), {unchanged: true});
  await batch.commit();
  const before = await logicalSnapshot();
  const restoreWrites = blockWrites();
  try {
    async function check(label, options, reason) {
      await t.test(label, async () => {
        const result = await authorize(options);
        assert.equal(result.reasonCode, reason);
        assert.equal(result.authorized, reason === "AUTHORIZED");
        assert.deepEqual(Object.keys(result).sort(), ["authorized", "reasonCode", "requesterUid", "targetStoreId"]);
      });
    }
    for (const intent of ["DRY_RUN", "EXECUTE"]) {
      await check(`${intent} owner MERGE_A1`, args("R2B-owner", "R2B-A", intent), "AUTHORIZED");
      await check(`${intent} nonowner admin MERGE_A1`, args("R2B-admin", "R2B-A", intent), "AUTHORIZED");
      await check(`${intent} owner REPLACE`, args("R2B-owner", "R2B-A", intent, "REPLACE"), "AUTHORIZED");
      await check(`${intent} nonowner admin REPLACE`, args("R2B-admin", "R2B-A", intent, "REPLACE"), "STORE_OWNER_REQUIRED");
    }
    await check("common user", args("R2B-common"), "INSUFFICIENT_PERMISSION");
    await check("manager", args("R2B-manager"), "INSUFFICIENT_PERMISSION");
    await check("unknown role", args("R2B-unknown"), "INSUFFICIENT_PERMISSION");
    await check("same admin allowed on own store", args("R2B-other", "R2B-B"), "AUTHORIZED");
    await check("same admin denied cross-store, even source admin", args("R2B-other", "R2B-A"), "NOT_STORE_MEMBER");
    const spoof = args("R2B-owner"); spoof.authenticatedRequester.uid = "R2B-common";
    await check("requester spoof", spoof, "REQUESTER_MISMATCH");
    await check("target nonexistent even with profile membership", args("R2B-missing-target", "R2B-missing"), "STORE_NOT_FOUND");
    await check("profile absent", args("R2B-no-profile"), "PROFILE_NOT_FOUND");
    await check("membership absent", args("R2B-no-membership"), "NOT_STORE_MEMBER");
    await check("access revoked", args("R2B-revoked"), "ACCESS_REVOKED");
    await check("malformed status", args("R2B-bad-status"), "INVALID_AUTHORIZATION_CONTEXT");
    const disabled = args("R2B-owner"); disabled.authenticatedRequester.disabled = true;
    await check("Auth disabled context", disabled, "REQUESTER_DISABLED");
    const invalid = args("R2B-owner"); delete invalid.request.targetStoreId;
    await check("R2A invalid", invalid, "INVALID_REQUEST");
    const roleSpoof = args("R2B-common"); roleSpoof.request.role = "admin";
    await check("role spoof", roleSpoof, "INVALID_REQUEST");
    const capabilitySpoof = args("R2B-common"); capabilitySpoof.request.capability = "restore";
    await check("capability spoof", capabilitySpoof, "INVALID_REQUEST");
    const unconfirmed = args("R2B-owner", "R2B-A", "EXECUTE", "REPLACE");
    unconfirmed.request.confirmation.destructiveActionAcknowledged = false;
    await check("REPLACE without destructive confirmation", unconfirmed, "INVALID_REQUEST");
    const beforeRequest = args("R2B-owner", "R2B-A", "EXECUTE", "REPLACE");
    const inputCopy = JSON.stringify(beforeRequest);
    await check("inputs preserved", beforeRequest, "AUTHORIZED");
    assert.equal(JSON.stringify(beforeRequest), inputCopy);
    await t.test("zero writes: complete database logical snapshot identical including subcollections", async () => {
      assert.deepEqual(await logicalSnapshot(), before);
    });
  } finally { restoreWrites(); }
  await t.test("membership removal is revalidated", async () => {
    await db.doc("users/R2B-admin").update({storeId: "R2B-B"});
    const changed = await logicalSnapshot();
    assert.equal((await authorize(args("R2B-admin", "R2B-A", "EXECUTE"))).reasonCode, "NOT_STORE_MEMBER");
    assert.deepEqual(await logicalSnapshot(), changed);
  });
});

for (const host of [undefined, "", "store-connect-app:8080", "127.0.0.1:443", "https://localhost:8080", "localhost:8080.evil"]) {
  test(`host guard rejects ${String(host)} before SDK or reads`, async () => {
    const previous = process.env.FIRESTORE_EMULATOR_HOST; const originalLoad = Module._load;
    try {
      if (host === undefined) delete process.env.FIRESTORE_EMULATOR_HOST; else process.env.FIRESTORE_EMULATOR_HOST = host;
      Module._load = () => { assert.fail("guard reached SDK"); };
      await assert.rejects(authorize(args("R2B-owner")), {message: "INVALID_EMULATOR_HOST"});
    } finally { Module._load = originalLoad; process.env.FIRESTORE_EMULATOR_HOST = previous; }
  });
}
for (const invalidProject of [undefined, "", "store-connect-app", "demo-other", "demo-store-connect-restore "]) {
  test(`project guard rejects ${String(invalidProject)} before SDK or reads`, async () => {
    const originalLoad = Module._load;
    try {
      Module._load = () => { assert.fail("guard reached SDK"); };
      await assert.rejects(authorize({...args("R2B-owner"), projectId: invalidProject}), {message: "INVALID_EMULATOR_PROJECT"});
    } finally { Module._load = originalLoad; }
  });
}
test("requester spoof and invalid payload denied before SDK or reads", async () => {
  const originalLoad = Module._load;
  try {
    Module._load = () => { assert.fail("invalid identity reached SDK"); };
    const spoof = args("R2B-owner"); spoof.authenticatedRequester.uid = "R2B-common";
    assert.equal((await authorize(spoof)).reasonCode, "REQUESTER_MISMATCH");
    assert.equal((await authorize({...args("R2B-owner"), request: {}})).reasonCode, "INVALID_REQUEST");
  } finally { Module._load = originalLoad; }
});
test("read failure denied with sanitized reason and terminated client", async () => {
  const originalLoad = Module._load; let terminated = false;
  try {
    Module._load = (id) => {
      assert.equal(id, "firebase-admin/firestore");
      return {Firestore: class {
        constructor(options) { assert.deepEqual(options, {projectId, host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false}); }
        doc() { return {get: async () => { throw new Error("sensitive internal error"); }}; }
        async terminate() { terminated = true; }
      }};
    };
    assert.equal((await authorize(args("R2B-owner"))).reasonCode, "AUTHORIZATION_READ_FAILED");
    assert.equal(terminated, true);
  } finally { Module._load = originalLoad; }
});
for (const host of ["127.0.0.1:8080", "localhost:8080", "[::1]:8080"]) {
  test(`allowed host ${host}: exact transport, only canonical paths, detached inputs`, async () => {
    const previous = process.env.FIRESTORE_EMULATOR_HOST; const originalLoad = Module._load;
    const options = args("R2B-owner", "R2B-A", "EXECUTE", "REPLACE");
    const paths = []; let terminated = false;
    try {
      process.env.FIRESTORE_EMULATOR_HOST = host;
      Module._load = (id) => {
        assert.equal(id, "firebase-admin/firestore");
        return {Firestore: class {
          constructor(settings) { assert.deepEqual(settings, {projectId, host, ssl: false}); }
          doc(path) {
            paths.push(path);
            return {get: async () => {
              // Caller changes its input during I/O; the approved identities remain detached.
              options.request.targetStoreId = "R2B-B"; options.authenticatedRequester.uid = "spoofed";
              return path.startsWith("users/")
                ? {id: "R2B-owner", exists: true, data: () => ({storeId: "R2B-A", role: "admin", accessStatus: "active"})}
                : {id: "R2B-A", exists: true, data: () => ({ownerId: "R2B-owner"})};
            }};
          }
          async terminate() { terminated = true; }
        }};
      };
      assert.deepEqual(await authorize(options), {authorized: true, reasonCode: "AUTHORIZED",
        targetStoreId: "R2B-A", requesterUid: "R2B-owner"});
      assert.deepEqual(paths, ["users/R2B-owner", "stores/R2B-A"]); assert.equal(terminated, true);
    } finally { Module._load = originalLoad; process.env.FIRESTORE_EMULATOR_HOST = previous; }
  });
}
test("SDK construction failure denied without forwarding internal errors", async () => {
  const originalLoad = Module._load;
  try {
    Module._load = () => ({Firestore: class { constructor() { throw new Error("sensitive details"); } }});
    assert.equal((await authorize(args("R2B-owner"))).reasonCode, "AUTHORIZATION_READ_FAILED");
  } finally { Module._load = originalLoad; }
});
