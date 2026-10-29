import { buildGeminiInteractionsRequest } from "./request-builders.js";
import { classifyFetchFailure, classifyHttpStatus, LiveProviderError } from "./live-errors.js";
import type { LiveClientOptions, LiveProviderResult } from "./live-types.js";
import { DEFAULT_LIVE_TIMEOUT_MS } from "../live/provider-timeouts.js";

/**
 * Map frozen Stage-1 semantic settings onto Gemini Interactions API wire shape.
 * thinking_level / max_output_tokens live under generation_config.
 */
export function buildGeminiInteractionsWireBody(input: {
  model?: string;
  input: string;
  thinkingLevel?: "low" | "medium" | "high";
  maxOutputTokens?: number;
}): Record<string, unknown> {
  const semantic = buildGeminiInteractionsRequest(input);
  return {
    model: semantic.model,
    input: semantic.input,
    generation_config: {
      thinking_level: semantic.thinking_level,
      max_output_tokens: semantic.max_output_tokens,
    },
  };
}

function collectTextParts(content: unknown): string[] {
  const parts: string[] = [];
  if (typeof content === "string" && content.trim()) {
    parts.push(content);
    return parts;
  }
  if (!Array.isArray(content)) return parts;
  for (const c of content) {
    if (!c || typeof c !== "object") continue;
    const p = c as { type?: string; text?: string };
    // Skip explicit non-text part types; accept type=text or unset.
    if (p.type && p.type !== "text") continue;
    if (typeof p.text === "string" && p.text.length > 0) parts.push(p.text);
  }
  return parts;
}

/**
 * Extract final model text from Interactions / generateContent-like payloads.
 * Ignores thought/signature steps; only model_output (and output_text / outputs).
 */
export function extractGeminiText(raw: Record<string, unknown>): string {
  if (typeof raw.output_text === "string" && raw.output_text.trim()) {
    return raw.output_text.trim();
  }

  const outputs = raw.outputs;
  if (Array.isArray(outputs)) {
    const parts: string[] = [];
    for (const item of outputs) {
      if (!item || typeof item !== "object") continue;
      const o = item as { type?: string; text?: string; content?: unknown };
      if (typeof o.text === "string") parts.push(o.text);
      parts.push(...collectTextParts(o.content));
    }
    if (parts.length) return parts.join("\n").trim();
  }

  const steps = raw.steps;
  if (Array.isArray(steps)) {
    const parts: string[] = [];
    for (const step of steps) {
      if (!step || typeof step !== "object") continue;
      const s = step as { type?: string; content?: unknown };
      // Live Interactions API: final answer is in type=model_output content[].text
      // (thought steps may precede it and must not be treated as the answer).
      if (s.type !== "model_output") continue;
      parts.push(...collectTextParts(s.content));
    }
    if (parts.length) return parts.join("\n").trim();
  }

  // generateContent-shaped fallback (candidates[].content.parts[].text)
  const candidates = raw.candidates;
  if (Array.isArray(candidates)) {
    const parts: string[] = [];
    for (const cand of candidates) {
      if (!cand || typeof cand !== "object") continue;
      const content = (cand as { content?: { parts?: unknown } }).content;
      if (content && typeof content === "object") {
        parts.push(...collectTextParts((content as { parts?: unknown }).parts));
      }
    }
    if (parts.length) return parts.join("\n").trim();
  }

  return "";
}

/** True only when the payload itself signals safety/block/refusal. */
export function isGeminiContentFilterOrRefusal(raw: Record<string, unknown>): boolean {
  const status = String(raw.status ?? raw.state ?? "").toLowerCase();
  if (/blocked|safety|refuse|refusal|cancel/.test(status)) return true;

  const finish = String(
    raw.finish_reason ?? raw.finishReason ?? raw.stop_reason ?? raw.stopReason ?? "",
  ).toLowerCase();
  if (/safety|block|recitation|prohibited|other|refuse|refusal/.test(finish)) return true;

  const blockReason = String(
    raw.block_reason ??
      raw.blockReason ??
      (raw.promptFeedback as { blockReason?: string } | undefined)?.blockReason ??
      "",
  ).toLowerCase();
  if (blockReason && blockReason !== "block_reason_unspecified") return true;

  if (Array.isArray(raw.candidates)) {
    for (const c of raw.candidates) {
      if (!c || typeof c !== "object") continue;
      const fr = String((c as { finishReason?: string }).finishReason ?? "").toLowerCase();
      if (/safety|block|recitation|prohibited/.test(fr)) return true;
    }
  }
  return false;
}

