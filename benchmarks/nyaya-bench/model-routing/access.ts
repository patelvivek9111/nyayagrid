/**
 * Presence-only credential inventory. Never returns secret values.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PINNED_MODEL_IDS, providerApiKeyPresent, type DirectProviderId } from "@nyayagrid/ai";

export const CERT_PROVIDERS: DirectProviderId[] = ["openai", "anthropic", "xai", "google"];

export type KeyState = "present" | "absent" | "commented-empty" | "commented-nonempty" | "empty";

export type ProviderAccess = {
  provider: DirectProviderId;
  keyAvailable: boolean;
  modelId: string;
  status: "AVAILABLE" | "BLOCKED_EXTERNAL";
};

const KEY_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "XAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
] as const;

function parseDotEnvPresence(filePath: string): Record<string, KeyState> {
  const out: Record<string, KeyState> = {};
  if (!existsSync(filePath)) return out;
  for (const raw of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const commented = line.startsWith("#");
    const body = commented ? line.replace(/^#\s*/, "") : line;
    const eq = body.indexOf("=");
    if (eq < 1) continue;
    const key = body.slice(0, eq).trim();
    if (!(KEY_NAMES as readonly string[]).includes(key)) continue;
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const empty = value.length === 0;
    if (commented && empty) out[key] = "commented-empty";
    else if (commented) out[key] = "commented-nonempty";
    else if (empty) out[key] = "empty";
    else out[key] = "present";
  }
  return out;
}

export function inventoryProviderAccess(params: {
  repoRoot: string;
  env?: Record<string, string | undefined>;
}): {
  files: Record<string, "EXISTS" | "ABSENT">;
  dotenv: Record<string, KeyState>;
  process: Record<string, "present" | "absent">;
  providers: ProviderAccess[];
  databaseUrl: "present" | "absent";
} {
  const env = params.env ?? process.env;
  const files: Record<string, "EXISTS" | "ABSENT"> = {};
  const candidates = [
    ".env",
    ".env.local",
    "apps/web/.env",
    "benchmarks/nyaya-bench/.env",
  ];
  const dotenv: Record<string, KeyState> = {};
  for (const rel of candidates) {
    const full = resolve(params.repoRoot, rel);
    files[rel] = existsSync(full) ? "EXISTS" : "ABSENT";
    Object.assign(dotenv, parseDotEnvPresence(full));
  }
  const processPresence: Record<string, "present" | "absent"> = {};
  for (const key of KEY_NAMES) {
    processPresence[key] = env[key]?.trim() ? "present" : "absent";
  }

  const modelFor = (provider: DirectProviderId): string => {
    if (provider === "openai") return env.OPENAI_MODEL?.trim() || PINNED_MODEL_IDS.openai;
    if (provider === "anthropic") return env.ANTHROPIC_MODEL?.trim() || PINNED_MODEL_IDS.anthropic;
    if (provider === "xai") return env.XAI_MODEL?.trim() || PINNED_MODEL_IDS.xai;
    return env.GOOGLE_MODEL?.trim() || env.GEMINI_MODEL?.trim() || PINNED_MODEL_IDS.google;
  };

  const providers: ProviderAccess[] = CERT_PROVIDERS.map((provider) => {
    const keyAvailable = providerApiKeyPresent(provider, env);
    return {
      provider,
      keyAvailable,
      modelId: modelFor(provider),
      status: keyAvailable ? "AVAILABLE" : "BLOCKED_EXTERNAL",
    };
  });

  return {
    files,
    dotenv,
    process: processPresence,
    providers,
    databaseUrl: env.DATABASE_URL?.trim() ? "present" : "absent",
  };
}

export function accessHasNoSecrets(record: unknown): boolean {
  const json = JSON.stringify(record);
  if (/sk-[a-zA-Z0-9]{8,}/.test(json)) return false;
  if (/Bearer\s+\S+/.test(json)) return false;
  for (const key of KEY_NAMES) {
    const value = process.env[key];
    if (value && value.trim().length >= 8 && json.includes(value)) return false;
  }
  return true;
}
