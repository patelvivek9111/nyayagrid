import { buildOpenAiResponsesRequest } from "./request-builders.js";
import { classifyHttpStatus, LiveProviderError } from "./live-errors.js";
import type { LiveClientOptions, LiveProviderResult } from "./live-types.js";

function extractOpenAiText(raw: Record<string, unknown>): string {
  if (typeof raw.output_text === "string" && raw.output_text.trim()) {
    return raw.output_text.trim();
  }
  const output = raw.output;
  if (Array.isArray(output)) {
    const parts: string[] = [];
    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const p = part as { type?: string; text?: string };
        if ((p.type === "output_text" || p.type === "text") && typeof p.text === "string") {
          parts.push(p.text);
        }
      }
    }
    if (parts.length > 0) return parts.join("\n").trim();
  }
  const choices = raw.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const msg = (choices[0] as { message?: { content?: string } }).message;
    if (typeof msg?.content === "string") return msg.content.trim();
  }
  return "";
}

function extractUsage(raw: Record<string, unknown>): LiveProviderResult["usage"] {
  const usage = (raw.usage ?? {}) as Record<string, unknown>;
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
  const details = (usage.output_tokens_details ?? usage.completion_tokens_details ?? {}) as Record<
    string,
    unknown
  >;
  const reasoningTokens =
    Number(details.reasoning_tokens ?? usage.reasoning_tokens ?? 0) || undefined;
  return {
    inputTokens,
    outputTokens,
    reasoningTokens: reasoningTokens && reasoningTokens > 0 ? reasoningTokens : undefined,
  };
}

export type OpenAiLiveCallInput = {
  model: "gpt-6.1-sol";
  input: unknown;
  effort: "high" | "medium";
  maxOutputTokens: number;
  /** When true, request already left the client; uncertain failures escalate. */
  requestDispatched?: boolean;
};

/**
 * OpenAI Responses API client for canary response + OpenAI judge.
 * Never logs Authorization or API keys.
 */
export async function executeOpenAiResponses(
  options: LiveClientOptions,
  input: OpenAiLiveCallInput,
): Promise<LiveProviderResult> {
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = buildOpenAiResponsesRequest({
    input: input.input,
    effort: input.effort,
    maxOutputTokens: input.maxOutputTokens,
  });
  // Enforce exact model from caller (builder already pins gpt-6.1-sol).
  if (body.model !== input.model) {
    throw new LiveProviderError({
      code: "BAD_REQUEST",
      provider: "openai",
      message: "OpenAI request builder model mismatch",
      retryable: false,
    });
  }

  const started = Date.now();
  // Once fetch begins, the request may have reached the provider — treat
  // subsequent transport loss as UNKNOWN_COMPLETION (do not auto-resend).
  let dispatched = Boolean(input.requestDispatched);
  let response: Response;
  try {
    dispatched = true;
    response = await fetchImpl(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (dispatched) {
      throw new LiveProviderError({
        code: "UNKNOWN_COMPLETION",
        provider: "openai",
        message: `OpenAI transport failure after dispatch: ${message}`,
        retryable: false,
        completionKnownIncomplete: false,
      });
    }
    throw new LiveProviderError({
      code: "TRANSPORT_ERROR",
      provider: "openai",
      message: `OpenAI transport error: ${message}`,
      retryable: true,
      completionKnownIncomplete: true,
    });
  }

  const bodyText = await response.text();
  if (!response.ok) {
    throw classifyHttpStatus("openai", response.status, bodyText);
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    throw new LiveProviderError({
      code: "TEMPORARY_PROVIDER_ERROR",
      provider: "openai",
      message: "OpenAI returned non-JSON body",
      retryable: true,
      completionKnownIncomplete: true,
    });
  }

  const text = extractOpenAiText(raw);
  if (!text) {
    throw new LiveProviderError({
      code: "CONTENT_FILTER_OR_REFUSAL",
      provider: "openai",
      message: "OpenAI response missing text output",
      retryable: false,
    });
  }

  const requestId =
    (typeof raw.id === "string" ? raw.id : null) ??
    response.headers.get("x-request-id") ??
    response.headers.get("request-id");

  return {
    provider: "openai",
    exactModelId: input.model,
    text,
    raw,
    usage: extractUsage(raw),
    latencyMs: Date.now() - started,
    providerRequestId: requestId,
    finishReason: typeof raw.status === "string" ? raw.status : null,
    completionStatus: "success",
  };
}
