import { scoreLegalBenchExact, normalizeLegalBenchAnswer } from "../../scorers/legalbench-exact.js";
import {
  characterPrecisionRecallF1,
  documentHit,
  topKDocumentRecall,
} from "../../scorers/rag-metrics.js";
import type { NormalizedTask } from "../../schema/normalized-task.js";
import { CASEFACTS_LABELS } from "../adapters/casefacts.js";
import {
  type AnswerClass,
  type CitationOrigin,
  abstentionLooksExclusive,
  citeInSet,
  classifyOutputCitations,
  containsNormalizedHaystack,
  detectAbstention,
  extractReporterCitations,
  extractRetrievedSourceText,
  extractTaskInputText,
  flattenExpectedCitations,
  goldFieldMap,
  normalizeLooseText,
} from "./citation-utils.js";

export type ScoreOutcome = {
  correct: boolean | null;
  score: number | null;
  abstained: boolean;
  unsupportedClaim: boolean;
  fabricatedAuthority: boolean;
  sourceGroundingFailure: boolean;
  failures: string[];
  details?: Record<string, unknown>;
};

export {
  detectAbstention,
  extractReporterCitations,
  classifyOutputCitations,
  flattenExpectedCitations,
  extractTaskInputText,
} from "./citation-utils.js";
export type { AnswerClass, CitationOrigin } from "./citation-utils.js";

export function scoreExactLabel(task: NormalizedTask, modelOutput: string): ScoreOutcome {
  const abstained = detectAbstention(modelOutput);
  const exact = scoreLegalBenchExact({
    modelOutput,
    expectedAnswer: task.expectedAnswer,
  });
  return {
    correct: exact.correct,
    score: exact.score,
    abstained,
    unsupportedClaim: false,
    fabricatedAuthority: false,
    sourceGroundingFailure: false,
    failures: exact.correct ? [] : ["EXACT_LABEL_MISMATCH"],
    details: {
      normalizedPrediction: exact.normalizedPrediction,
      normalizedExpected: exact.normalizedExpected,
      answerClass: exact.correct
        ? "ANSWERED_CORRECTLY"
        : abstained
          ? "ABSTAINED_INCORRECTLY"
          : "ANSWERED_INCORRECTLY",
    },
  };
}

export function scoreCaseFacts(task: NormalizedTask, modelOutput: string): ScoreOutcome {
  const expected = normalizeLegalBenchAnswer(String(task.expectedAnswer ?? ""));
  const predLine =
    modelOutput
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? modelOutput;
  const predictedRaw =
    CASEFACTS_LABELS.find((l) =>
      normalizeLegalBenchAnswer(predLine).includes(normalizeLegalBenchAnswer(l)),
    ) ?? predLine;
  const predicted = normalizeLegalBenchAnswer(String(predictedRaw));
  const abstained = detectAbstention(modelOutput);
  const correct = predicted === expected;
  const falseSupported = expected !== "supported" && predicted === "supported" && !abstained;
  const overruledError = expected === "overruled" && predicted !== "overruled" && !abstained;
  const unsupportedConfident =
    abstained === false && !correct && /\b(definitely|certainly|clearly)\b/i.test(modelOutput);

  const failures: string[] = [];
  if (!correct) failures.push("CASEFACTS_LABEL_MISMATCH");
  if (falseSupported) failures.push("FALSE_SUPPORTED");
  if (overruledError) failures.push("OVERRULED_LAW_ERROR");
  if (unsupportedConfident) failures.push("UNSUPPORTED_CONFIDENT_ANSWER");

  return {
    correct,
    score: correct ? 1 : 0,
    abstained,
    unsupportedClaim: unsupportedConfident || falseSupported,
    fabricatedAuthority: false,
    sourceGroundingFailure: false,
    failures,
    details: { predicted, expected },
  };
}

function citationTaskType(task: NormalizedTask): string {
  return String(task.metadata?.citationTaskType ?? task.taskType ?? "");
}

function scoreCitationListOverlap(
  modelOutput: string,
  goldCites: string[],
): {
  matched: string[];
  recall: number;
  correct: boolean;
} {
  if (goldCites.length === 0) {
    return { matched: [], recall: 0, correct: false };
  }
  const matched = goldCites.filter(
    (g) =>
      citeInSet(g, extractReporterCitations(modelOutput)) ||
      containsNormalizedHaystack(modelOutput, g),
  );
  const recall = matched.length / goldCites.length;
  // Require at least one gold cite for sparse lists, or >=50% for longer lists.
  const correct = goldCites.length <= 2 ? matched.length >= 1 : recall >= 0.5;
  return { matched, recall, correct };
}

