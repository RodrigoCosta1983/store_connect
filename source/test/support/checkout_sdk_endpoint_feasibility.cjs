'use strict';
// B4-B-R1 diagnostic only. Real installed JS SDK; loopback synthetic responders.
// No operational backend, credentials, Auth, App Check, ledger or sale payload.
const assert = require('node:assert/strict');
const http = require('node:http');
const { initializeApp, deleteApp, getApps } = require('../../functions/node_modules/firebase/app');
const { getFunctions, connectFunctionsEmulator, httpsCallable,
  httpsCallableFromURL } = require('../../functions/node_modules/firebase/functions');

async function main() {
  const requests = [];
  const servers = [];
  let app;
  try {
    for (const port of [4471, 4472]) {
      const server = http.createServer((req, res) => {
        assert.equal(req.method, 'POST');
        assert.equal(req.headers.authorization, undefined);
        assert.equal(req.headers['x-firebase-appcheck'], undefined);
        requests.push({ port, path: req.url });
        req.resume();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: { port } }));
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      servers.push(server);
    }
    app = initializeApp({ projectId: 'demo-store-connect-checkout',
      appId: '1:123:web:diagnostic', apiKey: 'demo-key' }, 'b4br1-endpoint-probe');
    const functions = getFunctions(app, 'us-central1');
    connectFunctionsEmulator(functions, '127.0.0.1', 4471);
    const named = httpsCallable(functions, 'diagnosticOnly');
    const fixed = httpsCallableFromURL(functions, 'http://127.0.0.1:4471/diagnosticOnly');
    assert.equal((await named({ probe: true })).data.port, 4471);
    assert.equal((await fixed({ probe: true })).data.port, 4471);
    const recovered = getFunctions(getApps().find(value => value.name === app.name), 'us-central1');
    assert.equal(recovered, functions);
    connectFunctionsEmulator(recovered, '127.0.0.1', 4472);
    assert.equal((await named({ probe: true })).data.port, 4472);
    assert.equal((await fixed({ probe: true })).data.port, 4471);
    const response = await fetch('http://127.0.0.1:4471/explicit-http', {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ probe: true }),
    });
    assert.equal((await response.json()).data.port, 4471);
    assert.deepEqual(requests.map(value => value.port), [4471, 4471, 4472, 4471, 4471]);
    console.log(JSON.stringify({ result: 'PASS', sdk: require('../../functions/node_modules/firebase/package.json').version,
      samePublicInstance: true, requests, assertions: 'named changes; explicit URL and HTTP remain fixed',
      limits: 'Node JS only; synthetic HTTP; no Auth/App Check/Firestore/Android validation' }));
  } finally {
    if (app) await deleteApp(app);
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
