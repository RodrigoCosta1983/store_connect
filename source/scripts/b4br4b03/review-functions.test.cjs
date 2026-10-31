'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { review } = require('./review-functions.cjs');

test('review consumes exactly the 20 original Functions P0 identities and hashes', () => {
  const result = review(process.cwd());
  assert.equal(result.summary.selected, 20);
  assert.equal(result.summary.directedReviewed, 20);
  assert.equal(result.summary.pendingClosures, 20);
  assert.equal(result.summary.runtimeDemonstrated, 0);
  assert.equal(new Set(result.boundaries.map(row => row.id)).size, 20);
  assert.ok(result.boundaries.every(row => row.integrity.status === 'CONFERIDO' && row.excerpt.status === 'LOCALIZADO'));
  assert.ok(result.additionalEvidence.every(item => item.status === 'LOCALIZADO'));
  assert.ok(result.supplementary.every(item => item.evidence.status === 'LOCALIZADO'));
  assert.deepEqual(result.admitted, []);
  assert.equal(result.status, 'BLOQUEADO');
  assert.equal(result.provenance.originalTranscriptAvailable, false);
  assert.equal(result.provenance.policyChanged, false);
  assert.match(result.historicalFailure.result, /REPROVADO/);
  assert.deepEqual(review(process.cwd()), result);
});

test('export refuses overwrite and never returns a successful SDK admission', () => {
  fs.mkdirSync('build/b4br4b03', { recursive: true });
  const dir = fs.mkdtempSync(path.resolve('build/b4br4b03/review-fixtures-'));
  const output = path.join(dir, 'functions.json');
  const args = ['scripts/b4br4b03/review-functions.cjs', output];
  const first = cp.spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(first.status, 1, first.stderr);
  const bytes = fs.readFileSync(output);
  const second = cp.spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(second.status, 2);
  assert.match(second.stderr, /EEXIST/);
  assert.deepEqual(fs.readFileSync(output), bytes);
});
