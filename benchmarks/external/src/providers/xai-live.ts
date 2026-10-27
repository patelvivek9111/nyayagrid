import { buildXaiResponsesRequest } from "./request-builders.js";
import { classifyFetchFailure, classifyHttpStatus, LiveProviderError } from "./live-errors.js";
import type { LiveClientOptions, LiveProviderResult } from "./live-types.js";
import { DEFAULT_LIVE_TIMEOUT_MS } from "../live/provider-timeouts.js";

function extractXaiText(raw: Record<string, unknown>): string {
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

function extractXaiUsage(raw: Record<string, unknown>): LiveProviderResult["usage"] {
  const usage = (raw.usage ?? {}) as Record<string, unknown>;
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
  const details = (usage.output_tokens_details ?? usage.completion_tokens_details ?? {}) as Record<
    string,
    unknown
  >;
  const inputDetails = (usage.input_tokens_details ?? usage.prompt_tokens_details ?? {}) as Record<
    string,
    unknown
  >;
  const reasoningTokens =
    Number(details.reasoning_tokens ?? usage.reasoning_tokens ?? 0) || undefined;
  const cachedInputTokens =
    Number(usage.cached_input_tokens ?? inputDetails.cached_tokens ?? 0) || undefined;
  return {
    inputTokens,
    outputTokens,
    reasoningTokens: reasoningTokens && reasoningTokens > 0 ? reasoningTokens : undefined,
    cachedInputTokens: cachedInputTokens && cachedInputTokens > 0 ? cachedInputTokens : undefined,
  };
}

export type XaiLiveCallInput = {
  model: "grok-4.7";
  input: unknown;
  effort: "high";
  maxOutputTokens: number;
  requestDispatched?: boolean;
};

/**
 * xAI Responses API for Stage-1 responses (grok-4.7).
 * Global endpoint. No tools / web search. Never logs API keys.
 */
export async function executeXaiResponses(
  options: LiveClientOptions,
  input: XaiLiveCallInput,
): Promise<LiveProviderResult> {
  const baseUrl = (options.baseUrl ?? "https://api.x.ai/v1").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = buildXaiResponsesRequest({
    input: input.input,
    effort: input.effort,
    maxOutputTokens: input.maxOutputTokens,
  });
  if (body.model !== input.model) {
    throw new LiveProviderError({
      code: "BAD_REQUEST",
      provider: "xai",
      message: "xAI request model mismatch",
      retryable: false,
    });
  }

  const started = Date.now();
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
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_LIVE_TIMEOUT_MS),
    });
  } catch (err) {
    throw classifyFetchFailure({ provider: "xai", dispatched, err });
  }

  const bodyText = await response.text();
  if (!response.ok) {
    throw classifyHttpStatus("xai", response.status, bodyText);
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    throw new LiveProviderError({
      code: "TEMPORARY_PROVIDER_ERROR",
      provider: "xai",
      message: "xAI returned non-JSON body",
      retryable: true,
      completionKnownIncomplete: true,
    });
  }

  const text = extractXaiText(raw);
  if (!text) {
    throw new LiveProviderError({
      code: "CONTENT_FILTER_OR_REFUSAL",
      provider: "xai",
      message: "xAI response missing text output",
      retryable: false,
    });
  }

  return {
    provider: "xai",
    exactModelId: input.model,
    text,
    raw,
    usage: extractXaiUsage(raw),
    latencyMs: Date.now() - started,
    providerRequestId:
      (typeof raw.id === "string" ? raw.id : null) ??
      response.headers.get("x-request-id") ??
      response.headers.get("request-id"),
    finishReason: typeof raw.status === "string" ? raw.status : null,
    completionStatus: "success",
  };
}
