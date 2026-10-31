"use strict";

// Administrative tool: credentials do not authorize writes. --apply requires
// separate human authorization. Default/dry-run performs reads only.
// Local tests live here to keep this delivery limited to one new file.
const assert = require("node:assert/strict");
const path = require("node:path");
const {createRequire} = require("node:module");
const {execFileSync} = require("node:child_process");
const fs = require("node:fs");
const PROJECT = "store-connect-hml";
const NUMBER = "324469869942";
const DATABASE = "(default)";
let runtimeStage = "arguments";
const req = createRequire(path.join(__dirname, "../functions/package.json"));
const {validateCategoryMutationInput, validateCategoryId} =
  req("./categories/categoryHierarchyContract");
const TREE = [
  ["cuidados-com-a-pele", "Cuidados com a Pele", [
    ["cuidados-corporais", "Cuidados Corporais"],
    ["hidratantes", "Hidratantes"],
    ["limpeza-facial", "Limpeza Facial"],
    ["protetor-solar", "Protetor Solar"],
  ]],
  ["higiene-pessoal", "Higiene Pessoal", [
    ["cabelos", "Cabelos"],
    ["desodorantes", "Desodorantes"],
    ["higiene-bucal", "Higiene Bucal"],
  ]],
];

class SeedValidationError extends Error {}

function check(condition, code) {
  if (!condition) throw new SeedValidationError(code);
}

function parseArgs(args) {
  const flags = {};
  const values = new Set(["project-id", "project-number", "database-id", "store-id"]);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    check(args[i].startsWith("--") &&
      (values.has(key) || key === "dry-run" || key === "apply"), "INVALID_ARGUMENT");
    check(!Object.hasOwn(flags, key), "DUPLICATE_ARGUMENT");
    if (values.has(key)) {
      check(typeof args[i + 1] === "string" && !args[i + 1].startsWith("--"), "MISSING_VALUE");
      flags[key] = args[++i];
    } else flags[key] = true;
  }
  check(!(flags.apply && flags["dry-run"]), "CONFLICTING_MODE");
  check(flags["project-id"] === PROJECT && flags["project-number"] === NUMBER &&
    flags["database-id"] === DATABASE, "TARGET_NOT_APPROVED_HML");
  validateCategoryId(flags["store-id"], "storeId");
  check(![".", ".."].includes(flags["store-id"]), "INVALID_STORE_ID");
  return {projectId: PROJECT, projectNumber: NUMBER, databaseId: DATABASE,
    storeId: flags["store-id"], apply: flags.apply === true};
}

function validateEnvironment(env) {
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    check(!/EMULATOR/i.test(key) &&
      !["FIRESTORE_HOST", "FIRESTORE_API_ENDPOINT", "GOOGLE_CLOUD_UNIVERSE_DOMAIN",
        "GOOGLE_API_ENDPOINT_OVERRIDES_FIRESTORE",
        "GOOGLE_API_ENDPOINT_OVERRIDES_CLOUDRESOURCEMANAGER"].includes(key),
    "EMULATOR_OR_ENDPOINT_OVERRIDE");
    if (["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "GCP_PROJECT",
      "CLOUDSDK_CORE_PROJECT", "FIREBASE_PROJECT", "FIREBASE_PROJECT_ID",
      "GOOGLE_CLOUD_QUOTA_PROJECT"].includes(key)) {
      check(value === PROJECT, "CONFLICTING_PROJECT_ENVIRONMENT");
    }
  }
  if (env.FIREBASE_CONFIG) {
    const config = JSON.parse(env.FIREBASE_CONFIG.startsWith("{")
      ? env.FIREBASE_CONFIG : fs.readFileSync(env.FIREBASE_CONFIG, "utf8"));
    check(config.projectId === PROJECT, "CONFLICTING_FIREBASE_CONFIG");
    check(!config.databaseURL || config.databaseURL ===
      "https://store-connect-hml.firebaseio.com", "CONFLICTING_FIREBASE_DATABASE");
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credential = JSON.parse(fs.readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
    check(credential.project_id === PROJECT, "CONFLICTING_CREDENTIAL_PROJECT");
  }
}

function normalizedName(name) {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .trim().replace(/\s+/g, " ").toLowerCase();
}

