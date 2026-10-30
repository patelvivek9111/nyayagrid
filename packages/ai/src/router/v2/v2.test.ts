import { describe, expect, it } from "vitest";
import type { AiGenerateRequest, AIProvider } from "../../provider-contract";
import { FakeProvider } from "../providers/fake";
import { NyayaRouter } from "../router";
import { ProviderError, RouterUnavailableError } from "../errors";
import {
  BENCHMARK_EVIDENCE_LABELS,
  BENCHMARK_MODEL_REGISTRY,
  BenchmarkRouterPolicyError,
  PINNED_BENCHMARK_MODEL_IDS,
  isIllegalHighStakesDowngrade,
  isModelRouterV2Enabled,
  planBenchmarkRoute,
  planHighStakesFallback,
  resolveFallbackAfterPrimaryFailure,
} from "./index";

function req(partial?: Partial<AiGenerateRequest>): AiGenerateRequest {
  return {
    messages: [{ role: "user", content: "What is the holding?" }],
    ...partial,
  };
}

function jsonOk(provider: string, model: string): AIProvider {
  return new FakeProvider({
    name: provider,
    model,
    behavior: { type: "json", payload: { ok: true } },
  });
}

describe("benchmark model registry", () => {
  it("pins exact Stage-2 / challenger model IDs", () => {
    const ids = BENCHMARK_MODEL_REGISTRY.map((m) => m.modelId).sort();
    expect(ids).toEqual(["claude-opus-5-5", "gemini-4-argon", "gpt-6.1-sol", "grok-4.7"].sort());
  });

  it("certifies Claude/Grok for high-stakes and blocks Gemini", () => {
    const claude = BENCHMARK_MODEL_REGISTRY.find((m) => m.modelId === "claude-opus-5-5")!;
    const grok = BENCHMARK_MODEL_REGISTRY.find((m) => m.modelId === "grok-4.7")!;
    const gpt = BENCHMARK_MODEL_REGISTRY.find((m) => m.modelId === "gpt-6.1-sol")!;
    const gemini = BENCHMARK_MODEL_REGISTRY.find((m) => m.modelId === "gemini-4-argon")!;
    expect(claude.highStakesLegalAllowed).toBe(true);
    expect(claude.routingTiers).toEqual([1]);
    expect(grok.highStakesLegalAllowed).toBe(true);
    expect(grok.routingTiers).toEqual([2]);
    expect(gpt.highStakesLegalAllowed).toBe(false);
    expect(gpt.routingTiers).toEqual([3]);
    expect(gemini.highStakesLegalAllowed).toBe(false);
    expect(gemini.experimental).toBe(true);
    expect(gemini.routingTiers).toEqual([4]);
    expect(claude.benchmarkEvidenceLabel).toBe(BENCHMARK_EVIDENCE_LABELS.claudeStage2);
    expect(gemini.benchmarkEvidenceLabel).toBe(BENCHMARK_EVIDENCE_LABELS.geminiChallenger);
  });
});

describe("feature flag", () => {
  it("defaults OFF", () => {
    expect(isModelRouterV2Enabled({})).toBe(false);
    expect(isModelRouterV2Enabled({ FEATURE_NYAYA_MODEL_ROUTER_V2: "0" })).toBe(false);
  });

  it("enables on explicit truthy env", () => {
    expect(isModelRouterV2Enabled({ FEATURE_NYAYA_MODEL_ROUTER_V2: "1" })).toBe(true);
  });
});

