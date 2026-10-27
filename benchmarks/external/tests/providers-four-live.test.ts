import { describe, expect, it } from "vitest";
import { executeOpenAiResponses } from "../src/providers/openai-live.js";
import { executeAnthropicMessages } from "../src/providers/anthropic-live.js";
import {
  buildGeminiInteractionsWireBody,
  executeGeminiInteractions,
} from "../src/providers/gemini-live.js";
import { executeXaiResponses } from "../src/providers/xai-live.js";
import { LiveProviderError } from "../src/providers/live-errors.js";
import { assertSameModelPinned, ModelSwapForbiddenError } from "../src/live/no-fallback.js";
import { calculateActualCostUsd, worstCaseCostForBudgetGate } from "../src/live/cost-accounting.js";
import { xaiPricingTierForPromptTokens } from "../src/providers/request-builders.js";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("four-provider live clients (mock fetch)", () => {
  it("OpenAI success normalizes text, usage, request id", async () => {
    const result = await executeOpenAiResponses(
      {
        apiKey: "sk-test",
        fetchImpl: async () =>
          jsonResponse(
            {
              id: "resp_oa",
              status: "completed",
              output_text: "openai answer",
              usage: {
                input_tokens: 11,
                output_tokens: 7,
                output_tokens_details: { reasoning_tokens: 3 },
              },
            },
            200,
          ),
      },
      {
        model: "gpt-6.1-sol",
        effort: "high",
        maxOutputTokens: 4096,
        input: [{ role: "user", content: "q" }],
      },
    );
    expect(result.provider).toBe("openai");
    expect(result.exactModelId).toBe("gpt-6.1-sol");
    expect(result.text).toBe("openai answer");
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7, reasoningTokens: 3 });
    expect(result.providerRequestId).toBe("resp_oa");
  });

  it("Anthropic Opus success (distinct from Sonnet judge)", async () => {
    const result = await executeAnthropicMessages(
      {
        apiKey: "anthropic-secret",
        fetchImpl: async () =>
          jsonResponse({
            id: "msg_opus",
            stop_reason: "end_turn",
            content: [{ type: "text", text: "opus answer" }],
            usage: { input_tokens: 20, output_tokens: 9, thinking_tokens: 4 },
          }),
      },
      {
        model: "claude-opus-5-5",
        effort: "high",
        maxTokens: 4096,
        messages: [{ role: "user", content: "q" }],
      },
    );
    expect(result.provider).toBe("anthropic");
    expect(result.exactModelId).toBe("claude-opus-5-5");
    expect(result.text).toBe("opus answer");
    expect(result.usage.thinkingTokens).toBe(4);
    expect(result.providerRequestId).toBe("msg_opus");
    expect(JSON.stringify(result)).not.toContain("anthropic-secret");
  });

  it("Gemini success with thinking tokens and wire generation_config", async () => {
    const wire = buildGeminiInteractionsWireBody({
      input: "q",
      thinkingLevel: "high",
      maxOutputTokens: 4096,
    });
    expect(wire.model).toBe("gemini-4-argon");
    expect((wire.generation_config as { thinking_level: string }).thinking_level).toBe("high");
    expect(wire).not.toHaveProperty("temperature");

    const result = await executeGeminiInteractions(
      {
        apiKey: "google-secret",
        fetchImpl: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          expect(body.generation_config).toEqual({
            thinking_level: "high",
            max_output_tokens: 4096,
          });
          expect(body).not.toHaveProperty("temperature");
          return jsonResponse({
            id: "interaction_1",
            status: "completed",
            output_text: "gemini answer",
            usage: { input_tokens: 15, output_tokens: 8, thinking_tokens: 12 },
          });
        },
      },
      {
        model: "gemini-4-argon",
        thinkingLevel: "high",
        maxOutputTokens: 4096,
        input: "q",
      },
    );
    expect(result.provider).toBe("google");
    expect(result.exactModelId).toBe("gemini-4-argon");
    expect(result.usage.thinkingTokens).toBe(12);
    expect(result.providerRequestId).toBe("interaction_1");
  });

  it("Grok success with cached input tokens", async () => {
    const result = await executeXaiResponses(
      {
        apiKey: "xai-secret",
        fetchImpl: async () =>
          jsonResponse({
            id: "resp_xai",
            status: "completed",
            output_text: "grok answer",
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              cached_input_tokens: 40,
              output_tokens_details: { reasoning_tokens: 5 },
            },
          }),
      },
      {
        model: "grok-4.7",
        effort: "high",
        maxOutputTokens: 4096,
        input: [{ role: "user", content: "q" }],
      },
    );
    expect(result.provider).toBe("xai");
    expect(result.exactModelId).toBe("grok-4.7");
    expect(result.usage.cachedInputTokens).toBe(40);
    expect(result.usage.reasoningTokens).toBe(5);
  });

  it("classifies auth, 429, 5xx, model not found, overflow, refusal", async () => {
    await expect(
      executeGeminiInteractions(
        {
          apiKey: "k",
          fetchImpl: async () => new Response("invalid key", { status: 401 }),
        },
        {
          model: "gemini-4-argon",
          thinkingLevel: "high",
          maxOutputTokens: 4096,
          input: "q",
        },
      ),
    ).rejects.toMatchObject({ code: "AUTH_ERROR" });

    await expect(
      executeXaiResponses(
        {
          apiKey: "k",
          fetchImpl: async () => new Response("rate", { status: 429 }),
        },
        { model: "grok-4.7", effort: "high", maxOutputTokens: 4096, input: "q" },
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMIT" });

    await expect(
      executeAnthropicMessages(
        {
          apiKey: "k",
          fetchImpl: async () => new Response("boom", { status: 503 }),
        },
        {
          model: "claude-opus-5-5",
          effort: "high",
          maxTokens: 4096,
          messages: [{ role: "user", content: "q" }],
        },
      ),
    ).rejects.toMatchObject({ code: "TEMPORARY_PROVIDER_ERROR" });

    await expect(
      executeOpenAiResponses(
        {
          apiKey: "k",
          fetchImpl: async () => new Response("model does not exist", { status: 404 }),
        },
        {
          model: "gpt-6.1-sol",
          effort: "high",
          maxOutputTokens: 4096,
          input: "q",
        },
      ),
    ).rejects.toMatchObject({ code: "MODEL_NOT_FOUND" });

    await expect(
      executeGeminiInteractions(
        {
          apiKey: "k",
          fetchImpl: async () => new Response("prompt is too long", { status: 400 }),
        },
        {
          model: "gemini-4-argon",
          thinkingLevel: "high",
          maxOutputTokens: 4096,
          input: "q",
        },
      ),
    ).rejects.toMatchObject({ code: "CONTEXT_OVERFLOW" });

    await expect(
      executeXaiResponses(
        {
          apiKey: "k",
          fetchImpl: async () => jsonResponse({ id: "x", output_text: "" }),
        },
        { model: "grok-4.7", effort: "high", maxOutputTokens: 4096, input: "q" },
      ),
    ).rejects.toMatchObject({ code: "CONTENT_FILTER_OR_REFUSAL" });
  });

  it("post-dispatch transport failure is TRANSPORT_POST_DISPATCH_UNKNOWN", async () => {
    await expect(
      executeGeminiInteractions(
        {
          apiKey: "k",
          fetchImpl: async () => {
            throw new Error("socket reset");
          },
        },
        {
          model: "gemini-4-argon",
          thinkingLevel: "high",
          maxOutputTokens: 4096,
          input: "q",
        },
      ),
    ).rejects.toBeInstanceOf(LiveProviderError);
    await expect(
      executeGeminiInteractions(
        {
          apiKey: "k",
          fetchImpl: async () => {
            throw new Error("socket reset");
          },
        },
        {
          model: "gemini-4-argon",
          thinkingLevel: "high",
          maxOutputTokens: 4096,
          input: "q",
        },
      ),
    ).rejects.toMatchObject({ code: "TRANSPORT_POST_DISPATCH_UNKNOWN", retryable: false });
  });

  it("no fallback / model swap forbidden", () => {
    expect(() => assertSameModelPinned("claude-opus-5-5", "claude-sonnet-5-5")).toThrow(
      ModelSwapForbiddenError,
    );
  });
});

