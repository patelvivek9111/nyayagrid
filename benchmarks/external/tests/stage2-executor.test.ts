import { describe, expect, it } from "vitest";
import { rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { freezeRunManifest, hashRunConfig } from "../src/live/manifest.js";
import { runStage2Finalists } from "../src/live/stage2-executor.js";
import { getCacheDir } from "../src/paths.js";
import { ensureRunDir } from "../src/live/persistence.js";
import type { NormalizedTask } from "../src/schema/normalized-task.js";
import { isResponseCacheHit } from "../src/live/response-cache.js";
import { isJudgeCacheHit } from "../src/live/judge-cache.js";
import { autoStartStage2FromStage1, mayStartStage } from "../src/live/stage-gate.js";
import {
  plannedStage2JudgeCount,
  plannedStage2ResponseCount,
  STAGE2_RESPONSE_MODELS,
  type Stage2SuitePlan,
} from "../src/live/stage2-task-planner.js";
import { computeStage2ExactCostPlan } from "../src/cost/plan-stage2.js";
import { buildStage2ContextProfileFromTasks } from "../src/live/stage2-context-profile.js";
import {
  isLegalBenchTaskCommercialCleared,
  isRagTaskProductionCleared,
} from "../src/selectors/commercial-screening.js";
import {
  classifyFetchFailure,
  classifyHttpStatus,
  isRetryableLiveError,
} from "../src/providers/live-errors.js";
import { assertSameModelPinned } from "../src/live/no-fallback.js";
import { assertCompletionKnown, UnknownCompletionError } from "../src/live/retry.js";
import {
  assertWithinProviderCaps,
  emptyProviderSpend,
  parseProviderCaps,
} from "../src/live/provider-caps.js";
import { BudgetLimitError, reconstructSpendFromPersistedCosts } from "../src/live/budget.js";
import {
  STAGE2_PROVIDER_TIMEOUTS_MS,
  stage2JudgeTimeoutMs,
  stage2ResponseTimeoutMs,
} from "../src/live/provider-timeouts.js";
import {
  acknowledgeQuarantineForSingleResend,
  auditUnknownCompletions,
  hasConsumedSingleUnknownResend,
  hasUnknownCompletionArtifact,
  listUnknownCompletions,
  persistUnknownCompletion,
  readRunUnknownQuarantine,
  recordUnknownResendAttempt,
  writeRunUnknownQuarantine,
} from "../src/live/unknown-completion.js";
import {
  PROVIDER_UNKNOWN_CIRCUIT_BREAKER_THRESHOLD,
  hasTerminalProviderUnknown,
  listTerminalProviderUnknowns,
} from "../src/live/terminal-unknown.js";

function task(
  partial: Partial<NormalizedTask> & { taskId: string; benchmarkId: string },
): NormalizedTask {
  return {
    split: "test",
    jurisdiction: null,
    practiceArea: null,
    difficulty: null,
    taskType: "unit",
    input: { question: "Q?" },
    conversation: [{ role: "user", content: "What is the holding?" }],
    supportingDocuments: null,
    expectedAnswer: "yes",
    rubric: {
      criteria: [{ id: "c1", description: "correctness", weight: 1, maxScore: 1 }],
    },
    goldEvidence: null,
    metadata: {},
    contaminationRisk: "PUBLIC_HIGH",
    ...partial,
  } as NormalizedTask;
}

function mockFetchFactory() {
  let calls = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    calls += 1;
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (u.includes("api.openai.com")) {
      const isJudge = JSON.stringify(body).includes("independent legal-benchmark judge");
      return new Response(
        JSON.stringify({
          id: `resp_${calls}`,
          status: "completed",
          output_text: isJudge
            ? '{"score":0.7,"rationale":"ok"}'
            : "OpenAI legal answer mentioning yes",
          usage: { input_tokens: 50, output_tokens: 20 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (u.includes("api.anthropic.com")) {
      return new Response(
        JSON.stringify({
          id: `msg_${calls}`,
          stop_reason: "end_turn",
          content: [{ type: "text", text: '{"score":0.65,"rationale":"ok"}' }],
          usage: { input_tokens: 40, output_tokens: 15 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (u.includes("api.x.ai")) {
      return new Response(
        JSON.stringify({
          id: `xai_${calls}`,
          status: "completed",
          output_text: "Grok answer yes",
          usage: { input_tokens: 35, output_tokens: 12 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (u.includes("generativelanguage.googleapis.com")) {
      throw new Error("Google must not be called in Stage-2");
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, getCalls: () => calls };
}

function miniSuite(pr: string[], lb: string[], rag: string[]): Stage2SuitePlan {
  return {
    suite_id: "external-stage2-finalists-v1-mini",
    selection_method: "test",
    seed: "test",
    frozen: true,
    license_filter: "commercial_internal_eval_ok_only",
    targets: { prbenchHard: 250, legalbench: 80, legalbenchRag: 150 },
    actual: {
      prbenchHard: pr.length,
      legalbench: lb.length,
      legalbenchRag: rag.length,
    },
    response_models: STAGE2_RESPONSE_MODELS,
    judges: { judge_a: "claude-sonnet-5-5", judge_b: "gpt-6.1-sol" },
    call_counts: {
      prbenchResponses: pr.length * 2,
      legalbenchResponses: lb.length * 2,
      totalResponses: (pr.length + lb.length) * 2,
      judgeCalls: pr.length * 2 * 2,
      ragRetrievalOnly: rag.length,
      ragGenerationCalls: 0,
    },
    upstream_ids: {
      prbench_legal_hard: pr,
      legalbench: lb,
      legalbench_rag: rag,
    },
    dropped: { legalbench_nc_or_non_us: [], legalbench_rag_excluded: [] },
    dataset_revisions: {
      prbench: "01947c6ef913df518e6e52626a7b29f132b12d4f",
      legalbench: "b46bf4ffae90524b2b72aaa30e7745fe9db64481",
      legalbench_rag: "2b9c248bc8179ef0908fd6ba01d50b156facd48b",
    },
  };
}

describe("stage2 planner counts", () => {
  it("computes response and judge counts for finalists only", () => {
    const suite = miniSuite(
      ["a", "b", "c"],
      ["lb1", "lb2", "lb3"],
      ["cuad::0", "maud::1", "contractnli::2"],
    );
    expect(plannedStage2ResponseCount(suite)).toBe(12);
    expect(plannedStage2JudgeCount(suite)).toBe(12);
    expect(suite.call_counts.ragGenerationCalls).toBe(0);
    expect(STAGE2_RESPONSE_MODELS).toEqual(["gpt-6.1-sol", "grok-4.7"]);
  });

  it("license helpers fail closed for privacy_qa / nc", () => {
    expect(isRagTaskProductionCleared("privacy_qa::1")).toBe(false);
  });
});

describe("stage2 cost plan", () => {
  it("recomputes with exact finalists and recommends hard cap", () => {
    const suite = miniSuite(
      Array.from({ length: 250 }, (_, i) => `pr-${i}`),
      Array.from({ length: 80 }, (_, i) => `lb-${i}`),
      Array.from({ length: 150 }, (_, i) => `cuad::${i}`),
    );
    const plan = computeStage2ExactCostPlan({
      suite,
      measuredInputTokens: { p50: 2000, p90: 8000, p95: 12000, max: 20000 },
    });
    expect(plan.models).toEqual(["gpt-6.1-sol", "grok-4.7"]);
    expect(plan.callCounts.totalResponses).toBe(660);
    expect(plan.callCounts.judgeCalls).toBe(1000);
    expect(plan.callCounts.ragGenerationCalls).toBe(0);
    expect(plan.authorizedNow).toBe(false);
    expect(plan.recommendedHardCapUsd).toBeGreaterThanOrEqual(plan.cost.highUsd);
    expect(plan.breakdown.ragGeneration.expectedUsd).toBe(0);
  });
});

describe("stage2 context profile", () => {
  it("reports percentiles and overflow counts without provider calls", () => {
    const tasks = [
      task({ benchmarkId: "prbench", taskId: "p1" }),
      task({ benchmarkId: "prbench", taskId: "p2" }),
      task({ benchmarkId: "legalbench", taskId: "abercrombie::train::0" }),
    ];
    const profile = buildStage2ContextProfileFromTasks(tasks);
    expect(profile.paidCalls).toBe(0);
    expect(profile.promptCount).toBe(3);
    expect(profile.inputTokens.p50).toBeGreaterThan(0);
    expect(profile.gptOverflows).toBe(0);
    expect(profile.grokOverflows).toBe(0);
  });
});

describe("stage2 mini-run mock", () => {
  it("runs mini Stage-2 for GPT+Grok, resumes cache, no Stage-3, no Google", async () => {
    const runId = `stage2-mini-${Date.now()}`;
    const suite = miniSuite(
      ["prbench-mini-1", "prbench-mini-2", "prbench-mini-3"],
      ["abercrombie::train::0", "sara_numeric::train::0", "definition_classification::train::0"],
      ["cuad::0", "maud::0", "contractnli::0"],
    );
    const config = {
      runId,
      stage: 2,
      autoEscalate: false,
      suite,
      models: {
        response: ["gpt-6.1-sol", "grok-4.7"],
        judges: ["claude-sonnet-5-5", "gpt-6.1-sol"],
      },
      test: true,
    };
    const configHash = hashRunConfig(config);
    ensureRunDir(runId);
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "full-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "stage2-suite.json"),
      `${JSON.stringify(suite, null, 2)}\n`,
    );
    freezeRunManifest(runId, {
      runId,
      configHash,
      suite: config,
      models: config.models,
      budgetMaxUsd: 75,
    });

    const prbenchTasks = [
      task({
        benchmarkId: "prbench",
        taskId: "prbench-mini-1",
        rubric: { criteria: [{ id: "c1", description: "ok", weight: 1, maxScore: 1 }] },
      }),
      task({
        benchmarkId: "prbench",
        taskId: "prbench-mini-2",
        rubric: { criteria: [{ id: "c1", description: "ok", weight: 1, maxScore: 1 }] },
      }),
      task({
        benchmarkId: "prbench",
        taskId: "prbench-mini-3",
        rubric: { criteria: [{ id: "c1", description: "ok", weight: 1, maxScore: 1 }] },
      }),
    ];
    const legalbenchTasks = [
      task({ benchmarkId: "legalbench", taskId: "abercrombie::train::0", expectedAnswer: "yes" }),
      task({ benchmarkId: "legalbench", taskId: "sara_numeric::train::0", expectedAnswer: "yes" }),
      task({
        benchmarkId: "legalbench",
        taskId: "definition_classification::train::0",
        expectedAnswer: "yes",
      }),
    ];

    const { fetchImpl, getCalls } = mockFetchFactory();
    const summary1 = await runStage2Finalists({
      argv: [
        "node",
        "stage2",
        "--run-id",
        runId,
        "--allow-paid-model-calls",
        "--max-cost-usd",
        "75",
      ],
      deps: {
        bypassAuthForTests: true,
        maxCostUsdForTests: 75,
        fetchImpl,
        openaiApiKey: "test-openai",
        anthropicApiKey: "test-anthropic",
        xaiApiKey: "test-xai",
        prbenchTasks,
        legalbenchTasks,
        ragTaskIds: [],
        skipRag: true,
        suiteOverride: suite,
      },
    });

    expect(summary1.stage3Started).toBe(false);
    expect(summary1.courtListener).toBe(0);
    expect(summary1.progress.plannedResponses).toBe(12);
    expect(summary1.progress.plannedJudges).toBe(12);
    expect(summary1.progress.completedResponses).toBe(12);
    expect(summary1.progress.completedJudges).toBe(12);
    expect(summary1.paidCalls).toBe(24); // 12 responses + 12 judges
    const callsAfterFirst = getCalls();
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Interrupt/resume: all cache hits, no new paid calls
    const { fetchImpl: fetch2, getCalls: getCalls2 } = mockFetchFactory();
    const summary2 = await runStage2Finalists({
      argv: [
        "node",
        "stage2",
        "--run-id",
        runId,
        "--allow-paid-model-calls",
        "--max-cost-usd",
        "75",
      ],
      deps: {
        bypassAuthForTests: true,
        maxCostUsdForTests: 75,
        fetchImpl: fetch2,
        openaiApiKey: "test-openai",
        anthropicApiKey: "test-anthropic",
        xaiApiKey: "test-xai",
        prbenchTasks,
        legalbenchTasks,
        ragTaskIds: [],
        skipRag: true,
        suiteOverride: suite,
      },
    });
    expect(summary2.paidCalls).toBe(0);
    expect(summary2.cacheHits).toBe(24);
    expect(getCalls2()).toBe(0);
    expect(summary2.progress.totalSpendUsd).toBeGreaterThan(0);
    expect(
      Math.abs(summary2.progress.totalSpendUsd - summary1.progress.totalSpendUsd),
    ).toBeLessThan(1e-9);

    // Partial judge resume: delete one judge, resume fills only that gap
    const judgeDir = path.join(getCacheDir(), "runs", runId, "judge");
    const judgeFiles = readdirSync(judgeDir).filter((f) => f.endsWith(".json"));
    expect(judgeFiles.length).toBe(12);
    rmSync(path.join(judgeDir, judgeFiles[0]!));
    const { fetchImpl: fetch3, getCalls: getCalls3 } = mockFetchFactory();
    const summary3 = await runStage2Finalists({
      argv: [
        "node",
        "stage2",
        "--run-id",
        runId,
        "--allow-paid-model-calls",
        "--max-cost-usd",
        "75",
      ],
      deps: {
        bypassAuthForTests: true,
        maxCostUsdForTests: 75,
        fetchImpl: fetch3,
        openaiApiKey: "test-openai",
        anthropicApiKey: "test-anthropic",
        xaiApiKey: "test-xai",
        prbenchTasks,
        legalbenchTasks,
        ragTaskIds: [],
        skipRag: true,
        suiteOverride: suite,
      },
    });
    expect(summary3.paidCalls).toBe(1);
    expect(getCalls3()).toBe(1);
    expect(summary3.progress.completedJudges).toBe(12);

    // Cache integrity for responses
    const respDir = path.join(getCacheDir(), "runs", runId, "response");
    for (const f of readdirSync(respDir).filter((x) => x.endsWith(".json"))) {
      expect(isResponseCacheHit(runId, f.replace(/\.json$/, ""))).toBe(true);
    }
    for (const f of readdirSync(judgeDir).filter((x) => x.endsWith(".json"))) {
      expect(isJudgeCacheHit(runId, f.replace(/\.json$/, ""))).toBe(true);
    }

    expect(autoStartStage2FromStage1()).toBe(false);
    expect(mayStartStage(3, [1, 2])).toBe(true);
    expect(mayStartStage(3, [1])).toBe(false);

    rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
    expect(existsSync(path.join(getCacheDir(), "runs", runId))).toBe(false);
  });

  it("rejects non-finalist response models", async () => {
    const runId = `stage2-bad-${Date.now()}`;
    const suite = miniSuite(["p1"], ["lb1"], []);
    const config = { runId, stage: 2, suite, models: { response: ["claude-opus-5-5"] } };
    ensureRunDir(runId);
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "full-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    freezeRunManifest(runId, {
      runId,
      configHash: hashRunConfig(config),
      suite: config,
      models: config.models,
      budgetMaxUsd: 75,
    });
    await expect(
      runStage2Finalists({
        argv: ["node", "stage2", "--run-id", runId],
        deps: {
          bypassAuthForTests: true,
          maxCostUsdForTests: 75,
          openaiApiKey: "x",
          anthropicApiKey: "x",
          xaiApiKey: "x",
          responseModels: ["claude-opus-5-5" as never],
          prbenchTasks: [task({ benchmarkId: "prbench", taskId: "p1" })],
          legalbenchTasks: [],
          skipRag: true,
          suiteOverride: suite,
          fetchImpl: mockFetchFactory().fetchImpl,
        },
      }),
    ).rejects.toThrow(/forbids response model/);
    rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
  });
});

describe("stage2 post-stop safety", () => {
  it("classifies OpenAI credit_balance_exhausted as AUTH_ERROR", () => {
    const err = classifyHttpStatus(
      "openai",
      429,
      JSON.stringify({
        error: {
          message: "You have no credits remaining.",
          type: "insufficient_quota",
          code: "credit_balance_exhausted",
        },
      }),
    );
    expect(err.code).toBe("AUTH_ERROR");
    expect(err.retryable).toBe(false);
  });

  it("preserves $55 global cap and frozen provider subcap defaults", () => {
    const caps = parseProviderCaps([
      "node",
      "stage2",
      "--max-cost-usd",
      "55",
      "--max-openai-usd",
      "13",
      "--max-xai-usd",
      "11",
      "--max-anthropic-usd",
      "18",
      "--max-judge-usd",
      "35",
    ]);
    expect(caps.openai?.maxDollars).toBe(13);
    expect(caps.xai?.maxDollars).toBe(11);
    expect(caps.anthropic?.maxDollars).toBe(18);
    expect(caps.maxJudgeDollars).toBe(35);
    expect(() =>
      assertWithinProviderCaps({
        provider: "openai",
        caps: { openai: { maxDollars: 13 }, google: { maxDollars: 0 } },
        spend: { ...emptyProviderSpend(), dollars: 12.9 },
        nextDollarsWorstCase: 0.2,
      }),
    ).toThrow(/STOP_PROVIDER_CAP/);
    const prior = reconstructSpendFromPersistedCosts(55, [0.0896768, 0.02461]);
    expect(prior.spentUsd).toBeCloseTo(0.1142868, 7);
    expect(prior.maxUsd).toBe(55);
    expect(() => {
      throw new BudgetLimitError("STOP_BUDGET_LIMIT");
    }).toThrow(BudgetLimitError);
  });

  it("unknown completion and no-fallback guards remain hard failures", () => {
    expect(() => assertCompletionKnown(false)).toThrow(UnknownCompletionError);
    expect(() => assertSameModelPinned("gpt-6.1-sol", "gpt-4o")).toThrow(/swap|fallback|pin/i);
  });

  it("OpenAI billing AUTH_ERROR stops balanced Stage-2 without Grok-alone continuation", async () => {
    const runId = `stage2-bal-stop-${Date.now()}`;
    const suite = miniSuite(
      ["pr-bal-1", "pr-bal-2", "pr-bal-3"],
      ["abercrombie::train::0", "sara_numeric::train::0"],
      [],
    );
    const config = {
      runId,
      stage: 2,
      suite,
      models: {
        response: ["gpt-6.1-sol", "grok-4.7"],
        judges: ["claude-sonnet-5-5", "gpt-6.1-sol"],
      },
    };
    const configHash = hashRunConfig(config);
    ensureRunDir(runId);
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "full-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    freezeRunManifest(runId, {
      runId,
      configHash,
      suite: config,
      models: config.models,
      budgetMaxUsd: 55,
    });

    let openaiCalls = 0;
    let xaiCalls = 0;
    let anthropicCalls = 0;
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes("api.openai.com")) {
        openaiCalls += 1;
        return new Response(
          JSON.stringify({
            error: {
              message: "You have no credits remaining. Add credits to continue.",
              type: "insufficient_quota",
              code: "credit_balance_exhausted",
            },
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.x.ai")) {
        xaiCalls += 1;
        return new Response(
          JSON.stringify({
            id: "xai_should_not_run",
            status: "completed",
            output_text: "Grok alone",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.anthropic.com")) {
        anthropicCalls += 1;
        return new Response(
          JSON.stringify({
            id: "msg_should_not_run",
            stop_reason: "end_turn",
            content: [{ type: "text", text: '{"score":0.5,"rationale":"x"}' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    };

    const prbenchTasks = [
      task({ benchmarkId: "prbench", taskId: "pr-bal-1" }),
      task({ benchmarkId: "prbench", taskId: "pr-bal-2" }),
      task({ benchmarkId: "prbench", taskId: "pr-bal-3" }),
    ];
    const legalbenchTasks = [
      task({ benchmarkId: "legalbench", taskId: "abercrombie::train::0", expectedAnswer: "yes" }),
      task({ benchmarkId: "legalbench", taskId: "sara_numeric::train::0", expectedAnswer: "yes" }),
    ];

    const summary = await runStage2Finalists({
      argv: [
        "node",
        "stage2",
        "--run-id",
        runId,
        "--allow-paid-model-calls",
        "--max-cost-usd",
        "55",
        "--concurrency",
        "1",
        "--batch-size",
        "5",
      ],
      deps: {
        bypassAuthForTests: true,
        maxCostUsdForTests: 55,
        fetchImpl,
        openaiApiKey: "test-openai",
        anthropicApiKey: "test-anthropic",
        xaiApiKey: "test-xai",
        prbenchTasks,
        legalbenchTasks,
        ragTaskIds: [],
        skipRag: true,
        suiteOverride: suite,
        sleep: async () => undefined,
      },
    });

    expect(summary.status).toBe("STAGE2_BLOCKED");
    expect(summary.note).toMatch(/STAGE2_BLOCKED_OPENAI_BILLING/);
    expect(xaiCalls).toBe(0);
    expect(anthropicCalls).toBe(0);
    expect(openaiCalls).toBeGreaterThanOrEqual(1);
    expect(openaiCalls).toBeLessThanOrEqual(3);
    expect(summary.paidCalls).toBe(0);
    expect(summary.cost.totalUsd).toBe(0);
    expect(summary.stage3Started).toBe(false);

    rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
  });

  it("resume reconstructs prior Grok/Judge A spend and cache-hits without duplicate paid calls", async () => {
    const runId = `stage2-resume-safety-${Date.now()}`;
    const suite = miniSuite(["pr-res-1", "pr-res-2"], ["abercrombie::train::0"], []);
    const config = {
      runId,
      stage: 2,
      suite,
      models: {
        response: ["gpt-6.1-sol", "grok-4.7"],
        judges: ["claude-sonnet-5-5", "gpt-6.1-sol"],
      },
    };
    const configHash = hashRunConfig(config);
    ensureRunDir(runId);
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "full-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    freezeRunManifest(runId, {
      runId,
      configHash,
      suite: config,
      models: config.models,
      budgetMaxUsd: 55,
    });

    const prbenchTasks = [
      task({ benchmarkId: "prbench", taskId: "pr-res-1" }),
      task({ benchmarkId: "prbench", taskId: "pr-res-2" }),
    ];
    const legalbenchTasks = [
      task({ benchmarkId: "legalbench", taskId: "abercrombie::train::0", expectedAnswer: "yes" }),
    ];

    let phase: "seed" | "resume" = "seed";
    let openaiPaid = 0;
    let xaiPaid = 0;
    let anthropicPaid = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (u.includes("api.openai.com")) {
        if (phase === "resume") {
          openaiPaid += 1;
          return new Response(
            JSON.stringify({
              error: {
                message: "You have no credits remaining.",
                type: "insufficient_quota",
                code: "credit_balance_exhausted",
              },
            }),
            { status: 429, headers: { "content-type": "application/json" } },
          );
        }
        const isJudge = JSON.stringify(body).includes("independent legal-benchmark judge");
        openaiPaid += 1;
        return new Response(
          JSON.stringify({
            id: `resp_seed_${openaiPaid}`,
            status: "completed",
            output_text: isJudge ? '{"score":0.7,"rationale":"ok"}' : "OpenAI seed answer yes",
            usage: { input_tokens: 50, output_tokens: 20 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.x.ai")) {
        xaiPaid += 1;
        return new Response(
          JSON.stringify({
            id: `xai_${xaiPaid}`,
            status: "completed",
            output_text: "Grok seed answer yes",
            usage: { input_tokens: 35, output_tokens: 12 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.anthropic.com")) {
        anthropicPaid += 1;
        return new Response(
          JSON.stringify({
            id: `msg_${anthropicPaid}`,
            stop_reason: "end_turn",
            content: [{ type: "text", text: '{"score":0.65,"rationale":"ok"}' }],
            usage: { input_tokens: 40, output_tokens: 15 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    };

    const commonDeps = {
      bypassAuthForTests: true,
      maxCostUsdForTests: 55,
      fetchImpl,
      openaiApiKey: "test-openai",
      anthropicApiKey: "test-anthropic",
      xaiApiKey: "test-xai",
      prbenchTasks,
      legalbenchTasks,
      ragTaskIds: [] as string[],
      skipRag: true,
      suiteOverride: suite,
      sleep: async () => undefined,
    };

    const seed = await runStage2Finalists({
      argv: [
        "node",
        "stage2",
        "--run-id",
        runId,
        "--allow-paid-model-calls",
        "--max-cost-usd",
        "55",
      ],
      deps: commonDeps,
    });
    expect(seed.status).toBe("STAGE2_COMPLETE");
    expect(seed.paidCalls).toBeGreaterThan(0);
    const priorSpend = seed.cost.totalUsd;
    expect(priorSpend).toBeGreaterThan(0);

    // Drop GPT response + Judge B artifacts so resume must confront OpenAI again;
    // keep Grok responses + Judge A as cache hits (mirrors blocked live run shape).
    const respDir = path.join(getCacheDir(), "runs", runId, "response");
    const judgeDir = path.join(getCacheDir(), "runs", runId, "judge");
    for (const f of readdirSync(respDir).filter((x) => x.endsWith(".json"))) {
      const payload = JSON.parse(readFileSync(path.join(respDir, f), "utf8")) as {
        exactModelId?: string;
        provider?: string;
      };
      if (payload.provider === "openai" || payload.exactModelId === "gpt-6.1-sol") {
        rmSync(path.join(respDir, f));
      }
    }
    for (const f of readdirSync(judgeDir).filter((x) => x.endsWith(".json"))) {
      const payload = JSON.parse(readFileSync(path.join(judgeDir, f), "utf8")) as {
        exactModelId?: string;
        provider?: string;
        taskId?: string;
      };
      if (
        payload.provider === "openai" ||
        payload.exactModelId === "gpt-6.1-sol" ||
        String(payload.taskId ?? "").includes("judge_B")
      ) {
        rmSync(path.join(judgeDir, f));
      }
    }

    const grokRespFiles = readdirSync(respDir).filter((x) => x.endsWith(".json"));
    const grokJudgeAFiles = readdirSync(judgeDir).filter((x) => {
      if (!x.endsWith(".json")) return false;
      const payload = JSON.parse(readFileSync(path.join(judgeDir, x), "utf8")) as {
        taskId?: string;
        provider?: string;
      };
      return payload.provider === "anthropic" && String(payload.taskId ?? "").includes("grok-4.7");
    });
    expect(grokRespFiles.length).toBeGreaterThanOrEqual(2);
    expect(grokJudgeAFiles.length).toBeGreaterThanOrEqual(2);

    openaiPaid = 0;
    xaiPaid = 0;
    anthropicPaid = 0;
    phase = "resume";

    const resumed = await runStage2Finalists({
      argv: [
        "node",
        "stage2",
        "--run-id",
        runId,
        "--allow-paid-model-calls",
        "--max-cost-usd",
        "55",
      ],
      deps: commonDeps,
    });

    expect(resumed.status).toBe("STAGE2_BLOCKED");
    expect(resumed.note).toMatch(/STAGE2_BLOCKED_OPENAI_BILLING/);
    expect(resumed.cacheHits).toBeGreaterThanOrEqual(grokRespFiles.length + grokJudgeAFiles.length);
    expect(xaiPaid).toBe(0);
    expect(anthropicPaid).toBe(0);
    expect(resumed.paidCalls).toBe(0);
    expect(resumed.cost.totalUsd).toBeGreaterThan(0);
    expect(resumed.cost.xaiResponsesUsd).toBeGreaterThan(0);
    expect(resumed.cost.anthropicJudgeUsd).toBeGreaterThan(0);
    expect(resumed.cost.remainingUsd).toBeLessThan(55);
    expect(resumed.cost.authorizedUsd).toBe(55);
    expect(priorSpend).toBeGreaterThan(resumed.cost.totalUsd); // GPT/Judge B spend not in ledger

    rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
  });
});

describe("stage2 unknown-completion safety", () => {
  it("provider-specific timeouts: Grok 360s tail; GPT/judges remain 180s", () => {
    expect(STAGE2_PROVIDER_TIMEOUTS_MS.xaiResponse).toBe(360_000);
    expect(STAGE2_PROVIDER_TIMEOUTS_MS.openaiResponse).toBe(180_000);
    expect(STAGE2_PROVIDER_TIMEOUTS_MS.anthropicJudge).toBe(180_000);
    expect(STAGE2_PROVIDER_TIMEOUTS_MS.openaiJudge).toBe(180_000);
    expect(stage2ResponseTimeoutMs("xai")).toBe(360_000);
    expect(stage2ResponseTimeoutMs("openai")).toBe(180_000);
    expect(stage2JudgeTimeoutMs("anthropic")).toBe(180_000);
    expect(stage2JudgeTimeoutMs("openai")).toBe(180_000);
  });

  it("classifies timeout vs transport pre/post dispatch separately", () => {
    const timeoutPost = classifyFetchFailure({
      provider: "xai",
      dispatched: true,
      err: Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      }),
    });
    expect(timeoutPost.code).toBe("TIMEOUT_POST_DISPATCH_UNKNOWN");
    expect(timeoutPost.retryable).toBe(false);
    expect(isRetryableLiveError(timeoutPost)).toBe(false);

    const transportPost = classifyFetchFailure({
      provider: "openai",
      dispatched: true,
      err: new Error("fetch failed"),
    });
    expect(transportPost.code).toBe("TRANSPORT_POST_DISPATCH_UNKNOWN");
    expect(isRetryableLiveError(transportPost)).toBe(false);

    const transportPre = classifyFetchFailure({
      provider: "openai",
      dispatched: false,
      err: new Error("fetch failed"),
    });
    expect(transportPre.code).toBe("TRANSPORT_PRE_DISPATCH");
    expect(isRetryableLiveError(transportPre)).toBe(true);
  });

  it("OpenAI post-dispatch timeout persists UNKNOWN, quarantines, balanced-stops, no further finalist paid calls", async () => {
    const runId = `stage2-unk-oa-${Date.now()}`;
    const suite = miniSuite(["pr-u1", "pr-u2", "pr-u3"], [], []);
    const config = {
      runId,
      stage: 2,
      suite,
      models: {
        response: ["gpt-6.1-sol", "grok-4.7"],
        judges: ["claude-sonnet-5-5", "gpt-6.1-sol"],
      },
    };
    const configHash = hashRunConfig(config);
    ensureRunDir(runId);
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "full-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    freezeRunManifest(runId, {
      runId,
      configHash,
      suite: config,
      models: config.models,
      budgetMaxUsd: 55,
    });

    let openaiCalls = 0;
    let xaiCalls = 0;
    let anthropicCalls = 0;
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes("api.openai.com")) {
        openaiCalls += 1;
        throw Object.assign(new Error("The operation was aborted due to timeout"), {
          name: "TimeoutError",
        });
      }
      if (u.includes("api.x.ai")) {
        xaiCalls += 1;
        return new Response(
          JSON.stringify({
            id: "xai_should_stop",
            status: "completed",
            output_text: "should not continue alone",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.anthropic.com")) {
        anthropicCalls += 1;
        return new Response(
          JSON.stringify({
            id: "msg_x",
            stop_reason: "end_turn",
            content: [{ type: "text", text: '{"score":0.5,"rationale":"x"}' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    };

    const summary = await runStage2Finalists({
      argv: [
        "node",
        "stage2",
        "--run-id",
        runId,
        "--allow-paid-model-calls",
        "--max-cost-usd",
        "55",
      ],
      deps: {
        bypassAuthForTests: true,
        maxCostUsdForTests: 55,
        fetchImpl,
        openaiApiKey: "t",
        anthropicApiKey: "t",
        xaiApiKey: "t",
        prbenchTasks: [
          task({ benchmarkId: "prbench", taskId: "pr-u1" }),
          task({ benchmarkId: "prbench", taskId: "pr-u2" }),
          task({ benchmarkId: "prbench", taskId: "pr-u3" }),
        ],
        legalbenchTasks: [],
        skipRag: true,
        suiteOverride: suite,
        sleep: async () => undefined,
      },
    });

    expect(summary.status).toBe("STAGE2_PAUSED_UNKNOWN_COMPLETION");
    expect(summary.note).toMatch(/STAGE2_PAUSED_UNKNOWN_COMPLETION/);
    expect(openaiCalls).toBe(1);
    expect(xaiCalls).toBe(0);
    expect(anthropicCalls).toBe(0);
    expect(listUnknownCompletions(runId).length).toBe(1);
    expect(listUnknownCompletions(runId)[0]?.failureClassification).toBe(
      "TIMEOUT_POST_DISPATCH_UNKNOWN",
    );
    expect(readRunUnknownQuarantine(runId)?.automaticResendBlocked).toBe(true);
    expect(summary.progress.unverifiedProviderBillingExposure).toBe("YES");
    expect(summary.paidCalls).toBe(0);

    rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
  });

  it("xAI post-dispatch fetch failure persists UNKNOWN and stops balanced execution", async () => {
    const runId = `stage2-unk-xai-${Date.now()}`;
    const suite = miniSuite(["pr-x1", "pr-x2"], [], []);
    const config = {
      runId,
      stage: 2,
      suite,
      models: {
        response: ["gpt-6.1-sol", "grok-4.7"],
        judges: ["claude-sonnet-5-5", "gpt-6.1-sol"],
      },
    };
    const configHash = hashRunConfig(config);
    ensureRunDir(runId);
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "full-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    freezeRunManifest(runId, {
      runId,
      configHash,
      suite: config,
      models: config.models,
      budgetMaxUsd: 55,
    });

    let openaiCalls = 0;
    let xaiCalls = 0;
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes("api.openai.com")) {
        openaiCalls += 1;
        const isJudge = false;
        void isJudge;
        return new Response(
          JSON.stringify({
            id: `oa_${openaiCalls}`,
            status: "completed",
            output_text: "OpenAI ok",
            usage: { input_tokens: 20, output_tokens: 10 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.x.ai")) {
        xaiCalls += 1;
        throw new Error("fetch failed");
      }
      if (u.includes("api.anthropic.com")) {
        return new Response(
          JSON.stringify({
            id: "msg",
            stop_reason: "end_turn",
            content: [{ type: "text", text: '{"score":0.5,"rationale":"x"}' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    };

    const summary = await runStage2Finalists({
      argv: [
        "node",
        "stage2",
        "--run-id",
        runId,
        "--allow-paid-model-calls",
        "--max-cost-usd",
        "55",
      ],
      deps: {
        bypassAuthForTests: true,
        maxCostUsdForTests: 55,
        fetchImpl,
        openaiApiKey: "t",
        anthropicApiKey: "t",
        xaiApiKey: "t",
        prbenchTasks: [
          task({ benchmarkId: "prbench", taskId: "pr-x1" }),
          task({ benchmarkId: "prbench", taskId: "pr-x2" }),
        ],
        legalbenchTasks: [],
        skipRag: true,
        suiteOverride: suite,
        sleep: async () => undefined,
      },
    });

    expect(summary.status).toBe("STAGE2_PAUSED_UNKNOWN_COMPLETION");
    expect(xaiCalls).toBe(1);
    // GPT may complete the interleaved first task (+ judges) before Grok UNKNOWN stops the run.
    expect(openaiCalls).toBeGreaterThanOrEqual(1);
    expect(openaiCalls).toBeLessThanOrEqual(4);
    expect(listUnknownCompletions(runId).some((r) => r.provider === "xai")).toBe(true);
    expect(
      listUnknownCompletions(runId).find((r) => r.provider === "xai")?.failureClassification,
    ).toBe("TRANSPORT_POST_DISPATCH_UNKNOWN");

    rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
  });

  it("resume does not auto-resend UNKNOWN task without operator override", async () => {
    const runId = `stage2-unk-resume-${Date.now()}`;
    const suite = miniSuite(["pr-r1"], [], []);
    const config = {
      runId,
      stage: 2,
      suite,
      models: {
        response: ["gpt-6.1-sol", "grok-4.7"],
        judges: ["claude-sonnet-5-5", "gpt-6.1-sol"],
      },
    };
    const configHash = hashRunConfig(config);
    ensureRunDir(runId);
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "full-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    freezeRunManifest(runId, {
      runId,
      configHash,
      suite: config,
      models: config.models,
      budgetMaxUsd: 55,
    });

    persistUnknownCompletion({
      kind: "UNKNOWN_COMPLETION",
      runId,
      taskId: "pr-r1::grok-4.7",
      benchmarkId: "prbench",
      provider: "xai",
      exactModelId: "grok-4.7",
      attemptNumber: 1,
      requestStartTimestamp: new Date().toISOString(),
      dispatchTimestamp: new Date().toISOString(),
      failureTimestamp: new Date().toISOString(),
      failureClassification: "TRANSPORT_POST_DISPATCH_UNKNOWN",
      providerRequestId: null,
      sanitizedErrorMessage: "xAI transport failure after dispatch: fetch failed",
      usageReceived: false,
      responseBodyReceived: false,
      safelyRetryable: false,
      potentialBillingExposure: "YES",
      resendBlocked: true,
      operatorOverrideRequired: true,
    });
    writeRunUnknownQuarantine({
      runId,
      reason: "test quarantine",
      providers: ["openai", "xai"],
    });

    let xaiCalls = 0;
    let openaiCalls = 0;
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes("api.x.ai")) xaiCalls += 1;
      if (u.includes("api.openai.com")) openaiCalls += 1;
      throw new Error("should not be called under quarantine");
    };

    const resumed = await runStage2Finalists({
      argv: [
        "node",
        "stage2",
        "--run-id",
        runId,
        "--allow-paid-model-calls",
        "--max-cost-usd",
        "55",
      ],
      deps: {
        bypassAuthForTests: true,
        maxCostUsdForTests: 55,
        fetchImpl,
        openaiApiKey: "t",
        anthropicApiKey: "t",
        xaiApiKey: "t",
        prbenchTasks: [task({ benchmarkId: "prbench", taskId: "pr-r1" })],
        legalbenchTasks: [],
        skipRag: true,
        suiteOverride: suite,
        sleep: async () => undefined,
      },
    });

    expect(resumed.status).toBe("STAGE2_PAUSED_UNKNOWN_COMPLETION");
    expect(xaiCalls).toBe(0);
    expect(openaiCalls).toBe(0);
    expect(hasUnknownCompletionArtifact(runId, "pr-r1::grok-4.7", "xai")).toBe(true);
    expect(auditUnknownCompletions({ runId })[0]?.resendBlocked).toBe(true);

    rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
  });

  it("second UNKNOWN terminalizes task, continues Stage-2, and never third-attempts", async () => {
    const runId = `stage2-unk-terminal-${Date.now()}`;
    const suite = miniSuite(["pr-s1"], [], []);
    const config = {
      runId,
      stage: 2,
      suite,
      models: {
        response: ["gpt-6.1-sol", "grok-4.7"],
        judges: ["claude-sonnet-5-5", "gpt-6.1-sol"],
      },
    };
    const configHash = hashRunConfig(config);
    ensureRunDir(runId);
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "full-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    freezeRunManifest(runId, {
      runId,
      configHash,
      suite: config,
      models: config.models,
      budgetMaxUsd: 55,
    });

    persistUnknownCompletion({
      kind: "UNKNOWN_COMPLETION",
      runId,
      taskId: "pr-s1::grok-4.7",
      benchmarkId: "prbench",
      provider: "xai",
      exactModelId: "grok-4.7",
      attemptNumber: 1,
      requestStartTimestamp: new Date().toISOString(),
      dispatchTimestamp: new Date().toISOString(),
      failureTimestamp: new Date().toISOString(),
      failureClassification: "TIMEOUT_POST_DISPATCH_UNKNOWN",
      providerRequestId: null,
      sanitizedErrorMessage: "TIMEOUT_POST_DISPATCH_UNKNOWN: prior",
      usageReceived: false,
      responseBodyReceived: false,
      safelyRetryable: false,
      potentialBillingExposure: "YES",
      resendBlocked: true,
      operatorOverrideRequired: true,
    });
    writeRunUnknownQuarantine({
      runId,
      reason: "prior TIMEOUT_POST_DISPATCH_UNKNOWN",
      providers: ["openai", "xai"],
    });
    const ack = acknowledgeQuarantineForSingleResend({
      runId,
      taskIds: ["pr-s1::grok-4.7"],
    });
    expect(ack.status).toBe("OPERATOR_ACKNOWLEDGED_FOR_SINGLE_RESEND");
    expect(hasUnknownCompletionArtifact(runId, "pr-s1::grok-4.7", "xai")).toBe(true);
    expect(readRunUnknownQuarantine(runId)?.status).toBe("OPERATOR_ACKNOWLEDGED_FOR_SINGLE_RESEND");

    let xaiCalls = 0;
    let openaiCalls = 0;
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes("api.openai.com")) {
        openaiCalls += 1;
        return new Response(
          JSON.stringify({
            id: `oa_${openaiCalls}`,
            status: "completed",
            output_text: "OpenAI ok",
            usage: { input_tokens: 20, output_tokens: 10 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.x.ai")) {
        xaiCalls += 1;
        throw Object.assign(new Error("The operation was aborted due to timeout"), {
          name: "TimeoutError",
        });
      }
      if (u.includes("api.anthropic.com")) {
        return new Response(
          JSON.stringify({
            id: "msg",
            stop_reason: "end_turn",
            content: [{ type: "text", text: '{"score":0.5,"rationale":"x"}' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    };

    const resumeArgv = [
      "node",
      "stage2",
      "--run-id",
      runId,
      "--allow-paid-model-calls",
      "--max-cost-usd",
      "55",
      "--acknowledge-unverified-billing-exposure",
      "--allow-unknown-resend",
    ];
    const resumeDeps = {
      bypassAuthForTests: true,
      maxCostUsdForTests: 55,
      fetchImpl,
      openaiApiKey: "t",
      anthropicApiKey: "t",
      xaiApiKey: "t",
      prbenchTasks: [task({ benchmarkId: "prbench", taskId: "pr-s1" })],
      legalbenchTasks: [] as NormalizedTask[],
      skipRag: true,
      suiteOverride: suite,
      sleep: async () => undefined,
    };

    const first = await runStage2Finalists({ argv: resumeArgv, deps: resumeDeps });

    expect(hasTerminalProviderUnknown(runId, "pr-s1::grok-4.7", "xai")).toBe(true);
    expect(xaiCalls).toBe(1);
    expect(hasConsumedSingleUnknownResend(runId, "pr-s1::grok-4.7", "xai")).toBe(true);
    expect(readRunUnknownQuarantine(runId)?.status).toBe("CLEARED_AFTER_TASK_TERMINALIZATION");
    expect(first.progress.terminalProviderFailures).toBeGreaterThanOrEqual(1);
    expect(first.status).toBe("STAGE2_COMPLETE");

    const xaiBeforeSecond = xaiCalls;
    const second = await runStage2Finalists({ argv: resumeArgv, deps: resumeDeps });
    expect(xaiCalls).toBe(xaiBeforeSecond);
    expect(hasTerminalProviderUnknown(runId, "pr-s1::grok-4.7", "xai")).toBe(true);
    expect(second.status).toBe("STAGE2_COMPLETE");

    rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
  });

  it("mock continuation: Task A double-UNKNOWN terminalizes then Task B/C continue", async () => {
    const runId = `stage2-unk-continue-${Date.now()}`;
    const suite = miniSuite(["pr-a", "pr-b", "pr-c"], [], []);
    const config = {
      runId,
      stage: 2,
      suite,
      models: {
        response: ["gpt-6.1-sol", "grok-4.7"],
        judges: ["claude-sonnet-5-5", "gpt-6.1-sol"],
      },
    };
    const configHash = hashRunConfig(config);
    ensureRunDir(runId);
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "full-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    freezeRunManifest(runId, {
      runId,
      configHash,
      suite: config,
      models: config.models,
      budgetMaxUsd: 55,
    });

    let xaiCalls = 0;
    let openaiCalls = 0;
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes("api.openai.com")) {
        openaiCalls += 1;
        return new Response(
          JSON.stringify({
            id: `oa_${openaiCalls}`,
            status: "completed",
            output_text: '{"score":0.7,"rationale":"ok"}',
            usage: { input_tokens: 20, output_tokens: 10 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.x.ai")) {
        xaiCalls += 1;
        // First two xAI calls = Task A grok attempt + authorized retry; then succeed.
        if (xaiCalls <= 2) throw new Error("fetch failed");
        return new Response(
          JSON.stringify({
            id: `xai_${xaiCalls}`,
            status: "completed",
            output_text: "Grok ok",
            usage: { input_tokens: 20, output_tokens: 10 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.anthropic.com")) {
        return new Response(
          JSON.stringify({
            id: "msg",
            stop_reason: "end_turn",
            content: [{ type: "text", text: '{"score":0.6,"rationale":"ok"}' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    };

    const deps = {
      bypassAuthForTests: true,
      maxCostUsdForTests: 55,
      fetchImpl,
      openaiApiKey: "t",
      anthropicApiKey: "t",
      xaiApiKey: "t",
      prbenchTasks: [
        task({ benchmarkId: "prbench", taskId: "pr-a" }),
        task({ benchmarkId: "prbench", taskId: "pr-b" }),
        task({ benchmarkId: "prbench", taskId: "pr-c" }),
      ],
      legalbenchTasks: [] as NormalizedTask[],
      skipRag: true,
      suiteOverride: suite,
      sleep: async () => undefined,
    };
    const argv = [
      "node",
      "stage2",
      "--run-id",
      runId,
      "--allow-paid-model-calls",
      "--max-cost-usd",
      "55",
      "--acknowledge-unverified-billing-exposure",
      "--allow-unknown-resend",
    ];

    const summary = await runStage2Finalists({ argv, deps });
    expect(hasTerminalProviderUnknown(runId, "pr-a::grok-4.7", "xai")).toBe(true);
    expect(xaiCalls).toBe(4); // 2 fails for A + 1 success B + 1 success C
    expect(summary.status).toBe("STAGE2_COMPLETE");
    expect(summary.progress.terminalProviderFailures).toBe(1);
    expect(summary.progress.gptResponsesDone).toBe(3);
    expect(summary.progress.grokResponsesDone).toBe(2);

    const before = xaiCalls;
    await runStage2Finalists({ argv, deps });
    expect(xaiCalls).toBe(before);

    rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
  });

  it("historical terminal reconcile does not burn session circuit-breaker budget", async () => {
    const runId = `stage2-unk-hist-${Date.now()}`;
    const suite = miniSuite(["pr-h1", "pr-h2"], [], []);
    const config = {
      runId,
      stage: 2,
      suite,
      models: {
        response: ["gpt-6.1-sol", "grok-4.7"],
        judges: ["claude-sonnet-5-5", "gpt-6.1-sol"],
      },
    };
    const configHash = hashRunConfig(config);
    ensureRunDir(runId);
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "full-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    freezeRunManifest(runId, {
      runId,
      configHash,
      suite: config,
      models: config.models,
      budgetMaxUsd: 55,
    });

    // Two prior uncertain attempts already recorded for h1 grok → historical terminal.
    for (let i = 0; i < 2; i += 1) {
      persistUnknownCompletion({
        kind: "UNKNOWN_COMPLETION",
        runId,
        taskId: "pr-h1::grok-4.7",
        benchmarkId: "prbench",
        provider: "xai",
        exactModelId: "grok-4.7",
        attemptNumber: i + 1,
        requestStartTimestamp: new Date().toISOString(),
        dispatchTimestamp: new Date().toISOString(),
        failureTimestamp: new Date().toISOString(),
        failureClassification: "TRANSPORT_POST_DISPATCH_UNKNOWN",
        providerRequestId: null,
        sanitizedErrorMessage: "prior unknown",
        usageReceived: false,
        responseBodyReceived: false,
        safelyRetryable: false,
        potentialBillingExposure: "YES",
        resendBlocked: true,
        operatorOverrideRequired: true,
      });
    }
    recordUnknownResendAttempt({
      runId,
      taskId: "pr-h1::grok-4.7",
      provider: "xai",
    });

    let xaiCalls = 0;
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes("api.openai.com")) {
        return new Response(
          JSON.stringify({
            id: "oa",
            status: "completed",
            output_text: '{"score":0.5,"rationale":"x"}',
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.x.ai")) {
        xaiCalls += 1;
        return new Response(
          JSON.stringify({
            id: `xai_${xaiCalls}`,
            status: "completed",
            output_text: "Grok ok",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.anthropic.com")) {
        return new Response(
          JSON.stringify({
            id: "msg",
            stop_reason: "end_turn",
            content: [{ type: "text", text: '{"score":0.5,"rationale":"x"}' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    };

    const summary = await runStage2Finalists({
      argv: [
        "node",
        "stage2",
        "--run-id",
        runId,
        "--allow-paid-model-calls",
        "--max-cost-usd",
        "55",
        "--acknowledge-unverified-billing-exposure",
        "--allow-unknown-resend",
      ],
      deps: {
        bypassAuthForTests: true,
        maxCostUsdForTests: 55,
        fetchImpl,
        openaiApiKey: "t",
        anthropicApiKey: "t",
        xaiApiKey: "t",
        prbenchTasks: [
          task({ benchmarkId: "prbench", taskId: "pr-h1" }),
          task({ benchmarkId: "prbench", taskId: "pr-h2" }),
        ],
        legalbenchTasks: [],
        skipRag: true,
        suiteOverride: suite,
        sleep: async () => undefined,
      },
    });

    expect(hasTerminalProviderUnknown(runId, "pr-h1::grok-4.7", "xai")).toBe(true);
    expect(summary.status).toBe("STAGE2_COMPLETE");
    expect(summary.progress.providerCircuitBreakerTripped).toBe(false);
    expect(summary.progress.sessionDistinctUnknownTasks).toBe(0);
    expect(xaiCalls).toBe(1); // only pr-h2 grok

    rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
  });

  it("three distinct provider UNKNOWN/terminal tasks trip circuit breaker", async () => {
    const runId = `stage2-unk-breaker-${Date.now()}`;
    const suite = miniSuite(["pr-1", "pr-2", "pr-3", "pr-4"], [], []);
    const config = {
      runId,
      stage: 2,
      suite,
      models: {
        response: ["gpt-6.1-sol", "grok-4.7"],
        judges: ["claude-sonnet-5-5", "gpt-6.1-sol"],
      },
    };
    const configHash = hashRunConfig(config);
    ensureRunDir(runId);
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "full-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    freezeRunManifest(runId, {
      runId,
      configHash,
      suite: config,
      models: config.models,
      budgetMaxUsd: 55,
    });

    let xaiCalls = 0;
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes("api.openai.com")) {
        return new Response(
          JSON.stringify({
            id: "oa",
            status: "completed",
            output_text: "ok",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.x.ai")) {
        xaiCalls += 1;
        throw new Error("fetch failed");
      }
      if (u.includes("api.anthropic.com")) {
        return new Response(
          JSON.stringify({
            id: "msg",
            stop_reason: "end_turn",
            content: [{ type: "text", text: '{"score":0.5,"rationale":"x"}' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    };

    const summary = await runStage2Finalists({
      argv: [
        "node",
        "stage2",
        "--run-id",
        runId,
        "--allow-paid-model-calls",
        "--max-cost-usd",
        "55",
        "--acknowledge-unverified-billing-exposure",
        "--allow-unknown-resend",
      ],
      deps: {
        bypassAuthForTests: true,
        maxCostUsdForTests: 55,
        fetchImpl,
        openaiApiKey: "t",
        anthropicApiKey: "t",
        xaiApiKey: "t",
        prbenchTasks: [
          task({ benchmarkId: "prbench", taskId: "pr-1" }),
          task({ benchmarkId: "prbench", taskId: "pr-2" }),
          task({ benchmarkId: "prbench", taskId: "pr-3" }),
          task({ benchmarkId: "prbench", taskId: "pr-4" }),
        ],
        legalbenchTasks: [],
        skipRag: true,
        suiteOverride: suite,
        sleep: async () => undefined,
      },
    });

    expect(PROVIDER_UNKNOWN_CIRCUIT_BREAKER_THRESHOLD).toBe(3);
    expect(summary.status).toBe("STAGE2_PROVIDER_CIRCUIT_BREAKER");
    expect(summary.progress.providerCircuitBreakerTripped).toBe(true);
    expect(listTerminalProviderUnknowns(runId).length).toBeGreaterThanOrEqual(3);
    expect(xaiCalls).toBeLessThan(8);

    rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
  });

  it("recordUnknownResendAttempt is idempotent and blocks duplicate consumption checks", () => {
    const runId = `stage2-unk-ledger-${Date.now()}`;
    ensureRunDir(runId);
    recordUnknownResendAttempt({
      runId,
      taskId: "t1::grok-4.7",
      provider: "xai",
    });
    recordUnknownResendAttempt({
      runId,
      taskId: "t1::grok-4.7",
      provider: "xai",
    });
    expect(hasConsumedSingleUnknownResend(runId, "t1::grok-4.7", "xai")).toBe(true);
    expect(hasConsumedSingleUnknownResend(runId, "t1::gpt-6.1-sol", "openai")).toBe(false);
    rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
  });
});

describe("stage2 claude half-run checkpoint", () => {
  it("stops at --max-claude-responses and refuses dispatch beyond the cap on resume", async () => {
    const runId = `stage2-claude-half-${Date.now()}`;
    const suite = miniSuite(
      ["prbench-half-1", "prbench-half-2", "prbench-half-3"],
      ["abercrombie::train::0", "sara_numeric::train::0"],
      [],
    );
    const config = {
      runId,
      stage: 2,
      challengerMode: "claude-only",
      autoEscalate: false,
      suite,
      models: {
        response: ["claude-opus-5-5"],
        judges: ["claude-sonnet-5-5", "gpt-6.1-sol"],
      },
      test: true,
    };
    const configHash = hashRunConfig(config);
    ensureRunDir(runId);
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "full-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "stage2-suite.json"),
      `${JSON.stringify(suite, null, 2)}\n`,
    );
    freezeRunManifest(runId, {
      runId,
      configHash,
      suite: config,
      models: config.models,
      budgetMaxUsd: 95,
    });

    const prbenchTasks = [
      task({
        benchmarkId: "prbench",
        taskId: "prbench-half-1",
        rubric: { criteria: [{ id: "c1", description: "ok", weight: 1, maxScore: 1 }] },
      }),
      task({
        benchmarkId: "prbench",
        taskId: "prbench-half-2",
        rubric: { criteria: [{ id: "c1", description: "ok", weight: 1, maxScore: 1 }] },
      }),
      task({
        benchmarkId: "prbench",
        taskId: "prbench-half-3",
        rubric: { criteria: [{ id: "c1", description: "ok", weight: 1, maxScore: 1 }] },
      }),
    ];
    const legalbenchTasks = [
      task({ benchmarkId: "legalbench", taskId: "abercrombie::train::0", expectedAnswer: "yes" }),
      task({ benchmarkId: "legalbench", taskId: "sara_numeric::train::0", expectedAnswer: "yes" }),
    ];

    let anthropicMessages = 0;
    let openaiCalls = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (u.includes("api.anthropic.com")) {
        anthropicMessages += 1;
        const isJudge = JSON.stringify(body).includes("independent legal-benchmark judge");
        return new Response(
          JSON.stringify({
            id: `msg_${anthropicMessages}`,
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: isJudge
                  ? '{"score":0.7,"rationale":"ok"}'
                  : "Claude half-run legal answer mentioning yes",
              },
            ],
            usage: { input_tokens: 40, output_tokens: 15 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.openai.com")) {
        openaiCalls += 1;
        return new Response(
          JSON.stringify({
            id: `resp_${openaiCalls}`,
            status: "completed",
            output_text: '{"score":0.65,"rationale":"ok"}',
            usage: { input_tokens: 30, output_tokens: 10 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected url ${u}`);
    };

    const summary1 = await runStage2Finalists({
      argv: [
        "node",
        "stage2-claude-challenger",
        "--run-id",
        runId,
        "--allow-paid-model-calls",
        "--max-cost-usd",
        "95",
        "--max-claude-responses",
        "2",
      ],
      deps: {
        bypassAuthForTests: true,
        maxCostUsdForTests: 95,
        fetchImpl,
        openaiApiKey: "test-openai",
        anthropicApiKey: "test-anthropic",
        prbenchTasks,
        legalbenchTasks,
        ragTaskIds: [],
        skipRag: true,
        responseModels: ["claude-opus-5-5"],
        suiteOverride: suite,
      },
    });

    expect(summary1.status).toBe("STAGE2_CHECKPOINT_STOP");
    expect(summary1.progress.claudeResponsesDone).toBe(2);
    expect(summary1.progress.judgeADone).toBe(2);
    expect(summary1.progress.judgeBDone).toBe(2);
    expect(summary1.note).toMatch(/CLAUDE_HALF_RUN_CHECKPOINT/);
    // 2 Claude responses + 2 Sonnet judges; no 3rd Claude response dispatch.
    expect(anthropicMessages).toBe(4);
    expect(openaiCalls).toBe(2);
    const anthropicAfterFirst = anthropicMessages;

    let anthropicOnResume = 0;
    const fetch2: typeof fetch = async (url, init) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) {
        anthropicOnResume += 1;
        return new Response(
          JSON.stringify({
            id: `msg_resume_${anthropicOnResume}`,
            stop_reason: "end_turn",
            content: [{ type: "text", text: "should-not-dispatch" }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.openai.com")) {
        return new Response(
          JSON.stringify({
            id: "resp_resume",
            status: "completed",
            output_text: '{"score":0.5,"rationale":"x"}',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected url ${u}`);
    };

    const summary2 = await runStage2Finalists({
      argv: [
        "node",
        "stage2-claude-challenger",
        "--run-id",
        runId,
        "--allow-paid-model-calls",
        "--max-cost-usd",
        "95",
        "--max-claude-responses",
        "2",
      ],
      deps: {
        bypassAuthForTests: true,
        maxCostUsdForTests: 95,
        fetchImpl: fetch2,
        openaiApiKey: "test-openai",
        anthropicApiKey: "test-anthropic",
        prbenchTasks,
        legalbenchTasks,
        ragTaskIds: [],
        skipRag: true,
        responseModels: ["claude-opus-5-5"],
        suiteOverride: suite,
      },
    });

    expect(summary2.status).toBe("STAGE2_CHECKPOINT_STOP");
    expect(summary2.progress.claudeResponsesDone).toBe(2);
    expect(summary2.paidCalls).toBe(0);
    expect(summary2.cacheHits).toBeGreaterThanOrEqual(4);
    expect(anthropicOnResume).toBe(0);
    expect(anthropicMessages).toBe(anthropicAfterFirst);

    rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
  });

  it("stop-after-prbench refuses LegalBench paid dispatch after PRBench", async () => {
    const runId = `stage2-claude-prbench-boundary-${Date.now()}`;
    const suite = miniSuite(
      ["prbench-bound-1"],
      ["abercrombie::train::0"],
      [],
    );
    const config = {
      runId,
      stage: 2,
      challengerMode: "claude-only",
      autoEscalate: false,
      suite,
      models: {
        response: ["claude-opus-5-5"],
        judges: ["claude-sonnet-5-5", "gpt-6.1-sol"],
      },
      test: true,
    };
    const configHash = hashRunConfig(config);
    ensureRunDir(runId);
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "full-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    writeFileSync(
      path.join(getCacheDir(), "runs", runId, "stage2-suite.json"),
      `${JSON.stringify(suite, null, 2)}\n`,
    );
    freezeRunManifest(runId, {
      runId,
      configHash,
      suite: config,
      models: config.models,
      budgetMaxUsd: 95,
    });

    const prbenchTasks = [
      task({
        benchmarkId: "prbench",
        taskId: "prbench-bound-1",
        rubric: { criteria: [{ id: "c1", description: "ok", weight: 1, maxScore: 1 }] },
      }),
    ];
    const legalbenchTasks = [
      task({ benchmarkId: "legalbench", taskId: "abercrombie::train::0", expectedAnswer: "yes" }),
    ];

    let anthropicCalls = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (u.includes("api.anthropic.com")) {
        anthropicCalls += 1;
        const isJudge = JSON.stringify(body).includes("independent legal-benchmark judge");
        return new Response(
          JSON.stringify({
            id: `msg_${anthropicCalls}`,
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: isJudge
                  ? '{"score":0.7,"rationale":"ok"}'
                  : "Claude PRBench boundary answer mentioning yes",
              },
            ],
            usage: { input_tokens: 40, output_tokens: 15 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.openai.com")) {
        return new Response(
          JSON.stringify({
            id: `resp_${anthropicCalls}`,
            status: "completed",
            output_text: '{"score":0.65,"rationale":"ok"}',
            usage: { input_tokens: 30, output_tokens: 10 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected url ${u}`);
    };

    const summary = await runStage2Finalists({
      argv: [
        "node",
        "stage2-claude-challenger",
        "--run-id",
        runId,
        "--allow-paid-model-calls",
        "--max-cost-usd",
        "95",
        "--stop-after-prbench",
        "--max-prbench-responses",
        "1",
      ],
      deps: {
        bypassAuthForTests: true,
        maxCostUsdForTests: 95,
        fetchImpl,
        openaiApiKey: "test-openai",
        anthropicApiKey: "test-anthropic",
        prbenchTasks,
        legalbenchTasks,
        ragTaskIds: [],
        skipRag: true,
        responseModels: ["claude-opus-5-5"],
        suiteOverride: suite,
      },
    });

    expect(summary.status).toBe("STAGE2_CHECKPOINT_STOP");
    expect(summary.note).toMatch(/CLAUDE_PRBENCH_BOUNDARY|CLAUDE_PRBENCH_CHECKPOINT/);
    expect(summary.progress.claudeResponsesDone).toBe(1);
    // 1 Claude PRBench response + 1 Sonnet judge; no LegalBench Claude dispatch.
    expect(anthropicCalls).toBe(2);

    rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
  });
});
