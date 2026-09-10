"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");

const tests = fs
    .readdirSync(__dirname)
    .filter((fileName) => fileName.endsWith(".test.js"))
    .sort();

console.log("");
console.log("============================================================");
console.log("F7 — REGRESSÃO AUTOMÁTICA DO CATÁLOGO INTELIGENTE");
console.log("============================================================");
console.log(`🧪 ${tests.length} testes encontrados`);

let passed = 0;

for (const testFile of tests) {
  const testPath = path.join(__dirname, testFile);

  console.log("");
  console.log("------------------------------------------------------------");
  console.log(`▶️ ${testFile}`);
  console.log("------------------------------------------------------------");

  const result = spawnSync(
      process.execPath,
      [testPath],
      {
        stdio: "inherit",
        env: process.env,
      },
  );

  if (result.error) {
    console.error(`❌ Erro ao iniciar ${testFile}`);
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error("");
    console.error(`❌ FALHOU: ${testFile}`);
    console.error(`Exit code: ${result.status}`);
    console.error("");
    console.error("============================================================");
    console.error(`❌ REGRESSÃO INTERROMPIDA — ${passed}/${tests.length} passaram`);
    console.error("============================================================");
    process.exit(result.status || 1);
  }

  passed += 1;
  console.log(`✅ PASSOU: ${testFile}`);
}

console.log("");
console.log("============================================================");
console.log(`✅ REGRESSÃO F7 COMPLETA — ${passed}/${tests.length} PASSARAM`);
console.log("============================================================");
console.log("");
