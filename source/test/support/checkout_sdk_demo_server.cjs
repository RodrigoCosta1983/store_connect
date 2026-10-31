'use strict';
// Local fixture seeding and cached JS assets only. Never load operational backend.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const projectId = 'demo-store-connect-checkout';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = projectId;
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId });
const assets = path.resolve(__dirname, '../../functions/node_modules/firebase');
let sequence = 0;
const fixtureRun = Date.now().toString(36);
http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    if (req.url === '/health/functions') {
      const probe = await fetch('http://127.0.0.1:5001/', { redirect: 'error' });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ port: 5001, status: probe.status }));
      return;
    }
    if (req.url.startsWith('/seed/')) {
      const mode = req.url.slice(6);
      const uid = `sdk-fixture-${fixtureRun}-${++sequence}`;
      const email = `${uid}@demo.invalid`;
      const password = 'synthetic-fixture-password';
      await admin.auth().createUser({ uid, email, password });
      if (mode !== 'missing') {
        await admin.firestore().doc(`users/${uid}`).set({
          storeId: 'fixture-shop', role: mode === 'invalid' ? '' : 'operador',
          accessStatus: mode === 'revoked' ? 'revoked' : 'active',
        });
        await admin.firestore().doc('stores/fixture-shop').set({ ownerId: uid });
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ uid, email, password }));
      return;
    }
    const file = req.url.slice(1);
    if (!['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js',
      'firebase-firestore-pipelines.js', 'firebase-functions.js'].includes(file)) {
      res.writeHead(404).end(); return;
    }
    const source = fs.readFileSync(path.join(assets, file), 'utf8').replaceAll(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js',
      'http://127.0.0.1:4460/firebase-app.js');
    res.setHeader('Content-Type', 'application/javascript');
    res.end(source);
  } catch (error) {
    console.error('Local fixture error code:', error.code || 'unknown');
    res.writeHead(500).end('Local fixture failure');
  }
}).listen(4460, '127.0.0.1', () => console.log('Demo fixtures/assets on loopback 4460.'));
