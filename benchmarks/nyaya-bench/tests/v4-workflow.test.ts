import { describe, expect, it } from "vitest";
import {
  FW1_DATASET_ID,
  FW1_GRADER_VERSION,
  FW1_ISOLATION_TOKEN,
  FW1_MATTERS,
  RUBRIC_CRITERIA,
  WORKFLOW_STEPS,
  catalogFingerprint,
  catalogStats,
  documentsFor,
  lateDiscoveredDocument,
} from "../datasets/v4-workflow/catalog";
import { goldenSnapshot, gradeFw1Matter, summarizeFw1 } from "../graders/v4-workflow-grade";
import { estimateFw1, RequestCapAbort, XaiRequestCounter, budgetPreflightPass } from "../runner/fw1-cost";
import { mapPool } from "../runner/concurrency";

describe("fw1 catalog", () => {
  it("freezes 12 complete matters with 12-step workflows and 11 rubric criteria", () => {
    const stats = catalogStats();
    expect(stats.datasetId).toBe(FW1_DATASET_ID);
    expect(stats.matterCount).toBe(12);
    expect(stats.workflowCount).toBe(12);
    expect(stats.workflowSteps).toBe(12);
    expect(stats.rubricCriteria).toBe(11);
    expect(WORKFLOW_STEPS).toHaveLength(12);
    expect(RUBRIC_CRITERIA).toHaveLength(11);
    expect(stats.minDocs).toBeGreaterThanOrEqual(24);
    expect(stats.maxDocs).toBeGreaterThanOrEqual(40);
    expect(catalogFingerprint()).toHaveLength(64);
    expect(FW1_GRADER_VERSION).toBe("fw1-grade-2026-09-10");
  });

  it("keeps isolation token only on org B", () => {
    const orgA = FW1_MATTERS.filter((m) => m.org === "A");
    const orgB = FW1_MATTERS.filter((m) => m.org === "B");
    expect(orgB).toHaveLength(1);
    expect(orgA.every((seed) => !documentsFor(seed).some((d) => d.body.includes(FW1_ISOLATION_TOKEN)))).toBe(true);
    expect(documentsFor(orgB[0]!).some((d) => d.body.includes(FW1_ISOLATION_TOKEN))).toBe(true);
  });

  it("does not attach the missing exhibit and includes a late-discovered wire", () => {
    for (const seed of FW1_MATTERS) {
      const bodies = documentsFor(seed).map((d) => d.body).join("\n");
      expect(bodies).toMatch(new RegExp(`Exhibit ${seed.missingExhibit}.*(NOT attached|not attached|missing)`, "i"));
      expect(lateDiscoveredDocument(seed).body).toContain(seed.wireRef);
    }
  });
});

