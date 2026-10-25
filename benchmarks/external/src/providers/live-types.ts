export type LiveUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  thinkingTokens?: number;
  cachedInputTokens?: number;
};

export type LiveProviderId = "openai" | "anthropic" | "google" | "xai";

export type LiveProviderResult = {
  provider: LiveProviderId;
  exactModelId: string;
  text: string;
  raw: unknown;
  usage: LiveUsage;
  latencyMs: number;
  providerRequestId: string | null;
  finishReason: string | null;
  completionStatus: "success" | "failed" | "unknown_completion_review_required";
};

export type LiveFetch = typeof fetch;

export type LiveClientOptions = {
  apiKey: string;
  fetchImpl?: LiveFetch;
  baseUrl?: string;
  timeoutMs?: number;
};
