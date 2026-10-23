import { readFileSync } from "node:fs";
import path from "node:path";
import { getRegistryDir } from "../paths.js";
import { loadCurrentPricingTable } from "./estimator.js";

export type TokenScenario = "low" | "expected" | "high";

export type StageCostBand = {
  lowUsd: number;
  expectedUsd: number;
  highUsd: number;
  currency: string;
};

export type Stage1Plan = {
  stage: 1;
  effectiveDate: string;
  models: string[];
  callCounts: {
    prbenchRawModelReasoning: number;
    legalbenchGeneration: number;
    ragRetrievalOnly: number;
    judgeCalls: number;
  };
  tokenAssumptions: {
    inputTokens: Record<TokenScenario, number>;
    prbenchOutput: Record<TokenScenario, number>;
    legalbenchOutput: Record<TokenScenario, number>;
    judgeOutput: Record<TokenScenario, number>;
    inputFromTokenProfile: boolean;
  };
  cost: StageCostBand;
  perModelResponseCost: Record<string, StageCostBand>;
  judgeCost: StageCostBand;
};

export type Stage2Plan = {
  stage: 2;
  status: "PLANNED_REQUIRES_SEPARATE_AUTHORIZATION";
  autoStartFromStage1: false;
  models: string[];
  modelNote: string;
  tasks: {
    prbenchLegalHard: number;
    legalbenchCleared: number;
    legalbenchRagRetrieval: number;
  };
  callCounts: {
    prbenchRawModelReasoning: number;
    legalbenchGeneration: number;
    ragRetrievalOnly: number;
    judgeCalls: number;
  };
  cost: StageCostBand;
};

export type Stage3Plan = {
  stage: 3;
  status: "PLANNED_REQUIRES_SEPARATE_AUTHORIZATION";
  autoStartFromStage2: false;
  repeats: number;
  tasks: number;
  models: string[];
  purpose: string;
  cost: StageCostBand;
};

const STAGE1_MODELS = [
  "gpt-6.1-sol",
  "claude-opus-5-5",
  "gemini-4-argon",
  "grok-4.7",
] as const;

const JUDGE_MODELS = ["claude-sonnet-5-5", "gpt-6.1-sol"] as const;

function costUsd(
  inputTokens: number,
  outputTokens: number,
  inputPer1M: number,
  outputPer1M: number,
): number {
  return (inputTokens / 1_000_000) * inputPer1M + (outputTokens / 1_000_000) * outputPer1M;
}

function loadScreeningCounts(): {
  prbenchHard: number;
  legalbench: number;
  legalbenchRag: number;
} {
  const raw = readFileSync(path.join(getRegistryDir(), "screening-suite.json"), "utf8");
  const suite = JSON.parse(raw) as {
    actual?: { prbenchHard?: number; legalbench?: number; legalbenchRag?: number };
    targets?: { prbenchHard?: number; legalbench?: number; legalbenchRag?: number };
  };
  const actual = suite.actual ?? {};
  const targets = suite.targets ?? {};
  return {
    prbenchHard: actual.prbenchHard ?? targets.prbenchHard ?? 32,
    legalbench: actual.legalbench ?? targets.legalbench ?? 24,
    legalbenchRag: actual.legalbenchRag ?? targets.legalbenchRag ?? 150,
  };
}

function loadTokenProfileInputs(): Record<TokenScenario, number> {
  try {
    const raw = readFileSync(path.join(getRegistryDir(), "token-profile.json"), "utf8");
    const profile = JSON.parse(raw) as {
      aggregate?: { inputTokens?: { p50?: number; p90?: number; p95?: number } };
    };
    const t = profile.aggregate?.inputTokens;
    return {
      low: t?.p50 ?? 700,
      expected: t?.p90 ?? 7000,
      high: t?.p95 ?? 15000,
    };
  } catch {
    return { low: 700, expected: 7000, high: 15000 };
  }
}

function emptyBand(currency: string): StageCostBand {
  return { lowUsd: 0, expectedUsd: 0, highUsd: 0, currency };
}

function addBand(a: StageCostBand, b: StageCostBand): StageCostBand {
  return {
    lowUsd: a.lowUsd + b.lowUsd,
    expectedUsd: a.expectedUsd + b.expectedUsd,
    highUsd: a.highUsd + b.highUsd,
    currency: a.currency,
  };
}

