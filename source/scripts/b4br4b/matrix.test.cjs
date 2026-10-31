'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { hash } = require('../b4br3/gate.cjs');
const { classify, sourceEvidence, buildBoundaries, trace, textEvidence, generate } = require('./matrix.cjs');
fs.mkdirSync('build/b4br4b02', { recursive: true });

function fixture() {
  const dir = fs.mkdtempSync(path.resolve('build/b4br4b02/matrix-fixtures-'));
  const file = path.join(dir, 'source.dart');
  const bytes = Buffer.from("import 'dart:async';\n");
  fs.writeFileSync(file, bytes);
  const edge = { from: file, uri: 'dart:async', line: 1, kind: 'ImportDirectiveImpl', boundary: 'Dart SDK capability; not reviewed' };
  const record = { file, sha256: hash(bytes), diagnostics: [], directives: [{ kind: edge.kind, line: 1, uris: [edge.uri] }] };
  return { dir, file, bytes, edge, record, snapshot: { packages: [{ name: 'fixture', lib: dir }], sourceGraph: { files: [record], boundaries: [edge] } } };
}

test('classifies potential capabilities without claiming invocation or approval', () => {
  for (const [uri, category] of [
    ['dart:js_interop', 'INTEROP'], ['dart:js_interop_unsafe', 'INTEROP'], ['package:web/web.dart', 'INTEROP'],
    ['package:flutter_web_plugins/flutter_web_plugins.dart', 'REGISTRO_PLATAFORMA'],
    ['package:plugin_platform_interface/plugin_platform_interface.dart', 'REGISTRO_PLATAFORMA'],
    ['package:flutter/services.dart', 'CANAIS_PLATAFORMA'], ['package:http/http.dart', 'REDE_IO'],
    ['package:http_parser/http_parser.dart', 'REDE_IO'], ['dart:io', 'REDE_IO'], ['dart:async', 'ASSINCRONIA'],
    ['package:flutter/foundation.dart', 'FRAMEWORK'], ['package:meta/meta.dart', 'ANOTAÇÕES'],
    ['dart:convert', 'DADOS_UTILITÁRIOS'], ['package:collection/collection.dart', 'DADOS_UTILITÁRIOS'],
  ]) assert.equal(classify(uri).category, category);
  assert.equal(classify('package:unknown/x.dart').category, 'OUTROS');
  assert.equal(classify(null).category, 'DADOS_INCOMPLETOS');
});

test('preserves every duplicate boundary, original edge, index and pending review', () => {
  const f = fixture();
  f.snapshot.sourceGraph.boundaries.push({ ...f.edge });
  const result = buildBoundaries(f.snapshot);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows.map(r => r.id), ['B001', 'B002']);
  for (const row of result.rows) {
    assert.deepEqual(row.original, f.edge);
    assert.equal(row.evidence.status, 'CONFERIDO');
    assert.equal(row.reviewStatus, 'PENDENTE');
    assert.equal(row.runtimeProof, 'NÃO DEMONSTRADO');
    assert.equal(row.admission, 'NOT_ADMITTED');
  }
});

test('missing source never becomes reviewed or a successful proof', () => {
  const f = fixture();
  const result = buildBoundaries(f.snapshot, () => { throw new Error('ENOENT'); });
  assert.equal(result.rows[0].reviewStatus, 'NÃO DEMONSTRADO');
  assert.equal(result.rows[0].evidence.reason, 'Fonte ausente/ilegível');
  const missing = path.join(f.dir, 'not-present.dart');
  f.edge.from = missing;
  f.record.file = missing;
  const absent = buildBoundaries(f.snapshot);
  assert.equal(absent.rows[0].evidence.reason, 'Fonte ausente/ilegível');
  assert.equal(absent.rows[0].reviewStatus, 'NÃO DEMONSTRADO');
});

