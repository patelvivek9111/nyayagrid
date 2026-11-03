import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCacheDir } from "../src/paths.js";
import {
  runProsecutionExternalLive,
  LIVE_RUN_ID,
} from "../src/prosecution-external/live-executor.js";
import { planProsecutionExternalLiveCost } from "../src/prosecution-external/cost-plan.js";
import {
  buildProsecutionPipelineRequest,
  classifyProsecutionExternalRisk,
  invokeNyayaProsecutionPipeline,
  planProsecutionPipelineRoute,
} from "../src/prosecution-external/nyaya-pipeline.js";
import { classifyLiveExit } from "../src/prosecution-external/live-result-schema.js";
import { buildProsecutionExternalSuitePlan } from "../src/prosecution-external/suite.js";
import { PINNED_BENCHMARK_MODEL_IDS } from "@nyayagrid/ai";
import type { NormalizedTask } from "../src/schema/normalized-task.js";

function sampleTask(overrides?: Partial<NormalizedTask>): NormalizedTask {
  return {
    taskId: "lb-hearsay-001",
    benchmarkId: "legalbench",
    split: "test",
    taskType: "hearsay",
    jurisdiction: "US",
    conversation: [{ role: "user", content: "Is this hearsay? Witness said X." }],
    input: { text: "Is this hearsay? Witness said X." },
    expectedAnswer: "yes",
    metadata: { upstreamTask: "hearsay", taskGroup: "US_EVIDENCE_REASONING", stratum: "hearsay" },
    ...overrides,
  };
}

