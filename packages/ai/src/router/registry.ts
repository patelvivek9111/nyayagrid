/**
 * Central model registry. Availability of an API key is not certification.
 * Certification is per model × subsystem and is assigned only from evidence.
 */

import type {
  CertificationSubsystem,
  ProviderId,
} from "../provider-contract";
import { CERTIFICATION_SUBSYSTEMS } from "../provider-contract";
import { CERTIFICATION_EVIDENCE, type CertificationEvidence } from "./certification-evidence";

export const MODEL_REGISTRY_VERSION = "nyaya-registry-v1";

export type ModelLifecycle =
  | "CANDIDATE"
  | "BENCHMARKED"
  | "VALIDATED"
  | "ACTIVE"
  | "LIMITED"
  | "DISABLED"
  | "RETIRED";

export type ModelCapabilities = {
  textGeneration: boolean;
  structuredOutput: boolean;
  toolUse: boolean;
  streaming: boolean;
};

export type SubsystemCertification = Record<CertificationSubsystem, ModelLifecycle>;

export type ModelRegistryEntry = {
  /** Stable id: `provider:modelId`. */
  id: string;
  provider: ProviderId;
  modelId: string;
  displayName: string;
  status: ModelLifecycle;
  capabilities: ModelCapabilities;
  contextWindowTokens: number;
  structuredOutputSupport: boolean;
  toolUseSupport: boolean;
  streamingSupport: boolean;
  certification: SubsystemCertification;
  /** Null means unrated — cannot win Auto. */
  qualityScore: number | null;
  safetyScore: number | null;
  citationReliability: number | null;
  structuredReliability: number | null;
  notes: string;
};

export type EnvSource = Record<string, string | undefined>;

function allSubsystems(status: ModelLifecycle): SubsystemCertification {
  return Object.fromEntries(
    CERTIFICATION_SUBSYSTEMS.map((s) => [s, status]),
  ) as SubsystemCertification;
}

function openaiValidated(): SubsystemCertification {
  // Historical nyaya-bench evidence is the OpenAI matter-QA / analysis route (gpt-4o-mini family).
  // This is route-level inheritance, not a four-provider certification.
  return allSubsystems("VALIDATED");
}

function candidate(): SubsystemCertification {
  return allSubsystems("CANDIDATE");
}

const TEXT_CAPS: ModelCapabilities = {
  textGeneration: true,
  structuredOutput: true,
  toolUse: false,
  streaming: false,
};

