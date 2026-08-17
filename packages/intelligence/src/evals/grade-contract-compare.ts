/**
 * Deterministic contract-compare evals (CC-01, CC-03) using computeParagraphDiffs.
 *
 * Invoked from `npm run eval:ai` via the intelligence workspace script, and also
 * importable from the AI eval runner when the intelligence package is present.
 */
import {
  applyComparisonSummaryAlignmentPolicy,
  computeParagraphDiffs,
  scoreComparisonSummaryAgainstDiffs,
  type DiffChange,
} from "../draft/helpers";
import {
  CLOSEST_MATCH_LIMITATION,
  CONTRACT_COMPARE_CASES,
  contractAnalysisItemSchema,
  wantsContractCompare,
  type ContractCompareCase,
} from "@nyayagrid/ai/evals";
import type { CaseQualityFlags } from "@nyayagrid/ai/evals";

export type ContractCompareGrade = {
  caseId: string;
  passed: boolean;
  details: string;
  flags: CaseQualityFlags;
};

function changeCorpus(changes: DiffChange[]): string {
  return changes
    .map((c) => `${c.changeType}/${c.attention} ${c.oldText ?? ""} ${c.newText ?? ""}`)
    .join("\n")
    .toLowerCase();
}

function flags(
  testCase: ContractCompareCase,
  passed: boolean,
  extras: Partial<CaseQualityFlags> = {},
): CaseQualityFlags {
  return {
    workflow: "contract_compare",
    caseId: testCase.id,
    passed,
    attemptedCites: extras.attemptedCites ?? 0,
    validCites: extras.validCites ?? 0,
    fabricatedCites: extras.fabricatedCites ?? 0,
    falseInsufficient: extras.falseInsufficient ?? false,
    falseConfidence: extras.falseConfidence ?? false,
  };
}