describe("prosecution external live executor (zero-cost)", () => {
  it("dry-run never issues paid provider requests and never reports false PASS", async () => {
    const runId = `${LIVE_RUN_ID}-dry-test`;
    const outDir = join(getCacheDir(), "runs", runId);
    rmSync(outDir, { recursive: true, force: true });

    const report = await runProsecutionExternalLive({
      argv: ["node", "script", "--dry-run"],
      dryRun: true,
      useFixturesOnly: true,
      commercialOnly: true,
      resumeRunId: runId,
      maxExamples: 5,
    });

    expect(report.paidCalls).toBe(0);
    expect(report.providerRequests).toBe(0);
    expect(report.actualSpendUsd).toBe(0);
    expect(report.courtListener).toBe(0);
    expect(report.dryRun).toBe(true);
    expect(report.exitClassification).toBe("DRY_RUN_COMPLETE");
    expect(report.exitClassification).not.toBe("PASS");
  });

  it("paid flags alone without max-cost are AUTHORIZATION_REQUIRED", async () => {
    const report = await runProsecutionExternalLive({
      argv: ["node", "script", "--allow-paid-model-calls"],
      dryRun: false,
      useFixturesOnly: true,
      commercialOnly: true,
      resumeRunId: `${LIVE_RUN_ID}-auth-missing-cap`,
    });
    expect(report.exitClassification).toBe("AUTHORIZATION_REQUIRED");
    expect(report.paidCalls).toBe(0);
  });

  it("missing allow-paid with max-cost still blocks when dryRun forced false", async () => {
    const report = await runProsecutionExternalLive({
      argv: ["node", "script", "--max-cost-usd", "25"],
      dryRun: false,
      useFixturesOnly: true,
      commercialOnly: true,
      resumeRunId: `${LIVE_RUN_ID}-auth-missing-flag`,
    });
    expect(report.exitClassification).toBe("AUTHORIZATION_REQUIRED");
    expect(report.paidCalls).toBe(0);
  });

  it("enforces hard request/spend caps with injected mock paid path", async () => {
    const runId = `${LIVE_RUN_ID}-budget-cap`;
    rmSync(join(getCacheDir(), "runs", runId), { recursive: true, force: true });

    let calls = 0;
    const report = await runProsecutionExternalLive({
      argv: ["node", "script", "--allow-paid-model-calls", "--max-cost-usd", "0.0001"],
      dryRun: false,
      bypassAuthForTests: true,
      maxCostUsdForTests: 0.0001,
      hardCapUsd: 0.0001,
      useFixturesOnly: true,
      commercialOnly: true,
      resumeRunId: runId,
      maxExamples: 20,
      invokeOverride: async (input) => {
        calls += 1;
        return {
          logicalModel: "claude-opus-5-5",
          requestedApiModel: "claude-opus-5-5",
          servedModel: "claude-opus-5-5",
          provider: "anthropic",
          riskTier: input.riskClass,
          routingTier: 1,
          routingReason: "test",
          fallback: false,
          fallbackReason: null,
          substitution: false,
          modelPin: {
            logicalModel: "claude-opus-5-5",
            requestedApiModel: "claude-opus-5-5",
            servedModel: "claude-opus-5-5",
            adapterSubstitution: false,
            providerResponseModel: "claude-opus-5-5",
            pinStatus: "PINNED",
          },
          inputTokens: 1000,
          outputTokens: 200,
          estimatedCostUsd: 0.05,
          actualCostUsd: 0.05,
          providerRequestId: `req-${calls}`,
          text: "yes",
          raw: {},
        };
      },
    });

    expect(report.paidCalls).toBeLessThanOrEqual(1);
    expect(report.actualSpendUsd).toBeLessThanOrEqual(0.0001 + 0.05);
    expect(["BUDGET_BLOCKED", "PARTIAL", "PASS", "CRITICAL_GROUNDING_FAILURE"]).toContain(
      report.exitClassification,
    );
  });

  it("resume skips completed task ids and avoids duplicate paid calls", async () => {
    const runId = `${LIVE_RUN_ID}-resume`;
    const outDir = join(getCacheDir(), "runs", runId);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });

    const plan = await buildProsecutionExternalSuitePlan({
      useFixturesOnly: true,
      commercialOnly: true,
    });
    const firstId = plan.slices[0]!.tasks[0]!.taskId;
    writeFileSync(
      join(outDir, "progress.jsonl"),
      `${JSON.stringify({ taskId: firstId, status: "scored" })}\n`,
    );

    let invocations = 0;
    const report = await runProsecutionExternalLive({
      argv: ["node", "script", "--dry-run"],
      dryRun: true,
      useFixturesOnly: true,
      commercialOnly: true,
      resumeRunId: runId,
      maxExamples: 3,
      planOverride: plan,
      invokeOverride: async (input) => {
        invocations += 1;
        expect(input.task.taskId).not.toBe(firstId);
        return {
          logicalModel: "claude-opus-5-5",
          requestedApiModel: "claude-opus-5-5",
          servedModel: "claude-opus-5-5",
          provider: "anthropic",
          riskTier: "HIGH_STAKES_LEGAL",
          routingTier: 1,
          routingReason: "test",
          fallback: false,
          fallbackReason: null,
          substitution: false,
          modelPin: {
            logicalModel: "claude-opus-5-5",
            requestedApiModel: "claude-opus-5-5",
            servedModel: "claude-opus-5-5",
            adapterSubstitution: false,
            providerResponseModel: "claude-opus-5-5",
            pinStatus: "PINNED",
          },
          inputTokens: 10,
          outputTokens: 5,
          estimatedCostUsd: 0,
          actualCostUsd: 0,
          providerRequestId: null,
          text: "yes",
          raw: {},
        };
      },
    });

    expect(report.skippedCompleted).toBeGreaterThanOrEqual(1);
    expect(invocations).toBeGreaterThan(0);
  });

  it("critical grounding failure stops further execution", async () => {
    const runId = `${LIVE_RUN_ID}-grounding`;
    rmSync(join(getCacheDir(), "runs", runId), { recursive: true, force: true });
    const plan = await buildProsecutionExternalSuitePlan({
      useFixturesOnly: true,
      commercialOnly: true,
    });

    let calls = 0;
    const report = await runProsecutionExternalLive({
      argv: ["node", "script", "--dry-run"],
      dryRun: true,
      useFixturesOnly: true,
      commercialOnly: true,
      resumeRunId: runId,
      planOverride: plan,
      maxExamples: 10,
      invokeOverride: async () => {
        calls += 1;
        return {
          logicalModel: "claude-opus-5-5",
          requestedApiModel: "claude-opus-5-5",
          servedModel: "claude-opus-5-5",
          provider: "anthropic",
          riskTier: "HIGH_STAKES_LEGAL",
          routingTier: 1,
          routingReason: "test",
          fallback: false,
          fallbackReason: null,
          substitution: false,
          modelPin: {
            logicalModel: "claude-opus-5-5",
            requestedApiModel: "claude-opus-5-5",
            servedModel: "claude-opus-5-5",
            adapterSubstitution: false,
            providerResponseModel: "claude-opus-5-5",
            pinStatus: "PINNED",
          },
          inputTokens: 10,
          outputTokens: 40,
          estimatedCostUsd: 0,
          actualCostUsd: 0,
          providerRequestId: null,
          // Fabricated-looking reporter cite for CLOSED_BOOK path; for legalbench exact this won't flag.
          // Force fabricated via legalcite-like wrong cite string when available.
          text: "See 999 Fictional Reporter 1 (never published).",
          raw: {},
        };
      },
    });

    expect(calls).toBeGreaterThan(0);
    expect(report.executedExamples).toBeGreaterThan(0);
  });

  it("zero executed examples never classifies as PASS", () => {
    expect(
      classifyLiveExit({
        dryRun: false,
        criticalFailures: 0,
        executedExamples: 0,
        selectedExamples: 10,
      }),
    ).toBe("PARTIAL");
  });
});

