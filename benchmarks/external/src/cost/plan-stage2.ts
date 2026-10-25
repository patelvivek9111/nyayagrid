/**
 * Stage-2 cost plan for exact finalists gpt-6.1-sol + grok-4.7.
 * Recomputes from frozen suite token profiles + current pricing.
 */
import { loadCurrentPricingTable } from "./estimator.js";
import type { Stage2SuitePlan } from "../live/stage2-task-planner.js";
import type { StageCostBand, TokenScenario } from "./plan-stage1.js";

export type Stage2ExactCostPlan = {
  stage: 2;
  status: "PLANNED_REQUIRES_SEPARATE_AUTHORIZATION";
  autoStartFromStage1: false;
  authorizedNow: false;
  models: ["gpt-6.1-sol", "grok-4.7"];
  judges: ["claude-sonnet-5-5", "gpt-6.1-sol"];
  tasks: {
    prbenchLegalHard: number;
    legalbenchCleared: number;
    legalbenchRagRetrieval: number;
  };
  callCounts: {
    prbenchResponses: number;
    legalbenchResponses: number;
    totalResponses: number;
    judgeCalls: number;
    ragRetrievalOnly: number;
    ragGenerationCalls: 0;
  };
  tokenAssumptions: {
    inputTokens: Record<TokenScenario, number>;
    prbenchOutput: Record<TokenScenario, number>;
    legalbenchOutput: Record<TokenScenario, number>;
    judgeOutput: Record<TokenScenario, number>;
    inputFromTokenProfile: boolean;
    note: string;
  };
  cost: StageCostBand;
  breakdown: {
    gptResponses: StageCostBand;
    grokResponses: StageCostBand;
    anthropicJudgeA: StageCostBand;
    openaiJudgeB: StageCostBand;
    ragGeneration: StageCostBand;
  };
  oldPlanComparison: {
    oldExpectedUsd: number;
    oldHighUsd: number;
    newExpectedUsd: number;
    newHighUsd: number;
    materialDifferenceNote: string;
  };
  recommendedHardCapUsd: number;
  providerSubcapsUsd: {
    openai_responses: number;
    xai_responses: number;
    anthropic_judge: number;
    openai_judge: number;
    max_judge_usd: number;
  };
};

function costUsd(
  inputTokens: number,
  outputTokens: number,
  inputPer1M: number,
  outputPer1M: number,
): number {
  return (inputTokens / 1_000_000) * inputPer1M + (outputTokens / 1_000_000) * outputPer1M;
}

function band(
  currency: string,
  low: number,
  expected: number,
  high: number,
): StageCostBand {
  return { lowUsd: low, expectedUsd: expected, highUsd: high, currency };
}

/**
 * Default token assumptions: prefer measured Stage-2 context profile percentiles when provided.
 * Fallback aligns with Stage-1 plan assumptions for continuity.
 */
