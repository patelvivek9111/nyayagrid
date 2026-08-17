/**
 * Graded rubrics for golden-matter Case Q&A.
 *
 * Scores are deterministic against the model (or mock) CitedAnswer + retrieved passages.
 * See docs/AGENT_QUALITY.md. Rates (citation accuracy, hallucination, false-insufficient,
 * false-confidence) are aggregated by `evals/metrics.ts` — not just per-case pass/fail.
 */
import {
  citedAnswerSchema,
  citedAnswerTextFromRaw,
  validateCitedAnswerAgainstPassages,
  validateQuoteAgainstText,
  applyQa06VerifiedIntelCap,
  type CitedAnswer,
  type GroundingPassage,
} from "../index";
import { assessNeedMoreDocuments } from "../need-more-docs";
import type { CaseQualityFlags, WorkflowId } from "./metrics";

export type TrapKind = "decoy" | "one_sided" | "should_refuse" | "false_positive";

export type GradedRubric = {
  /** Substrings that should appear in a complete answer (case-insensitive). */
  mustIncludePhrases?: string[];
  /** Chunk IDs that must be cited for completeness. */
  mustCiteChunkIds?: string[];
  /**
   * Chunk IDs that are real in the retrieved set but must not be cited as
   * support for this answer (plausible decoys / wrong clause).
   */
  forbiddenChunkIds?: string[];
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
  workflow?: WorkflowId;
  question: string;
  /** Simulated retrieval set (not the full corpus). */
  retrieved: GroundingPassage[];
  verifiedIntelligence?: string | null;
  verifiedGraph?: string | null;
  verifiedMemory?: string | null;
  /** Correct behavior is to refuse / insufficient rather than answer. */
  shouldRefuse?: boolean;
  trapKind?: TrapKind;
  adversarial?: boolean;
  rubric: GradedRubric;
};

export type GradeDimensionName =
  | "evidence_state"
  | "faithfulness"
  | "completeness"
  | "need_more_docs"
  | "citation_relevance";

export type GradeDimension = {
  name: GradeDimensionName;
  passed: boolean;
  detail: string;
};

export type GradeResult = {
  caseId: string;
  passed: boolean;
  dimensions: GradeDimension[];
  answer?: CitedAnswer;
  flags: CaseQualityFlags;
};

function includesPhrase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function rawAnswerText(raw: unknown): string {
  return citedAnswerTextFromRaw(raw);
}

function attemptedCiteCount(raw: unknown): number {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const sources = (raw as { sources?: unknown }).sources;
  return Array.isArray(sources) ? sources.length : 0;
}

const MONTH_DATE_RE =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/gi;

/** Calendar dates asserted in `answer` that do not appear in retrieved or verified text. */
export function unsupportedDatesInAnswer(
  answer: string,
  retrieved: GroundingPassage[],
  verified?: {
    intelligence?: string | null;
    graph?: string | null;
    memory?: string | null;
    question?: string | null;
  },
): string[] {
  const corpus = [
    ...retrieved.map((p) => p.quote),
    verified?.intelligence,
    verified?.graph,
    verified?.memory,
  ]
    .filter((text): text is string => Boolean(text && text.trim()))
    .join("\n")
    .toLowerCase();
  const question = verified?.question?.toLowerCase() ?? "";
  const found = answer.match(MONTH_DATE_RE) ?? [];
  const unique = [...new Set(found.map((d) => d.trim()))];
  return unique.filter((date) => {
    const needle = date.toLowerCase();
    if (corpus.includes(needle)) return false;
    // Echoing a date from the question (to reject a near-miss) is not an invented date.
    if (question.includes(needle)) return false;
    return true;
  });
}

export { assessNeedMoreDocuments } from "../need-more-docs";

