import type { CertificationSubsystem, RoutingMode } from "../provider-contract";
import { CERTIFICATION_SUBSYSTEMS } from "../provider-contract";
import { STRATEGY_LABELS } from "./strategy";
import {
  buildDefaultModelRegistry,
  isAutoEligible,
  type ModelRegistryEntry,
} from "./registry";
import { isProviderAllowed, mergeProviderPolicy, resolveEnvProviderPolicy } from "./policy";
import { isModelKilled, resolveKillSwitches } from "./kill-switch";

export type RoutingOptionModel = {
  id: string;
  provider: string;
  modelId: string;
  displayName: string;
  certification: string;
};

export type RoutingOptions = {
  defaultStrategy: RoutingMode;
  strategies: Array<{ id: RoutingMode; label: string; helper: string }>;
  models: RoutingOptionModel[];
  subsystem: CertificationSubsystem;
};

export function listValidatedRoutingOptions(params: {
  subsystem: CertificationSubsystem;
  env?: Record<string, string | undefined>;
  registry?: ModelRegistryEntry[];
  organizationPolicy?: { allowedProviders?: string[]; blockedProviders?: string[] };
}): RoutingOptions {
  const env = params.env ?? process.env;
  const registry = params.registry ?? buildDefaultModelRegistry(env);
  const policy = mergeProviderPolicy(
    resolveEnvProviderPolicy(env),
    params.organizationPolicy as never,
  );
  const switches = resolveKillSwitches(env);
  const models = registry
    .filter((entry) => {
      if (entry.provider === "mock" || entry.provider === "fake") return false;
      if (!isAutoEligible(entry, params.subsystem)) return false;
      if (!isProviderAllowed(entry.provider, policy)) return false;
      if (isModelKilled(switches, entry.provider, entry.modelId)) return false;
      if (entry.provider === "openai" && !env.OPENAI_API_KEY) return false;
      if (entry.provider === "anthropic" && !env.ANTHROPIC_API_KEY) return false;
      if (entry.provider === "xai" && !env.XAI_API_KEY) return false;
      if (
        entry.provider === "google" &&
        !env.GOOGLE_GENERATIVE_AI_API_KEY &&
        !env.GEMINI_API_KEY &&
        !env.GOOGLE_API_KEY
      ) {
        return false;
      }
      return true;
    })
    .map((entry) => ({
      id: entry.id,
      provider: entry.provider,
      modelId: entry.modelId,
      displayName: entry.displayName,
      certification: entry.certification[params.subsystem],
    }));

  return {
    defaultStrategy: "auto",
    strategies: [
      { id: "auto", ...STRATEGY_LABELS.auto },
      { id: "fast", ...STRATEGY_LABELS.fast },
      { id: "deep", ...STRATEGY_LABELS.deep },
    ],
    models,
    subsystem: params.subsystem,
  };
}

export function isCertificationSubsystem(value: string): value is CertificationSubsystem {
  return (CERTIFICATION_SUBSYSTEMS as readonly string[]).includes(value);
}
