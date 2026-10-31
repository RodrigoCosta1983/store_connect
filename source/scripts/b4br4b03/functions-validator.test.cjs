'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { profile, diagnosticUrl, checkDescriptor, createLocalFunctionsValidator } = require('./functions-validator.cjs');
const candidate = () => ({ profile: { ...profile }, functionsOrigin: profile.functions, url: diagnosticUrl });
function opened() {
  const validator = createLocalFunctionsValidator();
  const created = validator.createPlan(candidate());
  assert.equal(created.decision.matches, true);
  assert.ok(created.plan);
  return { validator, plan: created.plan };
}
const blocked = decision => {
  assert.equal(decision.matches, false);
  assert.equal(decision.sdkAdmission, 'BLOCKED');
  assert.equal(decision.runtimeAuthorization, false);
};

test('positive local control validates only descriptors, never authorizes runtime', () => {
  const { validator, plan } = opened();
  const result = validator.verify(plan, candidate());
  assert.equal(result.matches, true);
  assert.equal(result.sdkAdmission, 'BLOCKED');
  assert.equal(result.runtimeAuthorization, false);
  assert.equal(plan.scope, 'LOCAL_PLAN_NOT_FIREBASE_BINDING');
});

test('every divergent profile field, missing field and extra field is refused', () => {
  for (const key of Object.keys(profile)) {
    const value = candidate();
    value.profile[key] = key === 'tenantId' ? 'other-tenant' : 'divergent';
    const created = createLocalFunctionsValidator().createPlan(value);
    blocked(created.decision);
    assert.equal(created.plan, null);
    assert.equal(created.decision.reason, 'PROFILE_MISMATCH');
    delete value.profile[key];
    blocked(checkDescriptor(value));
  }
  const extra = candidate(); extra.profile.appId = 'unreviewed';
  blocked(checkDescriptor(extra)); // not an app identity checker accepting arbitrary new fields
});

test('changed origin is refused even when absolute diagnostic URL is unchanged', () => {
  const { validator, plan } = opened();
  const value = candidate(); value.functionsOrigin = 'http://127.0.0.1:5002';
  assert.equal(validator.verify(plan, value).reason, 'ORIGIN_MISMATCH');
  assert.equal(validator.verify(plan, candidate()).reason, 'STALE_LOCAL_PLAN');
});

test('profile switch permanently retires the observed local plan', () => {
  const { validator, plan } = opened();
  const changed = candidate(); changed.profile.projectId = 'demo-other';
  blocked(validator.verify(plan, changed));
  assert.equal(validator.verify(plan, candidate()).reason, 'STALE_LOCAL_PLAN');
});

test('destination changes, aliases, credentials, query/fragment and commercial paths are refused', () => {
  for (const url of [undefined, null, {}, '', 'diagnosticOnly',
    'http://localhost:4471/diagnosticOnly', 'http://127.0.0.1:4472/diagnosticOnly',
    'https://127.0.0.1:4471/diagnosticOnly', 'http://user@127.0.0.1:4471/diagnosticOnly',
    diagnosticUrl + '?x=1', diagnosticUrl + '#fragment', diagnosticUrl + '/',
    'http://127.0.0.1:4471/a/../diagnosticOnly', 'http://127.0.0.1:4471/%64iagnosticOnly',
    'http://127.0.0.1:5001/demo-store-connect-checkout/us-central1/confirmSaleV2']) {
    const value = candidate(); value.url = url;
    blocked(checkDescriptor(value));
  }
  const { validator, plan } = opened();
  const value = candidate(); value.url = diagnosticUrl + '?x=1';
  assert.equal(validator.verify(plan, value).reason, 'DESTINATION_MISMATCH');
  assert.equal(validator.verify(plan, candidate()).reason, 'STALE_LOCAL_PLAN');
});

test('unknown identity, copied receipt and plan from another fixture are refused', () => {
  const { validator, plan } = opened();
  for (const unknown of [null, undefined, true, 1, 'receipt', {}, { ...plan }, JSON.parse(JSON.stringify(plan))]) {
    const decision = validator.verify(unknown, candidate());
    blocked(decision); assert.equal(decision.reason, 'UNKNOWN_LOCAL_IDENTITY');
  }
  blocked(createLocalFunctionsValidator().verify(plan, candidate()));
});

test('controlled reconfiguration is refused and invalidates only its local plan', () => {
  const { validator, plan } = opened();
  const refusal = validator.rejectReconfiguration(plan);
  blocked(refusal); assert.equal(refusal.reason, 'RECONFIGURATION_PROHIBITED');
  assert.equal(validator.verify(plan, candidate()).reason, 'STALE_LOCAL_PLAN');
  blocked(validator.rejectReconfiguration({}));
});

test('retired plan stays stale; retirement is idempotent and cannot reset it', () => {
  const { validator, plan } = opened();
  blocked(validator.retire(plan)); blocked(validator.retire(plan));
  blocked(validator.verify(plan, candidate()));
  blocked(validator.retire({}));
  assert.equal(validator.reset, undefined);
});

test('incomplete shapes, accessors and unreadable descriptors fail closed', () => {
  for (const invalid of [null, undefined, [], {}, Object.create(null), { ...candidate(), trusted: true }]) blocked(checkDescriptor(invalid));
  let getterCalls = 0;
  const value = candidate();
  Object.defineProperty(value, 'url', { get() { getterCalls++; return diagnosticUrl; } });
  blocked(checkDescriptor(value));
  assert.equal(getterCalls, 0);
  const proxy = new Proxy({}, { getPrototypeOf() { throw new Error('unreadable'); } });
  const refused = checkDescriptor(proxy);
  blocked(refused); assert.equal(refused.reason, 'UNREADABLE_DESCRIPTOR');
});

test('binding/result cannot be mutated to forge a usable authorization', () => {
  const { validator, plan } = opened();
  assert.ok(Object.isFrozen(validator)); assert.ok(Object.isFrozen(plan));
  const result = validator.verify(plan, candidate());
  assert.throws(() => { result.runtimeAuthorization = true; }, TypeError);
  assert.throws(() => { profile.functions = 'http://127.0.0.1:5002'; }, TypeError);
  for (const capability of ['send', 'call', 'capture', 'sdk', 'configure', 'httpsCallable']) assert.equal(validator[capability], undefined);
});

test('unobserved SDK drift cannot be detected or certified by matching descriptors', () => {
  const { validator, plan } = opened();
  // Same input remains the same local contract. No SDK mock or endpoint probe.
  assert.deepEqual(validator.verify(plan, candidate()), validator.verify(plan, candidate()));
  assert.equal(validator.verify(plan, candidate()).runtimeAuthorization, false);
  assert.equal(validator.verify(plan, candidate()).sdkAdmission, 'BLOCKED');
});
