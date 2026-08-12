/**
 * Phase 9 — feature flags.
 *
 * A flag answers "is this capability turned on in this deployment?" and nothing else. It is not an
 * authorization check and must never be used as one: `FEATURE_AGENTS=1` does not mean this user may
 * run an agent on this matter. Capability checks (@nyayagrid/permissions) and entitlement checks
 * (./billing) are separate and both still apply. The order at a call site is always: authenticated
 * identity, then capability, then entitlement, then flag — the flag is only the last gate that says
 * the code path exists here at all.
 *
 * Because of that ordering, a disabled flag is safe (nothing runs) and an enabled flag grants
 * nothing on its own, so flags may be flipped by operators without a security review.
 */
import { getAppEnv, type AppEnv, type EnvSource } from "./config";

export const FEATURE_FLAGS = [
  "agents",
  "professor",
  "guide",
  "research",
  "ocr",
  "live_ai",
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export type FeatureFlagState = Record<FeatureFlag, boolean>;

const FLAG_ENV_VAR: Record<FeatureFlag, string> = {
  agents: "FEATURE_AGENTS",
  professor: "FEATURE_PROFESSOR",
  guide: "FEATURE_GUIDE",
  research: "FEATURE_RESEARCH",
  ocr: "FEATURE_OCR",
  live_ai: "FEATURE_LIVE_AI",
};

/**
 * `ocr` is off everywhere because only `UnsupportedOcrProvider` exists; turning it on would promise
 * text extraction from scanned files that cannot happen. `live_ai` is off everywhere because it
 * describes calling a paid provider, which an operator opts into deliberately. Everything else is
 * on locally so the product is fully explorable, and off in staging/production until declared.
 */
const DEFAULTS_BY_ENV: Record<AppEnv, FeatureFlagState> = {
  development: {
    agents: true,
    professor: true,
    guide: true,
    research: true,
    ocr: false,
    live_ai: false,
  },
  test: {
    agents: true,
    professor: true,
    guide: true,
    research: true,
    ocr: false,
    live_ai: false,
  },
  staging: {
    agents: false,
    professor: false,
    guide: false,
    research: false,
    ocr: false,
    live_ai: false,
  },
  production: {
    agents: false,
    professor: false,
    guide: false,
    research: false,
    ocr: false,
    live_ai: false,
  },
};

const TRUTHY = ["1", "true", "yes", "on"];
const FALSY = ["0", "false", "no", "off"];

/** Returns undefined for an unset or unrecognized value so the environment default still applies. */
export function parseFlagValue(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (value.length === 0) return undefined;
  if (TRUTHY.includes(value)) return true;
  if (FALSY.includes(value)) return false;
  return undefined;
}

export function getFeatureFlags(env: EnvSource = process.env): FeatureFlagState {
  const defaults = DEFAULTS_BY_ENV[getAppEnv(env)];
  const flags = { ...defaults };
  for (const flag of FEATURE_FLAGS) {
    const parsed = parseFlagValue(env[FLAG_ENV_VAR[flag]]);
    if (parsed !== undefined) flags[flag] = parsed;
  }
  return flags;
}

export function isFeatureEnabled(flag: FeatureFlag, env: EnvSource = process.env): boolean {
  return getFeatureFlags(env)[flag];
}

export function isFeatureFlag(value: string): value is FeatureFlag {
  return (FEATURE_FLAGS as readonly string[]).includes(value);
}

/**
 * Applies `feature_flag_overrides` rows on top of the environment baseline. Rows with a null
 * organization are global and are applied first, so an organization row wins for that organization.
 * Unknown flag keys are ignored rather than trusted, which keeps a stale database row from enabling
 * something this build does not implement.
 */
export function applyFlagOverrides(
  baseline: FeatureFlagState,
  overrides: Array<{ organizationId: string | null; flagKey: string; enabled: boolean }>,
  organizationId?: string | null,
): FeatureFlagState {
  const flags = { ...baseline };
  const ordered = [
    ...overrides.filter((o) => o.organizationId === null),
    ...overrides.filter((o) => organizationId != null && o.organizationId === organizationId),
  ];
  for (const override of ordered) {
    if (isFeatureFlag(override.flagKey)) flags[override.flagKey] = override.enabled;
  }
  return flags;
}
