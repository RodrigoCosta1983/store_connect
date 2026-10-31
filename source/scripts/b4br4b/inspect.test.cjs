'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { graph, resolve } = require('./inspect.cjs');
fs.mkdirSync(path.resolve('build/b4br4b'), { recursive: true });

test('directed source collector preserves boundaries, conditional branches and non-admission', () => {
  const dir = fs.mkdtempSync(path.resolve('build/b4br4b/source-fixtures-'));
  const lib = fs.realpathSync.native(dir);
  const packages = [{ name: 'fixture', lib }];
  for (const name of ['root.dart', 'a.dart', 'b.dart', 'bad.dart']) fs.writeFileSync(path.join(lib, name), '// inert fixture\n');
  const file = name => path.join(lib, name);
  const record = (name, uris, diagnostics = []) => ({ file: file(name), diagnostics,
    directives: [{ kind: 'ImportDirectiveImpl', line: 1, uris }] });
  const records = [record('root.dart', ['a.dart', 'b.dart', 'bad.dart', 'missing.dart',
    'package:flutter/foundation.dart', 'dart:js_interop']),
  record('a.dart', ['root.dart']), record('b.dart', []), record('bad.dart', [], [{ code: 'syntax' }])];
  const result = graph(['package:fixture/root.dart'], packages, records);
  assert.equal(result.status, 'INDETERMINADO/BLOCKED');
  assert.deepEqual(result.admitted, []);
  assert.equal(result.files.length, 3); // both conditional alternatives; cycle terminates
  assert.ok(result.files.every(f => f.sha256 && f.admission === 'NOT_ADMITTED'));
  assert.ok(result.boundaries.some(b => b.boundary.includes('parsing')));
  assert.ok(result.boundaries.some(b => b.boundary === 'Missing source'));
  assert.ok(result.boundaries.some(b => b.uri === 'package:flutter/foundation.dart'));
  assert.ok(result.boundaries.some(b => b.uri === 'dart:js_interop'));
  assert.ok(resolve(file('root.dart'), 'package:fixture/../escape.dart', packages).boundary);
  assert.ok(resolve(file('root.dart'), 'https://example.invalid/sdk.dart', packages).boundary);
  assert.ok(resolve(file('root.dart'), null, packages).boundary);
  const absentAst = graph(['package:fixture/root.dart'], packages, []);
  assert.equal(absentAst.files.length, 0);
  assert.equal(absentAst.boundaries.length, 1);
});

test('a closed, parseable source graph still cannot admit an SDK', () => {
  const dir = fs.mkdtempSync(path.resolve('build/b4br4b/closed-fixtures-'));
  const file = path.join(fs.realpathSync.native(dir), 'root.dart');
  fs.writeFileSync(file, '// no SDK execution\n');
  const result = graph(['package:fixture/root.dart'], [{ name: 'fixture', lib: path.dirname(file) }],
    [{ file, diagnostics: [], directives: [] }]);
  assert.equal(result.files.length, 1);
  assert.equal(result.boundaries.length, 0);
  assert.equal(result.status, 'INDETERMINADO/BLOCKED');
  assert.deepEqual(result.admitted, []);
});
