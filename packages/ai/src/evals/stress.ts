/**
 * Adversarial stress subset + harness check.
 *
 * Stress PASSES when scoring catches a bait-taking model (non-zero
 * citation-relevance fail, decoy FPR, and false-confidence). A clean stress
 * run is a grader/fixture bug, not good news.
 */
import type { GradedCase } from "./grade";
import type { ContradictionCase } from "./graded-cases-contradiction";
import { GRADED_CASES } from "./graded-cases";
import { CONTRADICTION_CASES } from "./graded-cases-contradiction";
import { CONTRACT_COMPARE_CASES, type ContractCompareCase } from "./graded-cases-contract-compare";
import type { WorkflowRateReport } from "./metrics";

export function adversarialQaCases(cases: GradedCase[] = GRADED_CASES): GradedCase[] {
  return cases.filter(
    (c) =>
      Boolean(c.adversarial) ||
      Boolean(c.shouldRefuse) ||
      Boolean(c.trapKind) ||
      (c.rubric.forbiddenChunkIds?.length ?? 0) > 0,
  );
}

export function adversarialContradictionCases(
  cases: ContradictionCase[] = CONTRADICTION_CASES,
): ContradictionCase[] {
  return cases.filter(
    (c) =>
      c.kind === "generate" &&
      (Boolean(c.adversarial) ||
        Boolean(c.expectNoCandidates) ||
        Boolean(c.trapKind) ||
        (c.forbiddenChunkIds?.length ?? 0) > 0),
  );
}

export function decoyContractCompareCases(
  cases: ContractCompareCase[] = CONTRACT_COMPARE_CASES,
): ContractCompareCase[] {
  return cases.filter((c) => c.kind === "diff_decoy");
}

export type StressHarnessResult = {
  ok: boolean;
  citationRelevanceFailureRatePct: number | null;
  decoyFalsePositiveRatePct: number | null;
  falseConfidenceRatePct: number;
  misses: string[];
};

export function evaluateStressHarness(reports: WorkflowRateReport[]): StressHarnessResult {
  const qa = reports.find((r) => r.workflow === "case_qa");
  const cx = reports.find((r) => r.workflow === "contradiction");
  const cc = reports.find((r) => r.workflow === "contract_compare");

  const citationRelevanceFailureRatePct = qa?.citationRelevanceFailureRatePct ?? null;
  const decoyFalsePositiveRatePct = cc?.decoyFalsePositiveRatePct ?? null;
  const falseConfidenceRatePct = Math.max(
    qa?.falseConfidenceRatePct ?? 0,
    cx?.falseConfidenceRatePct ?? 0,
    cc?.falseConfidenceRatePct ?? 0,
  );

  const misses: string[] = [];
  if (citationRelevanceFailureRatePct == null || citationRelevanceFailureRatePct <= 0) {
    misses.push(
      "citation-relevance failure rate is 0% — GullibleMock did not get scored for citing a forbidden/decoy chunk",
    );
  }
  if (decoyFalsePositiveRatePct == null || decoyFalsePositiveRatePct <= 0) {
    misses.push(
      "contract-compare decoy FPR is 0% — GullibleMock's material-decoy claims were not scored as false positives",
    );
  }
  if (falseConfidenceRatePct <= 0) {
    misses.push(
      "false-confidence rate is 0% — GullibleMock's one-sided/refuse-path answers were not scored as false confidence",
    );
  }

  return {
    ok: misses.length === 0,
    citationRelevanceFailureRatePct,
    decoyFalsePositiveRatePct,
    falseConfidenceRatePct,
    misses,
  };
}