function planSeed(documents) {
  const byId = new Map();
  const byName = new Map();
  for (const doc of documents) {
    validateCategoryId(doc.id);
    check(!byId.has(doc.id), "DUPLICATE_DOCUMENT_ID");
    check(typeof doc.name === "string" && doc.name.trim(), "INVALID_EXISTING_NAME");
    const parent = doc.parentCategoryId === undefined ? null : doc.parentCategoryId;
    if (parent !== null) validateCategoryId(parent, "parentCategoryId");
    const record = {id: doc.id, name: doc.name, parentCategoryId: parent};
    byId.set(doc.id, record);
    const key = normalizedName(doc.name);
    const matches = byName.get(key) || [];
    matches.push(record);
    byName.set(key, matches);
  }
  for (const record of byId.values()) {
    if (record.parentCategoryId === null) continue;
    const parent = byId.get(record.parentCategoryId);
    check(parent && parent.id !== record.id && parent.parentCategoryId === null,
      "INVALID_EXISTING_HIERARCHY");
  }
  const planned = [];
  function resolve(id, name, parentCategoryId) {
    const matches = byName.get(normalizedName(name)) || [];
    const matching = matches.filter((doc) => doc.parentCategoryId === parentCategoryId);
    check(matching.length <= 1, "AMBIGUOUS_EXISTING_CATEGORY");
    // A same-name category elsewhere is a conflict, never silently moved/copied.
    check(matches.length === matching.length, "NAME_HIERARCHY_CONFLICT");
    const found = matching[0];
    check(!byId.has(id) || (found && found.id === id), "DETERMINISTIC_ID_COLLISION");
    const result = {id: found ? found.id : id, name, imageUrl: "",
      parentCategoryId, action: found ? "preserve" : "create"};
    validateCategoryMutationInput({name, imageUrl: "", parentCategoryId});
    planned.push(result);
    return result.id;
  }
  for (const [slug, name, children] of TREE) {
    const rootId = resolve(`f9-hml-${slug}`, name, null);
    for (const [childSlug, childName] of children) {
      resolve(`f9-hml-${slug}-${childSlug}`, childName, rootId);
    }
  }
  check(planned.length === 9, "INVALID_SEED_SIZE");
  return {existingCount: documents.length, categories: planned};
}

function records(snapshot) {
  return snapshot.docs.map((doc) => ({...doc.data(), id: doc.id}));
}

async function applyPlan(db, storeRef, categoriesRef, approvedPlan, timestamp) {
  return db.runTransaction(async (transaction) => {
    // Every read (including the complete collection query) precedes every create.
    const store = await transaction.get(storeRef);
    check(store.exists, "STORE_NOT_FOUND");
    const snapshot = await transaction.get(categoriesRef);
    const current = planSeed(records(snapshot));
    check(JSON.stringify(current) === JSON.stringify(approvedPlan), "PLAN_CHANGED_RERUN_DRY_RUN");
    const creates = current.categories.filter((category) => category.action === "create");
    for (const {id, name, imageUrl, parentCategoryId} of creates) {
      transaction.create(categoriesRef.doc(id), {
        name, imageUrl, parentCategoryId, createdAt: timestamp(),
      });
    }
    return creates.length;
  });
}

function accessToken() {
  // Fixed command, no CLI/user text interpolated into the Windows shell.
  // Token stays in memory; subprocess output/errors are never logged.
  const token = execFileSync(process.platform === "win32" ? "gcloud.cmd" : "gcloud",
    ["auth", "print-access-token"], {encoding: "utf8", timeout: 30000,
      shell: process.platform === "win32", windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]}).trim();
  check(token.length > 0, "AUTH_UNAVAILABLE");
  return token;
}

async function verifyRemoteIdentity(token, fetcher = fetch) {
  async function get(url) {
    const response = await fetcher(url, {headers: {Authorization: `Bearer ${token}`},
      redirect: "error", signal: AbortSignal.timeout(30000)});
    check(response.ok, `IDENTITY_READ_HTTP_${response.status}`);
    return response.json();
  }
  const project = await get(`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}`);
  check(project.projectId === PROJECT && String(project.projectNumber) === NUMBER &&
    project.lifecycleState === "ACTIVE", "REMOTE_PROJECT_MISMATCH");
  const databaseName = `projects/${PROJECT}/databases/${DATABASE}`;
  const database = await get(`https://firestore.googleapis.com/v1/${databaseName}`);
  check(database.name === databaseName && database.type === "FIRESTORE_NATIVE",
    "REMOTE_DATABASE_MISMATCH");
  return {projectId: PROJECT, projectNumber: NUMBER, databaseId: DATABASE};
}