export function extractGeminiUsage(raw: Record<string, unknown>): LiveProviderResult["usage"] {
  const usage = (raw.usage ?? raw.usage_metadata ?? {}) as Record<string, unknown>;
  const inputTokens =
    Number(
      usage.input_tokens ??
        usage.total_input_tokens ??
        usage.prompt_token_count ??
        usage.promptTokenCount ??
        0,
    ) || 0;
  const outputTokens =
    Number(
      usage.output_tokens ??
        usage.total_output_tokens ??
        usage.candidates_token_count ??
        usage.candidatesTokenCount ??
        0,
    ) || 0;
  const thinkingTokens =
    Number(
      usage.thinking_tokens ??
        usage.total_thought_tokens ??
        usage.thoughts_token_count ??
        usage.thoughtsTokenCount ??
        usage.reasoning_tokens ??
        0,
    ) || undefined;
  const cachedInputTokens =
    Number(usage.cached_input_tokens ?? usage.total_cached_tokens ?? usage.cachedTokenCount ?? 0) ||
    undefined;
  return {
    inputTokens,
    outputTokens,
    thinkingTokens: thinkingTokens && thinkingTokens > 0 ? thinkingTokens : undefined,
    cachedInputTokens: cachedInputTokens && cachedInputTokens > 0 ? cachedInputTokens : undefined,
  };
}

export type GeminiLiveCallInput = {
  /** Exact model id. Stage-1 production path still passes gemini-4-argon. */
  model: string;
  input: string;
  thinkingLevel: "high" | "medium" | "low";
  maxOutputTokens: number;
  requestDispatched?: boolean;
};

/**
 * Google Gemini Interactions API (generativelanguage.googleapis.com).
 * Auth: x-goog-api-key only (never Authorization Bearer / ADC).
 * Never logs API keys. No tools / grounding / code execution.
 */
export async function executeGeminiInteractions(
  options: LiveClientOptions,
  input: GeminiLiveCallInput,
): Promise<LiveProviderResult> {
  const baseUrl = (options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(
    /\/$/,
    "",
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = buildGeminiInteractionsWireBody({
    model: input.model,
    input: input.input,
    thinkingLevel: input.thinkingLevel,
    maxOutputTokens: input.maxOutputTokens,
  });
  if (body.model !== input.model) {
    throw new LiveProviderError({
      code: "BAD_REQUEST",
      provider: "google",
      message: "Gemini request model mismatch",
      retryable: false,
    });
  }

  const started = Date.now();
  let dispatched = Boolean(input.requestDispatched);
  let response: Response;
  try {
    dispatched = true;
    response = await fetchImpl(`${baseUrl}/interactions`, {
      method: "POST",
      headers: {
        "x-goog-api-key": options.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_LIVE_TIMEOUT_MS),
    });
  } catch (err) {
    throw classifyFetchFailure({ provider: "google", dispatched, err });
  }

  const bodyText = await response.text();
  if (!response.ok) {
    throw classifyHttpStatus("google", response.status, bodyText);
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    throw new LiveProviderError({
      code: "TEMPORARY_PROVIDER_ERROR",
      provider: "google",
      message: "Gemini returned non-JSON body",
      retryable: true,
      completionKnownIncomplete: true,
    });
  }

  const text = extractGeminiText(raw);
  if (!text) {
    if (isGeminiContentFilterOrRefusal(raw)) {
      throw new LiveProviderError({
        code: "CONTENT_FILTER_OR_REFUSAL",
        provider: "google",
        message: "Gemini content filter/refusal (no usable text)",
        retryable: false,
      });
    }
    throw new LiveProviderError({
      code: "NON_RETRYABLE_PROVIDER_ERROR",
      provider: "google",
      message: `Gemini response missing text output (status=${String(raw.status ?? "unknown")}; no content-filter signal)`,
      retryable: false,
      completionKnownIncomplete: true,
    });
  }

  return {
    provider: "google",
    exactModelId: input.model,
    text,
    raw,
    usage: extractGeminiUsage(raw),
    latencyMs: Date.now() - started,
    providerRequestId:
      (typeof raw.id === "string" ? raw.id : null) ??
      response.headers.get("x-request-id") ??
      response.headers.get("request-id"),
    finishReason: typeof raw.status === "string" ? raw.status : null,
    completionStatus: "success",
  };
}
