import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { getCacheDir, getRegistryDir } from "../src/paths.js";
import {
  buildChallengerScreenRunId,
  freezeChallengerScreenManifest,
} from "../src/live/challenger-screen-manifest-builder.js";
import { probeGeminiModelAccess } from "../src/live/gemini-access-probe.js";
import { runStage1Screening } from "../src/live/stage1-executor.js";
import { hashRunConfig } from "../src/live/manifest.js";
import { ensureRunDir } from "../src/live/persistence.js";
import type { NormalizedTask } from "../src/schema/normalized-task.js";
import { buildAnthropicMessagesRequest } from "../src/providers/request-builders.js";

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

describe("challenger screen", () => {
  it("freezes challenger settings with Claude max_tokens 8192 (not 4096)", () => {
    const settings = JSON.parse(
      readFileSync(path.join(getRegistryDir(), "challenger-screen-settings.json"), "utf8"),
    ) as {
      settings: {
        "claude-opus-5-5": { max_tokens: number };
        "gemini-4-argon": { max_output_tokens: number };
      };
    };
    expect(settings.settings["claude-opus-5-5"].max_tokens).toBe(8192);
    expect(settings.settings["gemini-4-argon"].max_output_tokens).toBe(4096);
    const req = buildAnthropicMessagesRequest({
      model: "claude-opus-5-5",
      effort: "high",
      maxTokens: 8192,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(req.max_tokens).toBe(8192);
  });

  it("reuses exact Stage-1 screening task IDs (32+24)", () => {
    const suite = JSON.parse(
      readFileSync(path.join(getRegistryDir(), "screening-suite.json"), "utf8"),
    ) as {
      upstream_ids: { prbench_legal_hard: string[]; legalbench: string[] };
    };
    expect(suite.upstream_ids.prbench_legal_hard).toHaveLength(32);
    expect(suite.upstream_ids.legalbench).toHaveLength(24);
  });

  it("probes Gemini via Models.list without generation", async () => {
    let generationPosts = 0;
    const result = await probeGeminiModelAccess({
      apiKey: "test-key",
      fetchImpl: async (url, init) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "POST") generationPosts += 1;
        expect(String(url)).toContain("/models");
        return new Response(
          JSON.stringify({
            models: [{ name: "models/gemini-4-argon" }, { name: "models/gemini-2.5-flash" }],
          }),
          { status: 200 },
        );
      },
    });
    expect(result.status).toBe("GEMINI_ACCESS_OK");
    expect(result.modelListed).toBe(true);
    expect(result.paidGenerationCalls).toBe(0);
    expect(generationPosts).toBe(0);
  });

  it("marks Gemini blocked when model missing from list", async () => {
    const result = await probeGeminiModelAccess({
      apiKey: "test-key",
      fetchImpl: async () =>
        new Response(JSON.stringify({ models: [{ name: "models/gemini-2.5-flash" }] }), {
          status: 200,
        }),
    });
    expect(result.status).toBe("GEMINI_PROVIDER_ACCESS_BLOCKED");
  });

  it("runs Claude+Gemini challenger subset with 8192 Claude cap and interleaved order", async () => {
    const runId = "challenger-screen-test-unit-001";
    const dir = path.join(getCacheDir(), "runs", runId);
    rmSync(dir, { recursive: true, force: true });
    ensureRunDir(runId);

    const { config, configHash } = freezeChallengerScreenManifest({
      runId,
      gitSha: "deadbeefdead",
      budgetMaxUsd: 20,
      includeGemini: true,
    });
    expect(
      (config as { outputTokenOverrides: Record<string, number> }).outputTokenOverrides[
        "claude-opus-5-5"
      ],
    ).toBe(8192);

    // Re-hash after freeze (freeze writes files)
    const full = JSON.parse(readFileSync(path.join(dir, "full-config.json"), "utf8"));
    expect(hashRunConfig(full)).toBe(configHash);

    const seenMaxTokens: number[] = [];
    const callOrder: string[] = [];
    let calls = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      calls += 1;
      const u = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (u.includes("api.anthropic.com")) {
        if (
          typeof body.max_tokens === "number" &&
          !String(JSON.stringify(body)).includes("judge")
        ) {
          seenMaxTokens.push(body.max_tokens);
          callOrder.push("claude");
        }
        const isJudge = JSON.stringify(body).includes("independent legal-benchmark judge");
        return new Response(
          JSON.stringify({
            id: `msg_${calls}`,
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: isJudge ? '{"score":0.7,"rationale":"ok"}' : "Claude final answer yes",
              },
            ],
            usage: { input_tokens: 40, output_tokens: 20 },
          }),
          { status: 200 },
        );
      }
      if (u.includes("generativelanguage.googleapis.com") && u.includes("/interactions")) {
        callOrder.push("gemini");
        return new Response(
          JSON.stringify({
            id: `int_${calls}`,
            status: "completed",
            output_text: "Gemini final answer yes",
            usage: { input_tokens: 30, output_tokens: 10 },
          }),
          { status: 200 },
        );
      }
      if (u.includes("api.openai.com")) {
        return new Response(
          JSON.stringify({
            id: `resp_${calls}`,
            status: "completed",
            output_text: '{"score":0.65,"rationale":"ok"}',
            usage: { input_tokens: 50, output_tokens: 15 },
          }),
          { status: 200 },
        );
      }
      return new Response("no", { status: 404 });
    };

    const pr = [
      task({
        taskId: "prbench-challenger-1",
        benchmarkId: "prbench",
        rubric: { criteria: [{ id: "c1", description: "ok", weight: 1, maxScore: 1 }] },
      }),
      task({
        taskId: "prbench-challenger-2",
        benchmarkId: "prbench",
        rubric: { criteria: [{ id: "c1", description: "ok", weight: 1, maxScore: 1 }] },
      }),
    ];
    const lb = [
      task({
        taskId: "abercrombie::train::0",
        benchmarkId: "legalbench",
        expectedAnswer: "yes",
      }),
    ];

    const summary = await runStage1Screening({
      argv: [
        "node",
        "challenger",
        "--run-id",
        runId,
        "--allow-paid-model-calls",
        "--max-cost-usd",
        "20",
      ],
      deps: {
        fetchImpl,
        openaiApiKey: "sk-test",
        anthropicApiKey: "sk-ant",
        googleApiKey: "gk",
        responseModels: ["claude-opus-5-5", "gemini-4-argon"],
        prbenchTasks: pr,
        legalbenchTasks: lb,
        skipRag: true,
        requireOnlySelectedProviderKeys: true,
        interleaveModelsPerTask: true,
        claudeMaxTokens: 8192,
        geminiMaxOutputTokens: 4096,
        maxCostUsdCeiling: 20,
        bypassAuthForTests: true,
        maxCostUsdForTests: 20,
      },
    });

    expect(summary.status).toBe("STAGE1_COMPLETE");
    expect(seenMaxTokens.every((n) => n === 8192)).toBe(true);
    expect(seenMaxTokens.length).toBeGreaterThan(0);
    // Interleaved: for each PRBench task, Claude then Gemini
    expect(callOrder.slice(0, 4)).toEqual(["claude", "gemini", "claude", "gemini"]);
    expect(summary.stage2Started).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("buildChallengerScreenRunId uses challenger-screen-v1 prefix", () => {
    expect(buildChallengerScreenRunId("a888ad28ce82c4308fd0e23cd5372803afffc9d8")).toBe(
      "challenger-screen-v1-a888ad28ce82",
    );
  });

  it("does not require writing into stage2-finalists run directory", () => {
    const stage2 = path.join(getCacheDir(), "runs", "stage2-finalists-v1-044fb482d7bf");
    const before = existsSync(stage2)
      ? readFileSync(path.join(stage2, "manifest.json"), "utf8")
      : null;
    const runId = "challenger-screen-test-isolation";
    const dir = path.join(getCacheDir(), "runs", runId);
    rmSync(dir, { recursive: true, force: true });
    freezeChallengerScreenManifest({
      runId,
      gitSha: "abcdef012345",
      includeGemini: false,
    });
    if (before !== null) {
      expect(readFileSync(path.join(stage2, "manifest.json"), "utf8")).toBe(before);
    }
    rmSync(dir, { recursive: true, force: true });
  });
});
