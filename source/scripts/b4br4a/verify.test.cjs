'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluate, scan } = require('./verify.cjs');
const proposal = require('./graph-proposal.json');
const root = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(root, 'build/b4br4a/gate-fixtures-'));
const owner = proposal.roots[0];
const prefix = 'lib/firebase/isolated_checkout/';
const cases = [
  { name: 'real inert graph passes structural checks but remains unapproved' },
  { name: 'direct legacy import blocked', prepend: "import '../../services/sale_mutation_api.dart';\n", legacy: true, code: 'LEGACY_REACHABLE' },
  { name: 'indirect legacy export blocked', prepend: "import 'bridge.dart';\n", bridge: true, legacy: true, code: 'LEGACY_REACHABLE' },
  { name: 'unexpected harmless transitive source blocked', prepend: "import 'new.dart';\n", extra: true, code: 'UNCLASSIFIED' },
  { name: 'unclassified package remains indeterminate and blocked', prepend: "import 'package:unknown/module.dart';\n", code: 'UNKNOWN' },
  { name: 'default app rejected even inside proposed owner', append: '\nObject bad() => Firebase.app();\n', code: 'DEFAULT' },
  { name: 'app not authorized rejected', append: '\nObject bad() => FirebaseAuth.instanceFor(app: external);\n', code: 'APP_ARGUMENT' },
  { name: 'new configuration after hypothetical admission blocked by frozen graph', append: "\nvoid afterAdmission(dynamic f) { f.useFunctionsEmulator('127.0.0.1', 5002); }\n", surface: 'useFunctionsEmulator' },
  { name: 'consumer setter rejected', portAppend: '\nvoid useAuthEmulator(String host, int port) {}\n', surface: 'useAuthEmulator' },
  { name: 'commercial callable surface rejected', append: "\nvoid bad(dynamic f) { f.httpsCallable('confirmSaleV2'); }\n", code: 'CALLABLE_NAME' },
  { name: 'writer import rejected', prepend: "import '../../widgets/payment_options_sheet.dart';\n", writer: true, code: 'LEGACY_REACHABLE' },
];
const scenarios = cases.map((scenario, index) => {
  const location = path.join(dir, String(index));
  const contents = Object.fromEntries(proposal.files.map(f => [f.file, fs.readFileSync(path.join(root, f.file), 'utf8')]));
  if (scenario.prepend) contents[owner] = scenario.prepend + contents[owner];
  if (scenario.append) contents[owner] += scenario.append;
  if (scenario.portAppend) contents[prefix + 'structure_port.dart'] += scenario.portAppend;
  if (scenario.legacy) contents['lib/services/sale_mutation_api.dart'] = '// SYNTHETIC stub, never imported/executed by Node.\n';
  if (scenario.bridge) contents[prefix + 'bridge.dart'] = "export '../../services/sale_mutation_api.dart';\n";
  if (scenario.extra) contents[prefix + 'new.dart'] = 'const value = 1;\n';
  if (scenario.writer) contents['lib/widgets/payment_options_sheet.dart'] = '// SYNTHETIC stub; no operational source copied.\n';
  const paths = [];
  for (const [file, source] of Object.entries(contents)) {
    const target = path.join(location, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
    paths.push(target);
  }
  return { scenario, location, paths };
});
const records = scan(root, scenarios.flatMap(s => s.paths));
for (const s of scenarios) {
  test(s.scenario.name, () => {
    const result = evaluate(s.location, proposal, records.filter(r => s.paths.includes(r.file)));
    assert.equal(result.admission.status, 'BLOCKED');
    assert.ok(result.admission.reasons.some(r => r.code === 'POLICY_REVIEW'));
    if (!s.scenario.prepend && !s.scenario.append && !s.scenario.portAppend) {
      assert.equal(result.structural.status, 'PASS');
      assert.equal(result.structural.files.length, 3);
      assert.equal(result.structural.edges.length, 2);
      assert.deepEqual(result.structural.dangerous, []);
    } else {
      assert.equal(result.structural.status, 'BLOCKED');
      assert.ok(result.structural.changes.length > 0);
      if (s.scenario.code) assert.ok(result.admission.reasons.some(r => r.code === s.scenario.code));
      if (s.scenario.surface) assert.ok(result.structural.sdkSurface.some(r => r.operation === s.scenario.surface));
    }
  });
}
test('proposal cannot grant post-admission configuration or certify SDK dependencies', () => {
  assert.match(proposal.rules.postAdmissionConfiguration, /^PROHIBITED/);
  assert.ok(proposal.files.every(f => f.admission === 'NOT_APPROVED' && !f.review));
  assert.ok(proposal.futureDependencies.every(d => /BLOCKED|NOT_ADMITTED/.test(d.status)));
  assert.deepEqual(require('../b4br3/policy.json').roots, []);
});
