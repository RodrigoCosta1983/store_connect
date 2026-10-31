"use strict";
const fs = require("node:fs"), path = require("node:path"), {spawnSync} = require("node:child_process");
const root = path.resolve(__dirname, "../.."), out = path.join(root, "build/consolidacao-20261025");
function normalize(value) {return value.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();}
function baseline(name) {const b = fs.readFileSync(path.join(out, name)); return normalize(b.toString(b[0] === 255 ? "utf16le" : "utf8"));}
function git(args) {const r = spawnSync("git", ["--no-pager", "diff", ...args, "--binary"], {cwd: root, encoding: "utf8", windowsHide: true}); if (r.status) throw Error("git_read_failed"); return normalize(r.stdout);}
function parts(text) {return new Map(text.split(/(?=^diff --git )/m).filter(Boolean).map(part => [part.split("\n")[0], normalize(part)]));}
const before = parts(baseline("baseline-unstaged.patch")), after = parts(git([]));
const allowed = ["functions/financeiro/faturas.js", "functions/tests/financeiro/asaasSecrets.test.js", "firestore.rules"];
const differences = [...new Set([...before.keys(), ...after.keys()])].filter(key => before.get(key) !== after.get(key));
const unexpected = differences.filter(key => !allowed.some(file => key === `diff --git a/${file} b/${file}`));
const stagedPreserved = baseline("baseline-staged.patch") === git(["--cached"]);
const result = {stagedPreserved, baselineUnstagedFiles: before.size,
  sessionTrackedFiles: differences, unexpectedTrackedChanges: unexpected, preservationVerified: stagedPreserved && !unexpected.length};
fs.writeFileSync(path.join(out, "preservation-results.json"), JSON.stringify(result, null, 2));
console.log(`Preservação: staged=${stagedPreserved}; arquivos anteriores=${before.size}; deltas fora dos 3 arquivos previstos=${unexpected.length}`);
if (!result.preservationVerified) process.exitCode = 1;
