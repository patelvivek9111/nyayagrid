import { describe, expect, it } from "vitest";
import { formatRepeatVarianceReport, summarizeRepeatVariance } from "./variance";
import type { CaseQualityFlags } from "./metrics";

function flags(overrides: Partial<CaseQualityFlags> = {}): CaseQualityFlags {
  return {
    workflow: "case_qa",
    caseId: "x",
    passed: true,
    attemptedCites: 2,
    validCites: 2,
    fabricatedCites: 0,
    falseInsufficient: false,
    falseConfidence: false,
    ...overrides,
  };
}

describe("repeat variance", () => {
  it("reports a range when repeats disagree", () => {
    const repeatA = [flags({ caseId: "a" }), flags({ caseId: "b" })];
    const repeatB = [
      flags({ caseId: "a", passed: false, falseInsufficient: true, validCites: 0, fabricatedCites: 2 }),
      flags({ caseId: "b" }),
    ];
    const reports = summarizeRepeatVariance([repeatA, repeatB]);
    const qa = reports.find((r) => r.workflow === "case_qa");
    expect(qa?.repeats).toBe(2);
    expect(qa?.falseInsufficient.min).toBe(0);
    expect(qa?.falseInsufficient.max).toBeGreaterThan(0);
    expect(qa?.rangeStraddlesBar).toBe(true);
  });

  it("always prints min/max even when repeats agree", () => {
    const repeat = [flags({ caseId: "a" }), flags({ caseId: "b" })];
    const reports = summarizeRepeatVariance([repeat, repeat, repeat]);
    const qa = reports.find((r) => r.workflow === "case_qa");
    expect(qa?.falseInsufficient.min).toBe(0);
    expect(qa?.falseInsufficient.max).toBe(0);
    const printed = formatRepeatVarianceReport(qa!);
    expect(printed).toMatch(/min 0\.0–max 0\.0%/);
  });
});