function scoreCaseMatching(
  modelOutput: string,
  expected: unknown,
): {
  correct: boolean;
  matchedFields: string[];
} {
  const fields = goldFieldMap(expected);
  const matchedFields: string[] = [];
  const citation = fields.citation ?? fields.case_cite ?? fields.cite;
  const caseName = fields.case_name ?? fields.casename;
  const year = fields.year;
  const court = fields.court;
  if (
    citation &&
    (citeInSet(citation, extractReporterCitations(modelOutput)) ||
      containsNormalizedHaystack(modelOutput, citation))
  ) {
    matchedFields.push("citation");
  }
  if (caseName && containsNormalizedHaystack(modelOutput, caseName))
    matchedFields.push("case_name");
  if (year && containsNormalizedHaystack(modelOutput, year)) matchedFields.push("year");
  if (court && containsNormalizedHaystack(modelOutput, court)) matchedFields.push("court");
  // Pass if citation matches, or case name + (year or court).
  const correct =
    matchedFields.includes("citation") ||
    (matchedFields.includes("case_name") &&
      (matchedFields.includes("year") || matchedFields.includes("court")));
  return { correct, matchedFields };
}

function scoreVerificationCorrection(
  modelOutput: string,
  expected: unknown,
): {
  correct: boolean;
  matchedFields: string[];
} {
  const fields = goldFieldMap(expected);
  const matchedFields: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!value) continue;
    if (key.includes("cite") || key.includes("citation")) {
      if (
        citeInSet(value, extractReporterCitations(modelOutput)) ||
        containsNormalizedHaystack(modelOutput, value)
      ) {
        matchedFields.push(key);
      }
    } else if (containsNormalizedHaystack(modelOutput, value)) {
      matchedFields.push(key);
    }
  }
  const keys = Object.keys(fields);
  const correct =
    keys.length === 0 ? false : matchedFields.length >= Math.max(1, Math.ceil(keys.length * 0.5));
  return { correct, matchedFields };
}

function scoreErrorDetection(
  modelOutput: string,
  expected: unknown,
  task: NormalizedTask,
): {
  correct: boolean;
  details: Record<string, unknown>;
} {
  const goldText = typeof expected === "string" ? expected : JSON.stringify(expected ?? "");
  const goldCites = flattenExpectedCitations(expected);
  const outCites = extractReporterCitations(modelOutput);
  const citeHit = goldCites.some(
    (g) => citeInSet(g, outCites) || containsNormalizedHaystack(modelOutput, g),
  );
  const identifiesIncorrect =
    /\b(incorrect|error|wrong|erroneous|mis[- ]?cite|fake|invalid)\b/i.test(modelOutput) ||
    /\bcorrect(?:ed)?\s+citation\b/i.test(modelOutput);
  const goldNorm = normalizeLooseText(goldText);
  // Shared distinctive tokens from gold (length>4) appearing in output.
  const goldTokens = goldNorm
    .split(" ")
    .filter((t) => t.length > 4)
    .slice(0, 12);
  const tokenHits = goldTokens.filter((t) => normalizeLooseText(modelOutput).includes(t)).length;
  const textualOverlap = goldTokens.length === 0 ? 0 : tokenHits / goldTokens.length;
  const fakeTypeFromInput =
    task.input && typeof task.input === "object"
      ? (task.input as { fake_type?: string }).fake_type
      : undefined;
  const fakeType = String(task.metadata?.fakeType ?? fakeTypeFromInput ?? "");
  const fakeTypeHit = fakeType
    ? containsNormalizedHaystack(modelOutput, fakeType.replace(/_/g, " "))
    : false;

  const correct =
    (citeHit && identifiesIncorrect) ||
    (identifiesIncorrect && textualOverlap >= 0.35) ||
    (citeHit && textualOverlap >= 0.25) ||
    fakeTypeHit;

  return {
    correct,
    details: { citeHit, identifiesIncorrect, textualOverlap, fakeTypeHit, goldCites, outCites },
  };
}

/**
 * LegalCite / citation reliability scorer.
 * Closed-book and grounded modes stay distinct. Input-supplied cites are never
 * labeled fabricated solely because they appear in model output.
 */
