import { describe, expect, it } from "vitest";
import { buildProsecutionBenchFixtures } from "../datasets/prosecution-bench/fixtures";
import {
  buildProsecutionFeatureInventory,
  summarizeInventory,
} from "../datasets/prosecution-bench/inventory";
import { runProsecutionBenchScenarios } from "../datasets/prosecution-bench/scenarios";
import {
  auditCjisTechnicalGaps,
  liveCanaryPlan,
} from "../datasets/prosecution-bench/staging-audit";
import {
  CRITICAL_FAILURE_CODES,
  PROSECUTION_BENCH_ID,
  SYNTHETIC_CASE_IDS,
} from "../datasets/prosecution-bench/taxonomy";
import { runProsecutionBench } from "../runner/prosecution-bench";

describe("NYAYA_PROSECUTION_BENCH", () => {
  it("includes synthetic cases A–J", () => {
    const fixtures = buildProsecutionBenchFixtures();
    expect(Object.keys(fixtures).sort()).toEqual([...SYNTHETIC_CASE_IDS].sort());
    expect(fixtures.CASE_G_LARGE.evidence.length).toBeGreaterThanOrEqual(100);
    expect(fixtures.CASE_I_ADVERSARIAL_ISOLATION.adversarialOrgId).toBeTruthy();
  });

  it("defines critical failure taxonomy", () => {
    expect(CRITICAL_FAILURE_CODES).toContain("CROSS_TENANT_LEAK");
    expect(CRITICAL_FAILURE_CODES).toContain("HIGH_STAKES_GPT_FALLBACK");
    expect(CRITICAL_FAILURE_CODES).toContain("AUTOMATED_FINAL_DISCLOSURE");
    expect(CRITICAL_FAILURE_CODES).toContain("GUILT_PROBABILITY");
  });

  it("passes all deterministic scenarios with zero critical failures", () => {
    const scenarios = runProsecutionBenchScenarios();
    const failed = scenarios.filter((s) => !s.passed);
    const criticalFailed = scenarios.filter((s) => s.critical && !s.passed);
    expect(failed, failed.map((f) => `${f.id}:${f.detail}`).join(" | ")).toEqual([]);
    expect(criticalFailed).toEqual([]);
    expect(scenarios.length).toBeGreaterThanOrEqual(30);
  });

  it("classifies inventory without marking COMPLETE for broken scenarios", () => {
    const scenarios = runProsecutionBenchScenarios();
    const pass = new Map(scenarios.map((s) => [s.id, s.passed] as const));
    const rows = buildProsecutionFeatureInventory(pass);
    const summary = summarizeInventory(rows);
    expect(summary.BROKEN).toBe(0);
    expect(summary.COMPLETE + summary.PARTIAL + summary.UNTESTED).toBe(rows.length);
  });

  it("keeps live canary unauthorized and unpaid", () => {
    const plan = liveCanaryPlan();
    expect(plan.executed).toBe(false);
    expect(plan.authorizationRequired).toBe(true);
    expect(plan.status).toBe("PAID_VALIDATION_AUTHORIZATION_REQUIRED");
    expect(plan.maxCalls).toBeLessThanOrEqual(20);
  });

  it("CJIS audit does not claim certification", () => {
    const gaps = auditCjisTechnicalGaps();
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.some((g) => g.severity === "BLOCKING_FOR_CJIS_CLAIM")).toBe(true);
  });

  it("runner produces PAID_VALIDATION_AUTHORIZATION_REQUIRED when software gates pass", () => {
    const { summary } = runProsecutionBench();
    expect(summary.benchmarkId).toBe(PROSECUTION_BENCH_ID);
    expect(summary.paidCalls).toBe(0);
    expect(summary.courtListener).toBe(0);
    expect(summary.totals.criticalFailures).toBe(0);
    expect(summary.totals.failed).toBe(0);
    expect(summary.classification).toBe("PAID_VALIDATION_AUTHORIZATION_REQUIRED");
    expect(summary.liveCanary.executed).toBe(false);
    expect(summary.cjis.certified).toBe(false);
  });
});
