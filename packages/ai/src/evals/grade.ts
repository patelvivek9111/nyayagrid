/**
 * Graded rubrics for golden-matter Case Q&A.
 *
 * Scores are deterministic against the model (or mock) CitedAnswer + retrieved passages.
 * See docs/AGENT_QUALITY.md Phase B.
 */
import {
  citedAnswerSchema,
  validateCitedAnswerAgainstPassages,
  validateQuoteAgainstText,
  type CitedAnswer,
  type GroundingPassage,
} from "../index";
import { assessNeedMoreDocuments } from "../need-more-docs";

export type GradedRubric = {
  /** Substrings that should appear in a complete answer (case-insensitive). */
  mustIncludePhrases?: string[];
  /** Chunk IDs that must be cited for completeness. */
  mustCiteChunkIds?: string[];
  /** Substrings that must NOT appear (hallucinated facts / invented authority). */
  forbiddenPhrases?: string[];
  /** If true, every retained cite must be verbatim in its passage. */
  requireVerbatimQuotes?: boolean;
  expectEvidenceState: "grounded" | "insufficient" | "partial";
  expectNeedsMoreDocuments?: boolean;
};

export type GradedCase = {
  id: string;
  description: string;
  question: string;
  /** Simulated retrieval set (not the full corpus). */
  retrieved: GroundingPassage[];
  rubric: GradedRubric;
};

export type GradeDimension = {
  name: "evidence_state" | "faithfulness" | "completeness" | "need_more_docs";
  passed: boolean;
  detail: string;
};

export type GradeResult = {
  caseId: string;
  passed: boolean;
  dimensions: GradeDimension[];
  answer?: CitedAnswer;
};

function includesPhrase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export { assessNeedMoreDocuments } from "../need-more-docs";

export function gradeCitedAnswer(params: {
  caseId: string;
  raw: unknown;
  retrieved: GroundingPassage[];
  rubric: GradedRubric;
  question?: string;
}): GradeResult {
  const dimensions: GradeDimension[] = [];
  let answer: CitedAnswer | undefined;

  try {
    const validated = validateCitedAnswerAgainstPassages(params.raw, params.retrieved);
    answer = validated.answer;
  } catch (error) {
    return {
      caseId: params.caseId,
      passed: false,
      dimensions: [
        {
          name: "faithfulness",
          passed: false,
          detail: `Parse/validate failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  dimensions.push({
    name: "evidence_state",
    passed: answer.evidenceState === params.rubric.expectEvidenceState,
    detail: `expected=${params.rubric.expectEvidenceState}, got=${answer.evidenceState}`,
  });

  const faithfulnessIssues: string[] = [];
  if (params.rubric.requireVerbatimQuotes !== false) {
    for (const source of answer.sources) {
      const passage =
        params.retrieved.find((p) => p.chunkId === source.chunkId) ??
        params.retrieved.find(
          (p) =>
            p.documentId === source.documentId &&
            p.documentVersionId === source.documentVersionId,
        );
      if (!passage) {
        faithfulnessIssues.push(
          `cite missing from retrieval: ${source.chunkId ?? source.documentId}`,
        );
        continue;
      }
      const check = validateQuoteAgainstText(source.quote, passage.quote);
      if (!check.valid) {
        faithfulnessIssues.push(check.reason ?? "non-verbatim quote");
      }
    }
  }
  for (const phrase of params.rubric.forbiddenPhrases ?? []) {
    if (includesPhrase(answer.answer, phrase)) {
      faithfulnessIssues.push(`forbidden phrase present: "${phrase}"`);
    }
  }
  dimensions.push({
    name: "faithfulness",
    passed: faithfulnessIssues.length === 0,
    detail:
      faithfulnessIssues.length === 0
        ? "no invented claims; quotes verified"
        : faithfulnessIssues.join("; "),
  });

  const completenessIssues: string[] = [];
  if (params.rubric.expectEvidenceState === "grounded") {
    for (const phrase of params.rubric.mustIncludePhrases ?? []) {
      if (!includesPhrase(answer.answer, phrase)) {
        completenessIssues.push(`missing phrase: "${phrase}"`);
      }
    }
    const cited = new Set(answer.sources.map((s) => s.chunkId).filter(Boolean));
    for (const chunkId of params.rubric.mustCiteChunkIds ?? []) {
      if (!cited.has(chunkId)) {
        completenessIssues.push(`missing citation: ${chunkId}`);
      }
    }
  }
  dimensions.push({
    name: "completeness",
    passed: completenessIssues.length === 0,
    detail:
      completenessIssues.length === 0
        ? "required facts/cites present"
        : completenessIssues.join("; "),
  });

  const need = assessNeedMoreDocuments({
    evidenceState: answer.evidenceState,
    retrievedCount: params.retrieved.length,
    unresolvedQuestions: answer.unresolvedQuestions,
    question: params.question,
  });
  if (typeof params.rubric.expectNeedsMoreDocuments === "boolean") {
    dimensions.push({
      name: "need_more_docs",
      passed: need.needsMoreDocuments === params.rubric.expectNeedsMoreDocuments,
      detail: `expectedNeedsMore=${params.rubric.expectNeedsMoreDocuments}, got=${need.needsMoreDocuments}`,
    });
  }

  try {
    citedAnswerSchema.parse(answer);
  } catch {
    dimensions.push({
      name: "faithfulness",
      passed: false,
      detail: "validated answer failed citedAnswerSchema",
    });
  }

  return {
    caseId: params.caseId,
    passed: dimensions.every((d) => d.passed),
    dimensions,
    answer,
  };
}
