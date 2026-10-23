/**
 * Provider request builders for Stage-1 compatibility.
 * These construct request bodies only — they MUST NOT perform network I/O.
 */

export type OpenAiResponsesRequest = {
  model: "gpt-6.1-sol";
  input: unknown;
  reasoning: { effort: "low" | "medium" | "high" | "xhigh" | "max" };
  service_tier: "standard";
  max_output_tokens: number;
};

export type AnthropicMessagesRequest = {
  model: "claude-opus-5-5" | "claude-sonnet-5-5";
  messages: Array<{ role: string; content: string }>;
  max_tokens: number;
  thinking: { type: "adaptive" };
  output_config?: { effort: "low" | "medium" | "high" | "xhigh" | "max" };
};

export type GeminiInteractionsRequest = {
  model: "gemini-4-argon";
  input: string;
  thinking_level: "low" | "medium" | "high";
  max_output_tokens: number;
};

export type XaiResponsesRequest = {
  model: "grok-4.7";
  input: unknown;
  reasoning: { effort: "low" | "medium" | "high" | "xhigh" };
  max_output_tokens: number;
};

export function buildOpenAiResponsesRequest(input: {
  input: unknown;
  effort?: OpenAiResponsesRequest["reasoning"]["effort"];
  maxOutputTokens?: number;
}): OpenAiResponsesRequest {
  return {
    model: "gpt-6.1-sol",
    input: input.input,
    reasoning: { effort: input.effort ?? "high" },
    service_tier: "standard",
    max_output_tokens: input.maxOutputTokens ?? 4096,
  };
}

export function buildAnthropicMessagesRequest(input: {
  model: "claude-opus-5-5" | "claude-sonnet-5-5";
  messages: Array<{ role: string; content: string }>;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  /** Forbidden for Stage-1 — presence throws. */
  temperature?: number;
  top_p?: number;
  top_k?: number;
}): AnthropicMessagesRequest {
  if (input.temperature !== undefined) {
    throw new Error("Anthropic 5.5 Stage-1 builder forbids temperature");
  }
  if (input.top_p !== undefined || input.top_k !== undefined) {
    throw new Error("Anthropic 5.5 Stage-1 builder forbids top_p/top_k");
  }
  return {
    model: input.model,
    messages: input.messages,
    max_tokens: input.maxTokens ?? 4096,
    thinking: { type: "adaptive" },
    output_config: { effort: input.effort ?? (input.model === "claude-sonnet-5-5" ? "medium" : "high") },
  };
}

export function buildGeminiInteractionsRequest(input: {
  input: string;
  thinkingLevel?: "low" | "medium" | "high";
  maxOutputTokens?: number;
}): GeminiInteractionsRequest {
  return {
    model: "gemini-4-argon",
    input: input.input,
    thinking_level: input.thinkingLevel ?? "high",
    max_output_tokens: input.maxOutputTokens ?? 4096,
  };
}

export function buildXaiResponsesRequest(input: {
  input: unknown;
  effort?: "low" | "medium" | "high" | "xhigh";
  maxOutputTokens?: number;
}): XaiResponsesRequest {
  return {
    model: "grok-4.7",
    input: input.input,
    reasoning: { effort: input.effort ?? "high" },
    max_output_tokens: input.maxOutputTokens ?? 4096,
  };
}

export const XAI_LONG_CONTEXT_THRESHOLD_TOKENS = 200_000;

export function xaiPricingTierForPromptTokens(promptTokens: number): {
  tier: "short" | "long";
  inputPer1M: number;
  outputPer1M: number;
} {
  if (promptTokens >= XAI_LONG_CONTEXT_THRESHOLD_TOKENS) {
    return { tier: "long", inputPer1M: 4, outputPer1M: 12 };
  }
  return { tier: "short", inputPer1M: 2, outputPer1M: 6 };
}
