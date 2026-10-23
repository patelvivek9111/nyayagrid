import { describe, expect, it, vi } from "vitest";
import { freezeRunManifest, hashRunConfig } from "../src/live/manifest.js";
import { persistPaidCallImmediately } from "../src/live/persistence.js";
import { buildCacheKey } from "../src/live/cache-key.js";
import { isResponseCacheHit } from "../src/live/response-cache.js";
import { isJudgeCacheHit } from "../src/live/judge-cache.js";
import { assertNextCallWithinBudget, BudgetLimitError, recordSpend } from "../src/live/budget.js";
import { UnknownCompletionError, assertCompletionKnown } from "../src/live/retry.js";
import { autoStartStage2FromStage1, mayStartStage } from "../src/live/stage-gate.js";
import { calculateActualCostUsd } from "../src/live/cost-accounting.js";
import {
  classifyHttpStatus,
  isRetryableLiveError,
  LiveProviderError,
} from "../src/providers/live-errors.js";
import { executeOpenAiResponses } from "../src/providers/openai-live.js";
import { executeAnthropicMessages } from "../src/providers/anthropic-live.js";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("OpenAI response normalization", () => {
  it("captures text, usage, reasoning tokens, request id", async () => {
    const result = await executeOpenAiResponses(
      {
        apiKey: "sk-test-secret",
        fetchImpl: async () =>
          jsonResponse(
            {
              id: "resp_123",
              status: "completed",
              output_text: "Bench answer",
              usage: {
                input_tokens: 10,
                output_tokens: 5,
                output_tokens_details: { reasoning_tokens: 2 },
              },
            },
            200,
            { "x-request-id": "req-oa" },
          ),
      },
      {
        model: "gpt-6.1-sol",
        effort: "high",
        maxOutputTokens: 4096,
        input: [{ role: "user", content: "q" }],
      },
    );
    expect(result.text).toBe("Bench answer");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, reasoningTokens: 2 });
    expect(result.providerRequestId).toBe("resp_123");
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
  });
});

describe("Anthropic judge normalization", () => {
  it("captures text and usage without logging api key", async () => {
    const result = await executeAnthropicMessages(
      {
        apiKey: "anthropic-secret-key",
        fetchImpl: async () =>
          jsonResponse({
            id: "msg_1",
            stop_reason: "end_turn",
            content: [{ type: "text", text: '{"score":0.8,"rationale":"ok"}' }],
            usage: { input_tokens: 12, output_tokens: 8 },
          }),
      },
      {
        model: "claude-sonnet-5-5",
        effort: "medium",
        maxTokens: 2048,
        messages: [{ role: "user", content: "judge" }],
      },
    );
    expect(result.text).toContain('"score":0.8');
    expect(result.usage.inputTokens).toBe(12);
    expect(JSON.stringify(result)).not.toContain("anthropic-secret-key");
  });
});

describe("OpenAI judge normalization", () => {
  it("uses medium effort and 2048 max tokens via builder path", async () => {
    const captured: { body?: Record<string, unknown> } = {};
    await executeOpenAiResponses(
      {
        apiKey: "sk-judge",
        fetchImpl: async (_url, init) => {
          captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return jsonResponse({
            id: "resp_j",
            status: "completed",
            output_text: '{"score":0.7,"rationale":"fine"}',
            usage: { input_tokens: 3, output_tokens: 2 },
          });
        },
      },
      {
        model: "gpt-6.1-sol",
        effort: "medium",
        maxOutputTokens: 2048,
        input: [{ role: "user", content: "j" }],
      },
    );
    expect(captured.body?.reasoning).toEqual({ effort: "medium" });
    expect(captured.body?.max_output_tokens).toBe(2048);
    expect(captured.body?.model).toBe("gpt-6.1-sol");
  });
});

describe("cost accounting", () => {
  it("calculates actual cost from frozen pricing", () => {
    expect(
      calculateActualCostUsd({
        modelId: "gpt-6.1-sol",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        bucket: "models",
      }),
    ).toBeCloseTo(12, 5);
  });
});

describe("error classification", () => {
  it("auth failure is non-retryable", () => {
    const err = classifyHttpStatus("openai", 401, "unauthorized");
    expect(err.code).toBe("AUTH_ERROR");
    expect(isRetryableLiveError(err)).toBe(false);
  });

  it("429 is retryable", () => {
    const err = classifyHttpStatus("openai", 429, "rate");
    expect(err.code).toBe("RATE_LIMIT");
    expect(isRetryableLiveError(err)).toBe(true);
  });

  it("5xx is retryable", () => {
    const err = classifyHttpStatus("anthropic", 503, "busy");
    expect(err.code).toBe("TEMPORARY_PROVIDER_ERROR");
    expect(isRetryableLiveError(err)).toBe(true);
  });

  it("400 is non-retryable", () => {
    const err = classifyHttpStatus("openai", 400, "bad schema");
    expect(err.code).toBe("BAD_REQUEST");
    expect(isRetryableLiveError(err)).toBe(false);
  });

  it("model-not-found is non-retryable", () => {
    const err = classifyHttpStatus("openai", 404, "model_not_found");
    expect(err.code).toBe("MODEL_NOT_FOUND");
    expect(isRetryableLiveError(err)).toBe(false);
  });

  it("context overflow is non-retryable", () => {
    const err = classifyHttpStatus("openai", 400, "maximum context length exceeded");
    expect(err.code).toBe("CONTEXT_OVERFLOW");
    expect(isRetryableLiveError(err)).toBe(false);
  });
});

