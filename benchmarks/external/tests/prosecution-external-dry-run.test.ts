import { describe, expect, it } from "vitest";
import { runProsecutionExternalDryRun } from "../src/prosecution-external/dry-run.js";
import { planProsecutionExternalLiveCost } from "../src/prosecution-external/cost-plan.js";
import { buildProsecutionExternalSuitePlan } from "../src/prosecution-external/suite.js";

describe("prosecution external dry-run harness", () => {
  it("loads suite fixtures with separated jurisdictions", async () => {
    const plan = await buildProsecutionExternalSuitePlan({ useFixturesOnly: true });
    expect(plan.suiteId).toBe("NYAYA_EXTERNAL_PROSECUTION_VALIDATION");
    expect(plan.totalSelected).toBeGreaterThan(0);
    expect(plan.slices.some((s) => s.jurisdiction === "VICTORIA_AUSTRALIA")).toBe(true);
    expect(
      plan.slices.some((s) => s.jurisdiction === "US" || s.jurisdiction.startsWith("US")),
    ).toBe(true);
  });

  it("runs mock evaluation with zero paid calls", async () => {
    const report = await runProsecutionExternalDryRun();
    expect(report.paidCalls).toBe(0);
    expect(report.courtListener).toBe(0);
    expect(report.internalBenchSeparated).toBe(true);
    expect(report.jurisdictionSeparated).toBe(true);
    expect(report.gpt61SolLiveVerified).toBe(false);
    expect(report.tasks.length).toBeGreaterThan(0);
    expect(report.groups.length).toBeGreaterThan(0);
  });

  it("resumes by skipping completed task ids", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { getCacheDir } = await import("../src/paths.js");
    const outDir = join(getCacheDir(), "runs", "prosecution-external-dry");
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    const first = await runProsecutionExternalDryRun();
    expect(first.tasks.length).toBeGreaterThan(0);
    // Seed progress as if prior tasks completed, then resume should emit no new rows.
    writeFileSync(
      join(outDir, "progress.jsonl"),
      first.tasks.map((t) => JSON.stringify({ taskId: t.sampleId, status: "scored" })).join("\n") +
        "\n",
    );
    const second = await runProsecutionExternalDryRun({ resumeRunId: "prosecution-external-dry" });
    expect(second.tasks.length).toBe(0);
  });

  it("produces a future live cost plan without authorizing paid execution", () => {
    const plan = planProsecutionExternalLiveCost();
    expect(plan.paidExecutionAuthorized).toBe(false);
    expect(plan.plannedExamples).toBeGreaterThan(0);
    expect(plan.recommendedHardCapUsd).toBeGreaterThan(plan.estimatedSpendUsd * 0.5);
    expect(plan.gpt61SolLiveVerified).toBe(false);
  });
});
