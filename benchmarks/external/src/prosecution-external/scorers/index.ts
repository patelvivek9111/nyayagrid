import { scoreLegalBenchExact, normalizeLegalBenchAnswer } from "../../scorers/legalbench-exact.js";
import {
  characterPrecisionRecallF1,
  documentHit,
  topKDocumentRecall,
} from "../../scorers/rag-metrics.js";
import type { NormalizedTask } from "../../schema/normalized-task.js";
import { CASEFACTS_LABELS } from "../adapters/casefacts.js";

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

const ABSTAIN_RE =
  /\b(abstain|insufficient|cannot (?:determine|verify)|unknown|not enough|unable to (?:confirm|verify)|no supporting (?:source|authority))\b/i;

export function detectAbstention(text: string): boolean {
  return ABSTAIN_RE.test(text);
}

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

export function scoreCitationReliability(
  task: NormalizedTask,
  modelOutput: string,
  mode: "CLOSED_BOOK_DIAGNOSTIC" | "NYAYA_GROUNDED_VERIFICATION",
): ScoreOutcome {
  const abstained = detectAbstention(modelOutput);
  const expected = task.expectedAnswer;
  const exact = scoreLegalBenchExact({ modelOutput, expectedAnswer: expected });

  const fabricatedAuthority =
    mode === "CLOSED_BOOK_DIAGNOSTIC" &&
    !abstained &&
    !exact.correct &&
    /\b\d+\s+[A-Za-z][\w.]*\s+\d+\b/.test(modelOutput);

  const failures: string[] = [];
  if (!exact.correct && !abstained) failures.push("CITATION_MISMATCH");
  if (fabricatedAuthority) failures.push("FABRICATED_OR_MISLEADING_AUTHORITY");

  return {
    correct: exact.correct,
    score: exact.correct ? 1 : abstained ? 0.25 : 0,
    abstained,
    unsupportedClaim: fabricatedAuthority,
    fabricatedAuthority,
    sourceGroundingFailure: mode === "NYAYA_GROUNDED_VERIFICATION" && !exact.correct && !abstained,
    failures,
    details: { mode, citationTaskType: task.metadata?.citationTaskType ?? task.taskType },
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
