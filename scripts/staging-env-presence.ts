/**
 * Presence / host-class only. Never prints secret values, connection strings, or key material.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..");

function loadDotenv(filePath: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(filePath)) return map;
  for (const raw of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (value) map.set(key, value);
  }
  return map;
}

function hostClass(value: string | undefined): string {
  if (!value?.trim()) return "missing";
  const v = value.trim();
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0|::1/i.test(v)) return "localhost";
  if (/neon\.tech/i.test(v)) return "neon";
  if (/^https:\/\//i.test(v)) return "https-remote";
  if (/postgres(ql)?:\/\//i.test(v)) return "postgres-remote";
  if (v.startsWith("pk_")) return "clerk-publishable-fingerprint";
  if (v.startsWith("sk_")) return "clerk-secret-fingerprint";
  if (v.startsWith("whsec_")) return "webhook-fingerprint";
  return "opaque";
}

const local = loadDotenv(join(repoRoot, ".env"));
const stagingFile = loadDotenv(join(repoRoot, ".env.staging"));

const keys = [
  "DATABASE_URL",
  "AUTH_PROVIDER",
  "AI_PROVIDER",
  "EMBEDDING_PROVIDER",
  "MALWARE_SCANNER",
  "INNGEST_DEV",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_WEBHOOK_SECRET",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
];

const report: Record<string, { process: string; envFile: string; stagingFile: string }> = {};
for (const key of keys) {
  report[key] = {
    process: hostClass(process.env[key]),
    envFile: local.has(key) ? hostClass(local.get(key)) : "missing",
    stagingFile: stagingFile.has(key) ? hostClass(stagingFile.get(key)) : "missing",
  };
}

console.log(
  JSON.stringify(
    {
      envStagingFile: existsSync(join(repoRoot, ".env.staging")) ? "present" : "absent",
      localEnv: report,
    },
    null,
    2,
  ),
);
