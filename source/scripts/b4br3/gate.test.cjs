'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scan, gate, digest, hash, compatibility, compareInventory } = require('./gate.cjs');
const root = path.resolve(__dirname, '../..');
const fixtures = require('./fixtures.json');
const basePolicy = require('./policy.json');
// All test artifacts are synthetic and remain under ignored build. No SDK run.
const dir = fs.mkdtempSync(path.join(root, 'build/b4br3/fixtures-'));
const scenarios = [{ name: 'positive reviewed owner and restricted port' },
  { name: 'positive textual comment is not an AST call', comment: true }, ...fixtures.negative];
const cases = scenarios.map((scenario, index) => {
  const location = path.join(dir, String(index));
  fs.mkdirSync(location);
  const files = {
    'owner.dart': fixtures.owner,
    'port.dart': fixtures.port,
    'consumer.dart': fixtures.consumer,
  };
  if (scenario.comment) files['consumer.dart'] += '// Firebase.initializeApp();\n';
  // Initial pins are for the reviewed fixture, BEFORE introducing mutations.
  for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(location, name), source);
  const policy = structuredClone(basePolicy);
  policy.roots = ['owner.dart', 'consumer.dart'];
  policy.forbidden = ['legacy.dart'];
  policy.files = Object.fromEntries(Object.keys(files).map(file => [file, {
    sha256: digest(path.join(location, file)), role: file.startsWith('owner') ? 'owner' : file.startsWith('port') ? 'port' : 'consumer',
    review: { noPostAdmissionConfiguration: true, restrictedPorts: true, sameApp: true, fixedProfile: true },
  }]));
  if (scenario.source) {
    files['consumer.dart'] = scenario.source + '\n';
    // Review consumer hash so ownership/graph, rather than only source pin,
    // must reject the prohibited surface/import.
    policy.files['consumer.dart'].sha256 = hash(files['consumer.dart']);
  }
  if (scenario.ownerAppend) files['owner.dart'] += scenario.ownerAppend + '\n';
  if (scenario.legacy) files['legacy.dart'] = 'class Firebase { static void initializeApp() {} }\n';
  if (scenario.bridge) files['bridge.dart'] = "export 'legacy.dart';\n";
  if (scenario.extra) files[scenario.extra] = 'const harmless = 1;\n';
  if (scenario.profile) Object.assign(policy.profile, scenario.profile);
  if (scenario.missingReview) delete policy.files['owner.dart'].review;
  const approval = { decision: 'K11-K16/R3', policySha256: hash(JSON.stringify(policy)) };
  if (scenario.tamper) policy.revision = 'not-authorized';
  for (const [file, source] of Object.entries(files)) fs.writeFileSync(path.join(location, file), source);
  return { scenario, location, policy, approval, paths: Object.keys(files).map(f => path.join(location, f)) };
});
const parsed = scan(root, cases.flatMap(c => c.paths));
for (const c of cases) {
  test(c.scenario.name, () => {
    const records = parsed.filter(p => c.paths.includes(p.file));
    const result = gate(c.location, c.policy, c.approval, records);
    if (!c.scenario.code) {
      assert.equal(result.status, 'PASS', JSON.stringify(result.reasons));
    } else {
      assert.equal(result.status, 'BLOCKED');
      assert.ok(result.reasons.some(r => r.code === c.scenario.code), JSON.stringify(result.reasons));
    }
  });
}
test('actual R3 policy cannot admit a nonexistent harness', () => {
  const result = gate(root, basePolicy, require('./review.json'), []);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.some(r => r.code === 'NO_HARNESS'));
});
test('local compatibility reports actual supported and installed divergence', () => {
  const result = compatibility(root);
  assert.equal(result.supported, '12.15.0');
  assert.equal(result.installed, '12.19.0');
  assert.equal(result.observedHistorical, '12.19.0');
  assert.equal(result.status, 'BLOCKED');
});
test('inventory refuses new or changed occurrence and parser diagnostics', () => {
  const old = [{ file: 'synthetic.dart', diagnostics: [], occurrences: [] }];
  assert.equal(compareInventory(old, old).status, 'PASS');
  assert.equal(compareInventory(old, [...old, { file: 'new.dart', diagnostics: [] }]).status, 'BLOCKED');
  assert.equal(compareInventory(old, [{ ...old[0], occurrences: [{ operation: 'Firebase' }] }]).status, 'BLOCKED');
  const bad = [{ file: 'bad.dart', diagnostics: ['syntax'] }];
  assert.equal(compareInventory(bad, bad).status, 'BLOCKED');
});
test('owner role cannot exempt syntactically recognized defaults or another app', () => {
  const c = cases[0];
  for (const operation of ['prohibited-default', 'unproven-app-argument']) {
    const records = parsed.filter(p => c.paths.includes(p.file)).map(r => ({ ...r,
      occurrences: r.file.endsWith('owner.dart') ? [...r.occurrences, { operation, line: 1 }] : r.occurrences,
    }));
    const result = gate(c.location, c.policy, c.approval, records);
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.reasons.some(r => r.code === (operation === 'prohibited-default' ? 'DEFAULT' : 'APP_ARGUMENT')));
  }
});