describe("task → tier mapping", () => {
  it("selects Claude for Tier-1 hard legal reasoning", () => {
    const { decision } = planBenchmarkRoute({
      request: req({
        routing: { benchmarkTaskCategory: "HARD_LEGAL_REASONING" },
      }),
    });
    expect(decision.routingTier).toBe(1);
    expect(decision.selectedModelId).toBe(PINNED_BENCHMARK_MODEL_IDS.claude);
    expect(decision.fallbackModelId).toBe(PINNED_BENCHMARK_MODEL_IDS.grok);
    expect(decision.afterFallbackFailure).toBe("FAIL_CLOSED");
    expect(decision.highStakesLegal).toBe(true);
  });

  it("selects GPT for Tier-3 structured extraction", () => {
    const { decision } = planBenchmarkRoute({
      request: req({
        routing: { benchmarkTaskCategory: "STRUCTURED_EXTRACTION" },
      }),
    });
    expect(decision.routingTier).toBe(3);
    expect(decision.selectedModelId).toBe(PINNED_BENCHMARK_MODEL_IDS.gpt);
    expect(decision.highStakesLegal).toBe(false);
  });

  it("maps contradiction subsystem to Tier-1 conflict analysis", () => {
    const { decision } = planBenchmarkRoute({
      request: req({ schemaName: "contradiction_analysis" }),
    });
    expect(decision.routingTier).toBe(1);
    expect(decision.classification.taskCategory).toBe("CONFLICT_ANALYSIS");
    expect(decision.selectedModelId).toBe("claude-opus-5-5");
  });

  it("requires experimental opt-in for Tier-4 Gemini", () => {
    expect(() =>
      planBenchmarkRoute({
        request: req({ routing: { benchmarkTaskCategory: "EXPERIMENTAL" } }),
      }),
    ).toThrow(BenchmarkRouterPolicyError);

    const { decision } = planBenchmarkRoute({
      request: req({
        routing: {
          benchmarkTaskCategory: "EXPERIMENTAL",
          experimentalModelOptIn: true,
        },
      }),
      experimentalOptIn: true,
    });
    expect(decision.routingTier).toBe(4);
    expect(decision.selectedModelId).toBe("gemini-4-argon");
  });
});

describe("fallback policy", () => {
  it("allows Claude → Grok for Tier-1 and forbids GPT/Gemini", () => {
    const { decision } = planBenchmarkRoute({
      request: req({ routing: { highStakesLegal: true } }),
    });
    const plan = planHighStakesFallback({
      decision,
      primaryFailedModelId: "claude-opus-5-5",
      failureCode: "timeout",
    });
    expect(plan.allowed).toBe(true);
    expect(plan.toModelId).toBe("grok-4.7");
    expect(plan.reasonCode).toBe("PRIMARY_TIMEOUT");
    expect(isIllegalHighStakesDowngrade({ highStakesLegal: true, toModelId: "gpt-6.1-sol" })).toBe(
      true,
    );
    expect(
      isIllegalHighStakesDowngrade({ highStakesLegal: true, toModelId: "gemini-4-argon" }),
    ).toBe(true);
  });

  it("FAIL_CLOSED after Grok — never GPT or Gemini", () => {
    const { decision } = planBenchmarkRoute({
      request: req({ routing: { highStakesLegal: true } }),
    });
    const afterGrok = resolveFallbackAfterPrimaryFailure({
      decision: { ...decision, selectedModelId: "grok-4.7" },
      failureCode: "server_error",
    });
    expect(afterGrok.allowed).toBe(false);
    expect(afterGrok.failClosed).toBe(true);
    expect(afterGrok.toModelId).toBeNull();
  });

  it("budget exceeded emits warning without downgrading Tier-1", () => {
    const { decision } = planBenchmarkRoute({
      request: req({ routing: { highStakesLegal: true } }),
      budgetExceeded: true,
    });
    expect(decision.selectedModelId).toBe("claude-opus-5-5");
    expect(decision.budgetWarning).toBe(true);
    expect(decision.routingReason).toContain("BUDGET_WARNING_NO_DOWNGRADE");
  });
});

describe("NyayaRouter integration (flag OFF preserves legacy)", () => {
  it("does not activate benchmark models when flag OFF", async () => {
    const audits: Array<{ model: string; benchmarkRouterVersion?: string }> = [];
    const router = new NyayaRouter({
      providers: {
        mock: new FakeProvider({
          name: "mock",
          model: "mock-1",
          behavior: { type: "json", payload: { ok: true } },
        }),
      },
      envProvider: "mock",
      env: { AI_PROVIDER: "mock" },
      onAudit: (a) => audits.push(a),
    });
    const result = await router.generate(
      req({ routing: { highStakesLegal: true, subsystem: "ask" } }),
    );
    expect(result.model).not.toBe("claude-opus-5-5");
    expect(audits[0]?.benchmarkRouterVersion).toBeUndefined();
  });
});

