/**
 * Canonical local env loading for server/bench/eval processes.
 *
 * Repo-root `.env` then `.env.local`, then optional app/bench overlays.
 * Does not override variables already in the process.
 * Skips comments and empty assignments so a blank `KEY=` cannot hide a later real value.
 * Does not load developer files when APP_ENV is production or staging.
 * Never returns secret values.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROVIDER_KEY_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "XAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
] as const;

export type EnvKeyState = "PRESENT" | "ABSENT" | "COMMENTED_EMPTY" | "COMMENTED_NONEMPTY" | "EMPTY";

export type EnvFilePresence = "EXISTS" | "ABSENT";

export function shouldLoadDeveloperDotenv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const app = (env.APP_ENV ?? "").trim().toLowerCase();
  return app !== "production" && app !== "staging";
}

export function applyDotEnvFile(
  filePath: string,
  env: Record<string, string | undefined> = process.env,
): void {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!value) continue;
    if (env[key] === undefined) {
      env[key] = value;
    }
  }
}

export function parseDotEnvKeyStates(filePath: string): Record<string, EnvKeyState> {
  const out: Record<string, EnvKeyState> = {};
  if (!existsSync(filePath)) return out;
  for (const raw of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const commented = line.startsWith("#");
    const body = commented ? line.replace(/^#\s*/, "") : line;
    const eq = body.indexOf("=");
    if (eq < 1) continue;
    const key = body.slice(0, eq).trim();
    if (!(PROVIDER_KEY_NAMES as readonly string[]).includes(key) && key !== "DATABASE_URL") {
      continue;
    }
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const empty = value.length === 0;
    if (commented && empty) out[key] = "COMMENTED_EMPTY";
    else if (commented) out[key] = "COMMENTED_NONEMPTY";
    else if (empty) out[key] = "EMPTY";
    else out[key] = "PRESENT";
  }
  return out;
}

export function canonicalEnvFiles(repoRoot: string): string[] {
  return [
    resolve(repoRoot, ".env"),
    resolve(repoRoot, ".env.local"),
    resolve(repoRoot, "apps/web/.env"),
    resolve(repoRoot, "apps/web/.env.local"),
    resolve(repoRoot, "benchmarks/nyaya-bench/.env"),
  ];
}

/**
 * Load the project's intended local secret files exactly once.
 * First non-empty assignment wins (process env already set always wins).
 */
export function loadCanonicalLocalEnv(params: {
  repoRoot: string;
  env?: Record<string, string | undefined>;
}): void {
  const env = params.env ?? process.env;
  if (!shouldLoadDeveloperDotenv(env)) return;
  for (const filePath of canonicalEnvFiles(params.repoRoot)) {
    applyDotEnvFile(filePath, env);
  }
}

export function repoRootFromHere(hereUrl: string, upSegments: number): string {
  let dir = dirname(fileURLToPath(hereUrl));
  for (let i = 0; i < upSegments; i += 1) {
    dir = resolve(dir, "..");
  }
  return dir;
}

export function accessReportHasNoSecrets(
  record: unknown,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const json = JSON.stringify(record);
  if (/sk-[a-zA-Z0-9_-]{8,}/.test(json)) return false;
  if (/Bearer\s+\S+/i.test(json)) return false;
  for (const key of PROVIDER_KEY_NAMES) {
    const value = env[key];
    if (value && value.trim().length >= 8 && json.includes(value)) return false;
  }
  return true;
}

export function redactEnvSecrets(
  text: string,
  env: Record<string, string | undefined> = process.env,
): string {
  let out = text;
  for (const key of PROVIDER_KEY_NAMES) {
    const value = env[key];
    if (value && value.trim().length >= 8) {
      out = out.split(value).join("[redacted]");
    }
  }
  return out
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

export function envKeyStateFromProcess(
  value: string | undefined,
): "PRESENT" | "ABSENT" {
  return value?.trim() ? "PRESENT" : "ABSENT";
}
