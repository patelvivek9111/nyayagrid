import { describe, expect, it } from "vitest";
import { aggregateWorkflowRates, QUALITY_BARS } from "./metrics";
import { CONTRADICTION_CASES } from "./graded-cases-contradiction";
import { CONTRACT_COMPARE_CASES } from "./graded-cases-contract-compare";
import { GRADED_CASES } from "./graded-cases";
import { DECOY_NEEDLES } from "./golden-contract-pair";

describe("quality bars", () => {
  it("requires 0% false-confidence and 90%+ citation accuracy", () => {
    expect(QUALITY_BARS.case_qa.falseConfidenceRatePct).toBe(0);
    expect(QUALITY_BARS.case_qa.citationAccuracyPct).toBe(90);
    expect(QUALITY_BARS.case_qa.hallucinationRatePct).toBe(5);
  });

  it("fails the bar on any false-confidence case", () => {
    const report = aggregateWorkflowRates("case_qa", [
      {
        workflow: "case_qa",
        caseId: "a",
        passed: true,
        attemptedCites: 10,
        validCites: 10,
        fabricatedCites: 0,
        falseInsufficient: false,
        falseConfidence: true,
      },
    ]);
    expect(report.meetsBar).toBe(false);
    expect(report.falseConfidenceRatePct).toBe(100);
  });

  it("reports citation-relevance failure rate among checked cases", () => {
    const report = aggregateWorkflowRates("case_qa", [
      {
        workflow: "case_qa",
        caseId: "checked-ok",
        passed: true,
        attemptedCites: 1,
        validCites: 1,
        fabricatedCites: 0,
        falseInsufficient: false,
        falseConfidence: false,
        citationRelevanceChecked: true,
        citationRelevanceFailures: 0,
      },
      {
        workflow: "case_qa",
        caseId: "checked-bad",
        passed: false,
        attemptedCites: 1,
        validCites: 1,
        fabricatedCites: 0,
        falseInsufficient: false,
        falseConfidence: false,
        citationRelevanceChecked: true,
        citationRelevanceFailures: 1,
      },
    ]);
    expect(report.citationRelevanceFailureRatePct).toBe(50);
  });
});

describe("suite sizes", () => {
  it("meets the measurement-track floors", () => {
    expect(GRADED_CASES.length).toBeGreaterThanOrEqual(30);
    expect(CONTRADICTION_CASES.length).toBeGreaterThanOrEqual(15);
    expect(CONTRADICTION_CASES.filter((c) => c.adversarial).length).toBeGreaterThanOrEqual(3);
    expect(
      CONTRADICTION_CASES.filter((c) => c.expectNoCandidates && c.kind === "generate").length,
    ).toBeGreaterThanOrEqual(5);
    expect(CONTRACT_COMPARE_CASES.filter((c) => c.kind === "diff_decoy").length).toBeGreaterThanOrEqual(
      8,
    );
    expect(DECOY_NEEDLES.length).toBeGreaterThanOrEqual(8);
  });
});
