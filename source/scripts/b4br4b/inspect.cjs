'use strict';
// Read-only source evidence. This tool cannot grant SDK/dependency admission.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const r3 = require('../b4br3/gate.cjs');
const r4a = require('../b4br4a/verify.cjs');
const names = ['firebase_core', 'firebase_auth', 'cloud_firestore', 'cloud_functions',
  'firebase_core_platform_interface', 'firebase_auth_platform_interface',
  'cloud_firestore_platform_interface', 'cloud_functions_platform_interface',
  'firebase_core_web', 'firebase_auth_web', 'cloud_firestore_web', 'cloud_functions_web',
  '_flutterfire_internals'];
const roots = ['package:firebase_core/firebase_core.dart',
  'package:firebase_auth/firebase_auth.dart', 'package:cloud_firestore/cloud_firestore.dart',
  'package:cloud_functions/cloud_functions.dart',
  'package:firebase_core_web/firebase_core_web.dart', 'package:firebase_auth_web/firebase_auth_web.dart',
  'package:cloud_firestore_web/cloud_firestore_web.dart', 'package:cloud_functions_web/cloud_functions_web.dart'];

function within(base, file) {
  const rel = path.relative(base, file);
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

function resolve(from, uri, packages) {
  if (typeof uri !== 'string') return { boundary: 'Nonliteral URI' };
  if (uri.startsWith('dart:')) return { boundary: 'Dart SDK capability; not reviewed', uri };
  let target;
  if (uri.startsWith('package:')) {
    const match = /^package:([^/]+)\/(.+)$/.exec(uri);
    const pkg = match && packages.find(p => p.name === match[1]);
    if (!pkg) return { boundary: 'External package outside directed source scope', uri };
    target = path.resolve(pkg.lib, match[2]);
    if (!within(pkg.lib, target)) return { boundary: 'Package path escape', uri };
  } else {
    if (/^[a-z][\w+.-]*:/i.test(uri) || path.isAbsolute(uri)) return { boundary: 'Unknown/absolute URI', uri };
    target = path.resolve(path.dirname(from), uri);
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return { boundary: 'Missing source', uri };
  target = fs.realpathSync.native(target);
  if (!packages.some(p => within(p.lib, target))) return { boundary: 'Source outside canonical directed roots', uri };
  return { target };
}

function graph(entries, packages, records) {
  const byFile = new Map(records.map(r => [path.resolve(r.file).toLowerCase(), r]));
  const queue = entries.map(uri => ({ from: '', uri }));
  const visited = new Set(), files = [], edges = [], boundaries = [];
  while (queue.length) {
    const edge = queue.shift();
    const result = resolve(edge.from, edge.uri, packages);
    edges.push({ ...edge, ...result });
    if (!result.target) { boundaries.push({ ...edge, ...result }); continue; }
    const key = result.target.toLowerCase();
    if (visited.has(key)) continue;
    visited.add(key);
    const record = byFile.get(key);
    if (!record || record.error || record.diagnostics?.length) {
      boundaries.push({ ...edge, boundary: 'Missing AST or parsing diagnostics', target: result.target });
      continue;
    }
    files.push({ ...record, sha256: r3.digest(result.target), admission: 'NOT_ADMITTED' });
    for (const directive of record.directives || []) {
      for (const uri of directive.uris) queue.push({ from: result.target, uri,
        line: directive.line, kind: directive.kind });
    }
  }
  return { status: 'INDETERMINADO/BLOCKED', admitted: [], files, edges, boundaries,
    scope: 'Directed Dart source closure, including all conditional branches; not runtime/tree-shaken artifact or JS closure' };
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? walk(path.join(dir, e.name)) : e.name.endsWith('.dart') ? [path.join(dir, e.name)] : []);
}

function inspect(root) {
  const configFile = path.join(root, '.dart_tool/package_config.json');
  const config = JSON.parse(fs.readFileSync(configFile));
  const packages = names.map(name => {
    const p = config.packages.find(p => p.name === name);
    if (!p) throw new Error('Missing resolved package: ' + name);
    const base = fs.realpathSync.native(fileURLToPath(new URL(p.rootUri.replace(/\/?$/, '/'), pathToFileURL(configFile))));
    const spec = path.join(base, 'pubspec.yaml');
    return { name, base, lib: fs.realpathSync.native(path.join(base, p.packageUri || 'lib/')),
      version: fs.readFileSync(spec, 'utf8').match(/^version:\s*(\S+)/m)?.[1],
      pubspecSha256: r3.digest(spec), admission: 'NOT_ADMITTED' };
  });
  const records = r3.scan(root, packages.flatMap(p => walk(p.lib)));
  const sourceGraph = graph(roots, packages, records);
  // Text locators assist manual review; they are not invocation/flow proof.
  const pattern = /registerWith|useAuthEmulator|useFirestoreEmulator|useFunctionsEmulator|connect\w+Emulator|httpsCallableFrom|_cachedInstances|_origin|supportedFirebaseJsSdkVersion|flutterfire_web_sdk_version/;
  const locators = sourceGraph.files.flatMap(record => fs.readFileSync(record.file, 'utf8').split(/\r?\n/)
    .flatMap((text, i) => pattern.test(text) ? [{ file: record.file, line: i + 1, text: text.trim(),
      evidence: 'Text locator only; manual source review required' }] : []));
  const proposal = require('../b4br4a/graph-proposal.json');
  const structural = r4a.evaluate(root, proposal, r4a.scan(root, proposal.files.map(p => p.file)));
  const currentPolicy = r3.gate(root, require('../b4br3/policy.json'),
    require('../b4br3/review.json'), []); // Empty approved roots: NO_HARNESS, no source admission.
  const compatibility = r3.compatibility(root);
  const generated = ['.flutter-plugins-dependencies', '.dart_tool/flutter_build/dart_plugin_registrant.dart'];
  const generatedEvidence = generated.map(file => ({ file, present: fs.existsSync(path.join(root, file)),
    sha256: fs.existsSync(path.join(root, file)) ? r3.digest(path.join(root, file)) : null,
    admission: 'NOT_ADMITTED; operational registration is not isolated harness registration' }));
  return { status: 'BLOCKED', admitted: [], packages, roots, sourceGraph, locators,
    structural, currentPolicy, compatibility, generatedEvidence,
    runtime: 'NOT_EXECUTED; no SDK loaded, emulator started, or network access',
    unresolved: ['Owner roles/policy review', 'SDK app name/exclusivity/lifecycle',
      'External Dart SDK/Flutter/package boundaries', 'Plugin registration and distributed artifact',
      'JS modules/transitive imports and K16 alignment', 'Auth/Firestore/Functions runtime isolation'] };
}

if (require.main === module) {
  try {
    const result = inspect(process.cwd());
    const dir = path.resolve('build/b4br4b');
    fs.mkdirSync(dir, { recursive: true });
    // Preserve earlier runs, including evidence from failed attempts.
    const output = path.join(dir, 'inspection-' + Date.now() + '.json');
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: result.status, packages: result.packages.length,
      files: result.sourceGraph.files.length, edges: result.sourceGraph.edges.length,
      boundaries: result.sourceGraph.boundaries.length, structural: result.structural.structural.status,
      compatibility: result.compatibility.status, output }, null, 2));
    process.exitCode = 1;
  } catch (error) { console.error('INDETERMINADO/BLOCKED:', error.message); process.exitCode = 2; }
}
module.exports = { resolve, graph, inspect, within };
