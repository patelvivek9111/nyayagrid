/**
 * CJS bridge for corpus scripts. Loads the TypeScript citation-resolution engine via tsx.
 */
"use strict";

const path = require("node:path");

try {
  require("tsx/cjs/api").register();
} catch {
  try {
    require("tsx/cjs");
  } catch {
    /* vitest/tsx may already transpile when run under tsx */
  }
}

const mod = require(path.join(__dirname, "index.ts"));
module.exports = mod;
