import { describe, expect, it } from "vitest";
import {
  assertsInventedMaterialChange,
  gradeLiveCompareScenario,
  isNoMaterialChangeClaim,
  summaryMentionsNeedle,
  type LiveCompareAlignmentHint,
} from "./grade-live-compare";
import { liveCompareCoverage } from "./live-cc-coverage";
import {
  COMPARE_ISOLATED_DECOY_EXAMPLE_MARKER,
  COMPARE_ISOLATED_DECOY_WORKED_EXAMPLE,
  COMPARE_MIXED_EXAMPLE_MARKER,
  COMPARE_MIXED_WORKED_EXAMPLE,
  COMPARE_SUMMARY_PROMPT_VERSION,
  COMPARE_SUMMARY_SYSTEM_PROMPT,
  LIVE_CONTRACT_COMPARE_SCENARIOS,
} from "./live-contract-compare";
import {
  ISOLATED_DECOY_NO_MATERIAL_SUMMARY,
  LIVE8_ISOLATED_DECOY_FALLBACK,
  MIXED_ASSIGNMENT_EXHIBIT_FIXED_SUMMARY,
  gradeAllLiveCompareWithProbe,
  gradeCompareScenarioWithProbe,
  probeCompareSummary,
} from "./compare-worked-example-mock";
import { aggregateWorkflowRates, isContractCompareDecoyFprId } from "./metrics";

const LIVE6_NO_MATERIAL_SUMMARY =
  "No material changes detected.\n\n[Note: AI summary claims are not fully aligned with the deterministic paragraph diff. Treat the summary as a proposal and verify every claim against the change list.]";

const LIVE6_NO_MATERIAL_ALIGNMENT: LiveCompareAlignmentHint = {
  alignment: "misaligned",
  unsupportedClaims: ["No material changes detected."],
  flags: ["Verify AI summary against the deterministic change list before relying on it."],
  claimCount: 1,
  supportedClaimCount: 0,
};

const LIVE6_RECIEVE3_SUMMARY =
  "The clause regarding notices has been modified to state that notices may receive electronic copies as a courtesy.";

const LIVE6_ASSIGNMENT_EXHIBIT_SUMMARY =
  "The clause regarding assignment has been modified to require the Customer to obtain the Vendor's reasonable consent instead of the Vendor's sole discretion consent. Additionally, the reference to Exhibit 1 has been updated to Exhibit I.";

const LIVE6_MIXED_SUMMARIES: Record<string, string[]> = {
  "cc-live-mixed-term-labelled": [
    "The term of the agreement has been extended from December 31, 2026, to December 31, 2027.",
    "The term of the agreement has been extended from expiring on December 31, 2026, to expiring on December 31, 2027.",
    "The term of the agreement has been extended from expiring on December 31, 2026, to expiring on December 31, 2027.",
  ],
  "cc-live-mixed-fee-agrement": [
    "The monthly fees have increased from four thousand dollars ($4,000) to four thousand five hundred dollars ($4,500).",
    "The monthly fees have increased from four thousand dollars ($4,000) to four thousand five hundred dollars ($4,500).",
    "The monthly fees have increased from four thousand dollars ($4,000) to four thousand five hundred dollars ($4,500).",
  ],
  "cc-live-mixed-notice-section-16": [
    "The notice period for termination has been changed from thirty (30) days to sixty (60) days.",
    "The notice period for termination has been changed from thirty (30) days to sixty (60) days.",
    "The notice period for termination has been changed from thirty (30) days to sixty (60) days.",
  ],
  "cc-live-mixed-indemnity-recieve": [
    "The indemnity clause has been modified to limit Vendor's indemnification to only third-party claims arising from Vendor's negligence, removing the previous unlimited indemnity for all claims. No other material changes were noted.",
    "Vendor shall indemnify Customer only for third-party claims arising from Vendor's negligence, and not for Customer's sole negligence.",
    "The indemnity clause has been modified to limit Vendor's indemnification to only third-party claims arising from Vendor's negligence, removing the previous unlimited indemnity for all claims. No other material changes were detected.",
  ],
  "cc-live-mixed-assignment-exhibit": [
    LIVE6_ASSIGNMENT_EXHIBIT_SUMMARY,
    LIVE6_ASSIGNMENT_EXHIBIT_SUMMARY,
    LIVE6_ASSIGNMENT_EXHIBIT_SUMMARY,
  ],
  "cc-live-mixed-insurance-govlaw": [
    "The insurance requirement for the Customer has been increased from one million dollars ($1,000,000) to two million dollars ($2,000,000).",
    "The insurance requirement for the Customer has been increased from one million dollars ($1,000,000) to two million dollars ($2,000,000).",
    "The insurance requirement for the Customer has been increased from one million dollars ($1,000,000) to two million dollars ($2,000,000).",
  ],
};

