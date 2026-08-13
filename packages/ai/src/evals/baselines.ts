/**
 * Committed mock baselines for graded Case Q&A dimensions.
 *
 * Live evals must not regress dimensions that the mock suite already proves.
 * When a baseline dimension is `true`, a live failure on that dimension fails the suite.
 */
import { GRADED_CASES } from "./graded-cases";
import type { GradeDimension } from "./grade";

export type BaselineDimension =
  | "evidence_state"
  | "faithfulness"
  | "completeness"
  | "need_more_docs";

export type CaseBaseline = {
  /** Dimensions that must pass on live if the mock baseline requires them. */
  required: Partial<Record<BaselineDimension, true>>;
};

export type EvalBaselineManifest = {
  version: 1;
  description: string;
  /** Model the live suite pins by default — informational for reviewers. */
  pinnedModelDefault: string;
  cases: Record<string, CaseBaseline>;
};

/** Build the expected baseline from graded case rubrics (deterministic). */
export function buildMockBaselinesFromGradedCases(
  pinnedModelDefault = "gpt-4o-mini",
): EvalBaselineManifest {
  const cases: Record<string, CaseBaseline> = {};
  for (const testCase of GRADED_CASES) {
    const required: CaseBaseline["required"] = {
      evidence_state: true,
      faithfulness: true,
      completeness: true,
    };
    if (typeof testCase.rubric.expectNeedsMoreDocuments === "boolean") {
      required.need_more_docs = true;
    }
    cases[testCase.id] = { required };
  }
  return {
    version: 1,
    description:
      "Mock-proven graded Case Q&A dimensions. Live runs fail if any required dimension regresses.",
    pinnedModelDefault,
    cases,
  };
}

export const MOCK_GRADED_BASELINES: EvalBaselineManifest = buildMockBaselinesFromGradedCases();

export type BaselineRegression = {
  caseId: string;
  dimension: BaselineDimension;
  detail: string;
};

/** Compare live grade dimensions to the committed mock baseline. */
export function findBaselineRegressions(params: {
  caseId: string;
  dimensions: GradeDimension[];
  baseline?: EvalBaselineManifest;
}): BaselineRegression[] {
  const manifest = params.baseline ?? MOCK_GRADED_BASELINES;
  const required = manifest.cases[params.caseId]?.required ?? {};
  const byName = new Map(params.dimensions.map((d) => [d.name, d]));
  const regressions: BaselineRegression[] = [];

  for (const dimension of Object.keys(required) as BaselineDimension[]) {
    if (!required[dimension]) continue;
    const result = byName.get(dimension);
    if (!result) {
      regressions.push({
        caseId: params.caseId,
        dimension,
        detail: `Missing dimension "${dimension}" in live grade result`,
      });
      continue;
    }
    if (!result.passed) {
      regressions.push({
        caseId: params.caseId,
        dimension,
        detail: result.detail,
      });
    }
  }
  return regressions;
}
