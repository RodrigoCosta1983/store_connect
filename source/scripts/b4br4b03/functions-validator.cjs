'use strict';
// Pure demonstration contract. No SDK, context adapter, transport or authority.
const profile = Object.freeze({ ...require('../b4br3/policy.json').profile });
// R2 diagnostic experiment only; not a Functions/commercial allowlist.
const diagnosticUrl = 'http://127.0.0.1:4471/diagnosticOnly';
const result = (matches, reason) => Object.freeze({ matches, reason,
  scope: 'LOCAL_VALIDATION_ONLY', runtimeAuthorization: false, sdkAdmission: 'BLOCKED' });

function dataRecord(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some(key => !descriptors[key] || !Object.hasOwn(descriptors[key], 'value'))) return null;
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

function checkDescriptor(candidate) {
  try {
    const data = dataRecord(candidate, ['profile', 'functionsOrigin', 'url']);
    if (!data) return result(false, 'INCOMPLETE_OR_UNKNOWN_FIELDS');
    const proposed = dataRecord(data.profile, Object.keys(profile));
    if (!proposed || Object.keys(profile).some(key => !Object.is(proposed[key], profile[key]))) {
      return result(false, 'PROFILE_MISMATCH');
    }
    if (data.functionsOrigin !== profile.functions) return result(false, 'ORIGIN_MISMATCH');
    // Exact raw string check rejects normalized aliases, userinfo, queries,
    // fragments, encoded paths, alternate ports and non-diagnostic operations.
    if (data.url !== diagnosticUrl) return result(false, 'DESTINATION_MISMATCH');
    return result(true, 'LOCAL_DESCRIPTOR_MATCH');
  } catch (_) { return result(false, 'UNREADABLE_DESCRIPTOR'); }
}

function createLocalFunctionsValidator() {
  const plans = new WeakMap();
  const known = plan => plan !== null && typeof plan === 'object' ? plans.get(plan) : undefined;
  return Object.freeze({
    createPlan(candidate) {
      const decision = checkDescriptor(candidate);
      if (!decision.matches) return Object.freeze({ decision, plan: null });
      const plan = Object.freeze({ scope: 'LOCAL_PLAN_NOT_FIREBASE_BINDING' });
      plans.set(plan, { active: true });
      return Object.freeze({ decision, plan });
    },
    verify(plan, candidate) {
      const state = known(plan);
      if (!state) return result(false, 'UNKNOWN_LOCAL_IDENTITY');
      if (!state.active) return result(false, 'STALE_LOCAL_PLAN');
      const decision = checkDescriptor(candidate);
      if (!decision.matches) state.active = false;
      return decision;
    },
    rejectReconfiguration(plan) {
      const state = known(plan);
      if (!state) return result(false, 'UNKNOWN_LOCAL_IDENTITY');
      state.active = false;
      return result(false, 'RECONFIGURATION_PROHIBITED');
    },
    retire(plan) {
      const state = known(plan);
      if (!state) return result(false, 'UNKNOWN_LOCAL_IDENTITY');
      state.active = false;
      return result(false, 'STALE_LOCAL_PLAN');
    },
  });
}

module.exports = { profile, diagnosticUrl, checkDescriptor, createLocalFunctionsValidator };
