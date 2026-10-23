import { assertPaidCallsAuthorized } from "../guards/paid-call-guard.js";
import type { NormalizedTask, RubricCriterion } from "../schema/normalized-task.js";

export const PRBenchRubricMode = {
  PREFILLED_RESPONSE: "PREFILLED_RESPONSE",
  LIVE_MODEL_RESPONSE: "LIVE_MODEL_RESPONSE",
} as const;

export type PRBenchRubricMode = (typeof PRBenchRubricMode)[keyof typeof PRBenchRubricMode];

export type PreparedRubricCriterion = RubricCriterion & {
  normalizedWeight: number;
};

export type PreparedRubric = {
  taskId: string;
  mode: PRBenchRubricMode;
  criteria: PreparedRubricCriterion[];
  totalWeight: number;
  prefilledResponse?: string;
};

export type ScorePrefilledRubricOptions = {
  task: NormalizedTask;
  responseText: string;
  mode?: PRBenchRubricMode;
};

export type RubricScoreResult = {
  taskId: string;
  mode: PRBenchRubricMode;
  weightedScore: number;
  maxScore: number;
  criterionScores: Array<{
    id: string | null | undefined;
    score: number;
    maxScore: number;
    weight: number;
  }>;
};

function normalizeWeights(criteria: RubricCriterion[]): PreparedRubricCriterion[] {
  const withWeights = criteria.map((c) => ({
    ...c,
    weight: c.weight ?? 1,
  }));
  const total = withWeights.reduce((sum, c) => sum + (c.weight ?? 0), 0);
  const divisor = total > 0 ? total : withWeights.length || 1;
  return withWeights.map((c) => ({
    ...c,
    normalizedWeight: (c.weight ?? 1) / divisor,
  }));
}

export function prepareWeightedRubric(
  task: NormalizedTask,
  mode: PRBenchRubricMode,
  prefilledResponse?: string,
): PreparedRubric {
  const criteria = task.rubric?.criteria ?? [];
  const prepared = normalizeWeights(criteria);
  return {
    taskId: task.taskId,
    mode,
    criteria: prepared,
    totalWeight: prepared.reduce((s, c) => s + c.normalizedWeight, 0),
    prefilledResponse,
  };
}

/** Deterministic heuristic scoring for CI — not an LLM judge. */
function heuristicCriterionScore(
  criterion: PreparedRubricCriterion,
  responseText: string,
  expectedAnswer: unknown,
): number {
  const max = criterion.maxScore ?? 1;
  const expected =
    typeof expectedAnswer === "string" ? expectedAnswer : JSON.stringify(expectedAnswer ?? "");
  const desc = (criterion.description ?? "").toLowerCase();
  let score = 0;
  if (expected && responseText.includes(String(expected).slice(0, 32))) {
    score += max * 0.5;
  }
  if (desc && responseText.toLowerCase().includes(desc.slice(0, 24))) {
    score += max * 0.5;
  }
  return Math.min(max, score);
}

export function scorePrefilledRubricResponse(
  options: ScorePrefilledRubricOptions,
): RubricScoreResult {
  const mode = options.mode ?? PRBenchRubricMode.PREFILLED_RESPONSE;
  if (mode === PRBenchRubricMode.LIVE_MODEL_RESPONSE) {
    assertPaidCallsAuthorized(undefined, "LIVE_MODEL_RESPONSE rubric scoring");
  }

  const prepared = prepareWeightedRubric(options.task, mode, options.responseText);
  const criterionScores = prepared.criteria.map((c) => {
    const maxScore = c.maxScore ?? 1;
    const score = heuristicCriterionScore(c, options.responseText, options.task.expectedAnswer);
    return {
      id: c.id,
      score,
      maxScore,
      weight: c.normalizedWeight,
    };
  });

  const weightedScore = criterionScores.reduce((sum, cs) => sum + cs.score * cs.weight, 0);
  const maxScore = criterionScores.reduce((sum, cs) => sum + cs.maxScore * cs.weight, 0);

  return {
    taskId: options.task.taskId,
    mode,
    weightedScore,
    maxScore,
    criterionScores,
  };
}

export function invokeLlmJudge(): never {
  assertPaidCallsAuthorized(undefined, "LLM judge invocation");
  throw new Error("LLM judge path is disabled in external-bench foundation");
}
