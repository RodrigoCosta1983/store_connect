"use strict";
// Local tests may reach only the Firestore Emulator. Fail even if a caller catches the error.
const net = require("node:net");
const original = net.Socket.prototype.connect;
let denied = 0;
net.Socket.prototype.connect = function(...args) {
  const first = args[0];
  const options = Array.isArray(first) ? first[0] : first;
  const host = typeof options === "object" ? options.host || options.hostname : typeof args[1] === "string" ? args[1] : "localhost";
  const port = typeof options === "object" ? options.port : options;
  if (!["127.0.0.1", "localhost", "::1"].includes(host) || Number(port) !== 8188) {
    denied++;throw Error("Non-emulator network forbidden in financial tests");
  }
  return original.apply(this, args);
};
const originalFetch = global.fetch;
global.fetch = async (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "8188") {
    denied++;throw Error("Non-emulator fetch forbidden in financial tests");
  }
  return originalFetch(input, {...options, redirect: "error"});
};
process.on("exit", () => {if (denied) {process.stderr.write("NETWORK_GUARD_DENIED=" + denied + "\n");process.exitCode = 1;}});
