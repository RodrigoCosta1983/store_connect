"use strict";

// Preload por arquivo, sem runner que dispare subprocessos. Falha mesmo se o
// codigo sob teste capturar a excecao de uma tentativa de IO real.
let attempts = 0;
function forbidden() {
  attempts++;
  throw new Error("A1 offline: external IO forbidden");
}
for (const [name, methods] of [
  ["node:http", ["request", "get"]],
  ["node:https", ["request", "get"]],
  ["node:net", ["connect", "createConnection"]],
  ["node:tls", ["connect"]],
  ["node:dns", ["lookup", "resolve", "resolve4", "resolve6"]],
  ["node:child_process", ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]],
]) {
  const module = require(name);
  for (const method of methods) module[method] = forbidden;
}
require("node:net").Socket.prototype.connect = forbidden;
global.fetch = forbidden;
process.on("exit", () => {
  if (attempts) process.exitCode = 1;
});