describe("fw1 grader", () => {
  it("passes a complete honest golden workflow", () => {
    const grades = FW1_MATTERS.filter((m) => m.org === "A").map((seed) => gradeFw1Matter(goldenSnapshot(seed)));
    expect(grades.every((g) => g.fullWorkflowPass)).toBe(true);
    expect(grades.every((g) => g.critical.length === 0)).toBe(true);
    const summary = summarizeFw1(grades);
    expect(summary.criterionPassPct).toBe(100);
    expect(summary.strictFullWorkflowPassPct).toBe(100);
    expect(summary.classification).toBe("GO-CANDIDATE");
  });

  it("flags fabricated exhibit and missing-evidence-as-existing as critical", () => {
    const seed = FW1_MATTERS[0]!;
    const snapshot = goldenSnapshot(seed);
    snapshot.asks.missing = `Exhibit ${seed.missingExhibit} is attached and the deductible is $5000.`;
    const grade = gradeFw1Matter(snapshot);
    expect(grade.critical).toEqual(expect.arrayContaining(["fabricated_exhibit", "missing_evidence_as_existing"]));
    expect(grade.fullWorkflowPass).toBe(false);
  });

  it("flags cross-org leakage as critical", () => {
    const seed = FW1_MATTERS[0]!;
    const snapshot = goldenSnapshot(seed);
    snapshot.orgLeakHaystack = `secret ${FW1_ISOLATION_TOKEN}`;
    const grade = gradeFw1Matter(snapshot);
    expect(grade.critical).toContain("cross_org_leakage");
  });

  it("flags silent incomplete workflow as critical", () => {
    const seed = FW1_MATTERS[0]!;
    const snapshot = goldenSnapshot(seed);
    snapshot.steps = snapshot.steps.filter((s) => s.step !== "revise_with_new_evidence");
    snapshot.incompletePresentedAsComplete = true;
    const grade = gradeFw1Matter(snapshot);
    expect(grade.critical).toContain("silent_incomplete_workflow");
  });

  it("does not treat a correct home-state answer that mentions the trap office as controlling", () => {
    const seed = FW1_MATTERS[1]!;
    const snapshot = goldenSnapshot(seed);
    snapshot.asks.jurisdiction = `${seed.state} law is the controlling law. ${seed.trapState} is mentioned only as an office location and does not control.`;
    snapshot.contradictionText = "Candidate finding: meeting dates conflict across deposition and hallway statement.";
    expect(gradeFw1Matter(snapshot).critical).not.toContain("wrong_jurisdiction_controlling");
    expect(gradeFw1Matter(snapshot).criterionResults.find((c) => c.criterion === "contradiction_handling")?.pass).toBe(
      true,
    );
  });

  it("does not tag future-effective mention of amended days as stale_amendment", () => {
    const seed = FW1_MATTERS[2]!;
    const snapshot = goldenSnapshot(seed);
    snapshot.asks.currentNotice = `As of 2026-09-10, the currently operative written notice period is ${seed.noticeDays} days. Amendment No. 1 changes the period to ${seed.amendedNoticeDays} days but is not effective until 2026-10-15.`;
    const grade = gradeFw1Matter(snapshot);
    expect(grade.families).not.toContain("stale_amendment");
    expect(grade.criterionResults.find((c) => c.criterion === "current_controlling")?.pass).toBe(true);
  });

  it("still tags a current answer that treats the future amendment as operative", () => {
    const seed = FW1_MATTERS[2]!;
    const snapshot = goldenSnapshot(seed);
    snapshot.asks.currentNotice = `As of 2026-09-10 the currently operative notice period is ${seed.amendedNoticeDays} days.`;
    const grade = gradeFw1Matter(snapshot);
    expect(grade.families).toContain("stale_amendment");
  });

  it("still flags an answer that presents trap law as controlling", () => {
    const seed = FW1_MATTERS[1]!;
    const snapshot = goldenSnapshot(seed);
    snapshot.asks.jurisdiction = `New York law is the controlling law of this matter.`;
    expect(gradeFw1Matter(snapshot).critical).toContain("wrong_jurisdiction_controlling");
  });
});

describe("fw1 cost controls", () => {
  it("estimates xAI requests, tokens, retries, cost, and duration for a reused 12-matter R2", () => {
    const estimate = estimateFw1({
      mode: "full",
      matterCount: 12,
      docs: 316,
      reuseIngest: true,
      reuseExtract: true,
      reuseContradiction: true,
    });
    expect(estimate.xaiRequests).toBe(132);
    expect(estimate.retryAllowance).toBe(20);
    expect(estimate.xaiRequestsWithRetry).toBe(152);
    expect(estimate.requestCeiling).toBe(200);
    expect(estimate.xaiRequestsWithRetry).toBeLessThanOrEqual(estimate.requestCeiling);
    expect(estimate.extractRequests).toBe(0);
    expect(estimate.embeddingDocs).toBe(0);
    expect(estimate.expectedInputTokens).toBeGreaterThan(0);
    expect(estimate.expectedOutputTokens).toBeGreaterThan(0);
    expect(estimate.approximateCostUsd).toBeGreaterThan(0);
    expect(estimate.expectedDurationMin).toBeGreaterThan(0);
  });

  it("requires an explicit budget preflight PASS for full R2", () => {
    expect(budgetPreflightPass({})).toBe(false);
    expect(budgetPreflightPass({ FW1_BUDGET_PREFLIGHT: "PASS" })).toBe(true);
  });

  it("stops at the hard request ceiling", () => {
    const counter = new XaiRequestCounter(2);
    counter.consume(2);
    expect(() => counter.consume(1)).toThrow(RequestCapAbort);
  });
});

describe("mapPool", () => {
  it("preserves order under bounded concurrency", async () => {
    const started: number[] = [];
    const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      started.push(n);
      await new Promise((resolve) => setTimeout(resolve, 5 * (6 - n)));
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(started[0]).toBe(1);
    expect(started[1]).toBe(2);
  });
});
