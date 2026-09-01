import { describe, expect, it } from "vitest";
import { evaluateCanary, runCanarySuite, CANARY_CASES } from "./canary";

describe("grader canaries (negative controls)", () => {
  it("defines the required bad-answer controls", () => {
    expect(CANARY_CASES.map((c) => c.id).sort()).toEqual(
      [
        "canary-evidence-overclaim",
        "canary-false-confidence",
        "canary-false-premise-accept",
        "canary-invented-date",
        "canary-mismatched-citation",
      ].sort(),
    );
  });

  it("fails invented dates on faithfulness", () => {
    const outcome = evaluateCanary(CANARY_CASES.find((c) => c.id === "canary-invented-date")!);
    expect(outcome.harnessOk, outcome.details).toBe(true);
    expect(outcome.gradePassed).toBe(false);
    expect(outcome.dimensionPassed).toBe(false);
  });

  it("fails a real-but-irrelevant cite on citation_relevance", () => {
    const outcome = evaluateCanary(
      CANARY_CASES.find((c) => c.id === "canary-mismatched-citation")!,
    );
    expect(outcome.harnessOk, outcome.details).toBe(true);
    expect(outcome.gradePassed).toBe(false);
    expect(outcome.dimensionPassed).toBe(false);
  });

  it("fails false confidence on evidence_state", () => {
    const outcome = evaluateCanary(CANARY_CASES.find((c) => c.id === "canary-false-confidence")!);
    expect(outcome.harnessOk, outcome.details).toBe(true);
    expect(outcome.gradePassed).toBe(false);
    expect(outcome.dimensionPassed).toBe(false);
  });

  it("fails physical-entry overclaim on faithfulness", () => {
    const outcome = evaluateCanary(CANARY_CASES.find((c) => c.id === "canary-evidence-overclaim")!);
    expect(outcome.harnessOk, outcome.details).toBe(true);
    expect(outcome.gradePassed).toBe(false);
    expect(outcome.dimensionPassed).toBe(false);
  });

  it("fails false-premise acceptance on faithfulness", () => {
    const outcome = evaluateCanary(
      CANARY_CASES.find((c) => c.id === "canary-false-premise-accept")!,
    );
    expect(outcome.harnessOk, outcome.details).toBe(true);
    expect(outcome.gradePassed).toBe(false);
    expect(outcome.dimensionPassed).toBe(false);
  });

  it("the full canary suite proves the grader can fail", () => {
    const outcomes = runCanarySuite();
    const broken = outcomes.filter((o) => !o.harnessOk);
    expect(broken, broken.map((b) => `${b.id}: ${b.details}`).join("\n")).toEqual([]);
  });
});