async function readCategoriesRest(token, storeId, fetcher = fetch) {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
  const storePath = `stores/${encodeURIComponent(storeId)}`;
  async function get(url) {
    const response = await fetcher(url, {headers: {Authorization: `Bearer ${token}`},
      redirect: "error", signal: AbortSignal.timeout(30000)});
    check(response.ok, `FIRESTORE_READ_HTTP_${response.status}`);
    return response.json();
  }
  runtimeStage = "store-read";
  await get(`${base}/${storePath}?mask.fieldPaths=name`);
  runtimeStage = "category-read-and-plan";
  const documents = [];
  let pageToken = "";
  do {
    const page = await get(`${base}/${storePath}/categories?pageSize=100` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""));
    for (const doc of page.documents || []) {
      const fields = doc.fields || {};
      const parent = fields.parentCategoryId;
      documents.push({id: doc.name.split("/").pop(), name: fields.name?.stringValue,
        parentCategoryId: !parent || Object.hasOwn(parent, "nullValue") ? null :
          Object.hasOwn(parent, "stringValue") ? parent.stringValue : false});
    }
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return documents;
}

async function loadCompatibleSdkAuth() {
  try {
    // Resolve each dependency from its actual consumer, including nested installs.
    const firestoreRequire = createRequire(req.resolve("@google-cloud/firestore"));
    const gaxRequire = createRequire(firestoreRequire.resolve("google-gax"));
    const versions = {
      firestore: req("@google-cloud/firestore/package.json").version,
      gax: firestoreRequire("google-gax/package.json").version,
      auth: gaxRequire("google-auth-library/package.json").version,
    };
    // Fail closed on dependency drift until the new combination is validated.
    check(versions.firestore === "7.11.6" && versions.gax === "4.6.1" &&
      versions.auth === "9.15.1", "SDK_AUTH_COMPATIBILITY_NOT_VALIDATED");
    const {OAuth2Client, GoogleAuth} = gaxRequire("google-auth-library");
    const probe = new OAuth2Client();
    probe.setCredentials({access_token: "local-compatibility-probe"});
    const headers = await probe.getRequestHeaders("https://firestore.googleapis.com");
    check(Object.hasOwn(headers, "Authorization") &&
      headers.Authorization === "Bearer local-compatibility-probe",
    "SDK_AUTH_HEADERS_INCOMPATIBLE");
    return {OAuth2Client, GoogleAuth, versions};
  } catch (error) {
    if (error instanceof SeedValidationError) throw error;
    throw new SeedValidationError("SDK_AUTH_RESOLUTION_FAILED");
  }
}

async function main(args) {
  const options = parseArgs(args);
  runtimeStage = "environment";
  validateEnvironment(process.env);
  runtimeStage = "sdk-auth-compatibility";
  const {OAuth2Client, GoogleAuth, versions} = await loadCompatibleSdkAuth();
  console.log(JSON.stringify({sdkAuthVersions: versions}));
  runtimeStage = "remote-identity";
  const token = accessToken();
  const identity = await verifyRemoteIdentity(token);
  const documents = await readCategoriesRest(token, options.storeId);
  const plan = planSeed(documents);
  const collectionPath = `stores/${options.storeId}/categories`;
  console.log(JSON.stringify({mode: options.apply ? "apply" : "dry-run", ...identity,
    storeId: options.storeId, storeExists: true, visualSessionStoreConfirmed: false,
    collection: collectionPath, ...plan,
    plannedCreates: plan.categories.filter((category) => category.action === "create").length,
    automaticAudit: false}, null, 2));
  if (!options.apply) {
    console.log("DRY_RUN_COMPLETE: no Firebase writes executed.");
    return;
  }
  runtimeStage = "sdk-initialization";
  const {Firestore, FieldValue} = req("@google-cloud/firestore");
  // The Admin SDK rejects custom token credentials for Firestore. Use its
  // installed Cloud Firestore client with an explicit OAuth client instead.
  // No ADC/CLI project default or credential-derived resource project is used.
  const authClient = new OAuth2Client({quotaProjectId: PROJECT});
  authClient.setCredentials({access_token: token});
  const auth = new GoogleAuth({projectId: PROJECT, authClient});
  const db = new Firestore({projectId: PROJECT, databaseId: DATABASE, auth});
  try {
    const storeRef = db.collection("stores").doc(options.storeId);
    const categoriesRef = storeRef.collection("categories");
    // Recheck remote identity immediately before entering the transaction.
    const refreshedToken = accessToken();
    await verifyRemoteIdentity(refreshedToken);
    authClient.setCredentials({access_token: refreshedToken});
    runtimeStage = "apply-transaction";
    const created = await applyPlan(db, storeRef, categoriesRef, plan,
      () => FieldValue.serverTimestamp());
    console.log(JSON.stringify({created}));
  } finally {
    await db.terminate();
  }
}