describe("unknown completion", () => {
  it("transport after dispatch is UNKNOWN_COMPLETION and not retryable", async () => {
    await expect(
      executeOpenAiResponses(
        {
          apiKey: "sk-test",
          fetchImpl: async () => {
            throw new Error("socket reset");
          },
        },
        {
          model: "gpt-6.1-sol",
          effort: "high",
          maxOutputTokens: 10,
          input: "x",
        },
      ),
    ).rejects.toMatchObject({
      code: "UNKNOWN_COMPLETION",
      retryable: false,
    } satisfies Partial<LiveProviderError>);
  });

  it("assertCompletionKnown throws review-required error", () => {
    expect(() => assertCompletionKnown(false)).toThrow(UnknownCompletionError);
  });
});

describe("budget", () => {
  it("blocks before request when worst-case would exceed", () => {
    expect(() => assertNextCallWithinBudget({ maxUsd: 1, spentUsd: 0.9 }, 0.2)).toThrow(
      BudgetLimitError,
    );
  });

  it("records spend after success", () => {
    expect(recordSpend({ maxUsd: 1, spentUsd: 0.1 }, 0.2).spentUsd).toBeCloseTo(0.3);
  });
});

describe("cache + persistence", () => {
  it("response cache hit prevents provider call need; judge cache independent", () => {
    const runId = `cache-test-${Date.now()}`;
    const config = { suite: "c", models: ["gpt-6.1-sol"] };
    const configHash = hashRunConfig(config);
    freezeRunManifest(runId, {
      runId,
      configHash,
      suite: config,
      models: config.models,
      budgetMaxUsd: 1,
    });
    const key = buildCacheKey({
      revision: "r",
      taskId: "t",
      contentHash: "h",
      provider: "openai",
      modelId: "gpt-6.1-sol",
      settingsHash: "s",
      promptHashes: ["p"],
      schemaVersion: 1,
      kind: "response",
    });
    persistPaidCallImmediately({
      runId,
      benchmarkId: "prbench",
      taskId: "t",
      provider: "openai",
      exactModelId: "gpt-6.1-sol",
      modelConfiguration: {},
      promptVersionHash: "p",
      datasetRevision: "r",
      inputHash: "h",
      response: { ok: true },
      structuredParsedResponse: { text: "cached" },
      usage: { inputTokens: 1, outputTokens: 1 },
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      providerRequestId: "id",
      timestamp: new Date().toISOString(),
      attemptNumber: 1,
      costEstimateUsd: 0.01,
      completionStatus: "success",
      cacheKey: key,
      kind: "response",
    });
    expect(isResponseCacheHit(runId, key)).toBe(true);

    const judgeKey = buildCacheKey({
      revision: "r",
      taskId: "t::judge",
      contentHash: "rh",
      provider: "anthropic",
      modelId: "claude-sonnet-5-5",
      settingsHash: "s",
      promptHashes: ["jp"],
      schemaVersion: 1,
      kind: "judge",
    });
    persistPaidCallImmediately({
      runId,
      benchmarkId: "prbench",
      taskId: "t::judge",
      provider: "anthropic",
      exactModelId: "claude-sonnet-5-5",
      modelConfiguration: {},
      promptVersionHash: "jp",
      datasetRevision: "r",
      inputHash: "rh",
      response: {},
      structuredParsedResponse: { score: 0.5 },
      usage: { inputTokens: 1, outputTokens: 1 },
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      providerRequestId: "j",
      timestamp: new Date().toISOString(),
      attemptNumber: 1,
      costEstimateUsd: 0.01,
      completionStatus: "success",
      cacheKey: judgeKey,
      kind: "judge",
    });
    expect(isJudgeCacheHit(runId, judgeKey)).toBe(true);
    // Response persisted before judge: both keys independent.
    expect(key).not.toBe(judgeKey);
  });
});

describe("stage isolation", () => {
  it("Stage 1 auto-start of Stage 2 remains impossible", () => {
    expect(autoStartStage2FromStage1()).toBe(false);
    expect(mayStartStage(2, [])).toBe(false);
    expect(mayStartStage(3, [1])).toBe(false);
  });
});

describe("HTTP error surfaces from live clients", () => {
  it("surfaces AUTH_ERROR from OpenAI", async () => {
    await expect(
      executeOpenAiResponses(
        {
          apiKey: "sk-bad",
          fetchImpl: async () => new Response("unauthorized", { status: 401 }),
        },
        {
          model: "gpt-6.1-sol",
          effort: "high",
          maxOutputTokens: 10,
          input: "x",
        },
      ),
    ).rejects.toMatchObject({ code: "AUTH_ERROR" });
  });

  it("surfaces RATE_LIMIT from Anthropic", async () => {
    await expect(
      executeAnthropicMessages(
        {
          apiKey: "k",
          fetchImpl: async () => new Response("rate", { status: 429 }),
        },
        {
          model: "claude-sonnet-5-5",
          effort: "medium",
          maxTokens: 10,
          messages: [{ role: "user", content: "x" }],
        },
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMIT", retryable: true });
  });
});

describe("no secret logging helper", () => {
  it("does not include Authorization header in thrown error message body dumps for 400", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await expect(
        executeOpenAiResponses(
          {
            apiKey: "sk-should-never-appear",
            fetchImpl: async () => new Response("bad", { status: 400 }),
          },
          {
            model: "gpt-6.1-sol",
            effort: "high",
            maxOutputTokens: 10,
            input: "x",
          },
        ),
      ).rejects.toBeInstanceOf(LiveProviderError);
      expect(spy.mock.calls.flat().join(" ")).not.toContain("sk-should-never-appear");
    } finally {
      spy.mockRestore();
    }
  });
});