test('changed bytes, incomplete AST and missing hash are not evidence approval', () => {
  const f = fixture();
  assert.equal(sourceEvidence(f.edge, [f.record], () => Buffer.from('changed')).status, 'NÃO DEMONSTRADO');
  assert.equal(sourceEvidence(f.edge, [{ ...f.record, directives: [] }], () => f.bytes).status, 'NÃO DEMONSTRADO');
  assert.equal(sourceEvidence(f.edge, [{ ...f.record, sha256: null }], () => f.bytes).status, 'NÃO DEMONSTRADO');
  assert.equal(sourceEvidence(f.edge, [{ ...f.record, diagnostics: [{ code: 'error' }] }], () => f.bytes).status, 'NÃO DEMONSTRADO');
});

test('incomplete rows stay present and malformed arrays produce explicit errors', () => {
  const snapshot = { sourceGraph: { boundaries: [null, {}, { uri: 'dart:async' }] } };
  const result = buildBoundaries(snapshot);
  assert.equal(result.rows.length, 3);
  assert.ok(result.errors.includes('Lista de fontes ausente'));
  assert.ok(result.rows.every(r => r.reviewStatus === 'NÃO DEMONSTRADO'));
  for (const data of [null, {}, { sourceGraph: { boundaries: {}, files: {} } }]) {
    const missing = buildBoundaries(data);
    assert.equal(missing.rows.length, 0);
    assert.equal(missing.errors.length, 2);
  }
});

test('a reference or range never creates an approved K14/K15 definition', () => {
  const f = fixture();
  const doc = path.join(f.dir, 'contract.txt');
  fs.writeFileSync(doc, '2. SEÇÃO LOCAL\nReferência K14/K15, sem definição.\nK11-K16/R3\n');
  const result = trace(f.dir, [doc, path.join(f.dir, 'missing.txt')]);
  assert.equal(result.references.length, 2);
  assert.equal(result.references[0].section, '2. SEÇÃO LOCAL');
  assert.equal(result.references[0].line, 2);
  assert.equal(result.errors.length, 1);
  assert.ok(result.definitions.every(d => d.status === 'NÃO LOCALIZADO' && d.approvedNormativeText === null));
});

test('evidence quotes identify section/line; missing anchors or documents remain explicit', () => {
  const f = fixture();
  assert.equal(textEvidence(f.file, 'not found').status, 'NÃO DEMONSTRADO');
  assert.equal(textEvidence(path.join(f.dir, 'missing'), 'anything').status, 'NÃO DEMONSTRADO');
  const found = textEvidence(f.file, 'dart:async');
  assert.equal(found.line, 1);
  assert.equal(found.sha256, hash(f.bytes));
});

test('real previous collection yields exactly 197 pending rows and deterministic output', () => {
  const input = path.resolve('build/b4br4b/inspection-1792358982334.json');
  const first = generate(process.cwd(), input);
  const second = generate(process.cwd(), input);
  assert.deepEqual(second, first);
  assert.equal(first.status, 'BLOQUEADO');
  assert.deepEqual(first.admitted, []);
  assert.equal(first.summary.boundaries, 197);
  assert.equal(first.summary.type.DEPENDÊNCIA_EXTERNA, 108);
  assert.equal(first.summary.type.API_DART, 89);
  assert.deepEqual(first.summary.review, { PENDENTE: 197 });
  assert.equal(first.requirements.length, 12);
  assert.ok(first.requirements.every(r => r.evidenceReview === 'REVISADO'));
  assert.ok(first.boundaries.rows.every(r => r.targetEvidence && r.originPackage));
  assert.equal(first.historicalFailure.status, 'REPROVADO HISTÓRICO R2');
});

test('CLI blocks admission and refuses to overwrite existing evidence', () => {
  const f = fixture();
  const output = path.join(f.dir, 'output.json');
  const args = ['scripts/b4br4b/matrix.cjs', 'build/b4br4b/inspection-1792358982334.json', output];
  const first = cp.spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(first.status, 1, first.stderr);
  const before = fs.readFileSync(output);
  const second = cp.spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(second.status, 2);
  assert.match(second.stderr, /EEXIST/);
  assert.deepEqual(fs.readFileSync(output), before);
});
