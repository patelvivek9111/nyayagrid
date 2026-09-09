/**
 * Provider-neutral AI contract. Subsystems call this shape; Nyaya Router and every adapter
 * (OpenAI, Anthropic, xAI, Google, mock, fake) normalize into it. Trust logic stays outside.
 */

export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProviderId = "openai" | "anthropic" | "xai" | "google" | "mock" | "fake";

export type RouterSubsystem =
  | "ask"
  | "research"
  | "draft"
  | "contract"
  | "deposition"
  | "evidence"
  | "compare"
  | "contradiction"
  | "timeline"
  | "graph"
  | "memory"
  | "agents"
  | "professor"
  | "guide";

export const CERTIFICATION_SUBSYSTEMS = [
  "ask",
  "research",
  "draft",
  "contract",
  "deposition",
  "evidence",
  "compare",
  "contradiction",
  "timeline",
  "graph",
  "memory",
] as const;

export type CertificationSubsystem = (typeof CERTIFICATION_SUBSYSTEMS)[number];

export type ExecutionStrategy = "fast" | "standard" | "deep";
export type RoutingMode = "auto" | ExecutionStrategy;

export type RiskLevel = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export type RiskSignal =
  | "multiple_jurisdictions"
  | "limited_coverage"
  | "unvalidated_coverage"
  | "missing_governing_law"
  | "conflicting_authorities"
  | "conflicting_evidence"
  | "missing_exhibit"
  | "unsupported_proposition"
  | "uncertain_currentness"
  | "critical_deadline"
  | "high_stakes_draft"
  | "weak_retrieval"
  | "low_citation_coverage"
  | "model_uncertainty"
  | "long_context"
  | "contradiction_request";

export type ProviderPolicy = {
  allowedProviders?: ProviderId[];
  blockedProviders?: ProviderId[];
  /**
   * Fail-closed: no provider may run. Set when an allowed-provider list is present
   * but contains no known providers (unknown-only / empty-after-parse).
   */
  denyAll?: boolean;
};

export type RouterRequestContext = {
  subsystem?: RouterSubsystem;
  /** User-facing routing mode. AUTO selects FAST/STANDARD/DEEP. */
  strategy?: RoutingMode;
  /** Explicit model registry id (provider:modelId). Advanced / manual. */
  modelId?: string;
  organizationId?: string;
  matterId?: string;
  userId?: string;
  runId?: string;
  riskSignals?: RiskSignal[];
  /** Approximate input size in tokens (chars/4 if unknown). */
  contextTokensEstimate?: number;
  evidenceChunkIds?: string[];
  authorityIds?: string[];
  jurisdictionSummary?: string;
  promptVersion?: string;
  retrievalIds?: string[];
  providerPolicy?: ProviderPolicy;
  /** High-stakes draft types (motion, complaint, brief) raise risk. */
  draftType?: string;
};

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type EstimatedCost =
  | { known: true; amountUsd: number }
  | { known: false };

export type AiGenerateRequest = {
  messages: AiMessage[];
  schemaName?: string;
  temperature?: number;
  /** Providers that support cancellation should pass this to `fetch`. */
  signal?: AbortSignal;
  routing?: RouterRequestContext;
};

export type AiGenerateResult = {
  provider: string;
  /** Requested model, or the provider-reported id when the API returns one. */
  model: string;
  text: string;
  usage?: TokenUsage;
  /** OpenAI `system_fingerprint` when present — inference-stack fingerprint, not a model id. */
  systemFingerprint?: string;
  finishReason?: string;
  latencyMs?: number;
  estimatedCost?: EstimatedCost;
};

export interface AIProvider {
  readonly name: string;
  generate(request: AiGenerateRequest): Promise<AiGenerateResult>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