describe("NyayaRouter integration (flag ON)", () => {
  it("selects Claude for high-stakes and falls back only to Grok", async () => {
    const audits: Array<{
      model: string;
      provider: string;
      benchmarkRouterVersion?: string;
      routingTier?: number;
      fallbackOccurred?: boolean;
      fallbackReasonCode?: string;
      fallbacks: Array<{ model: string; reason: string }>;
    }> = [];

    let anthropicCalls = 0;
    const failingClaude: AIProvider = {
      name: "anthropic",
      async generate() {
        anthropicCalls += 1;
        if (anthropicCalls === 1) {
          throw new ProviderError({
            provider: "anthropic",
            code: "timeout",
            message: "primary timeout",
            modelId: "claude-opus-5-5",
          });
        }
        return {
          text: '{"ok":true}',
          provider: "anthropic",
          model: "claude-opus-5-5",
        };
      },
    };

    const router = new NyayaRouter({
      providers: {
        anthropic: failingClaude,
        xai: jsonOk("xai", "grok-4.7"),
        openai: jsonOk("openai", "gpt-6.1-sol"),
        google: jsonOk("google", "gemini-4-argon"),
      },
      envProvider: "anthropic",
      env: {
        AI_PROVIDER: "anthropic",
        FEATURE_NYAYA_MODEL_ROUTER_V2: "1",
        APP_ENV: "development",
      },
      onAudit: (a) => audits.push(a),
    });

    const result = await router.generate(
      req({
        routing: {
          highStakesLegal: true,
          subsystem: "research",
        },
      }),
    );
    expect(result.model).toBe("grok-4.7");
    expect(audits[0]?.benchmarkRouterVersion).toBe("nyaya-model-router-v2");
    expect(audits[0]?.routingTier).toBe(1);
    expect(audits[0]?.fallbackOccurred).toBe(true);
    expect(audits[0]?.fallbackReasonCode).toBe("PRIMARY_TIMEOUT");
    expect(audits[0]?.fallbacks.some((f) => f.model === "grok-4.7")).toBe(true);
    expect(audits[0]?.fallbacks.some((f) => f.model === "gpt-6.1-sol")).toBe(false);
    expect(audits[0]?.fallbacks.some((f) => f.model === "gemini-4-argon")).toBe(false);
  });

  it("FAIL_CLOSED after Claude and Grok both fail — no GPT/Gemini", async () => {
    const fail = (provider: "anthropic" | "xai", model: string): AIProvider => ({
      name: provider,
      async generate() {
        throw new ProviderError({
          provider,
          code: "server_error",
          message: "down",
          modelId: model,
        });
      },
    });
    const gptCalls: string[] = [];
    const geminiCalls: string[] = [];
    const router = new NyayaRouter({
      providers: {
        anthropic: fail("anthropic", "claude-opus-5-5"),
        xai: fail("xai", "grok-4.7"),
        openai: {
          name: "openai",
          async generate() {
            gptCalls.push("called");
            return { text: "{}", provider: "openai", model: "gpt-6.1-sol" };
          },
        },
        google: {
          name: "google",
          async generate() {
            geminiCalls.push("called");
            return { text: "{}", provider: "google", model: "gemini-4-argon" };
          },
        },
      },
      envProvider: "anthropic",
      env: {
        AI_PROVIDER: "anthropic",
        FEATURE_NYAYA_MODEL_ROUTER_V2: "1",
        APP_ENV: "development",
      },
    });

    await expect(
      router.generate(req({ routing: { highStakesLegal: true, subsystem: "research" } })),
    ).rejects.toBeInstanceOf(RouterUnavailableError);
    expect(gptCalls).toEqual([]);
    expect(geminiCalls).toEqual([]);
  });

  it("selects GPT for Tier-3 extraction", async () => {
    const audits: Array<{ model: string; routingTier?: number; highStakesLegal?: boolean }> = [];
    const router = new NyayaRouter({
      providers: {
        openai: jsonOk("openai", "gpt-6.1-sol"),
        anthropic: jsonOk("anthropic", "claude-opus-5-5"),
      },
      envProvider: "openai",
      env: {
        AI_PROVIDER: "openai",
        FEATURE_NYAYA_MODEL_ROUTER_V2: "1",
        APP_ENV: "development",
      },
      onAudit: (a) => audits.push(a),
    });
    const result = await router.generate(
      req({
        routing: { benchmarkTaskCategory: "STRUCTURED_EXTRACTION", subsystem: "timeline" },
      }),
    );
    expect(result.model).toBe("gpt-6.1-sol");
    expect(audits[0]?.routingTier).toBe(3);
    expect(audits[0]?.highStakesLegal).toBe(false);
  });
});
