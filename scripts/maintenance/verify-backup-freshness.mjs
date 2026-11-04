#!/usr/bin/env node
/**
 * WP-05 — verify local backup rehearsal freshness against interim RPO (24h).
 * Does not contact Neon or production. Reads tmp/backup-rehearsal/latest.json only.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const MAX_AGE_MS = Number(process.env.BACKUP_MAX_AGE_MS ?? 24 * 60 * 60 * 1000);
const latestPath = path.resolve("tmp", "backup-rehearsal", "latest.json");

if (!existsSync(latestPath)) {
  console.error(
    JSON.stringify({
      ok: false,
      code: "BACKUP_REPORT_MISSING",
      path: latestPath,
      hint: "Run npm run ops:backup-rehearse first (local docker only).",
    }),
  );
  process.exit(1);
}

const latest = JSON.parse(readFileSync(latestPath, "utf8"));
const at = new Date(latest.at).getTime();
if (Number.isNaN(at)) {
  console.error(JSON.stringify({ ok: false, code: "BACKUP_REPORT_INVALID_TIMESTAMP", latest }));
  process.exit(1);
}
const ageMs = Date.now() - at;
const fresh = ageMs <= MAX_AGE_MS;
const report = {
  ok: fresh,
  code: fresh ? "BACKUP_FRESH" : "BACKUP_STALE",
  ageMs,
  maxAgeMs: MAX_AGE_MS,
  lastSuccessAt: latest.at,
  dumpSha256: latest.dumpSha256 ?? null,
  integrity: latest.integrity ?? null,
  managedPitrCertified: Boolean(latest.managedPitrCertified),
};
console.log(JSON.stringify(report, null, 2));
process.exit(fresh ? 0 : 2);
