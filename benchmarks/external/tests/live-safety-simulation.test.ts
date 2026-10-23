import { describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { FakeProvider } from "../src/providers/dummy.js";
import { freezeRunManifest, hashRunConfig } from "../src/live/manifest.js";
import { evaluateResumeSkip } from "../src/live/resume.js";
import { buildCacheKey } from "../src/live/cache-key.js";
import { persistPaidCallImmediately, writeCacheEntryFile } from "../src/live/persistence.js";
import { isResponseCacheHit } from "../src/live/response-cache.js";
import { isJudgeCacheHit } from "../src/live/judge-cache.js";
import {
  assertNextCallWithinBudget,
  BudgetLimitError,
  recordSpend,
} from "../src/live/budget.js";
import { assertCompletionKnown, UnknownCompletionError } from "../src/live/retry.js";
import { autoStartStage2FromStage1, mayStartStage } from "../src/live/stage-gate.js";
import { scoreFromSavedResponses } from "../src/live/offline-score.js";
import { getCacheDir } from "../src/paths.js";
import {
  buildAnthropicMessagesRequest,
  buildOpenAiResponsesRequest,
  buildGeminiInteractionsRequest,
  buildXaiResponsesRequest,
  xaiPricingTierForPromptTokens,
} from "../src/providers/request-builders.js";

describe("live safety simulation (fake provider only)", () => {
  it("persists, resumes, judge-only resume, budget stop, unknown completion, stage isolation", () => {
    const runId = `sim-${Date.now()}`;
    const config = { suite: "sim", models: ["dummy/fixture"] };
    const configHash = hashRunConfig(config);
    try {
      freezeRunManifest(runId, {
        runId,
        configHash,
        suite: config,
        models: config.models,
        budgetMaxUsd: 1,
      });

      const provider = new FakeProvider({ modelId: "dummy/fixture" });
      const callCount = { n: 0 };
      const completeOnce = (taskId: string) => {
        callCount.n += 1;
        return provider.complete({
          taskId,
          benchmarkId: "prbench",
          messages: [{ role: "user", content: `task ${taskId}` }],
        });
      };

      const taskId = "sim-task-1";
      const responseKey = buildCacheKey({
        revision: "sim",
        taskId,
        contentHash: "abc",
        provider: "dummy",
        modelId: "dummy/fixture",
        settingsHash: "effort-high",
        promptHashes: ["sys", "user"],
        schemaVersion: 1,
        kind: "response",
      });
      const judgeKey = buildCacheKey({
        revision: "sim",
        taskId: `${taskId}::judge`,
        contentHash: "resp-hash",
        provider: "dummy-judge",
        modelId: "dummy/judge",
        settingsHash: "effort-medium",
        promptHashes: ["judge-sys", "judge-user"],
        schemaVersion: 1,
        kind: "judge",
      });

      const response = completeOnce(taskId);
      persistPaidCallImmediately({
        runId,
        benchmarkId: "prbench",
        taskId,
        provider: "dummy",
        exactModelId: "dummy/fixture",
        modelConfiguration: { effort: "high" },
        promptVersionHash: "sys",
        datasetRevision: "sim",
        inputHash: "abc",
        response,
        structuredParsedResponse: { text: response.content },
        usage: response.usage,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        latencyMs: 1,
        providerRequestId: "req-1",
        timestamp: new Date().toISOString(),
        attemptNumber: 1,
        costEstimateUsd: 0.01,
        completionStatus: "success",
        cacheKey: responseKey,
        kind: "response",
      });
      expect(isResponseCacheHit(runId, responseKey)).toBe(true);

      let skip = evaluateResumeSkip({
        runId,
        config,
        responseCacheKey: responseKey,
        judgeCacheKey: judgeKey,
      });
      expect(skip.skipResponse).toBe(true);
      expect(skip.skipJudge).toBe(false);

      writeCacheEntryFile(runId, "judge", judgeKey, {
        score: 0.8,
        status: "success",
      });
      expect(isJudgeCacheHit(runId, judgeKey)).toBe(true);
      skip = evaluateResumeSkip({
        runId,
        config,
        responseCacheKey: responseKey,
        judgeCacheKey: judgeKey,
      });
      expect(skip.skipResponse).toBe(true);
      expect(skip.skipJudge).toBe(true);

      const before = callCount.n;
      if (!skip.skipResponse) completeOnce(taskId);
      expect(callCount.n).toBe(before);

      let budget = { maxUsd: 0.05, spentUsd: 0.04 };
      expect(() => assertNextCallWithinBudget(budget, 0.02)).toThrow(BudgetLimitError);
      budget = { maxUsd: 0.05, spentUsd: 0.03 };
      budget = recordSpend(budget, 0.01);
      expect(() => assertNextCallWithinBudget(budget, 0.005)).not.toThrow();

      expect(() => assertCompletionKnown(false)).toThrow(UnknownCompletionError);

      expect(autoStartStage2FromStage1()).toBe(false);
      expect(mayStartStage(2, [])).toBe(false);
      expect(mayStartStage(2, [1])).toBe(true); // explicit Stage-2 allowed only after Stage-1; never auto
      expect(mayStartStage(1, [])).toBe(true);

      const scored = scoreFromSavedResponses({
        runId,
        scoreFn: () => 1,
      });
      expect(scored.scored).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
    }
  });
});

describe("adapter request builders (no network)", () => {
  it("builds fair Stage-1 bodies and forbids Anthropic temperature", () => {
    expect(buildOpenAiResponsesRequest({ input: "q" }).reasoning.effort).toBe("high");
    expect(
      buildAnthropicMessagesRequest({
        model: "claude-opus-5-5",
        messages: [{ role: "user", content: "q" }],
      }).thinking.type,
    ).toBe("adaptive");
    expect(() =>
      buildAnthropicMessagesRequest({
        model: "claude-opus-5-5",
        messages: [{ role: "user", content: "q" }],
        temperature: 0,
      }),
    ).toThrow(/forbids temperature/);
    expect(buildGeminiInteractionsRequest({ input: "q" }).thinking_level).toBe("high");
    expect(buildXaiResponsesRequest({ input: "q" }).reasoning.effort).toBe("high");
    expect(xaiPricingTierForPromptTokens(1000).tier).toBe("short");
    expect(xaiPricingTierForPromptTokens(200000).tier).toBe("long");
  });
});
