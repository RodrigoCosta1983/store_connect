'use strict';
// Directed known cache inspection only. No network/npm command or secret files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const candidates = ['functions/node_modules/firebase', 'build/b4b-harness/functions/node_modules/firebase'];
const packageAssets = candidates.map(relative => {
  const spec = path.join(root, relative, 'package.json');
  if (!fs.existsSync(spec)) return { location: relative, available: false };
  const version = JSON.parse(fs.readFileSync(spec)).version;
  const file = path.join(root, relative, 'firebase-app.js');
  const requiredAssets = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js', 'firebase-functions.js'];
  const completeTargetSet = version === '12.15.0' && requiredAssets.every(asset => {
    const candidate = path.join(root, relative, asset);
    return fs.existsSync(candidate) && fs.readFileSync(candidate, 'utf8').includes('12.15.0');
  });
  return { location: relative, canonical: fs.realpathSync.native(path.dirname(spec)), version,
    completeTargetSet,
    appAssetPresent: fs.existsSync(file),
    sha256: fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null };
});
const index = path.join(process.env.LOCALAPPDATA || '', 'npm-cache/_cacache/index-v5');
const foundKeys = [], errors = [];
function inspect(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) inspect(file);
    else if (entry.isFile()) {
      try {
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
          const start = line.indexOf('\t');
          if (start < 0) continue;
          let record;
          try { record = JSON.parse(line.slice(start + 1)); } catch { continue; }
          // Only exact public SDK asset/tarball keys; never output cache values.
          if (typeof record.key === 'string' &&
              /(?:registry\.npmjs\.org\/firebase\/-\/firebase-12\.15\.0\.tgz|www\.gstatic\.com\/firebasejs\/12\.15\.0\/firebase-(?:app|auth|firestore|functions)\.js)$/.test(record.key)) {
            foundKeys.push({ type: record.key.includes('.tgz') ? 'firebase-12.15.0 tarball metadata' : 'Firebase 12.15.0 CDN asset metadata',
              metadataOnly: true, contentVerified: false });
          }
        }
      } catch { errors.push('An npm cache index entry could not be read'); }
    }
  }
}
inspect(index);
const targetAvailable = packageAssets.some(p => p.completeTargetSet);
const result = { status: targetAvailable && !errors.length ? 'PASS' : 'BLOCKED', requested: '12.15.0', packageAssets,
  npmIndexInspected: fs.existsSync(index), matches: foundKeys, errors,
  conclusion: targetAvailable ? 'Local 12.15.0 package/assets candidate found; this does not prove runtime compatibility' :
    'No verified complete 12.15.0 SDK asset set found in the directed known caches',
  limits: 'Not a global disk/browser cache search. Metadata is not a verified SDK artifact. No asset served/executed.',
  separateApprovalNeeded: 'Obtain the Firebase JS 12.15.0 artifacts for an isolated harness, or explicitly approve another FlutterFire/JS alignment. Keep 12.19.0 and all locks/helpers unchanged.' };
const output = path.join(root, 'build/b4br4a/local-cache.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === 'PASS' ? 0 : 1;