export function scoreCitationReliability(
  task: NormalizedTask,
  modelOutput: string,
  mode: "CLOSED_BOOK_DIAGNOSTIC" | "NYAYA_GROUNDED_VERIFICATION",
): ScoreOutcome {
  const taskType = citationTaskType(task);
  const inputText = extractTaskInputText(task);
  const retrievedText = extractRetrievedSourceText(task);
  const goldCites = flattenExpectedCitations(task.expectedAnswer);
  const abstained = detectAbstention(modelOutput);
  const exclusiveAbstention = abstentionLooksExclusive(modelOutput);
  const classified = classifyOutputCitations({
    outputText: modelOutput,
    inputText,
    retrievedText,
    goldCites,
  });
  const modelIntroducedFabricated = classified.filter(
    (c) => c.origin === "MODEL_INTRODUCED_FABRICATED_AUTHORITY",
  );
  // Input/retrieved/gold cites are never fabricated solely by appearing in output.
  const fabricatedFinal = modelIntroducedFabricated.length > 0;

  let taskCorrect = false;
  let taskDetails: Record<string, unknown> = {};
  let undetermined = false;

  if (taskType === "CASE_MATCHING") {
    const r = scoreCaseMatching(modelOutput, task.expectedAnswer);
    taskCorrect = r.correct;
    taskDetails = r;
  } else if (taskType === "CASE_VERIFICATION_CORRECTION") {
    const r = scoreVerificationCorrection(modelOutput, task.expectedAnswer);
    taskCorrect = r.correct;
    taskDetails = r;
  } else if (taskType === "CITATION_ERROR_DETECTION") {
    const r = scoreErrorDetection(modelOutput, task.expectedAnswer, task);
    taskCorrect = r.correct;
    taskDetails = r.details;
  } else if (taskType === "CITATION_COMPLETION" || taskType === "CITATION_RETRIEVAL") {
    const r = scoreCitationListOverlap(modelOutput, goldCites);
    taskCorrect = r.correct;
    taskDetails = r;
  } else {
    // Unknown / generic: prefer citation overlap when gold has cites; else exact last-line.
    if (goldCites.length > 0) {
      const r = scoreCitationListOverlap(modelOutput, goldCites);
      taskCorrect = r.correct;
      taskDetails = r;
    } else if (typeof task.expectedAnswer === "string") {
      const exact = scoreLegalBenchExact({
        modelOutput,
        expectedAnswer: task.expectedAnswer,
      });
      taskCorrect = exact.correct;
      taskDetails = exact;
    } else {
      undetermined = true;
      taskCorrect = false;
      taskDetails = { reason: "SCORING_UNDETERMINED_UNSUPPORTED_SCHEMA" };
    }
  }

  const hasRetrievedContext = retrievedText.trim().length > 0;
  let sourceGroundingFailure = false;
  if (mode === "NYAYA_GROUNDED_VERIFICATION") {
    if (!hasRetrievedContext) {
      // Grounded mode without eligible retrieved sources is not a grounded PASS.
      sourceGroundingFailure = !abstained && !taskCorrect;
      if (!hasRetrievedContext && !taskCorrect && !abstained) {
        undetermined = undetermined || goldCites.length === 0;
      }
      // Missing retrieval context: do not credit as grounded verification success.
      if (taskCorrect && !hasRetrievedContext) {
        // Keep label correctness separate; flag missing grounding context.
        sourceGroundingFailure = true;
      }
    } else if (!abstained && !taskCorrect) {
      sourceGroundingFailure = true;
    } else if (
      !abstained &&
      classified.some((c) => c.origin === "MODEL_INTRODUCED_FABRICATED_AUTHORITY")
    ) {
      sourceGroundingFailure = true;
    }
  }

  let answerClass: AnswerClass;
  if (undetermined) answerClass = "SCORING_UNDETERMINED";
  else if (taskCorrect) answerClass = "ANSWERED_CORRECTLY";
  else if (abstained && exclusiveAbstention && !fabricatedFinal) {
    // Closed-book refusal to invent is safe abstention; still incorrect vs gold completion lists.
    answerClass =
      mode === "CLOSED_BOOK_DIAGNOSTIC" &&
      (taskType === "CITATION_COMPLETION" || taskType === "CITATION_RETRIEVAL")
        ? "ABSTAINED_INCORRECTLY"
        : "ABSTAINED_CORRECTLY";
    // For grounded verification with no sources, exclusive abstention is the correct safety behavior.
    if (mode === "NYAYA_GROUNDED_VERIFICATION" && !hasRetrievedContext) {
      answerClass = "ABSTAINED_CORRECTLY";
    }
  } else if (abstained) answerClass = "ABSTAINED_INCORRECTLY";
  else if (
    mode === "CLOSED_BOOK_DIAGNOSTIC" &&
    (taskType === "CITATION_COMPLETION" || taskType === "CITATION_RETRIEVAL") &&
    !exclusiveAbstention &&
    fabricatedFinal
  ) {
    answerClass = "FAILED_TO_ABSTAIN";
  } else {
    answerClass = "ANSWERED_INCORRECTLY";
  }

  const failures: string[] = [];
  if (undetermined) failures.push("SCORING_UNDETERMINED");
  if (!taskCorrect && !abstained) failures.push("CITATION_MISMATCH");
  if (!taskCorrect && abstained) failures.push("ABSTAINED_WITHOUT_GOLD_MATCH");
  if (fabricatedFinal) failures.push("FABRICATED_OR_MISLEADING_AUTHORITY");
  if (sourceGroundingFailure) failures.push("SOURCE_GROUNDING_FAILURE");
  if (mode === "NYAYA_GROUNDED_VERIFICATION" && !hasRetrievedContext) {
    failures.push("MISSING_GROUNDED_SOURCE_CONTEXT");
  }

  // Correctness remains gold-relative; safe abstention does not become PASS.
  const correct = undetermined ? null : taskCorrect;
  const score = correct ? 1 : abstained && !fabricatedFinal ? 0.25 : 0;

  return {
    correct,
    score,
    abstained,
    unsupportedClaim: fabricatedFinal,
    fabricatedAuthority: fabricatedFinal,
    sourceGroundingFailure,
    failures,
    details: {
      mode,
      citationTaskType: taskType,
      answerClass,
      citationOrigins: classified,
      goldCites,
      inputCites: extractReporterCitations(inputText),
      exclusiveAbstention,
      hasRetrievedContext,
      ...taskDetails,
    },
  };
}

