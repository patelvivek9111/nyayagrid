#!/usr/bin/env npx tsx
/**
 * 6W-R2 credential presence inventory. Prints SET/UNSET/COMMENTED only — never values.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

function loadDotEnv(filePath: string): Map<string, { present: boolean; commented: boolean; empty: boolean }> {
  const map = new Map<string, { present: boolean; commented: boolean; empty: boolean }>();
  if (!existsSync(filePath)) return map;
  for (const raw of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const commented = line.startsWith("#");
    const body = commented ? line.replace(/^#\s*/, "") : line;
    const eq = body.indexOf("=");
    if (eq < 1) continue;
    const key = body.slice(0, eq).trim();
    const value = body.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!key) continue;
    map.set(key, { present: !commented && value.length > 0, commented: commented || value.length === 0, empty: value.length === 0 });
  }
  return map;
}

const KEYS = [
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_WEBHOOK_SECRET",
  "AUTH_PROVIDER",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "INNGEST_DEV",
  "INNGEST_DISABLED",
  "REDIS_URL",
  "REDIS_HOST",
  "RATE_LIMIT_PROVIDER",
  "S3_BUCKET",
  "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_FORCE_PATH_STYLE",
  "DATABASE_URL",
  "CLAMAV_HOST",
  "MALWARE_SCANNER",
  "APP_ENV",
  "FEATURE_AGENTS",
  "ALLOW_AGENTS_IN_PRODUCTION",
  "SMTP_HOST",
  "SMTP_URL",
  "STAGING_BASE_URL",
  "NEXT_PUBLIC_APP_URL",
];

const files = [".env", ".env.staging", ".env.local", ".env.production"];
console.log("files");
for (const f of files) {
  const p = join(repoRoot, f);
  console.log(`  ${f}: ${existsSync(p) ? "EXISTS" : "ABSENT"}`);
}

const env = loadDotEnv(join(repoRoot, ".env"));
const staging = loadDotEnv(join(repoRoot, ".env.staging"));
const local = loadDotEnv(join(repoRoot, ".env.local"));

function classify(key: string): string {
  const processSet = Boolean(process.env[key] && process.env[key]!.trim());
  const file = env.get(key) ?? staging.get(key) ?? local.get(key);
  if (processSet) return "AVAILABLE (process)";
  if (file?.present) return "AVAILABLE (dotenv)";
  if (file?.commented) return "MISSING (commented/empty)";
  return "MISSING";
}

console.log("inventory");
for (const key of KEYS) {
  console.log(`  ${key}: ${classify(key)}`);
}

const inngestDev = (process.env.INNGEST_DEV ?? env.get("INNGEST_DEV")?.present)
  ? String(process.env.INNGEST_DEV ?? "(from dotenv, value not printed)")
  : "";
const inngestDevOn = ["1", "true", "yes", "on"].includes((process.env.INNGEST_DEV ?? "").trim().toLowerCase());
const dotenvDev = env.get("INNGEST_DEV");
console.log("derived");
console.log(`  INNGEST_DEV_active: ${inngestDevOn || (dotenvDev?.present === true) ? "YES — Cloud proof blocked" : "NO"}`);
console.log(`  FEATURE_AGENTS_set: ${classify("FEATURE_AGENTS")}`);
