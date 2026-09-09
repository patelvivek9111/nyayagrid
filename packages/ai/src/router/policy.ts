/**
 * Provider policy (global env + optional org overlay). Enforced server-side before ranking.
 */

import type { ProviderId, ProviderPolicy } from "../provider-contract";

export type EnvSource = Record<string, string | undefined>;

const KNOWN: ProviderId[] = ["openai", "anthropic", "xai", "google", "mock", "fake"];

function parseList(raw: string | undefined): ProviderId[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ProviderId => (KNOWN as string[]).includes(s));
}

export function resolveEnvProviderPolicy(env: EnvSource = process.env): ProviderPolicy {
  const rawAllowed = env.NYAYA_ALLOWED_PROVIDERS?.trim();
  const allowed = parseList(rawAllowed);
  if (rawAllowed && allowed.length === 0) {
    return {
      allowedProviders: [],
      blockedProviders: parseList(
        [env.NYAYA_BLOCKED_PROVIDERS, env.NYAYA_DISABLED_PROVIDERS].filter(Boolean).join(","),
      ),
      denyAll: true,
    };
  }
  return {
    allowedProviders: allowed,
    blockedProviders: parseList(
      [env.NYAYA_BLOCKED_PROVIDERS, env.NYAYA_DISABLED_PROVIDERS].filter(Boolean).join(","),
    ),
  };
}

export function mergeProviderPolicy(
  envPolicy: ProviderPolicy,
  orgPolicy?: ProviderPolicy,
): ProviderPolicy {
  const allowed =
    orgPolicy?.allowedProviders && orgPolicy.allowedProviders.length > 0
      ? orgPolicy.allowedProviders
      : envPolicy.allowedProviders;
  const blocked = [
    ...new Set([
      ...(envPolicy.blockedProviders ?? []),
      ...(orgPolicy?.blockedProviders ?? []),
    ]),
  ];
  return {
    allowedProviders: allowed,
    blockedProviders: blocked,
    denyAll: Boolean(envPolicy.denyAll || orgPolicy?.denyAll),
  };
}

export function isProviderAllowed(
  provider: string,
  policy: ProviderPolicy,
): boolean {
  if (policy.denyAll) return false;
  const blocked = policy.blockedProviders ?? [];
  if (blocked.includes(provider as ProviderId)) return false;
  const allowed = policy.allowedProviders ?? [];
  if (allowed.length === 0) return true;
  return allowed.includes(provider as ProviderId);
}
