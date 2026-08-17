/**
 * QA-06: verified Graph / Memory / structured intel may support an answer, but never as
 * `grounded` without verbatim document quotes. Shared by the ask path and graded evals.
 */

export type Qa06CitedAnswer = {
  answer: string;
  sources: unknown[];
  assumptions: string[];
  unresolvedQuestions: string[];
  evidenceState: "grounded" | "insufficient" | "partial";
};

const VERIFIED_CONTEXT_ANSWER_RE =
  /(verified matter intelligence|verified graph|approved matter memory|verified timeline|verified deadline|professional analysis|reviewed analytical|contract analysis|discovery review)/i;

const STOCK_INSUFFICIENT_RE = /do not provide sufficient evidence/i;

export const QA06_PARTIAL_ASSUMPTION =
  "Answer relies on verified structured matter context without verbatim document quotes; treat as partial pending document citation.";

function verifiedContextExcerpt(params: {
  verifiedIntelligence?: string | null;
  verifiedGraph?: string | null;
  verifiedMemory?: string | null;
  professionalAnalysis?: string | null;
}): string {
  return [
    params.verifiedIntelligence,
    params.verifiedGraph,
    params.verifiedMemory,
    params.professionalAnalysis,
  ]
    .filter((text): text is string => Boolean(text?.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

export function applyQa06VerifiedIntelCap<T extends Qa06CitedAnswer>(params: {
  answer: T;
  rawAnswer: string;
  retrievedCount?: number;
  verifiedIntelligence?: string | null;
  verifiedGraph?: string | null;
  verifiedMemory?: string | null;
  professionalAnalysis?: string | null;
}): T {
  const hasVerifiedContext = Boolean(
    params.verifiedIntelligence?.trim() ||
      params.verifiedGraph?.trim() ||
      params.verifiedMemory?.trim() ||
      params.professionalAnalysis?.trim(),
  );
  if (
    params.answer.evidenceState !== "insufficient" ||
    !hasVerifiedContext ||
    params.answer.sources.length > 0
  ) {
    return params.answer;
  }

  const usesVerifiedLabel = VERIFIED_CONTEXT_ANSWER_RE.test(params.rawAnswer);
  const retrievedEmpty = (params.retrievedCount ?? 0) === 0;
  if (!usesVerifiedLabel && !retrievedEmpty) {
    return params.answer;
  }

  const looksLikeStockRefuse =
    STOCK_INSUFFICIENT_RE.test(params.rawAnswer) || !params.rawAnswer.trim();
  const excerpt = verifiedContextExcerpt(params);
  const nextAnswer =
    usesVerifiedLabel && !looksLikeStockRefuse
      ? params.rawAnswer
      : excerpt
        ? `Based on verified matter intelligence (not a document quote): ${excerpt}`
        : params.rawAnswer;

  return {
    ...params.answer,
    evidenceState: "partial",
    answer: nextAnswer,
    assumptions: [
      ...(params.answer.assumptions ?? []),
      QA06_PARTIAL_ASSUMPTION,
      ...(params.verifiedIntelligence?.trim()
        ? ["Answer used verified structured matter intelligence."]
        : []),
      ...(params.verifiedGraph?.trim() ? ["Answer used verified Graph relationships."] : []),
      ...(params.verifiedMemory?.trim() ? ["Answer used approved Matter Memory."] : []),
      ...(params.professionalAnalysis?.trim()
        ? ["Answer used matter-scoped professional analysis context (reviewed vs proposed labeled)."]
        : []),
    ],
  };
}
