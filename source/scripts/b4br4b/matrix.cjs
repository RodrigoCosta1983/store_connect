'use strict';
// Consumes R4-B/01 evidence. Never collects AST again or grants admission.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { within, resolve } = require('./inspect.cjs');
const { hash, digest } = require('../b4br3/gate.cjs');
const ownerSpec = require('./owner-review.json');
const slash = s => s.replaceAll('\\', '/');
const key = s => path.resolve(s).toLowerCase();
const documents = {
  R1: 'docs/catalog/F9_B07_D_C_C_C_B4_B_R1_RESULTADO.txt',
  R2: 'docs/catalog/F9_B07_D_C_C_C_B4_B_R2_RESULTADO.txt',
  R3: 'docs/catalog/F9_B07_D_C_C_C_B4_B_R3_RESULTADO.txt',
  R4A: 'docs/catalog/F9_B07_D_C_C_C_B4_B_R4_A_RESULTADO.txt',
  R3README: 'scripts/b4br3/README.md',
};
const authority = {
  R1: 'Diagnóstico histórico, não aprovação normativa',
  R2: 'Contrato revisado PROPOSTO no relatório; não demonstra aprovação normativa independente',
  R3: 'Contrato local dos gates R3; não admite owner R4',
  R4A: 'Relatório validado somente estruturalmente',
  R3README: 'Procedimento local de revisão; não é aprovação de uma dependência',
};
const sectionOf = lines => [...lines].reverse().find(line =>
  /^(?:#{1,4} |\d+\. [A-ZÀ-Ü0-9][A-ZÀ-Ü0-9 /—–_.,()\-]+$)/.test(line)) || 'Sem cabeçalho identificado';

function classify(uri) {
  if (typeof uri !== 'string') return { type: 'INDETERMINADO', package: null, category: 'DADOS_INCOMPLETOS', capability: 'Não inferível', priority: 'P0' };
  const pkg = /^package:([^/]+)\//.exec(uri)?.[1];
  const dart = /^dart:([\w_]+)$/.exec(uri)?.[1];
  const base = { type: dart ? 'API_DART' : pkg ? 'DEPENDÊNCIA_EXTERNA' : 'INDETERMINADO',
    package: pkg || (dart ? 'dart:' + dart : null), category: 'OUTROS',
    capability: 'Capacidade não determinada pelo nome da URI', priority: 'P1' };
  if (/^dart:js_interop(?:_unsafe)?$/.test(uri) || pkg === 'web') return { ...base, category: 'INTEROP', capability: 'Acesso potencial a JS/DOM, módulos e estado global', priority: 'P0' };
  if (pkg === 'flutter_web_plugins' || pkg === 'plugin_platform_interface') return { ...base, category: 'REGISTRO_PLATAFORMA', capability: 'Registro/substituição potencial de implementação global', priority: 'P0' };
  if (uri === 'package:flutter/services.dart') return { ...base, category: 'CANAIS_PLATAFORMA', capability: 'Canais e serviços de plataforma potenciais', priority: 'P0' };
  if (pkg === 'http' || pkg === 'http_parser' || uri === 'dart:io') return { ...base, category: 'REDE_IO', capability: 'Transporte, parsing HTTP ou I/O potencial; import não prova tráfego', priority: 'P0' };
  if (uri === 'dart:async') return { ...base, category: 'ASSINCRONIA', capability: 'Futures/streams e ordenação potencial de sessão', priority: 'P0' };
  if (pkg === 'meta') return { ...base, category: 'ANOTAÇÕES', capability: 'Metadados/anotações; não provam restrição em runtime', priority: 'P2' };
  if (pkg === 'collection' || ['dart:convert', 'dart:core', 'dart:math', 'dart:typed_data'].includes(uri)) return { ...base, category: 'DADOS_UTILITÁRIOS', capability: 'Tipos, coleções, conversão ou dados binários potenciais', priority: 'P2' };
  if (pkg === 'flutter') return { ...base, category: 'FRAMEWORK', capability: 'Estado, callbacks, diagnóstico ou UI potenciais', priority: 'P1' };
  return base;
}

function textEvidence(file, anchor) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const i = lines.findIndex(line => line.includes(anchor));
    if (i < 0) return { file, status: 'NÃO DEMONSTRADO', reason: 'Trecho não localizado' };
    const section = sectionOf(lines.slice(0, i + 1));
    return { file, line: i + 1, section, excerpt: lines[i], sha256: hash(text), status: 'LOCALIZADO',
      authority: 'Evidência local; não é aprovação automática nem nova regra K' };
  } catch (_) { return { file, status: 'NÃO DEMONSTRADO', reason: 'Fonte ausente/ilegível' }; }
}

