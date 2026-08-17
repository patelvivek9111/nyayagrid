/**
 * Negative-control (canary) tests for the Case Q&A grader.
 *
 * These feed `gradeCitedAnswer` hand-crafted *bad* answers. If any canary does
 * not fail on the expected dimension, the harness is not measuring quality —
 * it is only measuring that code did not crash. Always run (not EVAL_LIVE).
 */
import { gradeCitedAnswer, type GradeDimensionName, type GradeResult } from "./grade";
import { passagesByLabels } from "./golden-matter";

export type CanarySpec = {
  id: string;
  description: string;
  expectFailedDimension: GradeDimensionName;
  run: () => GradeResult;
};

function leaseTermPassage() {
  const retrieved = passagesByLabels("lease_term");
  const passage = retrieved[0];
  if (!passage) {
    throw new Error("golden lease_term passage missing");
  }
  return { retrieved, passage };
}

function indemnityAndTermPassages() {
  const retrieved = [...passagesByLabels("indemnity", "amendment"), ...passagesByLabels("lease_term")];
  const term = retrieved.find((p) => p.chunkId === "chunk_lease_term");
  if (!term) {
    throw new Error("golden lease_term passage missing from combined retrieval");
  }
  return { retrieved, term };
}

/**
 * Invented date that does not appear in any retrieved passage, cited against a
 * real chunk with a verbatim (but irrelevant-to-the-invention) quote.
 */
const inventedDateCanary: CanarySpec = {
  id: "canary-invented-date",
  description: "Invented date not in any retrieved passage must fail faithfulness",
  expectFailedDimension: "faithfulness",
  run: () => {
    const { retrieved, passage } = leaseTermPassage();
    return gradeCitedAnswer({
      caseId: "canary-invented-date",
      retrieved,
      question: "When does the lease term commence?",
      rubric: {
        expectEvidenceState: "grounded",
        mustIncludePhrases: ["July 4, 2020"],
        mustCiteChunkIds: ["chunk_lease_term"],
        expectNeedsMoreDocuments: false,
      },
      raw: {
        answer: "The lease term commences on July 4, 2020.",
        sources: [
          {
            chunkId: passage.chunkId,
            documentId: passage.documentId,
            documentVersionId: passage.documentVersionId,
            quote: passage.quote,
          },
        ],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "grounded",
      },
    });
  },
};

/**
 * Real, valid chunk ID cited next to a claim the chunk does not support
 * (term clause offered as support for indemnity).
 */
const mismatchedCitationCanary: CanarySpec = {
  id: "canary-mismatched-citation",
  description: "Real chunk that does not support the claim must fail citation_relevance",
  expectFailedDimension: "citation_relevance",
  run: () => {
    const { retrieved, term } = indemnityAndTermPassages();
    return gradeCitedAnswer({
      caseId: "canary-mismatched-citation",
      retrieved,
      question: "How does the amendment change the indemnity obligation?",
      rubric: {
        expectEvidenceState: "grounded",
        mustIncludePhrases: ["negligence"],
        mustCiteChunkIds: ["chunk_amend_indemnity"],
        forbiddenChunkIds: ["chunk_lease_term"],
        expectNeedsMoreDocuments: false,
      },
      raw: {
        answer:
          "The amendment limits indemnity to Tenant's negligence, as shown in the lease term clause.",
        sources: [
          {
            chunkId: term.chunkId,
            documentId: term.documentId,
            documentVersionId: term.documentVersionId,
            quote: term.quote,
          },
        ],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "grounded",
      },
    });
  },
};

/**
 * Confident grounded answer when the rubric requires insufficient (false confidence).
 */
const falseConfidenceCanary: CanarySpec = {
  id: "canary-false-confidence",
  description: "Grounded answer when the rubric expects insufficient must fail evidence_state",
  expectFailedDimension: "evidence_state",
  run: () => {
    const { retrieved, passage } = leaseTermPassage();
    return gradeCitedAnswer({
      caseId: "canary-false-confidence",
      retrieved,
      question: "What is the capital of France?",
      shouldRefuse: true,
      trapKind: "should_refuse",
      rubric: {
        expectEvidenceState: "insufficient",
        forbiddenPhrases: ["Paris"],
        expectNeedsMoreDocuments: true,
      },
      raw: {
        answer: `The lease term commences on January 1, 2024, which is a complete answer to this question.`,
        sources: [
          {
            chunkId: passage.chunkId,
            documentId: passage.documentId,
            documentVersionId: passage.documentVersionId,
            quote: passage.quote,
          },
        ],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "grounded",
      },
    });
  },
};

export const CANARY_CASES: CanarySpec[] = [
  inventedDateCanary,
  mismatchedCitationCanary,
  falseConfidenceCanary,
];

export type CanaryOutcome = {
  id: string;
  description: string;
  expectFailedDimension: GradeDimensionName;
  /** True when the grader failed the bad answer on the expected dimension. */
  harnessOk: boolean;
  gradePassed: boolean;
  dimensionPassed: boolean | null;
  details: string;
};

export function evaluateCanary(spec: CanarySpec): CanaryOutcome {
  const grade = spec.run();
  const dimension = grade.dimensions.find((d) => d.name === spec.expectFailedDimension);
  const dimensionPassed = dimension?.passed ?? null;
  const harnessOk = grade.passed === false && dimension?.passed === false;
  return {
    id: spec.id,
    description: spec.description,
    expectFailedDimension: spec.expectFailedDimension,
    harnessOk,
    gradePassed: grade.passed,
    dimensionPassed,
    details: dimension
      ? `${spec.expectFailedDimension}:${dimension.passed ? "ok" : dimension.detail}`
      : `missing dimension ${spec.expectFailedDimension} (got ${grade.dimensions.map((d) => d.name).join(",")})`,
  };
}

export function runCanarySuite(): CanaryOutcome[] {
  return CANARY_CASES.map(evaluateCanary);
}

export function formatCanaryFailure(outcome: CanaryOutcome): string {
  if (outcome.harnessOk) return "";
  if (outcome.gradePassed) {
    return (
      `CANARY HARNESS FAILURE: ${outcome.id} was expected to FAIL (${outcome.expectFailedDimension}) ` +
      `but gradeCitedAnswer returned passed=true. The grader is not measuring what it claims.`
    );
  }
  if (outcome.dimensionPassed === null) {
    return (
      `CANARY HARNESS FAILURE: ${outcome.id} failed overall but did not emit dimension ` +
      `${outcome.expectFailedDimension}. ${outcome.details}`
    );
  }
  return (
    `CANARY HARNESS FAILURE: ${outcome.id} failed, but ${outcome.expectFailedDimension} was not flagged. ` +
    `${outcome.details}`
  );
}
