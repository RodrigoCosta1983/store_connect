'use strict';
// Synthetic loopback callable protocol only; no backend or Firebase credentials.
const http = require('node:http');
const requests = [];
for (const port of [4471, 4472]) {
  http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    if (req.method === 'GET' && req.url === '/evidence') {
      res.end(JSON.stringify(requests)); return;
    }
    if (req.method !== 'POST' || !req.url.endsWith('/diagnosticOnly') && req.url !== '/lost') {
      res.writeHead(404).end(); return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const credentialsAbsent = !req.headers.authorization && !req.headers['x-firebase-appcheck'];
      const synthetic = body === '{"data":{"probe":true}}';
      requests.push({ port, path: req.url, credentialsAbsent, synthetic });
      if (!credentialsAbsent || !synthetic) { res.writeHead(400).end('{}'); return; }
      if (req.url === '/lost') return; // Received, deliberately no response.
      res.end(JSON.stringify({ data: { port } }));
    });
  }).listen(port, '127.0.0.1', () => console.log(`R2 synthetic responder ${port}`));
}
