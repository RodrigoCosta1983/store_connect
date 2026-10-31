"use strict";
const fs = require("node:fs"), path = require("node:path"), {spawnSync} = require("node:child_process");
const root = path.resolve(__dirname, "../.."), out = path.join(root, "build/consolidacao-20261025");
const raw = fs.readFileSync(path.join(out, "baseline-unstaged.patch"));
const patch = raw.toString(raw[0] === 255 ? "utf16le" : "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const results = [];
for (const file of ["functions/financeiro/faturas.js", "functions/tests/financeiro/asaasSecrets.test.js", "firestore.rules"]) {
  const head = spawnSync("git", ["show", `HEAD:${file}`], {cwd: root, encoding: "utf8", windowsHide: true});
  if (head.status !== 0) throw Error("head_read_failed");
  const lines = head.stdout.replace(/\r\n/g, "\n").split("\n");
  const segment = patch.split(`diff --git a/${file} b/${file}\n`)[1]?.split("\ndiff --git ")[0];
  let baseline = [], offset = 0;
  if (segment) {
    const chunks = segment.split(/^@@ /m).slice(1);
    for (const chunk of chunks) {
      const [header, ...body] = chunk.split("\n");
      const match = header.match(/^-(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!match) throw Error("invalid_hunk");
      const start = Number(match[1]) - 1;
      baseline.push(...lines.slice(offset, start)); offset = start;
      for (const line of body) {
        if (line.startsWith(" ") || line.startsWith("-")) {
          if (lines[offset] !== line.slice(1)) throw Error(`baseline_context_mismatch_${file}`);
          offset++;
        }
        if (line.startsWith(" ") || line.startsWith("+")) baseline.push(line.slice(1));
      }
    }
    baseline.push(...lines.slice(offset));
  } else baseline = lines;
  const backup = path.join(out, `baseline-${path.basename(file)}`);
  fs.writeFileSync(backup, baseline.join("\n"));
  const diff = spawnSync("git", ["--no-pager", "diff", "--no-index", "--", backup, path.join(root, file)], {encoding: "utf8", windowsHide: true});
  if (![0, 1].includes(diff.status)) throw Error("diff_failed");
  results.push(diff.stdout);
}
fs.writeFileSync(path.join(out, "session-only.diff"), results.join("\n"));
console.log("Session-only diff reconstructed against preserved pre-existing work.");