async function selfTest() {
  const {test} = require("node:test");
  const args = ["--project-id", PROJECT, "--project-number", NUMBER,
    "--database-id", DATABASE, "--store-id", "test-store"];
  const empty = planSeed([]);
  const seeded = empty.categories.map(({action, ...data}) => data);
  test("empty collection: nine categories, two roots, seven valid children", () => {
    assert.equal(empty.categories.length, 9);
    const roots = empty.categories.filter((x) => x.parentCategoryId === null);
    assert.equal(roots.length, 2);
    for (const child of empty.categories.filter((x) => x.parentCategoryId !== null)) {
      assert.ok(roots.some((root) => root.id === child.parentCategoryId));
      assert.equal(child.imageUrl, "");
    }
  });
  test("repeat seed is a no-op; input is preserved", () => {
    const before = JSON.stringify(seeded);
    assert.ok(planSeed(seeded).categories.every((x) => x.action === "preserve"));
    assert.equal(JSON.stringify(seeded), before);
  });
  test("reuse legacy root ID and link new children to it", () => {
    const result = planSeed([{id: "legacy", name: "Cuidados com a Pele", imageUrl: "keep"}]);
    assert.equal(result.categories[0].action, "preserve");
    assert.equal(result.categories[1].parentCategoryId, "legacy");
  });
  test("partial seed creates only missing categories", () => {
    assert.equal(planSeed(seeded.slice(0, 3)).categories.filter((x) => x.action === "create").length, 6);
  });
  test("normalized duplicate names abort", () => {
    assert.throws(() => planSeed([{id: "a", name: "Higiene Pessoal"},
      {id: "b", name: " HIGIENE   PESSOAL "}]), /AMBIGUOUS/);
  });
  test("deterministic ID collision aborts without overwrite", () => {
    assert.throws(() => planSeed([{id: seeded[0].id, name: "Other"}]), /COLLISION/);
  });
  test("same name at wrong level/parent aborts", () => {
    assert.throws(() => planSeed([{id: "wrong", name: "Cabelos"}]), /CONFLICT/);
    assert.throws(() => planSeed([{id: "r", name: "Other root"},
      {id: "c", name: "Hidratantes", parentCategoryId: "r"}]), /CONFLICT/);
  });
  test("orphans, cycles, self-parent and third level abort", () => {
    for (const docs of [
      [{id: "a", name: "a", parentCategoryId: "missing"}],
      [{id: "a", name: "a", parentCategoryId: "a"}],
      [{id: "a", name: "a", parentCategoryId: "b"}, {id: "b", name: "b", parentCategoryId: "a"}],
      [{id: "a", name: "a"}, {id: "b", name: "b", parentCategoryId: "a"},
        {id: "c", name: "c", parentCategoryId: "b"}],
    ]) assert.throws(() => planSeed(docs), /HIERARCHY/);
  });
  test("invalid stored fields abort; unrelated valid categories are preserved", () => {
    assert.throws(() => planSeed([{id: "a", name: ""}]), /NAME/);
    assert.throws(() => planSeed([{id: "a", name: "a", parentCategoryId: ""}]));
    assert.equal(planSeed([{id: "other", name: "Other"}]).existingCount, 1);
  });
  test("CLI defaults to dry-run; explicit apply supported; bad targets/modes rejected", () => {
    assert.equal(parseArgs(args).apply, false);
    assert.equal(parseArgs([...args, "--apply"]).apply, true);
    for (const bad of [[], [...args, "--apply", "--dry-run"], [...args, "--unknown"],
      args.map((x) => x === PROJECT ? "store-connect-app" : x),
      args.map((x) => x === NUMBER ? "1" : x),
      args.map((x) => x === DATABASE ? "other" : x),
      [...args, "--store-id", "other"]]) assert.throws(() => parseArgs(bad));
  });
  test("conflicting project and emulator/endpoint environments rejected", () => {
    validateEnvironment({GCLOUD_PROJECT: PROJECT});
    for (const env of [{GCLOUD_PROJECT: "store-connect-app"},
      {FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080"}, {FIRESTORE_HOST: "other"},
      {FIREBASE_CONFIG: '{"projectId":"store-connect-app"}'}]) {
      assert.throws(() => validateEnvironment(env));
    }
  });
  test("remote project ID, number, lifecycle and database identity must match", async () => {
    const project = {projectId: PROJECT, projectNumber: NUMBER, lifecycleState: "ACTIVE"};
    const database = {name: `projects/${PROJECT}/databases/${DATABASE}`, type: "FIRESTORE_NATIVE"};
    function reader(p, d) {
      return async (url, options) => {
        assert.equal(options.method, undefined); // fetch default is GET
        assert.ok(url.includes(PROJECT));
        return {ok: true, json: async () => url.includes("cloudresourcemanager") ? p : d};
      };
    }
    await verifyRemoteIdentity("fake-local-token", reader(project, database));
    for (const changed of [{...project, projectId: "store-connect-app"},
      {...project, projectNumber: "1"}, {...project, lifecycleState: "DELETE_REQUESTED"}]) {
      await assert.rejects(verifyRemoteIdentity("fake-local-token", reader(changed, database)));
    }
    await assert.rejects(verifyRemoteIdentity("fake-local-token",
      reader(project, {...database, name: "other"})));
  });
  test("REST dry-run reader uses GET only, checks store and paginates all categories", async () => {
    const urls = [];
    const result = await readCategoriesRest("fake-local-token", "test-store", async (url, options) => {
      urls.push(url);
      assert.equal(options.method, undefined);
      assert.ok(url.startsWith(`https://firestore.googleapis.com/v1/projects/${PROJECT}/`));
      const body = urls.length === 1 ? {} : urls.length === 2 ? {
        documents: [{name: "categories/a", fields: {name: {stringValue: "Other"}}}],
        nextPageToken: "page two",
      } : {documents: []};
      return {ok: true, json: async () => body};
    });
    assert.equal(urls.length, 3);
    assert.ok(urls[2].includes("pageToken=page%20two"));
    assert.deepEqual(result, [{id: "a", name: "Other", parentCategoryId: null}]);
    await assert.rejects(readCategoriesRest("fake-local-token", "missing",
      async () => ({ok: false, status: 404})), /HTTP_404/);
  });
  function fakeTransaction(documents, storeExists = true) {
    const events = [];
    const store = {path: "stores/test-store"};
    const collection = {path: `${store.path}/categories`,
      doc: (id) => ({path: `${store.path}/categories/${id}`})};
    const db = {runTransaction: (callback) => callback({
      get: async (ref) => {
        events.push("read");
        return ref === store ? {exists: storeExists} : {
          docs: documents.map((data) => ({id: data.id, data: () => data})),
        };
      },
      create: (ref, data) => {
        assert.ok(ref.path.startsWith(`${collection.path}/`));
        assert.deepEqual(Object.keys(data).sort(), ["createdAt", "imageUrl", "name", "parentCategoryId"]);
        assert.equal(data.createdAt, "SERVER_TIMESTAMP");
        events.push("create");
      },
    })};
    return {db, store, collection, events};
  }
  test("future transaction reads first, creates only approved category fields", async () => {
    const fake = fakeTransaction([]);
    assert.equal(await applyPlan(fake.db, fake.store, fake.collection, empty,
      () => "SERVER_TIMESTAMP"), 9);
    assert.deepEqual(fake.events, ["read", "read", ...Array(9).fill("create")]);
  });
  test("transaction revalidation rejects changed plan and missing store before writes", async () => {
    for (const fake of [fakeTransaction(seeded), fakeTransaction([], false)]) {
      await assert.rejects(applyPlan(fake.db, fake.store, fake.collection, empty,
        () => "SERVER_TIMESTAMP"));
      assert.ok(!fake.events.includes("create"));
    }
  });
  test("transaction on already seeded collection performs zero creates", async () => {
    const fake = fakeTransaction(seeded);
    assert.equal(await applyPlan(fake.db, fake.store, fake.collection, planSeed(seeded),
      () => "SERVER_TIMESTAMP"), 0);
    assert.deepEqual(fake.events, ["read", "read"]);
  });
}

module.exports = {parseArgs, validateEnvironment, planSeed, applyPlan, loadCompatibleSdkAuth};
if (require.main === module) {
  const args = process.argv.slice(2);
  const operation = args.length === 1 && args[0] === "--self-test" ? selfTest() : main(args);
  operation.catch((error) => {
    // Never print raw SDK, subprocess, credential, environment or HTTP errors.
    const reason = error instanceof SeedValidationError ? error.message : "READ_OR_RUNTIME_FAILURE";
    const detail = typeof error.code === "number" ? `; status=${error.code}` : "";
    const knownCause = /default credentials/i.test(error.message || "") ? "; cause=ADC_UNAVAILABLE" :
      /refresh token/i.test(error.message || "") ? "; cause=TOKEN_REFRESH_UNAVAILABLE" :
      /getUniverseDomain/i.test(error.message || "") ? "; cause=AUTH_INTERFACE_MISMATCH" : "";
    console.error(`SEED_ABORTED: ${reason}; stage=${runtimeStage}${detail}${knownCause}. No secrets logged.`);
    process.exitCode = 1;
  });
}
