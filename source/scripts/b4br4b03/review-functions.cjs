'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { digest } = require('../b4br3/gate.cjs');
const { sourceEvidence, textEvidence } = require('../b4br4b/matrix.cjs');
const notes = require('./functions-review-notes.json');

function review(root) {
  const matrixFile = 'docs/catalog/F9_B07_D_C_C_C_B4_B_R4_B_02_MATRIZ.json';
  const matrixPath = path.join(root, matrixFile);
  if (digest(matrixPath) !== '33af377e23032b6b77ca4a091869a3c09fbae0ee5fadbc8650d444516c39c16f') throw new Error('Matriz histórica divergente');
  const matrix = JSON.parse(fs.readFileSync(matrixPath));
  const inspectionPath = path.join(root, matrix.input.file);
  if (digest(inspectionPath) !== matrix.input.sha256) throw new Error('Coleta 01 divergente');
  const snapshot = JSON.parse(fs.readFileSync(inspectionPath));
  const ids = matrix.priorityByService.find(p => p.service === 'Functions').boundaryIds;
  if (ids.length !== 20 || new Set(ids).size !== 20 || notes.boundaries.length !== 20) throw new Error('Seleção Functions incompleta');
  const rows = ids.map(id => {
    const row = matrix.boundaries.rows.find(row => row.id === id);
    const note = notes.boundaries.find(note => note.id === id);
    if (!row || !note) throw new Error('Fronteira/nota ausente: ' + id);
    const integrity = sourceEvidence(row.original, snapshot.sourceGraph.files, file => fs.readFileSync(file));
    const excerpt = textEvidence(row.original.from, note.anchor);
    const verified = integrity.status === 'CONFERIDO' && excerpt.status === 'LOCALIZADO';
    return { id, original: row.original, category: row.category, integrity, excerpt,
      directedReview: verified ? 'REVISADO NO TRECHO' : 'NÃO DEMONSTRADO',
      finding: note.finding, dependencyClosure: 'PENDENTE', pending: note.pending,
      runtimeIsolation: 'NÃO DEMONSTRADO', admission: 'NOT_ADMITTED' };
  });
  const extra = [
    ['test/checkout_sdk_bundle_web_test.dart', 'externally reconfigured Functions must invalidate binding'],
    ['test/support/checkout_sdk_probe_bundle.dart', 'bool get _coherent'],
    ['test/support/checkout_sdk_probe_context_port.dart', 'CheckoutContextBinding? capture()'],
    ['test/checkout_sdk_explicit_url_r2_web_test.dart', 'Also create the explicit callable AFTER reconfiguration.'],
    ['functions/node_modules/@firebase/functions/dist/esm/index.esm.js', 'function connectFunctionsEmulator$1'],
    ['functions/node_modules/@firebase/functions/dist/esm/index.esm.js', 'function httpsCallableFromURL$1'],
    ['functions/node_modules/@firebase/functions/dist/esm/index.esm.js', 'const headers = await makeAuthHeaders'],
    ['functions/node_modules/@firebase/functions/dist/esm/index.esm.js', '_delete()'],
    ['functions/node_modules/@firebase/functions/dist/esm/index.esm.js', 'response = await fetchImpl(url, {'],
  ].map(([file, anchor]) => textEvidence(path.join(root, file), anchor));
  const functionsFile = path.join(snapshot.packages.find(p => p.name === 'cloud_functions').base, 'lib/src/firebase_functions.dart');
  extra.push(textEvidence(functionsFile, '_cachedInstances ='), textEvidence(functionsFile, '_origin ='));
  const configFile = path.join(root, '.dart_tool/package_config.json');
  const config = JSON.parse(fs.readFileSync(configFile));
  const supplementary = [
    ['flutter_web_plugins', 'src/plugin_registry.dart', 'void registerMessageHandler()',
      'Registrar substitui handler global; não certifica owner Firebase nem congela plataforma.'],
    ['plugin_platform_interface', 'plugin_platform_interface.dart', 'static void verify(PlatformInterface instance, Object token)',
      'Token verifica construção/extends; não atesta destino, perfil ou procedência SDK.'],
  ].map(([name, relative, anchor, finding]) => {
    const descriptor = config.packages.find(p => p.name === name);
    const base = descriptor ? fileURLToPath(new URL(descriptor.packageUri || 'lib/',
      new URL(descriptor.rootUri.replace(/\/?$/, '/'), pathToFileURL(configFile)))) : '';
    return { package: name, evidence: textEvidence(path.join(base, relative), anchor), finding,
      closure: 'PENDENTE; somente trecho delimitado revisado', admission: 'NOT_ADMITTED' };
  });
  return { scope: notes.scope, status: 'BLOQUEADO', admitted: [], provenance: notes.provenance,
    matrix: { file: matrixFile, sha256: digest(matrixPath) }, input: matrix.input,
    toolHashes: ['scripts/b4br4b03/functions-validator.cjs', 'scripts/b4br4b03/functions-review-notes.json', 'scripts/b4br4b03/review-functions.cjs']
      .map(file => ({ file, sha256: digest(path.join(root, file)) })),
    summary: { selected: ids.length, directedReviewed: rows.filter(row => row.directedReview === 'REVISADO NO TRECHO').length,
      pendingClosures: rows.length, runtimeDemonstrated: 0 },
    boundaries: rows, additionalEvidence: extra, supplementary,
    historicalFailure: { result: 'REPROVADO HISTÓRICO R2; NÃO REEXECUTADO', expected: 'null', observed: 'CheckoutContextBinding',
      cause: 'Cache retorna a mesma instância; setter _origin não altera campos observados por _coherent/capture nem a geração Auth',
      explicitUrl: 'Fixa argumento URL da callable, não origem Auth/Firestore, credenciais, redirects ou integridade de runtime' },
    lifecycleLimit: 'No módulo ESM local, callAtURL aguarda headers antes de iniciar postJSON; Promise.race com cancelAllRequests não demonstra ausência de envio após delete durante esse await. Inferência estática, sem ensaio runtime.',
    jsReviewScope: 'ESM local instalado, somente leitura; equivalência completa com bundle servido/distribuído e versão suportada não certificada',
    localProofScope: 'Validador puro de descritores e planos locais; não é CheckoutContextBinding nem prova de SDK',
    compatibility: 'K16 BLOQUEADO; nenhum JS baixado ou alinhado',
    policy: 'R3/R4-A preservados, sem promoção ou nova autorização fabricada' };
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Uso: node scripts/b4br4b03/review-functions.cjs <novo-output.json>');
    const result = review(process.cwd());
    fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: result.status, ...result.summary, output: path.resolve(process.argv[2]) }, null, 2));
    process.exitCode = 1;
  } catch (error) { console.error('BLOQUEADO/INFRAESTRUTURA:', error.message); process.exitCode = 2; }
}
module.exports = { review };
