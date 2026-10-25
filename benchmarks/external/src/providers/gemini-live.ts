import { buildGeminiInteractionsRequest } from "./request-builders.js";
import { classifyHttpStatus, LiveProviderError } from "./live-errors.js";
import type { LiveClientOptions, LiveProviderResult } from "./live-types.js";

/**
 * Map frozen Stage-1 semantic settings onto Gemini Interactions API wire shape.
 * thinking_level / max_output_tokens live under generation_config.
 */
export function buildGeminiInteractionsWireBody(input: {
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

function extractGeminiText(raw: Record<string, unknown>): string {
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
      if (Array.isArray(o.content)) {
        for (const c of o.content) {
          if (c && typeof c === "object") {
            const p = c as { type?: string; text?: string };
            if (typeof p.text === "string") parts.push(p.text);
          }
        }
      }
    }
    if (parts.length) return parts.join("\n").trim();
  }
  const steps = raw.steps;
  if (Array.isArray(steps)) {
    const parts: string[] = [];
    for (const step of steps) {
      if (!step || typeof step !== "object") continue;
      const s = step as { type?: string; content?: unknown };
      if (s.type !== "model_output") continue;
      if (!Array.isArray(s.content)) continue;
      for (const c of s.content) {
        if (c && typeof c === "object") {
          const p = c as { type?: string; text?: string };
          if ((p.type === "text" || !p.type) && typeof p.text === "string") parts.push(p.text);
        }
      }
    }
    if (parts.length) return parts.join("\n").trim();
  }
  return "";
}

function extractGeminiUsage(raw: Record<string, unknown>): LiveProviderResult["usage"] {
  const usage = (raw.usage ?? raw.usage_metadata ?? {}) as Record<string, unknown>;
  const inputTokens =
    Number(usage.input_tokens ?? usage.prompt_token_count ?? usage.promptTokenCount ?? 0) || 0;
  const outputTokens =
    Number(
      usage.output_tokens ?? usage.candidates_token_count ?? usage.candidatesTokenCount ?? 0,
    ) || 0;
  const thinkingTokens =
    Number(
      usage.thinking_tokens ??
        usage.thoughts_token_count ??
        usage.thoughtsTokenCount ??
        usage.reasoning_tokens ??
        0,
    ) || undefined;
  return {
    inputTokens,
    outputTokens,
    thinkingTokens: thinkingTokens && thinkingTokens > 0 ? thinkingTokens : undefined,
  };
}

export type GeminiLiveCallInput = {
  model: "gemini-4-argon";
  input: string;
  thinkingLevel: "high";
  maxOutputTokens: number;
  requestDispatched?: boolean;
};

/**
 * Google Gemini Interactions API for Stage-1 responses (gemini-4-argon).
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
      signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (dispatched) {
      throw new LiveProviderError({
        code: "UNKNOWN_COMPLETION",
        provider: "google",
        message: `Gemini transport failure after dispatch: ${message}`,
        retryable: false,
        completionKnownIncomplete: false,
      });
    }
    throw new LiveProviderError({
      code: "TRANSPORT_ERROR",
      provider: "google",
      message: `Gemini transport error: ${message}`,
      retryable: true,
      completionKnownIncomplete: true,
    });
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
    throw new LiveProviderError({
      code: "CONTENT_FILTER_OR_REFUSAL",
      provider: "google",
      message: "Gemini response missing text output",
      retryable: false,
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
