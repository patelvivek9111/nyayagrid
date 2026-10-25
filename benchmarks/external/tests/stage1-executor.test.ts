import { describe, expect, it } from "vitest";
import { rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { freezeRunManifest, hashRunConfig } from "../src/live/manifest.js";
import { runStage1Screening } from "../src/live/stage1-executor.js";
import { getCacheDir } from "../src/paths.js";
import { ensureRunDir } from "../src/live/persistence.js";
import { writeFileSync } from "node:fs";
import type { NormalizedTask } from "../src/schema/normalized-task.js";
import { scoreLegalBenchExact } from "../src/scorers/legalbench-exact.js";
import { autoStartStage2FromStage1 } from "../src/live/stage-gate.js";
import { isResponseCacheHit } from "../src/live/response-cache.js";
import { isJudgeCacheHit } from "../src/live/judge-cache.js";

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
      const isJudge = JSON.stringify(body).includes("independent legal-benchmark judge");
      const model = body.model as string;
      return new Response(
        JSON.stringify({
          id: `msg_${calls}`,
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: isJudge ? '{"score":0.6,"rationale":"ok"}' : `Anthropic ${model} answer yes`,
            },
          ],
          usage: { input_tokens: 40, output_tokens: 15 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (u.includes("generativelanguage.googleapis.com")) {
      return new Response(
        JSON.stringify({
          id: `int_${calls}`,
          status: "completed",
          output_text: "Gemini answer yes",
          usage: { input_tokens: 30, output_tokens: 10, thinking_tokens: 5 },
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
          usage: { input_tokens: 35, output_tokens: 12, cached_input_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, getCalls: () => calls };
}

describe("legalbench exact scorer", () => {
  it("scores normalized exact match", () => {
    expect(scoreLegalBenchExact({ modelOutput: "Yes.", expectedAnswer: "yes" }).correct).toBe(true);
    expect(scoreLegalBenchExact({ modelOutput: "no", expectedAnswer: "yes" }).score).toBe(0);
  });
});

describe("stage1 mini-run mock", () => {
  it("runs mini Stage-1 across 4 providers + judges, resumes with cache, no Stage-2", async () => {
    const runId = `stage1-mini-${Date.now()}`;
    const config = {
      runId,
      stage: 1,
      autoEscalate: false,
      models: {
        response: ["gpt-6.1-sol", "claude-opus-5-5", "gemini-4-argon", "grok-4.7"],
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
    freezeRunManifest(runId, {
      runId,
      configHash,
      suite: config,
      models: config.models,
      budgetMaxUsd: 25,
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
    ];
    const legalbenchTasks = [
      task({ benchmarkId: "legalbench", taskId: "abercrombie::train::0", expectedAnswer: "yes" }),
      task({
        benchmarkId: "legalbench",
        taskId: "definition_classification::train::0",
        expectedAnswer: "yes",
      }),
    ];

    const mock1 = mockFetchFactory();
    const argv = [
      "node",
      "stage1",
      "--run-id",
      runId,
      "--allow-paid-model-calls",
      "--max-cost-usd",
      "25",
      "--batch-size",
      "5",
      "--concurrency",
      "2",
    ];

    try {
      const summary1 = await runStage1Screening({
        argv,
        deps: {
          bypassAuthForTests: true,
          maxCostUsdForTests: 25,
          fetchImpl: mock1.fetchImpl,
          openaiApiKey: "o",
          anthropicApiKey: "a",
          googleApiKey: "g",
          xaiApiKey: "x",
          prbenchTasks,
          legalbenchTasks,
          ragTaskIds: ["cuad::0", "maud::0"],
          skipRag: true,
        },
      });

      expect(summary1.stage2Started).toBe(false);
      expect(autoStartStage2FromStage1()).toBe(false);
      expect(summary1.ragGenerationCalls).toBe(0);
      // 2 PRBench + 2 LegalBench × 4 models = 16 responses; PRBench judges = 2×4×2 = 16
      expect(summary1.progress.plannedResponses).toBe(16);
      expect(summary1.progress.plannedJudges).toBe(16);
      expect(summary1.progress.completedResponses).toBe(16);
      expect(summary1.progress.completedJudges).toBe(16);
      expect(summary1.paidCalls).toBe(32);
      expect(summary1.cost.totalUsd).toBeGreaterThan(0);
      expect(summary1.cost.totalUsd).toBeLessThanOrEqual(25);
      expect(mock1.getCalls()).toBe(32);

      const responseDir = path.join(getCacheDir(), "runs", runId, "response");
      const judgeDir = path.join(getCacheDir(), "runs", runId, "judge");
      expect(readdirSync(responseDir).filter((f) => f.endsWith(".json")).length).toBe(16);
      expect(readdirSync(judgeDir).filter((f) => f.endsWith(".json")).length).toBe(16);

      // Resume: zero new paid calls
      const mock2 = mockFetchFactory();
      const summary2 = await runStage1Screening({
        argv,
        deps: {
          bypassAuthForTests: true,
          maxCostUsdForTests: 25,
          fetchImpl: mock2.fetchImpl,
          openaiApiKey: "o",
          anthropicApiKey: "a",
          googleApiKey: "g",
          xaiApiKey: "x",
          prbenchTasks,
          legalbenchTasks,
          skipRag: true,
        },
      });
      expect(summary2.paidCalls).toBe(0);
      expect(summary2.cacheHits).toBeGreaterThanOrEqual(32);
      expect(mock2.getCalls()).toBe(0);
      expect(summary2.cost.totalUsd).toBeCloseTo(summary1.cost.totalUsd, 5);

      // Cache keys resolve as hits
      for (const file of readdirSync(responseDir).filter((f) => f.endsWith(".json"))) {
        const key = file.replace(/\.json$/, "");
        expect(isResponseCacheHit(runId, key)).toBe(true);
      }
      for (const file of readdirSync(judgeDir).filter((f) => f.endsWith(".json"))) {
        const key = file.replace(/\.json$/, "");
        expect(isJudgeCacheHit(runId, key)).toBe(true);
      }

      const progress = JSON.parse(
        readFileSync(path.join(getCacheDir(), "runs", runId, "stage1-progress.json"), "utf8"),
      ) as { paidCalls: number };
      expect(progress.paidCalls).toBe(0);
    } finally {
      rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
    }
  });

  it("partial judge resume does not regenerate response", async () => {
    const runId = `stage1-partial-${Date.now()}`;
    const config = { runId, stage: 1, models: ["gpt-6.1-sol"] };
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
      budgetMaxUsd: 25,
    });

    const prbenchTasks = [
      task({
        benchmarkId: "prbench",
        taskId: "prbench-partial-1",
        rubric: { criteria: [{ id: "c1", description: "ok", weight: 1, maxScore: 1 }] },
      }),
    ];

    let phase = 0;
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes("api.openai.com") && phase === 0) {
        return new Response(
          JSON.stringify({
            id: "resp_only",
            status: "completed",
            output_text: "answer",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.anthropic.com") && phase === 0) {
        return new Response("rate", { status: 429 });
      }
      // phase 1 resume
      if (u.includes("api.anthropic.com")) {
        return new Response(
          JSON.stringify({
            id: "msg_j",
            content: [{ type: "text", text: '{"score":0.5,"rationale":"ok"}' }],
            usage: { input_tokens: 8, output_tokens: 4 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("api.openai.com")) {
        return new Response(
          JSON.stringify({
            id: "resp_j",
            output_text: '{"score":0.55,"rationale":"ok"}',
            usage: { input_tokens: 8, output_tokens: 4 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // other providers unused in this single-model test
      return new Response(
        JSON.stringify({
          id: "other",
          output_text: "x",
          content: [{ type: "text", text: "x" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    try {
      phase = 0;
      await runStage1Screening({
        argv: ["node", "s", "--run-id", runId, "--allow-paid-model-calls", "--max-cost-usd", "25"],
        deps: {
          bypassAuthForTests: true,
          fetchImpl,
          openaiApiKey: "o",
          anthropicApiKey: "a",
          googleApiKey: "g",
          xaiApiKey: "x",
          prbenchTasks,
          legalbenchTasks: [],
          responseModels: ["gpt-6.1-sol"],
          skipRag: true,
        },
      });

      const responseCount = readdirSync(path.join(getCacheDir(), "runs", runId, "response")).filter(
        (f) => f.endsWith(".json"),
      ).length;
      expect(responseCount).toBe(1);

      phase = 1;
      const resumed = await runStage1Screening({
        argv: ["node", "s", "--run-id", runId, "--allow-paid-model-calls", "--max-cost-usd", "25"],
        deps: {
          bypassAuthForTests: true,
          fetchImpl,
          openaiApiKey: "o",
          anthropicApiKey: "a",
          googleApiKey: "g",
          xaiApiKey: "x",
          prbenchTasks,
          legalbenchTasks: [],
          responseModels: ["gpt-6.1-sol"],
          skipRag: true,
        },
      });
      expect(resumed.progress.completedJudges).toBe(2);
      expect(
        readdirSync(path.join(getCacheDir(), "runs", runId, "response")).filter((f) =>
          f.endsWith(".json"),
        ).length,
      ).toBe(1);
    } finally {
      if (existsSync(path.join(getCacheDir(), "runs", runId))) {
        rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
      }
    }
  });
});