function sourceEvidence(boundary, records, readFile) {
  if (!boundary || typeof boundary.from !== 'string' || !Number.isInteger(boundary.line) ||
      typeof boundary.uri !== 'string' || typeof boundary.kind !== 'string') {
    return { status: 'NÃO DEMONSTRADO', reason: 'Origem/linha/URI/tipo incompleto' };
  }
  const record = records.find(r => typeof r?.file === 'string' && key(r.file) === key(boundary.from));
  if (!record || !/^[a-f0-9]{64}$/i.test(record.sha256 || '')) return { status: 'NÃO DEMONSTRADO', reason: 'Fonte/hash não consta da coleta' };
  try {
    const bytes = readFile(boundary.from);
    const actual = hash(bytes);
    const directive = record.directives?.find(d => d.line === boundary.line && d.kind === boundary.kind && d.uris?.includes(boundary.uri));
    const excerpt = bytes.toString('utf8').split(/\r?\n/)[boundary.line - 1];
    const valid = actual === record.sha256 && !!directive && typeof excerpt === 'string' && !record.error && record.diagnostics?.length === 0;
    return { status: valid ? 'CONFERIDO' : 'NÃO DEMONSTRADO', expectedSha256: record.sha256,
      actualSha256: actual, astDirectiveMatches: !!directive, excerpt: excerpt ?? null,
      scope: 'Integridade e correspondência AST, não revisão de segurança' };
  } catch (_) { return { status: 'NÃO DEMONSTRADO', reason: 'Fonte ausente/ilegível' }; }
}

