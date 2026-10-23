/**
 * Benchmark-only local env loader for @nyayagrid/external-bench.
 * Loads monorepo-root `.env` then `.env.local` into process.env.
 * Does not override keys already set in the process.
 * Skips empty assignments. Never returns or logs secret values.
 * No-op when APP_ENV is production or staging.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getPackageRoot } from "../paths.js";

export function getMonorepoRoot(): string {
  return path.resolve(getPackageRoot(), "../..");
}

export function shouldLoadDeveloperDotenv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const app = (env.APP_ENV ?? "").trim().toLowerCase();
  return app !== "production" && app !== "staging";
}

/** Apply one dotenv file. Existing process keys win. Empty values are skipped. */
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

/**
 * Load repo-root `.env` then `.env.local` for live benchmark CLIs.
 * Call before credential presence checks.
 */
export function loadExternalBenchLocalEnv(
  env: Record<string, string | undefined> = process.env,
  repoRoot: string = getMonorepoRoot(),
): void {
  if (!shouldLoadDeveloperDotenv(env)) return;
  applyDotEnvFile(path.join(repoRoot, ".env"), env);
  applyDotEnvFile(path.join(repoRoot, ".env.local"), env);
}

/** Presence-only diagnostic. Never includes secret values. */
export function providerKeyPresenceFromEnv(
  env: Record<string, string | undefined> = process.env,
): Record<
  "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "GOOGLE_API_KEY" | "XAI_API_KEY",
  "PRESENT" | "MISSING"
> {
  const names = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "XAI_API_KEY"] as const;
  const out = {} as Record<(typeof names)[number], "PRESENT" | "MISSING">;
  for (const name of names) {
    const primary = env[name];
    const googleAlt = name === "GOOGLE_API_KEY" ? env.GEMINI_API_KEY : undefined;
    const present =
      (typeof primary === "string" && primary.trim().length > 0) ||
      (typeof googleAlt === "string" && googleAlt.trim().length > 0);
    out[name] = present ? "PRESENT" : "MISSING";
  }
  return out;
}