describe("live contract-compare scenarios", () => {
  it("has mixed material+decoy pairs and isolated decoys", () => {
    expect(LIVE_CONTRACT_COMPARE_SCENARIOS.length).toBeGreaterThanOrEqual(15);
    const kinds = new Set(LIVE_CONTRACT_COMPARE_SCENARIOS.map((s) => s.kind));
    expect(kinds.has("material")).toBe(true);
    expect(kinds.has("empty")).toBe(true);
    expect(kinds.has("decoy")).toBe(true);
    expect(kinds.has("mixed")).toBe(true);
    expect(LIVE_CONTRACT_COMPARE_SCENARIOS.filter((s) => s.kind === "decoy").length).toBeGreaterThanOrEqual(4);
    expect(LIVE_CONTRACT_COMPARE_SCENARIOS.filter((s) => s.kind === "mixed").length).toBeGreaterThanOrEqual(6);
    expect(LIVE_CONTRACT_COMPARE_SCENARIOS.filter((s) => s.numericPhrasing).length).toBeGreaterThanOrEqual(3);
  });

  it("uses unique ids", () => {
    const ids = LIVE_CONTRACT_COMPARE_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("counts live decoy and mixed ids toward decoy FPR after stripping #repeat", () => {
    const coverage = liveCompareCoverage([]);
    expect(coverage.mixedScenarioCount).toBeGreaterThanOrEqual(6);
    expect(coverage.decoyFprIdCount).toBe(coverage.decoyScenarioCount + coverage.mixedScenarioCount);
    expect(coverage.mixedPairsHaveMaterialAndDecoyNeedles).toBe(true);
    expect(isContractCompareDecoyFprId("cc-live-decoy-labelled#1")).toBe(true);
    expect(isContractCompareDecoyFprId("cc-live-mixed-term-labelled#3")).toBe(true);
    expect(isContractCompareDecoyFprId("cc-live-material-term#1")).toBe(false);
  });
});

describe("live compare decoy-discrimination grader", () => {
  const mixed = LIVE_CONTRACT_COMPARE_SCENARIOS.find((s) => s.id === "cc-live-mixed-notice-section-16")!;
  const decoy = LIVE_CONTRACT_COMPARE_SCENARIOS.find((s) => s.id === "cc-live-decoy-labelled")!;

  it("passes mixed when material is reported and the decoy is not", () => {
    const grade = gradeLiveCompareScenario({
      scenario: mixed,
      summary: "Termination notice changed from thirty (30) days to sixty (60) days.",
    });
    expect(grade.passed).toBe(true);
    expect(grade.flags.decoyDiscriminationChecked).toBe(true);
    expect(grade.flags.decoyDiscriminationFailures).toBe(0);
  });

  it("fails mixed when the decoy is reported alongside the material change", () => {
    const grade = gradeLiveCompareScenario({
      scenario: mixed,
      summary: "Notice is now 60 days. Section 16.0 is reserved.",
    });
    expect(grade.passed).toBe(false);
    expect(grade.flags.falseConfidence).toBe(true);
    expect(grade.flags.decoyDiscriminationFailures).toBeGreaterThan(0);
  });

  it("fails isolated decoy when the spelling change is reported as a change", () => {
    const grade = gradeLiveCompareScenario({
      scenario: decoy,
      summary: "Removed the heading labeled Recitals and added it back.",
    });
    expect(grade.passed).toBe(false);
    expect(grade.flags.decoyDiscriminationChecked).toBe(true);
  });

  it("passes isolated decoy when the summary reports no substantive change", () => {
    const grade = gradeLiveCompareScenario({
      scenario: decoy,
      summary: "No substantive material differences.",
    });
    expect(grade.passed).toBe(true);
  });

  it("fires decoy FPR on a nonzero count of mock live flags (including #repeat ids)", () => {
    const flags = LIVE_CONTRACT_COMPARE_SCENARIOS.filter(
      (s) => s.kind === "decoy" || s.kind === "mixed",
    ).flatMap((scenario) =>
      [1, 2, 3].map(
        (repeat) =>
          gradeLiveCompareScenario({
            scenario,
            caseId: `${scenario.id}#${repeat}`,
            summary:
              scenario.kind === "mixed"
                ? `Material update: ${(scenario.materialNeedles ?? []).join(" ")}.`
                : "No substantive material differences.",
          }).flags,
      ),
    );
    const coverage = liveCompareCoverage(flags);
    expect(coverage.decoyDiscriminationCheckedOnFlags).toBeGreaterThan(0);
    expect(coverage.decoyFprCaseCountFromRates).toBe(flags.length);
    expect(coverage.decoyFprCaseCountFromRates).toBeGreaterThanOrEqual(36);
    const report = aggregateWorkflowRates("contract_compare", flags);
    expect(report.decoyCaseCount).toBe(flags.length);
    expect(report.decoyFalsePositiveRatePct).not.toBeNull();
  });

  it("treats live-6 'No material changes detected' as a non-claim, not a decoy FP", () => {
    expect(isNoMaterialChangeClaim("No material changes detected.")).toBe(true);
    expect(isNoMaterialChangeClaim("No other material changes were noted.")).toBe(true);
    expect(isNoMaterialChangeClaim("No other material changes were detected.")).toBe(true);
    expect(assertsInventedMaterialChange(LIVE6_NO_MATERIAL_SUMMARY)).toBe(false);
    const grade = gradeLiveCompareScenario({
      scenario: decoy,
      summary: LIVE6_NO_MATERIAL_SUMMARY,
      alignment: LIVE6_NO_MATERIAL_ALIGNMENT,
    });
    expect(grade.passed).toBe(true);
    expect(grade.flags.falseConfidence).toBe(false);
  });

  it("still flags invented material claims on isolated decoys (live-6 recieve#3)", () => {
    const recieve = LIVE_CONTRACT_COMPARE_SCENARIOS.find((s) => s.id === "cc-live-decoy-recieve")!;
    expect(assertsInventedMaterialChange(LIVE6_RECIEVE3_SUMMARY)).toBe(true);
    const grade = gradeLiveCompareScenario({
      scenario: recieve,
      caseId: "cc-live-decoy-recieve#3",
      summary: LIVE6_RECIEVE3_SUMMARY,
      alignment: {
        alignment: "aligned",
        unsupportedClaims: [],
        flags: [],
        claimCount: 1,
        supportedClaimCount: 1,
      },
    });
    expect(grade.passed).toBe(false);
    expect(grade.flags.falseConfidence).toBe(true);
    expect(grade.details).toContain("invented material change");
  });

  it("replays live-6 decoy/mixed outputs to a needle-real FPR near 8.3% plus recieve#3", () => {
    const flags = LIVE_CONTRACT_COMPARE_SCENARIOS.filter(
      (s) => s.kind === "decoy" || s.kind === "mixed",
    ).flatMap((scenario) =>
      [1, 2, 3].map((repeat) => {
        const caseId = `${scenario.id}#${repeat}`;
        if (scenario.kind === "decoy") {
          const isRecieve3 = scenario.id === "cc-live-decoy-recieve" && repeat === 3;
          return gradeLiveCompareScenario({
            scenario,
            caseId,
            summary: isRecieve3 ? LIVE6_RECIEVE3_SUMMARY : LIVE6_NO_MATERIAL_SUMMARY,
            alignment: isRecieve3
              ? {
                  alignment: "aligned",
                  unsupportedClaims: [],
                  flags: [],
                  claimCount: 1,
                  supportedClaimCount: 1,
                }
              : LIVE6_NO_MATERIAL_ALIGNMENT,
          }).flags;
        }
        const summaries = LIVE6_MIXED_SUMMARIES[scenario.id] ?? ["Material update."];
        const summary = summaries[repeat - 1] ?? summaries[0]!;
        const indemnityDisclaimer =
          scenario.id === "cc-live-mixed-indemnity-recieve" && (repeat === 1 || repeat === 3);
        return gradeLiveCompareScenario({
          scenario,
          caseId,
          summary,
          alignment: indemnityDisclaimer
            ? {
                alignment: "misaligned",
                unsupportedClaims: [
                  repeat === 1
                    ? "No other material changes were noted."
                    : "No other material changes were detected.",
                ],
                flags: ["Verify AI summary against the deterministic change list before relying on it."],
                claimCount: 2,
                supportedClaimCount: 1,
              }
            : undefined,
        }).flags;
      }),
    );
    expect(flags).toHaveLength(36);
    const report = aggregateWorkflowRates("contract_compare", flags);
    const fp = flags.filter((c) => c.falseConfidence || (c.decoyDiscriminationFailures ?? 0) > 0);
    expect(fp.map((c) => c.caseId).sort()).toEqual([
      "cc-live-decoy-recieve#3",
      "cc-live-mixed-assignment-exhibit#1",
      "cc-live-mixed-assignment-exhibit#2",
      "cc-live-mixed-assignment-exhibit#3",
    ]);
    expect(report.decoyFalsePositiveRatePct).toBeCloseTo((4 / 36) * 100, 5);
    expect(report.decoyFalsePositiveRatePct).toBeLessThan(12);
  });
});

const LIVE7_GOLDEN_PAIR_SUMMARY =
  "The term of the agreement has been extended to expire on December 31, 2027. The monthly fees have increased from $4,000 to $4,500. The shared-cost allocation percentage has increased from 12% to 15%. The indemnity clause has been modified to limit Vendor's indemnification to third-party claims arising from Vendor's negligence. The notice period for termination has been extended from 30 days to 60 days. The warranty of quiet enjoyment has been removed, and the assignment clause now requires Vendor's reasonable consent instead of sole discretion. The required insurance amount has increased from $1,000,000 to $2,000,000.";

describe("number-word / digit needle equivalence", () => {
  const golden = LIVE_CONTRACT_COMPARE_SCENARIOS.find((s) => s.id === "cc-live-golden-pair-summary")!;

  it("matches a number-word needle when the summary only has the digit form, and vice versa", () => {
    expect(summaryMentionsNeedle("allocation increased from 12% to 15%.", "fifteen")).toBe(true);
    expect(summaryMentionsNeedle("notice extended from 30 days to 60 days.", "sixty")).toBe(true);
    expect(summaryMentionsNeedle("notice became sixty (60) days.", "60")).toBe(true);
    expect(summaryMentionsNeedle("allocation is now fifteen percent.", "15")).toBe(true);
  });

  it("does not treat 'as is' as a phrasing variant of quiet-enjoyment removal", () => {
    expect(summaryMentionsNeedle(LIVE7_GOLDEN_PAIR_SUMMARY, "as is")).toBe(false);
  });

  it("grades captured live-7 golden-pair output: fifteen/sixty match, as is still missing", () => {
    expect(summaryMentionsNeedle(LIVE7_GOLDEN_PAIR_SUMMARY, "fifteen")).toBe(true);
    expect(summaryMentionsNeedle(LIVE7_GOLDEN_PAIR_SUMMARY, "sixty")).toBe(true);
    expect(summaryMentionsNeedle(LIVE7_GOLDEN_PAIR_SUMMARY, "as is")).toBe(false);
    const grade = gradeLiveCompareScenario({
      scenario: golden,
      summary: LIVE7_GOLDEN_PAIR_SUMMARY,
    });
    expect(grade.passed).toBe(false);
    expect(grade.details).toContain("as is");
    expect(grade.details).not.toContain("fifteen");
    expect(grade.details).not.toContain("sixty");
  });
});

describe("compare mixed-digest worked example", () => {
  const assignmentExhibit = LIVE_CONTRACT_COMPARE_SCENARIOS.find(
    (s) => s.id === "cc-live-mixed-assignment-exhibit",
  )!;
  const isolatedExhibit = LIVE_CONTRACT_COMPARE_SCENARIOS.find(
    (s) => s.id === "cc-live-decoy-exhibit",
  )!;
  const withoutMixedExample = COMPARE_SUMMARY_SYSTEM_PROMPT.replace(COMPARE_MIXED_WORKED_EXAMPLE, "");

  it("is still present on compare-summary-v4 and not just a restated numbering instruction", () => {
    expect(COMPARE_SUMMARY_PROMPT_VERSION).toBe("compare-summary-v4");
    expect(COMPARE_SUMMARY_SYSTEM_PROMPT).toContain(COMPARE_MIXED_EXAMPLE_MARKER);
    expect(COMPARE_SUMMARY_SYSTEM_PROMPT).toMatch(/reasonable consent/);
    expect(COMPARE_SUMMARY_SYSTEM_PROMPT).toMatch(/Do not mention Exhibit 1 or Exhibit I/);
    expect(withoutMixedExample).not.toContain(COMPARE_MIXED_EXAMPLE_MARKER);
  });

  it("passes cc-live-mixed-assignment-exhibit when the mixed example is in the prompt", () => {
    const summary = probeCompareSummary(assignmentExhibit);
    expect(summaryMentionsNeedle(summary, "reasonable consent")).toBe(true);
    expect(summaryMentionsNeedle(summary, "Exhibit I")).toBe(false);
    expect(summaryMentionsNeedle(summary, "Exhibit 1")).toBe(false);
    expect(summary).toBe(MIXED_ASSIGNMENT_EXHIBIT_FIXED_SUMMARY);
    const grade = gradeCompareScenarioWithProbe(assignmentExhibit);
    expect(grade.passed).toBe(true);
    expect(grade.flags.decoyDiscriminationFailures).toBe(0);
  });

  it("still restates the exhibit decoy when the mixed example is stripped", () => {
    const grade = gradeCompareScenarioWithProbe(assignmentExhibit, withoutMixedExample);
    expect(grade.passed).toBe(false);
    expect(grade.flags.decoyDiscriminationFailures).toBeGreaterThan(0);
  });

  it("does not regress isolated decoys or other mixed pairs when the mixed example is stripped", () => {
    const stripped = gradeAllLiveCompareWithProbe(withoutMixedExample);
    expect(stripped.find((r) => r.caseId === isolatedExhibit.id)?.passed).toBe(true);
    const unexpected = stripped.filter(
      (r) => r.caseId !== "cc-live-mixed-assignment-exhibit" && !r.passed,
    );
    expect(unexpected.map((r) => r.caseId)).toEqual([]);
    expect(stripped.find((r) => r.caseId === "cc-live-mixed-assignment-exhibit")?.passed).toBe(false);
  });
});

describe("compare isolated-decoy worked example", () => {
  const isolatedDecoys = LIVE_CONTRACT_COMPARE_SCENARIOS.filter((s) => s.kind === "decoy");
  const withoutIsolatedExample = COMPARE_SUMMARY_SYSTEM_PROMPT.replace(
    COMPARE_ISOLATED_DECOY_WORKED_EXAMPLE,
    "",
  );

  it("is present on compare-summary-v4 and teaches a non-empty no-material summary", () => {
    expect(COMPARE_SUMMARY_PROMPT_VERSION).toBe("compare-summary-v4");
    expect(COMPARE_SUMMARY_SYSTEM_PROMPT).toContain(COMPARE_ISOLATED_DECOY_EXAMPLE_MARKER);
    expect(COMPARE_ISOLATED_DECOY_WORKED_EXAMPLE).toMatch(/No material changes detected/);
    expect(COMPARE_ISOLATED_DECOY_WORKED_EXAMPLE).toMatch(/Do not return an empty summary/);
    expect(COMPARE_ISOLATED_DECOY_WORKED_EXAMPLE).not.toMatch(/Document versions differ/);
    expect(withoutIsolatedExample).not.toContain(COMPARE_ISOLATED_DECOY_EXAMPLE_MARKER);
    expect(withoutIsolatedExample).toContain(COMPARE_MIXED_EXAMPLE_MARKER);
  });

  it("returns a real no-material summary on all 18 isolated-decoy repeats, not the fallback", () => {
    expect(isolatedDecoys).toHaveLength(6);
    const grades = isolatedDecoys.flatMap((scenario) =>
      [1, 2, 3].map((repeat) => {
        const summary = probeCompareSummary(scenario);
        expect(summary).toBe(ISOLATED_DECOY_NO_MATERIAL_SUMMARY);
        expect(summary).not.toBe(LIVE8_ISOLATED_DECOY_FALLBACK);
        expect(isNoMaterialChangeClaim(summary)).toBe(true);
        return gradeLiveCompareScenario({
          scenario,
          caseId: `${scenario.id}#${repeat}`,
          summary,
        });
      }),
    );
    expect(grades).toHaveLength(18);
    expect(grades.filter((g) => !g.passed).map((g) => g.caseId)).toEqual([]);
  });

  it("emits the live-8 fallback on isolated decoys when the isolated-decoy example is stripped", () => {
    const failing = isolatedDecoys.filter((scenario) => {
      const summary = probeCompareSummary(scenario, withoutIsolatedExample);
      expect(summary).toBe(LIVE8_ISOLATED_DECOY_FALLBACK);
      return !gradeCompareScenarioWithProbe(scenario, withoutIsolatedExample).passed;
    });
    expect(failing).toHaveLength(isolatedDecoys.length);
  });

  it("keeps mixed assignment-exhibit and other previously-passing compare cases passing", () => {
    const withExample = gradeAllLiveCompareWithProbe();
    expect(withExample.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    expect(withExample.find((r) => r.caseId === "cc-live-mixed-assignment-exhibit")?.passed).toBe(
      true,
    );
  });

  it("does not regress mixed pairs when the isolated-decoy example is stripped", () => {
    const stripped = gradeAllLiveCompareWithProbe(withoutIsolatedExample);
    const unexpected = stripped.filter((r) => r.kind !== "decoy" && !r.passed);
    expect(unexpected.map((r) => r.caseId)).toEqual([]);
    expect(stripped.find((r) => r.caseId === "cc-live-mixed-assignment-exhibit")?.passed).toBe(true);
  });
});