function buildBoundaries(snapshot, readFile = file => fs.readFileSync(file)) {
  const errors = [];
  if (!Array.isArray(snapshot?.sourceGraph?.boundaries)) errors.push('Lista de fronteiras ausente');
  if (!Array.isArray(snapshot?.sourceGraph?.files)) errors.push('Lista de fontes ausente');
  const entries = Array.isArray(snapshot?.sourceGraph?.boundaries) ? snapshot.sourceGraph.boundaries : [];
  const files = Array.isArray(snapshot?.sourceGraph?.files) ? snapshot.sourceGraph.files : [];
  const packages = Array.isArray(snapshot?.packages) ? snapshot.packages : [];
  const rows = entries.map((entry, i) => {
    const edge = entry && typeof entry === 'object' ? entry : {};
    const classification = classify(edge.uri);
    const evidence = sourceEvidence(edge, files, readFile);
    const origin = packages.find(p => p && typeof p.lib === 'string' && typeof edge.from === 'string' && within(p.lib, edge.from));
    const originPath = typeof edge.from === 'string' ? slash(edge.from) : '';
    const services = /firebase_auth/.test(originPath) ? ['Auth'] : /cloud_firestore/.test(originPath) ? ['Firestore'] :
      /cloud_functions/.test(originPath) ? ['Functions'] : ['Core/compartilhado'];
    return { id: 'B' + String(i + 1).padStart(3, '0'), sourceIndex: i, ...classification,
      original: edge, originPackage: origin?.name || null, services,
      contextTags: [...(/\/interop\//.test(originPath) ? ['ORIGEM_INTEROP'] : []),
        ...(/method_channel/.test(originPath) ? ['ORIGEM_METHOD_CHANNEL'] : [])],
      evidence, reviewStatus: evidence.status === 'CONFERIDO' ? 'PENDENTE' : 'NÃO DEMONSTRADO',
      runtimeProof: 'NÃO DEMONSTRADO', blocker: 'Closure e efeitos do destino não revisados',
      classificationBasis: 'Regra lexical de triagem; capacidade potencial, não chamada provada',
      admission: 'NOT_ADMITTED' };
  });
  return { errors, rows };
}

function targetPackages(root) {
  const configFile = path.join(root, '.dart_tool/package_config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configFile));
    return config.packages.map(p => ({ name: p.name,
      lib: fs.realpathSync.native(fileURLToPath(new URL(p.packageUri || 'lib/',
        new URL(p.rootUri.replace(/\/?$/, '/'), pathToFileURL(configFile))))) }));
  } catch (_) { return []; } // Missing configuration remains an explicit boundary.
}

function count(rows, field) {
  return rows.reduce((out, row) => { const value = row[field] ?? 'INDETERMINADO'; out[value] = (out[value] || 0) + 1; return out; }, {});
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap(e => {
    if (/node_modules|fixtures-|\.git/.test(e.name)) return [];
    const file = path.join(dir, e.name);
    return e.isDirectory() ? walk(file) : [file];
  });
}

function corpus(root) {
  const docs = walk(path.join(root, 'docs')).filter(f => /\.(md|txt)$/.test(f) && !f.endsWith('R4_B_02_RESULTADO.txt'));
  const scripts = ['b4br3', 'b4br4a'].flatMap(d => walk(path.join(root, 'scripts', d)))
    .filter(f => /README\.md$|(?:policy|review|graph-proposal)\.json$/.test(f));
  scripts.push(path.join(root, 'scripts/b4br4b/README.md'));
  const tests = walk(path.join(root, 'test')).filter(f => /checkout_sdk[^/\\]*\.(dart|cjs)$/.test(f));
  const buildRoot = path.join(root, 'build');
  const build = fs.readdirSync(buildRoot, { withFileTypes: true }).filter(e => e.name.startsWith('b4b') && e.name !== 'b4br4b02')
    .flatMap(e => e.isDirectory() ? walk(path.join(buildRoot, e.name)) : [path.join(buildRoot, e.name)])
    .filter(f => /\.(txt|md|log|json|cjs)$/.test(f) && !/baseline|preservation|inventory|inspection-|status-|gates\.json/.test(path.basename(f)));
  return [...new Set([...docs, ...scripts, ...tests, ...build])].sort();
}

function trace(root, files) {
  const searched = [], references = [], errors = [];
  const pattern = /\bK[ _–-]?(?:14|15)\b|\bK11[–—-]K16\b/;
  for (const file of files) {
    try {
      const bytes = fs.readFileSync(file);
      const text = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8');
      searched.push({ file: slash(path.relative(root, file)), sha256: hash(bytes) });
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) if (pattern.test(lines[i])) references.push({
        file: slash(path.relative(root, file)), line: i + 1,
        section: sectionOf(lines.slice(0, i + 1)),
        excerpt: lines[i], classification: 'REFERÊNCIA INDIRETA; sem definição normativa aprovada localizada' });
    } catch (_) { errors.push({ file, reason: 'Documento ausente/ilegível' }); }
  }
  return { status: 'BLOQUEADO', scope: 'Corpus local explícito; não inclui conversas externas, DOCX/PDF ou todo o disco',
    definitions: ['K14', 'K15'].map(id => ({ id, status: 'NÃO LOCALIZADO', approvedNormativeText: null,
      note: 'Busca textual não certifica inexistência; referências não preenchem a lacuna' })), searched, references, errors };
}

function owner(root, snapshot) {
  return ownerSpec.requirements.map(req => {
    const document = textEvidence(path.join(root, documents[req.document]), req.anchor);
    let source = path.join(root, 'lib/firebase/isolated_checkout', req.source);
    if (req.source.includes('/')) {
      const [name, ...rest] = req.source.split('/');
      const pkg = snapshot.packages?.find(p => p.name === name);
      source = pkg ? path.join(pkg.base, ...rest) : '';
    }
    const implementation = textEvidence(source, req.pattern);
    const fileRecord = snapshot.sourceGraph?.files?.find(f => key(f.file) === key(source));
    const sourceMatchesSnapshot = fileRecord ? implementation.sha256 === fileRecord.sha256 : null;
    return { ...req, documentAuthority: authority[req.document], documentEvidence: document, sourceEvidence: implementation, sourceMatchesSnapshot,
      evidenceReview: document.status === 'LOCALIZADO' && implementation.status === 'LOCALIZADO' && sourceMatchesSnapshot !== false ? 'REVISADO' : 'NÃO DEMONSTRADO',
      evidenceReviewScope: 'Somente localização de trecho e integridade; não é requisito satisfeito ou aprovação de fonte',
      requirementStatus: req.level === 'REAL' ? 'NÃO DEMONSTRADO' : 'PENDENTE',
      structuralEvidence: snapshot.structural?.structural?.status || 'NÃO DEMONSTRADO',
      realIsolation: 'NÃO DEMONSTRADO', admission: 'NOT_ADMITTED' };
  });
}