function read(env: EnvSource, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Pinned IDs. Never `latest`. Operators override via *_MODEL env vars. */
export const PINNED_MODEL_IDS = {
  openai: "gpt-4o-mini",
  openaiStrong: "gpt-4o",
  anthropic: "claude-sonnet-4-5-20250929",
  xai: "grok-3",
  google: "gemini-3.6-flash",
  mock: "mock-1",
} as const;

export function resolvePinnedModelId(
  provider: ProviderId,
  env: EnvSource = process.env,
): string {
  if (provider === "openai") {
    return read(env, "OPENAI_MODEL") ?? PINNED_MODEL_IDS.openai;
  }
  if (provider === "anthropic") {
    return read(env, "ANTHROPIC_MODEL") ?? PINNED_MODEL_IDS.anthropic;
  }
  if (provider === "xai") {
    return read(env, "XAI_MODEL") ?? PINNED_MODEL_IDS.xai;
  }
  if (provider === "google") {
    return read(env, "GOOGLE_MODEL") ?? read(env, "GEMINI_MODEL") ?? PINNED_MODEL_IDS.google;
  }
  if (provider === "mock") return PINNED_MODEL_IDS.mock;
  return "fake-1";
}

export function overlayRegistryEvidence(
  registry: ModelRegistryEntry[],
  evidence: CertificationEvidence = CERTIFICATION_EVIDENCE,
): ModelRegistryEntry[] {
  if (!evidence.applied || evidence.models.length === 0) return registry;
  const measuredProviders = new Set(evidence.models.map((model) => model.provider));
  return registry.map((entry) => {
    const match = evidence.models.find(
      (model) => model.provider === entry.provider && model.modelId === entry.modelId,
    );
    if (!match) {
      if (entry.provider === "mock" || entry.provider === "fake") return entry;
      if (!measuredProviders.has(entry.provider)) return entry;
      return {
        ...entry,
        status: "CANDIDATE",
        certification: candidate(),
        notes: `Unmeasured ${entry.provider} sibling after ${evidence.benchmarkId}. Remains CANDIDATE.`,
      };
    }
    const certification = { ...entry.certification, ...match.certification };
    for (const [subsystem, route] of Object.entries(evidence.preferredAuto)) {
      if (
        route &&
        route.provider === entry.provider &&
        route.modelId === entry.modelId &&
        (certification[subsystem as CertificationSubsystem] === "VALIDATED" ||
          certification[subsystem as CertificationSubsystem] === "ACTIVE")
      ) {
        certification[subsystem as CertificationSubsystem] = "ACTIVE";
      }
    }
    return {
      ...entry,
      status: match.status,
      certification,
      qualityScore: match.qualityScore,
      safetyScore: match.safetyScore,
      citationReliability: match.citationReliability,
      structuredReliability: match.structuredReliability,
      notes: match.notes,
    };
  });
}

function entry(params: Omit<ModelRegistryEntry, "id">): ModelRegistryEntry {
  return { id: `${params.provider}:${params.modelId}`, ...params };
}

export function buildDefaultModelRegistry(env: EnvSource = process.env): ModelRegistryEntry[] {
  const openaiPrimary = resolvePinnedModelId("openai", env);
  const anthropicId = resolvePinnedModelId("anthropic", env);
  const xaiId = resolvePinnedModelId("xai", env);
  const googleId = resolvePinnedModelId("google", env);

  const openaiModels = new Map<string, ModelRegistryEntry>();
  const registerOpenAi = (modelId: string, displayName: string) => {
    openaiModels.set(
      modelId,
      entry({
        provider: "openai",
        modelId,
        displayName,
        status: "VALIDATED",
        capabilities: TEXT_CAPS,
        contextWindowTokens: 128_000,
        structuredOutputSupport: true,
        toolUseSupport: false,
        streamingSupport: false,
        certification: openaiValidated(),
        qualityScore: null,
        safetyScore: null,
        citationReliability: null,
        structuredReliability: null,
        notes:
          "VALIDATED only as the historical OpenAI execution route. Snapshot quality scores remain unrated until the four-provider certification phase.",
      }),
    );
  };
  registerOpenAi("gpt-4o-mini", "GPT-4o mini");
  registerOpenAi("gpt-4o-mini-2024-07-18", "GPT-4o mini (2024-07-18)");
  registerOpenAi("gpt-4o", "GPT-4o");
  if (!openaiModels.has(openaiPrimary)) {
    registerOpenAi(openaiPrimary, `OpenAI ${openaiPrimary}`);
  }

  const entries = [
    ...openaiModels.values(),
    entry({
      provider: "anthropic",
      modelId: anthropicId,
      displayName: "Claude Sonnet",
      status: "CANDIDATE",
      capabilities: TEXT_CAPS,
      contextWindowTokens: 200_000,
      structuredOutputSupport: true,
      toolUseSupport: true,
      streamingSupport: false,
      certification: candidate(),
      qualityScore: null,
      safetyScore: null,
      citationReliability: null,
      structuredReliability: null,
      notes: "Adapter present. Not certified for Auto. Awaiting four-provider benchmark.",
    }),
    entry({
      provider: "xai",
      modelId: xaiId,
      displayName: "Grok",
      status: "CANDIDATE",
      capabilities: TEXT_CAPS,
      contextWindowTokens: 131_072,
      structuredOutputSupport: true,
      toolUseSupport: false,
      streamingSupport: false,
      certification: candidate(),
      qualityScore: null,
      safetyScore: null,
      citationReliability: null,
      structuredReliability: null,
      notes: "Adapter present. Not certified for Auto. Awaiting four-provider benchmark.",
    }),
    entry({
      provider: "google",
      modelId: googleId,
      displayName: "Gemini",
      status: "CANDIDATE",
      capabilities: TEXT_CAPS,
      contextWindowTokens: 1_048_576,
      structuredOutputSupport: true,
      toolUseSupport: true,
      streamingSupport: false,
      certification: candidate(),
      qualityScore: null,
      safetyScore: null,
      citationReliability: null,
      structuredReliability: null,
      notes: "Adapter present. Not certified for Auto. Awaiting four-provider benchmark.",
    }),
    entry({
      provider: "mock",
      modelId: PINNED_MODEL_IDS.mock,
      displayName: "Mock (deterministic)",
      status: "VALIDATED",
      capabilities: TEXT_CAPS,
      contextWindowTokens: 1_000_000,
      structuredOutputSupport: true,
      toolUseSupport: false,
      streamingSupport: false,
      certification: openaiValidated(),
      qualityScore: null,
      safetyScore: null,
      citationReliability: null,
      structuredReliability: null,
      notes: "Test/development fixture only. Never a production legal engine.",
    }),
  ];
  return overlayRegistryEvidence(entries);
}

export function getRegistryEntry(
  registry: ModelRegistryEntry[],
  provider: string,
  modelId: string,
): ModelRegistryEntry | undefined {
  return (
    registry.find((e) => e.provider === provider && e.modelId === modelId) ??
    registry.find((e) => e.id === modelId) ??
    registry.find((e) => e.id === `${provider}:${modelId}`)
  );
}

export function parseModelRef(
  value: string,
): { provider: ProviderId; modelId: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const colon = trimmed.indexOf(":");
  if (colon <= 0) return null;
  const provider = trimmed.slice(0, colon) as ProviderId;
  const modelId = trimmed.slice(colon + 1);
  if (!modelId) return null;
  return { provider, modelId };
}

export function isCertifiedFor(
  entry: ModelRegistryEntry,
  subsystem: CertificationSubsystem,
): boolean {
  const status = entry.certification[subsystem];
  return status === "VALIDATED" || status === "ACTIVE" || status === "LIMITED";
}

export function isAutoEligible(
  entry: ModelRegistryEntry,
  subsystem: CertificationSubsystem,
): boolean {
  const status = entry.certification[subsystem];
  return status === "VALIDATED" || status === "ACTIVE";
}

/** Independent-provider count used for Deep eligibility. Health is ignored. */
export function countAutoEligibleProviders(
  registry: ModelRegistryEntry[],
  subsystem: CertificationSubsystem,
): number {
  return new Set(
    registry
      .filter(
        (entry) =>
          entry.provider !== "mock" &&
          entry.provider !== "fake" &&
          isAutoEligible(entry, subsystem),
      )
      .map((entry) => entry.provider),
  ).size;
}