export function computeStage1Plan(): Stage1Plan {
  const pricing = loadCurrentPricingTable();
  const counts = loadScreeningCounts();
  const inputByScenario = loadTokenProfileInputs();

  const prbenchCalls = counts.prbenchHard * STAGE1_MODELS.length;
  const legalbenchCalls = counts.legalbench * STAGE1_MODELS.length;
  const ragCalls = counts.legalbenchRag;
  const judgeCalls = counts.prbenchHard * STAGE1_MODELS.length * JUDGE_MODELS.length;

  const prbenchOut = { low: 400, expected: 800, high: 1600 };
  const legalbenchOut = { low: 25, expected: 50, high: 100 };
  const judgeOut = { low: 100, expected: 200, high: 400 };

  const perModelResponseCost: Record<string, StageCostBand> = {};

  for (const modelId of STAGE1_MODELS) {
    const p = pricing.models[modelId];
    if (!p) continue;
    const bands = emptyBand(pricing.currency);
    for (const scenario of ["low", "expected", "high"] as const) {
      const inTok = inputByScenario[scenario];
      const prOut = prbenchOut[scenario];
      const lbOut = legalbenchOut[scenario];
      const prCost =
        counts.prbenchHard * costUsd(inTok, prOut, p.inputPer1M, p.outputPer1M);
      const lbCost =
        counts.legalbench *
        costUsd(Math.ceil(inTok * 0.5), lbOut, p.inputPer1M, p.outputPer1M);
      bands[`${scenario}Usd`] = prCost + lbCost;
    }
    perModelResponseCost[modelId] = bands;
  }

  let responseTotal = emptyBand(pricing.currency);
  for (const modelId of STAGE1_MODELS) {
    const band = perModelResponseCost[modelId];
    if (!band) continue;
    responseTotal = addBand(responseTotal, band);
  }

  const judgeCost = emptyBand(pricing.currency);
  const judgeCallsPerModel = counts.prbenchHard * STAGE1_MODELS.length;
  for (const judgeId of JUDGE_MODELS) {
    const jp = pricing.judgeModels?.[judgeId] ?? pricing.models[judgeId];
    if (!jp) continue;
    for (const scenario of ["low", "expected", "high"] as const) {
      const out = judgeOut[scenario];
      const inTok = inputByScenario[scenario] + prbenchOut[scenario];
      const jCost =
        judgeCallsPerModel * costUsd(inTok, out, jp.inputPer1M, jp.outputPer1M);
      judgeCost[`${scenario}Usd`] += jCost;
    }
  }

  const cost = addBand(responseTotal, judgeCost);

  return {
    stage: 1,
    effectiveDate: "2026-10-23",
    models: [...STAGE1_MODELS],
    callCounts: {
      prbenchRawModelReasoning: prbenchCalls,
      legalbenchGeneration: legalbenchCalls,
      ragRetrievalOnly: ragCalls,
      judgeCalls,
    },
    tokenAssumptions: {
      inputTokens: inputByScenario,
      prbenchOutput: prbenchOut,
      legalbenchOutput: legalbenchOut,
      judgeOutput: judgeOut,
      inputFromTokenProfile: true,
    },
    cost,
    perModelResponseCost,
    judgeCost,
  };
}

