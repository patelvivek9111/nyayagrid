import { buildAnthropicMessagesRequest } from "./request-builders.js";
import { classifyHttpStatus, LiveProviderError } from "./live-errors.js";
import type { LiveClientOptions, LiveProviderResult } from "./live-types.js";

const ANTHROPIC_VERSION = "2023-06-01";

function extractAnthropicText(raw: Record<string, unknown>): string {
  const content = raw.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && typeof part === "object")
    .map((part) => part as { type?: string; text?: string })
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
    .trim();
}

export type AnthropicLiveCallInput = {
  model: "claude-sonnet-5-5";
  messages: Array<{ role: string; content: string }>;
  effort: "medium";
  maxTokens: number;
  requestDispatched?: boolean;
};

/**
 * Anthropic Messages API for Judge A (claude-sonnet-5-5).
 * Never logs x-api-key.
 */
export async function executeAnthropicMessages(
  options: LiveClientOptions,
  input: AnthropicLiveCallInput,
): Promise<LiveProviderResult> {
  const baseUrl = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = buildAnthropicMessagesRequest({
    model: input.model,
    messages: input.messages,
    effort: input.effort,
    maxTokens: input.maxTokens,
  });

  const started = Date.now();
  // Once fetch begins, the request may have reached the provider — treat
  // subsequent transport loss as UNKNOWN_COMPLETION (do not auto-resend).
  let dispatched = Boolean(input.requestDispatched);
  let response: Response;
  try {
    dispatched = true;
    response = await fetchImpl(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": options.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (dispatched) {
      throw new LiveProviderError({
        code: "UNKNOWN_COMPLETION",
        provider: "anthropic",
        message: `Anthropic transport failure after dispatch: ${message}`,
        retryable: false,
        completionKnownIncomplete: false,
      });
    }
    throw new LiveProviderError({
      code: "TRANSPORT_ERROR",
      provider: "anthropic",
      message: `Anthropic transport error: ${message}`,
      retryable: true,
      completionKnownIncomplete: true,
    });
  }

  const bodyText = await response.text();
  if (!response.ok) {
    throw classifyHttpStatus("anthropic", response.status, bodyText);
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    throw new LiveProviderError({
      code: "TEMPORARY_PROVIDER_ERROR",
      provider: "anthropic",
      message: "Anthropic returned non-JSON body",
      retryable: true,
      completionKnownIncomplete: true,
    });
  }

  const text = extractAnthropicText(raw);
  if (!text) {
    throw new LiveProviderError({
      code: "CONTENT_FILTER_OR_REFUSAL",
      provider: "anthropic",
      message: "Anthropic response missing text content",
      retryable: false,
    });
  }

  const usage = (raw.usage ?? {}) as Record<string, unknown>;
  const inputTokens = Number(usage.input_tokens ?? 0) || 0;
  const outputTokens = Number(usage.output_tokens ?? 0) || 0;
  const thinkingTokens = Number(usage.thinking_tokens ?? 0) || undefined;

  return {
    provider: "anthropic",
    exactModelId: input.model,
    text,
    raw,
    usage: {
      inputTokens,
      outputTokens,
      thinkingTokens: thinkingTokens && thinkingTokens > 0 ? thinkingTokens : undefined,
    },
    latencyMs: Date.now() - started,
    providerRequestId:
      (typeof raw.id === "string" ? raw.id : null) ?? response.headers.get("request-id"),
    finishReason: typeof raw.stop_reason === "string" ? raw.stop_reason : null,
    completionStatus: "success",
  };
}
