"use strict";

// Diagnostic only: no listener, credentials, Auth/Firestore I/O or trusted adapter.
// Exercises the installed Admin SDK's JWT stage, NOT full verifyIdToken/revocation.
const test = require("node:test");
const assert = require("node:assert/strict");
const {initializeApp, deleteApp} = require("firebase-admin/app");
const {createIdTokenVerifier} = require("../../node_modules/firebase-admin/lib/auth/token-verifier");

const projectId = "demo-store-connect-f10-b2-b2-a";
function unsignedClientToken(uid, audience = projectId) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return encode({alg: "none", typ: "JWT"}) + "." + encode({
    aud: audience, iss: "https://securetoken.google.com/" + projectId,
    sub: uid, iat: now, exp: now + 300, auth_time: now,
    firebase: {sign_in_provider: "password", identities: {}},
  }) + ".";
}

test("Auth Emulator JWT stage accepts caller-selected identities without issuance", async () => {
  const app = initializeApp({projectId}, "f10-b2-b2-a-unsigned-diagnostic");
  try {
    const verifier = createIdTokenVerifier(app);
    for (const uid of ["synthetic-store-a-user", "synthetic-store-b-user"]) {
      const claims = await verifier.verifyJWT(unsignedClientToken(uid), true);
      assert.equal(claims.uid, uid);
    }
  } finally {
    await deleteApp(app);
  }
});

test("audience validation does not make an unsigned identity authentic", async () => {
  const app = initializeApp({projectId}, "f10-b2-b2-a-audience-diagnostic");
  try {
    const verifier = createIdTokenVerifier(app);
    await assert.rejects(verifier.verifyJWT(
        unsignedClientToken("synthetic-user", "demo-other-project"), true),
    (error) => error.code === "auth/argument-error");
  } finally {
    await deleteApp(app);
  }
});

test("normal verifier rejects the unsigned token before certificate/network lookup", async () => {
  const app = initializeApp({projectId}, "f10-b2-b2-a-normal-diagnostic");
  try {
    const verifier = createIdTokenVerifier(app);
    await assert.rejects(verifier.verifyJWT(unsignedClientToken("synthetic-user")),
        (error) => error.code === "auth/argument-error");
  } finally {
    await deleteApp(app);
  }
});