export function gradeContractCompareCase(testCase: ContractCompareCase): ContractCompareGrade {
  try {
    switch (testCase.kind) {
      case "diff_identity": {
        const a = computeParagraphDiffs(testCase.original ?? "", testCase.redline ?? "");
        const b = computeParagraphDiffs(testCase.original ?? "", testCase.redline ?? "");
        const passed = JSON.stringify(a) === JSON.stringify(b);
        return {
          caseId: testCase.id,
          passed,
          details: passed ? `diffs=${a.length} identical` : "repeat diffs diverged",
          flags: flags(testCase, passed, {
            attemptedCites: a.length,
            validCites: passed ? a.length : 0,
          }),
        };
      }
      case "diff_empty": {
        const changes = computeParagraphDiffs(testCase.original ?? "", testCase.redline ?? "");
        const passed = changes.length === 0;
        return {
          caseId: testCase.id,
          passed,
          details: passed ? "zero diffs" : `unexpected ${changes.length} diffs`,
          flags: flags(testCase, passed, {
            falseConfidence: !passed,
          }),
        };
      }
      case "diff_material": {
        const changes = computeParagraphDiffs(testCase.original ?? "", testCase.redline ?? "");
        const corpus = changeCorpus(changes);
        const missing = (testCase.mustDetectNeedles ?? []).filter(
          (needle) => !corpus.includes(needle.toLowerCase()),
        );
        const passed = missing.length === 0;
        const planted = testCase.mustDetectNeedles?.length ?? 0;
        return {
          caseId: testCase.id,
          passed,
          details: passed ? `detected ${planted} needle(s)` : `missing: ${missing.join(", ")}`,
          flags: flags(testCase, passed, {
            attemptedCites: planted,
            validCites: planted - missing.length,
            fabricatedCites: 0,
            falseInsufficient: !passed,
          }),
        };
      }
      case "diff_decoy": {
        const changes = computeParagraphDiffs(testCase.original ?? "", testCase.redline ?? "");
        const high = changes.filter((c) => c.attention === "high_attention");
        const highCorpus = changeCorpus(high);
        const decoys = testCase.decoyNeedles ?? [];
        const treatedAsMaterial = decoys.filter((needle) => highCorpus.includes(needle.toLowerCase()));
        // Unchanged identical paragraphs must not appear in any change.
        const allCorpus = changeCorpus(changes);
        const issues: string[] = [];
        if (treatedAsMaterial.length > 0) {
          issues.push(`decoy flagged high_attention: ${treatedAsMaterial.join(", ")}`);
        }
        if (testCase.id.includes("identical-parties") || testCase.id.includes("notices-unchanged")) {
          for (const needle of decoys) {
            if (allCorpus.includes(needle.toLowerCase()) && changes.some((c) => c.changeType !== "formatting")) {
              const inChange = changes.some((c) =>
                `${c.oldText ?? ""} ${c.newText ?? ""}`.toLowerCase().includes(needle.toLowerCase()),
              );
              if (inChange) issues.push(`unchanged decoy appeared in diffs: ${needle}`);
            }
          }
        }
        const passed = issues.length === 0;
        return {
          caseId: testCase.id,
          passed,
          details: passed ? "decoy not treated as material" : issues.join("; "),
          flags: flags(testCase, passed, {
            attemptedCites: decoys.length,
            validCites: passed ? decoys.length : decoys.length - treatedAsMaterial.length,
            falseConfidence: !passed,
          }),
        };
      }
      case "summary_aligned": {
        const changes = computeParagraphDiffs(testCase.original ?? "", testCase.redline ?? "");
        const score = scoreComparisonSummaryAgainstDiffs(testCase.summary ?? "", changes);
        const passed = score.alignment === "aligned" && score.unsupportedClaims.length === 0;
        return {
          caseId: testCase.id,
          passed,
          details: `alignment=${score.alignment} unsupported=${score.unsupportedClaims.length}`,
          flags: flags(testCase, passed, {
            attemptedCites: score.claimCount,
            validCites: score.supportedClaimCount,
            fabricatedCites: score.unsupportedClaims.length,
            falseConfidence: score.unsupportedClaims.length > 0,
          }),
        };
      }
      case "summary_invents": {
        const changes = computeParagraphDiffs(testCase.original ?? "", testCase.redline ?? "");
        const score = scoreComparisonSummaryAgainstDiffs(testCase.summary ?? "", changes);
        const passed = score.alignment !== "aligned" && score.unsupportedClaims.length > 0;
        return {
          caseId: testCase.id,
          passed,
          details: passed
            ? "invented claims flagged"
            : `expected unsupported claims, alignment=${score.alignment}`,
          flags: flags(testCase, passed, {
            attemptedCites: Math.max(1, score.claimCount),
            validCites: passed ? Math.max(1, score.claimCount) : 0,
            fabricatedCites: passed ? 0 : score.unsupportedClaims.length,
            falseConfidence: score.alignment === "aligned",
          }),
        };
      }
      case "summary_empty_diff_invents": {
        const changes = computeParagraphDiffs(testCase.original ?? "", testCase.redline ?? "");
        const applied = applyComparisonSummaryAlignmentPolicy(testCase.summary ?? "", changes);
        const passed =
          changes.length === 0 && /no substantive differences/i.test(applied.summary);
        return {
          caseId: testCase.id,
          passed,
          details: passed ? "empty-diff invention replaced" : applied.summary.slice(0, 160),
          flags: flags(testCase, passed, {
            falseConfidence: !passed,
          }),
        };
      }
      case "goal_routing": {
        const got = wantsContractCompare(testCase.goal ?? "");
        const passed = got === Boolean(testCase.expectCompareGoal);
        return {
          caseId: testCase.id,
          passed,
          details: `wantsCompare=${got} expected=${Boolean(testCase.expectCompareGoal)}`,
          flags: flags(testCase, passed, { falseConfidence: !passed && got }),
        };
      }
      case "schema_source_required": {
        let rejected = false;
        try {
          contractAnalysisItemSchema.parse({
            category: "risk",
            title: "Indemnity",
            explanation: "Missing sources",
            attention: "high_attention",
            sourceChunkIds: [],
          });
        } catch {
          rejected = true;
        }
        return {
          caseId: testCase.id,
          passed: rejected,
          details: rejected ? "sourceChunkIds.min(1) enforced" : "schema allowed empty sources",
          flags: flags(testCase, rejected, { falseConfidence: !rejected }),
        };
      }
      case "multi_doc_limitation": {
        const passed = CLOSEST_MATCH_LIMITATION.toLowerCase().includes(
          (testCase.expectedLimitationNeedle ?? "closest match only").toLowerCase(),
        );
        return {
          caseId: testCase.id,
          passed,
          details: passed ? CLOSEST_MATCH_LIMITATION : "CC-05 limitation copy missing",
          flags: flags(testCase, passed),
        };
      }
      default:
        return {
          caseId: testCase.id,
          passed: false,
          details: `unknown kind ${(testCase as ContractCompareCase).kind}`,
          flags: flags(testCase, false),
        };
    }
  } catch (error) {
    return {
      caseId: testCase.id,
      passed: false,
      details: error instanceof Error ? error.message : String(error),
      flags: flags(testCase, false),
    };
  }
}

export function gradeAllContractCompareCases(): ContractCompareGrade[] {
  return CONTRACT_COMPARE_CASES.map(gradeContractCompareCase);
}