function generate(root, inputFile) {
  const inputBytes = fs.readFileSync(inputFile);
  const snapshot = JSON.parse(inputBytes);
  const boundaries = buildBoundaries(snapshot);
  const available = targetPackages(root);
  for (const row of boundaries.rows) {
    const resolved = resolve(row.original.from || '', row.original.uri, available);
    row.targetEvidence = resolved.target ? { file: resolved.target, status: 'DISPONÍVEL; NÃO REVISADO',
      scope: 'Existência/canonicalização pelo resolver 01; nenhum código transitivo revisado' } :
      { status: 'NÃO DEMONSTRADO', reason: resolved.boundary };
  }
  const traceability = trace(root, corpus(root));
  const requirements = owner(root, snapshot);
  return { schema: 'F9-R4-B-02/1', status: 'BLOQUEADO', admitted: [],
    input: { file: slash(path.relative(root, inputFile)), sha256: hash(inputBytes) },
    tools: ['scripts/b4br4b/inspect.cjs', 'scripts/b4br4b/matrix.cjs', 'scripts/b4br4b/owner-review.json']
      .map(file => ({ file, sha256: digest(path.join(root, file)) })),
    limits: ['Classificação lexical não é aprovação de segurança', 'Não resolve closure externa nem executa SDK',
      'REVISADO nos requisitos significa revisão de rastreabilidade de evidência, não requisito aprovado'],
    summary: { boundaries: boundaries.rows.length, type: count(boundaries.rows, 'type'),
      category: count(boundaries.rows, 'category'), package: count(boundaries.rows, 'package'),
      priority: count(boundaries.rows, 'priority'), review: count(boundaries.rows, 'reviewStatus'),
      runtime: count(boundaries.rows, 'runtimeProof'), owner: count(requirements, 'requirementStatus') },
    priorityByService: ['Auth', 'Firestore', 'Functions', 'Core/compartilhado'].map(service => ({ service,
      priority: 'P0', boundaryIds: boundaries.rows.filter(row => row.priority === 'P0' && row.services.includes(service)).map(row => row.id),
      scope: 'Triagem de revisão, sem prova de execução ou segurança' })),
    boundaries, traceability, requirements,
    existingGates: { structural: snapshot.structural?.structural?.status ?? 'NÃO DEMONSTRADO',
      admission: snapshot.structural?.admission?.status ?? 'NÃO DEMONSTRADO',
      compatibility: snapshot.compatibility?.status ?? 'NÃO DEMONSTRADO',
      note: 'Resultados recebidos da coleta 01, não nova execução dos gates' },
    historicalFailure: { status: 'REPROVADO HISTÓRICO R2', currentExecution: 'NÃO EXECUTADO',
      test: 'externally reconfigured Functions must invalidate binding', expected: 'null', observed: 'CheckoutContextBinding' } };
}

if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error('Uso: node scripts/b4br4b/matrix.cjs <inspection.json> <novo-output.json>');
    const result = generate(process.cwd(), path.resolve(process.argv[2]));
    fs.writeFileSync(path.resolve(process.argv[3]), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: result.status, ...result.summary, output: path.resolve(process.argv[3]) }, null, 2));
    process.exitCode = 1; // Review matrix is never an admission gate.
  } catch (error) { console.error('BLOQUEADO/INFRAESTRUTURA:', error.message); process.exitCode = 2; }
}
module.exports = { classify, textEvidence, sourceEvidence, buildBoundaries, trace, owner, generate };