describe("Stage-1 pricing accounting", () => {
  it("bills Gemini thinking tokens as output", () => {
    const without = calculateActualCostUsd({
      modelId: "gemini-4-argon",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    const withThinking = calculateActualCostUsd({
      modelId: "gemini-4-argon",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      thinkingTokens: 500_000,
    });
    expect(withThinking).toBeGreaterThan(without);
    expect(withThinking - without).toBeCloseTo(5); // 0.5M * $10/1M
  });

  it("applies xAI cached discount and long-context threshold", () => {
    expect(xaiPricingTierForPromptTokens(1000).tier).toBe("short");
    expect(xaiPricingTierForPromptTokens(200_000).tier).toBe("long");
    const short = calculateActualCostUsd({
      modelId: "grok-4.7",
      inputTokens: 10_000,
      outputTokens: 0,
      cachedInputTokens: 5_000,
    });
    // short tier $2/1M: 5k uncached * $2 + 5k cached * $0.2 = 0.01 + 0.001 = 0.011
    expect(short).toBeCloseTo(0.011);
    const longWorst = worstCaseCostForBudgetGate({
      modelId: "grok-4.7",
      estimatedInputTokens: 200_000,
      maxOutputTokens: 0,
    });
    expect(longWorst).toBeCloseTo((200_000 / 1_000_000) * 4);
  });
});
