export type LiveUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  thinkingTokens?: number;
};

export type LiveProviderResult = {
  provider: "openai" | "anthropic";
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
