"use strict";
// Test-only reconstruction of Rules immediately before this session's two-field patch.
const fs = require("node:fs"), path = require("node:path");
const original = fs.readFileSync;
const target = path.resolve(__dirname, "../../firestore.rules");
fs.readFileSync = function(file, ...args) {
  const result = original.call(this, file, ...args);
  const filename = file instanceof URL ? require("node:url").fileURLToPath(file) : String(file);
  if (path.resolve(filename) !== target || typeof result !== "string") return result;
  return result.replace(/^          'blockedAt',\r?\n/m, "").replace(/^          'subscriptionInactiveReason',\r?\n/m, "");
};