export function gradeCitedAnswer(params: {
  caseId: string;
  raw: unknown;
  retrieved: GroundingPassage[];
  rubric: GradedRubric;
  question?: string;
  workflow?: WorkflowId;
  verifiedIntelligence?: string | null;
  verifiedGraph?: string | null;
  verifiedMemory?: string | null;
  shouldRefuse?: boolean;
  trapKind?: TrapKind;
}): GradeResult {
  const workflow: WorkflowId = params.workflow ?? "case_qa";
  const dimensions: GradeDimension[] = [];
  let answer: CitedAnswer | undefined;
  let rejectedCitations = 0;

  const emptyFlags = (overrides: Partial<CaseQualityFlags> = {}): CaseQualityFlags => ({
    workflow,
    caseId: params.caseId,
    passed: false,
    attemptedCites: attemptedCiteCount(params.raw),
    validCites: 0,
    fabricatedCites: attemptedCiteCount(params.raw),
    falseInsufficient: false,
    falseConfidence: false,
    ...overrides,
  });

  try {
    const validated = validateCitedAnswerAgainstPassages(params.raw, params.retrieved);
    rejectedCitations = validated.rejectedCitations;
    answer = applyQa06VerifiedIntelCap({
      answer: validated.answer,
      rawAnswer: rawAnswerText(params.raw),
      retrievedCount: params.retrieved.length,
      verifiedIntelligence: params.verifiedIntelligence,
      verifiedGraph: params.verifiedGraph,
      verifiedMemory: params.verifiedMemory,
    });
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
      flags: emptyFlags(),
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
  const hasRequiredFact = (params.rubric.mustIncludePhrases ?? []).some((phrase) =>
    includesPhrase(answer.answer, phrase),
  );
  for (const phrase of params.rubric.forbiddenPhrases ?? []) {
    if (!includesPhrase(answer.answer, phrase)) continue;
    const echoedFromQuestion =
      Boolean(params.question) && includesPhrase(params.question ?? "", phrase) && hasRequiredFact;
    if (echoedFromQuestion) continue;
    faithfulnessIssues.push(`forbidden phrase present: "${phrase}"`);
  }
  const inventedDates = unsupportedDatesInAnswer(answer.answer, params.retrieved, {
    intelligence: params.verifiedIntelligence,
    graph: params.verifiedGraph,
    memory: params.verifiedMemory,
    question: params.question,
  });
  for (const date of inventedDates) {
    faithfulnessIssues.push(`invented date not in retrieved or verified text: "${date}"`);
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
  if (
    params.rubric.expectEvidenceState === "grounded" ||
    params.rubric.expectEvidenceState === "partial"
  ) {
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

  const forbidden = params.rubric.forbiddenChunkIds ?? [];
  const citedChunkIds = answer.sources
    .map((s) => s.chunkId)
    .filter((id): id is string => Boolean(id));
  const mismatchedCites = citedChunkIds.filter((id) => forbidden.includes(id));
  if (forbidden.length > 0) {
    dimensions.push({
      name: "citation_relevance",
      passed: mismatchedCites.length === 0,
      detail:
        mismatchedCites.length === 0
          ? "no forbidden/decoy chunks cited"
          : `cited decoy chunk(s) that do not support the claim: ${mismatchedCites.join(", ")}`,
    });
  }

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

  const passed = dimensions.every((d) => d.passed);
  const expectedRefuse =
    Boolean(params.shouldRefuse) ||
    params.rubric.expectEvidenceState === "insufficient" ||
    params.trapKind === "decoy" ||
    params.trapKind === "one_sided" ||
    params.trapKind === "should_refuse" ||
    params.trapKind === "false_positive";
  const answeredConfidently =
    answer.evidenceState === "grounded" ||
    (answer.evidenceState === "partial" && params.rubric.expectEvidenceState === "insufficient");

  const flags: CaseQualityFlags = {
    workflow,
    caseId: params.caseId,
    passed,
    attemptedCites: Math.max(attemptedCiteCount(params.raw), rejectedCitations + answer.sources.length),
    validCites: answer.sources.length,
    fabricatedCites: rejectedCitations,
    falseInsufficient:
      (params.rubric.expectEvidenceState === "grounded" ||
        params.rubric.expectEvidenceState === "partial") &&
      answer.evidenceState === "insufficient",
    falseConfidence: expectedRefuse && answeredConfidently,
    citationRelevanceChecked: forbidden.length > 0,
    citationRelevanceFailures: mismatchedCites.length,
  };

  return {
    caseId: params.caseId,
    passed,
    dimensions,
    answer,
    flags,
  };
}
