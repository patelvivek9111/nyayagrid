import { describe, expect, it } from "vitest";
import { rmSync, existsSync, readdirSync, writeFileSync } from "node:fs";
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