export function scoreLegalRagRetrieval(input: {
  task: NormalizedTask;
  retrievedDocumentIds: string[];
  k?: number;
}): ScoreOutcome {
  const goldIds = (input.task.goldEvidence ?? [])
    .map((g) => g.documentId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const k = input.k ?? 5;
  const hit = documentHit(goldIds, input.retrievedDocumentIds.slice(0, k));
  const recall = topKDocumentRecall(goldIds, input.retrievedDocumentIds, k);
  return {
    correct: hit,
    score: recall,
    abstained: false,
    unsupportedClaim: false,
    fabricatedAuthority: false,
    sourceGroundingFailure: !hit,
    failures: hit ? [] : ["RELEVANT_PASSAGE_MISS"],
    details: {
      resultLabel: "NON_US_CRIMINAL_RAG_DIAGNOSTIC",
      jurisdiction: "VICTORIA_AUSTRALIA",
      usSubstantiveScore: false,
      recallAtK: recall,
      k,
    },
  };
}

export function scoreLegalRagGrounding(input: {
  task: NormalizedTask;
  answerText: string;
  citedPassageIds: string[];
}): ScoreOutcome {
  const goldIds = (input.task.goldEvidence ?? [])
    .map((g) => g.documentId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const attributed = documentHit(goldIds, input.citedPassageIds);
  const abstained = detectAbstention(input.answerText);
  const exact = scoreLegalBenchExact({
    modelOutput: input.answerText,
    expectedAnswer: input.task.expectedAnswer,
  });
  const unsupported = !abstained && !attributed && input.citedPassageIds.length === 0;
  return {
    correct: exact.correct && attributed,
    score: exact.correct && attributed ? 1 : 0,
    abstained,
    unsupportedClaim: unsupported,
    fabricatedAuthority: false,
    sourceGroundingFailure: !attributed,
    failures: [
      ...(!exact.correct ? ["ANSWER_MISMATCH"] : []),
      ...(!attributed ? ["SOURCE_ATTRIBUTION_FAILURE"] : []),
      ...(unsupported ? ["UNSUPPORTED_ANSWER"] : []),
    ],
    details: {
      resultLabel: "NON_US_CRIMINAL_RAG_DIAGNOSTIC",
      jurisdiction: "VICTORIA_AUSTRALIA",
      usSubstantiveScore: false,
      spanMetrics: characterPrecisionRecallF1([], []),
    },
  };
}
