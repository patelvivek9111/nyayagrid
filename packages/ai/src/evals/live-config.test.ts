import { describe, expect, it } from "vitest";
import {
  EvalBudgetTracker,
  EVAL_LIVE_PINNED_MODEL_DEFAULT,
  liveEvalSkipReason,
  resolveLiveEvalConfig,
} from "./live-config";
import {
  MOCK_GRADED_BASELINES,
  buildMockBaselinesFromGradedCases,
  findBaselineRegressions,
} from "./baselines";
import { GRADED_CASES } from "./graded-cases";

describe("live eval config", () => {
  it("pins gpt-4o-mini by default and requires explicit EVAL_LIVE", () => {
    const config = resolveLiveEvalConfig({
      EVAL_LIVE: undefined,
      OPENAI_API_KEY: "sk-test",
    } as NodeJS.ProcessEnv);
    expect(config.enabled).toBe(false);
    expect(config.model).toBe(EVAL_LIVE_PINNED_MODEL_DEFAULT);
    expect(liveEvalSkipReason(config)).toMatch(/EVAL_LIVE/);
  });

  it("accepts opt-in when key and EVAL_LIVE=1 are set", () => {
    const config = resolveLiveEvalConfig({
      EVAL_LIVE: "1",
      OPENAI_API_KEY: "sk-test",
      EVAL_LIVE_MODEL: "gpt-4o-mini",
      EVAL_LIVE_MAX_TOKENS: "1000",
      EVAL_LIVE_MAX_USD: "0.25",
      EVAL_LIVE_TIMEOUT_MS: "12000",
    } as NodeJS.ProcessEnv);
    expect(liveEvalSkipReason(config)).toBeNull();
    expect(config.model).toBe("gpt-4o-mini");
    expect(config.maxTokens).toBe(1000);
    expect(config.maxUsd).toBe(0.25);
    expect(config.timeoutMs).toBe(12_000);
  });

  it("tracks token and USD budgets", () => {
    const config = resolveLiveEvalConfig({
      EVAL_LIVE: "1",
      OPENAI_API_KEY: "sk-test",
      EVAL_LIVE_MAX_TOKENS: "100",
      EVAL_LIVE_MAX_USD: "1",
      EVAL_LIVE_USD_PER_1M_INPUT: "1000",
      EVAL_LIVE_USD_PER_1M_OUTPUT: "1000",
    } as NodeJS.ProcessEnv);
    const budget = new EvalBudgetTracker(config);
    expect(budget.wouldExceedBudget()).toBeNull();
    budget.recordUsage({ inputTokens: 60, outputTokens: 50 });
    expect(budget.wouldExceedBudget()).toMatch(/Token budget/);
  });
});

describe("mock graded baselines", () => {
  it("covers every graded case with required quality dimensions", () => {
    const baselines = buildMockBaselinesFromGradedCases();
    for (const testCase of GRADED_CASES) {
      expect(baselines.cases[testCase.id]?.required.evidence_state).toBe(true);
      expect(baselines.cases[testCase.id]?.required.faithfulness).toBe(true);
      expect(baselines.cases[testCase.id]?.required.completeness).toBe(true);
    }
    expect(MOCK_GRADED_BASELINES.version).toBe(1);
  });

  it("flags live regressions against required baseline dimensions", () => {
    const regressions = findBaselineRegressions({
      caseId: "golden-lease-commencement",
      dimensions: [
        { name: "evidence_state", passed: false, detail: "expected=grounded, got=insufficient" },
        { name: "faithfulness", passed: true, detail: "ok" },
        { name: "completeness", passed: true, detail: "ok" },
        { name: "need_more_docs", passed: true, detail: "ok" },
      ],
    });
    expect(regressions).toEqual([
      expect.objectContaining({ caseId: "golden-lease-commencement", dimension: "evidence_state" }),
    ]);
  });
});
