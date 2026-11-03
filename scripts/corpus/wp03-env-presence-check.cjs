/**
 * WP-03: report env key PRESENCE only. Never print secret values.
 * Exit 0 always. Output JSON.
 */
"use strict";
const fs = require("fs");
const path = require("path");

function keyStatusFromText(text, key) {
  const re = new RegExp("^\\s*" + key + "\\s*=(.*)$", "mi");
  const m = text.match(re);
  if (!m) return "KEY_ABSENT";
  let raw = String(m[1] ?? "").trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1);
  }
  if (!raw || raw.startsWith("#")) return "EMPTY_IN_FILE";
  return "SET_IN_FILE";
}

function processStatus(key) {
  const v = process.env[key];
  return v && String(v).trim() ? "SET" : "UNSET";
}

const keys = [
  "DATABASE_URL",
  "CORPUS_DATABASE_URL",
  "NEON_DATABASE_URL",
  "POSTGRES_URL",
  "DIRECT_URL",
  "RESEARCH_DATABASE_URL",
];

const files = [".env", ".env.local", ".env.development", ".env.integration", ".env.corpus"];
const filePresence = {};
const fileKeys = {};
for (const f of files) {
  const p = path.join(process.cwd(), f);
  const present = fs.existsSync(p);
  filePresence[f] = present ? "PRESENT" : "ABSENT";
  if (!present) continue;
  const text = fs.readFileSync(p, "utf8");
  fileKeys[f] = {};
  for (const k of keys) fileKeys[f][k] = keyStatusFromText(text, k);
}

const processEnv = {};
for (const k of keys) processEnv[k] = processStatus(k);

console.log(
  JSON.stringify(
    {
      ok: true,
      mutations: 0,
      courtListenerHttpCalls: 0,
      paidAiCalls: 0,
      processEnv,
      filePresence,
      fileKeys,
    },
    null,
    2,
  ),
);