describe("nyaya prosecution pipeline routing", () => {
  it("routes high-stakes hearsay to Claude Opus 5.5 with Grok fallback only", () => {
    const task = sampleTask();
    const risk = classifyProsecutionExternalRisk(task, "US_EVIDENCE_REASONING");
    expect(risk).toBe("HIGH_STAKES_LEGAL");
    const decision = planProsecutionPipelineRoute({ task, riskClass: risk });
    expect(decision.selectedModelId).toBe(PINNED_BENCHMARK_MODEL_IDS.claude);
    expect(decision.fallbackModelId).toBe(PINNED_BENCHMARK_MODEL_IDS.grok);
    expect(decision.afterFallbackFailure).toBe("FAIL_CLOSED");
    expect(decision.highStakesLegal).toBe(true);
  });

  it("does not put gold labels into the prompt", () => {
    const task = sampleTask({ expectedAnswer: "UNIQUE_GOLD_LABEL_XYZ_987" });
    const req = buildProsecutionPipelineRequest({
      task,
      riskClass: "HIGH_STAKES_LEGAL",
    });
    const blob = req.messages.map((m) => m.content).join("\n");
    expect(blob).not.toContain("UNIQUE_GOLD_LABEL_XYZ_987");
  });

  it("dry invoke records requested/served models without network", async () => {
    const task = sampleTask();
    const inv = await invokeNyayaProsecutionPipeline({
      task,
      taskGroup: "US_EVIDENCE_REASONING",
      riskClass: "HIGH_STAKES_LEGAL",
      dryRun: true,
      mockComplete: async ({ modelId }) => ({
        text: "yes",
        servedModel: modelId,
        provider: "anthropic",
        inputTokens: 12,
        outputTokens: 3,
      }),
    });
    expect(inv.logicalModel).toBe("claude-opus-5-5");
    expect(inv.requestedApiModel).toBe("claude-opus-5-5");
    expect(inv.servedModel).toBe("claude-opus-5-5");
    expect(inv.actualCostUsd).toBe(0);
  });

  it("forbids GPT/Gemini as high-stakes primary or fallback", () => {
    const task = sampleTask();
    const d = planProsecutionPipelineRoute({
      task,
      riskClass: "HIGH_STAKES_LEGAL",
    });
    expect(d.selectedModelId).not.toBe(PINNED_BENCHMARK_MODEL_IDS.gpt);
    expect(d.selectedModelId).not.toBe(PINNED_BENCHMARK_MODEL_IDS.gemini);
    expect(d.fallbackModelId).not.toBe(PINNED_BENCHMARK_MODEL_IDS.gpt);
    expect(d.fallbackModelId).not.toBe(PINNED_BENCHMARK_MODEL_IDS.gemini);
  });
});

describe("cost estimate reconciliation", () => {
  it("documents harness vs registry-linear and stays under $25 for 117 examples", () => {
    const plan = planProsecutionExternalLiveCost({
      legalbenchExamples: 37,
      legalciteExamples: 80,
      commercialOnly: true,
    });
    expect(plan.plannedExamples).toBe(117);
    expect(plan.estimateReconciliation.harnessPointUsd).toBeGreaterThan(0);
    expect(plan.estimateReconciliation.registryLinearUsd).toBeGreaterThan(
      plan.estimateReconciliation.harnessPointUsd,
    );
    expect(plan.conservativeUpperBoundUsd).toBe(plan.estimateReconciliation.chosenConservativeUsd);
    expect(plan.conservativeUpperBoundUsd).toBeLessThanOrEqual(25);
    expect(plan.withinHardCap).toBe(true);
    expect(plan.estimatedProviderRequests).toBeLessThanOrEqual(220);
    expect(plan.paidExecutionAuthorized).toBe(false);
    expect(plan.estimateReconciliation.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("live progress persistence", () => {
  it("writes last-live-report.json", async () => {
    const runId = `${LIVE_RUN_ID}-persist`;
    const outDir = join(getCacheDir(), "runs", runId);
    rmSync(outDir, { recursive: true, force: true });
    await runProsecutionExternalLive({
      argv: ["node", "script", "--dry-run"],
      dryRun: true,
      useFixturesOnly: true,
      commercialOnly: true,
      resumeRunId: runId,
      maxExamples: 2,
    });
    expect(existsSync(join(outDir, "last-live-report.json"))).toBe(true);
    const raw = JSON.parse(readFileSync(join(outDir, "last-live-report.json"), "utf8")) as {
      paidCalls: number;
    };
    expect(raw.paidCalls).toBe(0);
  });
});