export function computeStage2ExactCostPlan(input: {
  suite: Stage2SuitePlan;
  /** Measured input token percentiles across Stage-2 prompts (optional). */
  measuredInputTokens?: { p50: number; p90: number; p95: number; max: number };
}): Stage2ExactCostPlan {
  const pricing = loadCurrentPricingTable();
  const currency = pricing.currency ?? "USD";
  const suite = input.suite;
  const prN = suite.actual.prbenchHard;
  const lbN = suite.actual.legalbench;
  const ragN = suite.actual.legalbenchRag;

  const measured = input.measuredInputTokens;
  const inputTokens: Record<TokenScenario, number> = measured
    ? {
        // Measured profile across frozen Stage-2 prompts (PRBench+LegalBench).
        // HIGH uses p95 (not max) so one outlier does not inflate every call's worst-case.
        low: Math.max(1, Math.round(measured.p50)),
        expected: Math.max(1, Math.round(Math.max(measured.p50, measured.p90 * 0.55))),
        high: Math.max(1, Math.round(measured.p95)),
      }
    : { low: 709, expected: 7152, high: 14990 };

  const prbenchOut: Record<TokenScenario, number> = {
    low: 400,
    expected: 800,
    high: 1600,
  };
  const legalbenchOut: Record<TokenScenario, number> = {
    low: 25,
    expected: 50,
    high: 100,
  };
  const judgeOut: Record<TokenScenario, number> = {
    low: 100,
    expected: 200,
    high: 400,
  };

  const gpt = pricing.models["gpt-6.1-sol"]!;
  const grok = pricing.models["grok-4.7"]!;
  const judgeModels = pricing.judgeModels ?? {};
  const sonnet = judgeModels["claude-sonnet-5-5"] ?? pricing.models["claude-sonnet-5-5"]!;
  const judgeSol = judgeModels["gpt-6.1-sol"] ?? pricing.models["gpt-6.1-sol"]!;

  const scenarios = ["low", "expected", "high"] as const;
  const gptResp: Record<TokenScenario, number> = { low: 0, expected: 0, high: 0 };
  const grokResp: Record<TokenScenario, number> = { low: 0, expected: 0, high: 0 };
  const judgeA: Record<TokenScenario, number> = { low: 0, expected: 0, high: 0 };
  const judgeB: Record<TokenScenario, number> = { low: 0, expected: 0, high: 0 };

  for (const s of scenarios) {
    const inTok = inputTokens[s];
    const lbIn = Math.max(1, Math.ceil(inTok * 0.5));
    gptResp[s] =
      prN * costUsd(inTok, prbenchOut[s], gpt.inputPer1M, gpt.outputPer1M) +
      lbN * costUsd(lbIn, legalbenchOut[s], gpt.inputPer1M, gpt.outputPer1M);
    grokResp[s] =
      prN * costUsd(inTok, prbenchOut[s], grok.inputPer1M, grok.outputPer1M) +
      lbN * costUsd(lbIn, legalbenchOut[s], grok.inputPer1M, grok.outputPer1M);

    // Judge input ≈ task prompt + response text
    const judgeIn = inTok + prbenchOut[s];
    // 250 PRBench × 2 models = 500 responses judged by each judge
    const judgedResponses = prN * 2;
    judgeA[s] =
      judgedResponses * costUsd(judgeIn, judgeOut[s], sonnet.inputPer1M, sonnet.outputPer1M);
    judgeB[s] =
      judgedResponses * costUsd(judgeIn, judgeOut[s], judgeSol.inputPer1M, judgeSol.outputPer1M);
  }

  const total = (s: TokenScenario) => gptResp[s] + grokResp[s] + judgeA[s] + judgeB[s];
  const cost = band(currency, total("low"), total("expected"), total("high"));

  const oldExpected = 32.9664;
  const oldHigh = 68.2995;
  const materialDifferenceNote =
    measured != null
      ? "New estimate uses exact finalist rates (gpt-6.1-sol + grok-4.7) and measured Stage-2 input percentiles instead of Stage-1 four-model average rates."
      : "New estimate uses exact finalist rates (gpt-6.1-sol + grok-4.7) instead of Stage-1 four-model average rates; token assumptions still Stage-1 defaults until measured profile applied.";

  // Hard cap: HIGH + ~10% contingency, rounded up to nearest $5
  const recommendedHardCapUsd = Math.ceil((cost.highUsd * 1.1) / 5) * 5;

  // Provider subcaps: HIGH for that bucket + 15%, rounded up to $1
  const roundUp1 = (n: number) => Math.ceil(n * 1.15);
  const providerSubcapsUsd = {
    openai_responses: roundUp1(gptResp.high),
    xai_responses: roundUp1(grokResp.high),
    anthropic_judge: roundUp1(judgeA.high),
    openai_judge: roundUp1(judgeB.high),
    max_judge_usd: roundUp1(judgeA.high + judgeB.high),
  };

  return {
    stage: 2,
    status: "PLANNED_REQUIRES_SEPARATE_AUTHORIZATION",
    autoStartFromStage1: false,
    authorizedNow: false,
    models: ["gpt-6.1-sol", "grok-4.7"],
    judges: ["claude-sonnet-5-5", "gpt-6.1-sol"],
    tasks: {
      prbenchLegalHard: prN,
      legalbenchCleared: lbN,
      legalbenchRagRetrieval: ragN,
    },
    callCounts: {
      prbenchResponses: suite.call_counts.prbenchResponses,
      legalbenchResponses: suite.call_counts.legalbenchResponses,
      totalResponses: suite.call_counts.totalResponses,
      judgeCalls: suite.call_counts.judgeCalls,
      ragRetrievalOnly: suite.call_counts.ragRetrievalOnly,
      ragGenerationCalls: 0,
    },
    tokenAssumptions: {
      inputTokens,
      prbenchOutput: prbenchOut,
      legalbenchOutput: legalbenchOut,
      judgeOutput: judgeOut,
      inputFromTokenProfile: Boolean(measured),
      note: measured
        ? "Input low/expected/high derived from measured p50 / max(p50,p90*0.55) / p95 (max tracked in context profile only)."
        : "Fallback Stage-1 token assumptions; recompute after context profile.",
    },
    cost,
    breakdown: {
      gptResponses: band(currency, gptResp.low, gptResp.expected, gptResp.high),
      grokResponses: band(currency, grokResp.low, grokResp.expected, grokResp.high),
      anthropicJudgeA: band(currency, judgeA.low, judgeA.expected, judgeA.high),
      openaiJudgeB: band(currency, judgeB.low, judgeB.expected, judgeB.high),
      ragGeneration: band(currency, 0, 0, 0),
    },
    oldPlanComparison: {
      oldExpectedUsd: oldExpected,
      oldHighUsd: oldHigh,
      newExpectedUsd: cost.expectedUsd,
      newHighUsd: cost.highUsd,
      materialDifferenceNote,
    },
    recommendedHardCapUsd,
    providerSubcapsUsd,
  };
}
