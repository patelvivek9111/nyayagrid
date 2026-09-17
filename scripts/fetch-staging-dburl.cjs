#!/usr/bin/env node
/**
 * Fetch staging DATABASE_URL onto a local temp file via Fly SSH — never prints the URL.
 * Usage: node scripts/fetch-staging-dburl.cjs
 * Writes: .staging-dburl (gitignored) then exits 0.
 */
const { spawnSync } = require("node:child_process");
const { writeFileSync, unlinkSync, existsSync } = require("node:fs");
const path = require("node:path");

const out = path.join(__dirname, "..", ".staging-dburl");
if (existsSync(out)) unlinkSync(out);

const result = spawnSync(
  "flyctl",
  ["ssh", "console", "--app", "nyayagrid-staging", "-C", "printenv DATABASE_URL"],
  { encoding: "utf8", maxBuffer: 2_000_000 },
);

const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
const match = combined.match(/postgres(?:ql)?:\/\/[^\s"']+/i);
if (!match) {
  console.log(JSON.stringify({ ok: false, reason: "no_database_url_in_ssh_output", status: result.status }));
  process.exit(2);
}
writeFileSync(out, match[0], { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ ok: true, wrote: ".staging-dburl", bytes: match[0].length }));
