/**
 * Copies only OpenAI/xAI key NAMES from local .env into the Fly secret store.
 * Never prints values. Never copies INNGEST_DEV, DATABASE_URL, or Clerk keys.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const repoRoot = join(import.meta.dirname, "..");
const allowed = new Set(["OPENAI_API_KEY", "XAI_API_KEY"]);
const blocked = new Set([
  "INNGEST_DEV",
  "DATABASE_URL",
  "AUTH_PROVIDER",
  "AI_PROVIDER",
  "EMBEDDING_PROVIDER",
  "MALWARE_SCANNER",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SECRET",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
]);

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

const env = loadDotenv(join(repoRoot, ".env"));
const lines: string[] = [];
const imported: string[] = [];
for (const key of allowed) {
  if (blocked.has(key)) continue;
  const value = env.get(key);
  if (!value) continue;
  lines.push(`${key}=${value}`);
  imported.push(key);
}

if (lines.length === 0) {
  console.log(JSON.stringify({ ok: false, reason: "no_allowed_ai_keys_in_local_env", imported: [] }));
  process.exit(1);
}

const tmp = join(tmpdir(), `nyaya-fly-secrets-${process.pid}.env`);
writeFileSync(tmp, `${lines.join("\n")}\n`, { mode: 0o600 });
try {
  const fly = join(process.env.USERPROFILE ?? "", ".fly", "bin", "flyctl.exe");
  const bin = existsSync(fly) ? fly : "flyctl";
  const result = spawnSync(bin, ["secrets", "import", "--app", "nyayagrid-staging", "--stage"], {
    input: readFileSync(tmp),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const err = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.replace(
      /[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi,
      "[redacted]",
    );
    console.log(JSON.stringify({ ok: false, reason: "fly_import_failed", detail: err.trim().slice(0, 500) }));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, imported }));
} finally {
  try {
    unlinkSync(tmp);
  } catch {
    // ignore
  }
}
