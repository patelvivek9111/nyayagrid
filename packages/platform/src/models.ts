/**
 * Phase 9 — one place that answers "which model runs this capability?".
 *
 * Model choice used to be implicit: whatever `OPENAI_MODEL` happened to be, everywhere. That makes
 * two things impossible. An operator cannot give the high-stakes capabilities (drafting, research,
 * agent planning) a stronger model than the cheap ones without changing code, and a stored
 * `ai_usage_events` row cannot be explained after the fact because nothing recorded the intent.
 *
 * This module resolves, per capability, `MODEL_<CAPABILITY>` -> `OPENAI_MODEL` -> a default chosen
 * for the environment. It does not construct providers; @nyayagrid/ai still owns that. It only says
 * what should be asked for, so callers and usage records agree.
 */
import { resolveAiProvider, resolveEmbeddingProvider, type EnvSource } from "./config";

export const MODEL_CAPABILITIES = [
  "qa",
  "extraction",
  "draft",
  "research",
  "agents",
  "professor",
  "guide",
  "embeddings",
] as const;

export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export type ModelSelection = {
  capability: ModelCapability;
  provider: string;
  model: string;
  /** Where the value came from, so a usage row or support ticket can be explained. */
  source: "capability_env" | "provider_env" | "default";
};

export type ModelConfig = Record<ModelCapability, ModelSelection>;

/** `MODEL_EMBEDDING` is deliberately singular — there is one embedding space, not one per feature. */
const CAPABILITY_ENV_VAR: Record<ModelCapability, string> = {
  qa: "MODEL_QA",
  extraction: "MODEL_EXTRACTION",
  draft: "MODEL_DRAFT",
  research: "MODEL_RESEARCH",
  agents: "MODEL_AGENTS",
  professor: "MODEL_PROFESSOR",
  guide: "MODEL_GUIDE",
  embeddings: "MODEL_EMBEDDING",
};

/**
 * Mock provider identifiers, matching `MockAIProvider.name` and `MockEmbeddingProvider.model` so a
 * usage row written in development names the thing that actually ran.
 */
const MOCK_TEXT_MODEL = "mock";
const MOCK_EMBEDDING_MODEL = "mock-embed-384";

/**
 * Capabilities whose output a lawyer signs, files or relies on get the stronger default; summarizing
 * and teaching capabilities get the cheaper one. Operators can override any of them.
 */
const OPENAI_DEFAULTS: Record<ModelCapability, string> = {
  qa: "gpt-4o",
  extraction: "gpt-4o-mini",
  draft: "gpt-4o",
  research: "gpt-4o",
  agents: "gpt-4o",
  professor: "gpt-4o-mini",
  guide: "gpt-4o-mini",
  /**
   * Changing this is a migration, not a setting: `document_chunks.embedding` is `vector(384)` and
   * every stored vector came from one model. @nyayagrid/ai pins the OpenAI request to 384
   * dimensions, so a different model requires re-embedding the corpus before retrieval is
   * trustworthy again.
   */
  embeddings: "text-embedding-3-small",
};

function read(env: EnvSource, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function defaultModel(capability: ModelCapability, provider: string): string {
  if (provider === "mock") {
    return capability === "embeddings" ? MOCK_EMBEDDING_MODEL : MOCK_TEXT_MODEL;
  }
  if (provider === "openai") return OPENAI_DEFAULTS[capability];
  // An unrecognized provider has no default we can honestly claim. Name it so the failure is
  // legible in logs and usage rows rather than silently becoming an OpenAI model name.
  return `${provider}:unconfigured`;
}

export function getModelForCapability(
  capability: ModelCapability,
  env: EnvSource = process.env,
): ModelSelection {
  const provider =
    capability === "embeddings" ? resolveEmbeddingProvider(env) : resolveAiProvider(env);

  const fromCapability = read(env, CAPABILITY_ENV_VAR[capability]);
  if (fromCapability) {
    return { capability, provider, model: fromCapability, source: "capability_env" };
  }

  const providerEnvVar = capability === "embeddings" ? "OPENAI_EMBEDDING_MODEL" : "OPENAI_MODEL";
  const fromProvider = provider === "openai" ? read(env, providerEnvVar) : undefined;
  if (fromProvider) {
    return { capability, provider, model: fromProvider, source: "provider_env" };
  }

  return {
    capability,
    provider,
    model: defaultModel(capability, provider),
    source: "default",
  };
}

export function getModelConfig(env: EnvSource = process.env): ModelConfig {
  const entries = MODEL_CAPABILITIES.map(
    (capability) => [capability, getModelForCapability(capability, env)] as const,
  );
  return Object.fromEntries(entries) as ModelConfig;
}