/** Stage 2: top 2 finalists × full PRBench Legal Hard 250 + cleared LegalBench + RAG retrieval. */
export function computeStage2Plan(stage1: Stage1Plan): Stage2Plan {
  const pricing = loadCurrentPricingTable();
  const finalistCount = 2;
  const prbenchHard = 250;
  const legalbenchCleared = 80;
  const rag = 150;
  const inputByScenario = stage1.tokenAssumptions.inputTokens;
  const prbenchOut = stage1.tokenAssumptions.prbenchOutput;
  const legalbenchOut = stage1.tokenAssumptions.legalbenchOutput;
  const judgeOut = stage1.tokenAssumptions.judgeOutput;

  // Use mean of Stage-1 primary rates as proxy for unknown finalists.
  const avgInput =
    STAGE1_MODELS.reduce((s, id) => s + (pricing.models[id]?.inputPer1M ?? 0), 0) /
    STAGE1_MODELS.length;
  const avgOutput =
    STAGE1_MODELS.reduce((s, id) => s + (pricing.models[id]?.outputPer1M ?? 0), 0) /
    STAGE1_MODELS.length;

  const cost = emptyBand(pricing.currency);
  for (const scenario of ["low", "expected", "high"] as const) {
    const inTok = inputByScenario[scenario];
    const responseCost =
      finalistCount *
      (prbenchHard * costUsd(inTok, prbenchOut[scenario], avgInput, avgOutput) +
        legalbenchCleared *
          costUsd(Math.ceil(inTok * 0.5), legalbenchOut[scenario], avgInput, avgOutput));
    const judgeIn = inTok + prbenchOut[scenario];
    // Dual judges at Sonnet/Sol rates (~$2/$10)
    const judgeRateIn = 2;
    const judgeRateOut = 10;
    const jCost =
      finalistCount *
      prbenchHard *
      JUDGE_MODELS.length *
      costUsd(judgeIn, judgeOut[scenario], judgeRateIn, judgeRateOut);
    cost[`${scenario}Usd`] = responseCost + jCost;
  }

  return {
    stage: 2,
    status: "PLANNED_REQUIRES_SEPARATE_AUTHORIZATION",
    autoStartFromStage1: false,
    models: ["TOP_2_FROM_STAGE_1"],
    modelNote: "Exact finalist IDs selected only after Stage-1 scores; no auto-escalation.",
    tasks: {
      prbenchLegalHard: prbenchHard,
      legalbenchCleared,
      legalbenchRagRetrieval: rag,
    },
    callCounts: {
      prbenchRawModelReasoning: prbenchHard * finalistCount,
      legalbenchGeneration: legalbenchCleared * finalistCount,
      ragRetrievalOnly: rag,
      judgeCalls: prbenchHard * finalistCount * JUDGE_MODELS.length,
    },
    cost,
  };
}

/** Stage 3: 3 repeats on 40 hardest tasks × 2 finalists (variance / critical-failure stability). */
export function computeStage3Plan(stage1: Stage1Plan): Stage3Plan {
  const pricing = loadCurrentPricingTable();
  const repeats = 3;
  const tasks = 40;
  const finalistCount = 2;
  const inputByScenario = stage1.tokenAssumptions.inputTokens;
  const prbenchOut = stage1.tokenAssumptions.prbenchOutput;
  const judgeOut = stage1.tokenAssumptions.judgeOutput;
  const avgInput =
    STAGE1_MODELS.reduce((s, id) => s + (pricing.models[id]?.inputPer1M ?? 0), 0) /
    STAGE1_MODELS.length;
  const avgOutput =
    STAGE1_MODELS.reduce((s, id) => s + (pricing.models[id]?.outputPer1M ?? 0), 0) /
    STAGE1_MODELS.length;

  const cost = emptyBand(pricing.currency);
  for (const scenario of ["low", "expected", "high"] as const) {
    const inTok = inputByScenario[scenario];
    const responseCost =
      repeats *
      finalistCount *
      tasks *
      costUsd(inTok, prbenchOut[scenario], avgInput, avgOutput);
    const judgeIn = inTok + prbenchOut[scenario];
    const jCost =
      repeats *
      finalistCount *
      tasks *
      JUDGE_MODELS.length *
      costUsd(judgeIn, judgeOut[scenario], 2, 10);
    cost[`${scenario}Usd`] = responseCost + jCost;
  }

  return {
    stage: 3,
    status: "PLANNED_REQUIRES_SEPARATE_AUTHORIZATION",
    autoStartFromStage2: false,
    repeats,
    tasks,
    models: ["TOP_2_FROM_STAGE_2"],
    purpose: "variance, timeout rate, critical-failure stability on hardest subset",
    cost,
  };
}

export function computeStagePlans(): {
  generated_at: string;
  stage_1: Stage1Plan;
  stage_2: Stage2Plan;
  stage_3: Stage3Plan;
} {
  const stage1 = computeStage1Plan();
  return {
    generated_at: "2026-10-23",
    stage_1: stage1,
    stage_2: computeStage2Plan(stage1),
    stage_3: computeStage3Plan(stage1),
  };
}
