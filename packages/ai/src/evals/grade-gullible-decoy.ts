/**
 * Grade a model's contract-compare *claim* that a decoy edit is material.
 *
 * Deterministic diffs never take the bait (they score decoys as non-material).
 * This grades the model-facing claim so decoy FPR is defined when a provider
 * actually treats a decoy as a high-attention amendment.
 */
import type { ContractCompareCase } from "./graded-cases-contract-compare";
import type { CaseQualityFlags } from "./metrics";

export function gradeGullibleDecoyClaim(
  testCase: ContractCompareCase,
  claimText: string,
): CaseQualityFlags {
  const decoys = testCase.decoyNeedles ?? [];
  const lower = claimText.toLowerCase();
  const mentioned = decoys.filter((needle) => lower.includes(needle.toLowerCase()));
  const treatsAsMaterial =
    mentioned.length > 0 &&
    /material|high[_ -]?attention|substantive|amended the agreement/i.test(claimText);

  return {
    workflow: "contract_compare",
    caseId: testCase.id,
    passed: !treatsAsMaterial,
    attemptedCites: decoys.length,
    validCites: treatsAsMaterial ? 0 : decoys.length,
    fabricatedCites: treatsAsMaterial ? mentioned.length : 0,
    falseInsufficient: false,
    falseConfidence: treatsAsMaterial,
  };
}
