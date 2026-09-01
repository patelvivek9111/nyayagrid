/**
 * Env kill switches: provider, model, DEEP strategy. No production UI required.
 */

export type EnvSource = Record<string, string | undefined>;

function flag(env: EnvSource, name: string): boolean {
  const raw = env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function list(env: EnvSource, name: string): string[] {
  const raw = env[name];
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export type KillSwitches = {
  disabledProviders: string[];
  disabledModels: string[];
  deepDisabled: boolean;
  allowExperimentalModels: boolean;
};

export function resolveKillSwitches(env: EnvSource = process.env): KillSwitches {
  return {
    disabledProviders: [
      ...list(env, "NYAYA_DISABLED_PROVIDERS"),
      ...list(env, "NYAYA_BLOCKED_PROVIDERS"),
    ].map((s) => s.toLowerCase()),
    disabledModels: list(env, "NYAYA_DISABLED_MODELS"),
    deepDisabled: flag(env, "NYAYA_DISABLE_DEEP"),
    allowExperimentalModels: flag(env, "NYAYA_ALLOW_EXPERIMENTAL_MODELS"),
  };
}

export function isModelKilled(
  switches: KillSwitches,
  provider: string,
  modelId: string,
): boolean {
  if (switches.disabledProviders.includes(provider.toLowerCase())) return true;
  const full = `${provider}:${modelId}`;
  return switches.disabledModels.some(
    (m) => m === modelId || m === full || m.toLowerCase() === full.toLowerCase(),
  );
}

export function isProductionLikeEnv(env: EnvSource = process.env): boolean {
  const app = env.APP_ENV?.trim().toLowerCase();
  if (app === "production" || app === "staging") return true;
  if (!app && env.NODE_ENV?.trim().toLowerCase() === "production") return true;
  return false;
}
