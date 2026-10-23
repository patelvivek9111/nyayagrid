import { describe, expect, it } from "vitest";
import { assertJudgeSeparation } from "../src/guards/judge-separation.js";

describe("judge-separation", () => {
  it("passes when models differ", () => {
    expect(() =>
      assertJudgeSeparation({
        responseModel: "model-a",
        judgeModel: "model-b",
      }),
    ).not.toThrow();
  });

  it("fails when models match", () => {
    expect(() =>
      assertJudgeSeparation({
        responseModel: "same",
        judgeModel: "same",
      }),
    ).toThrow(/must differ/);
  });

  it("allows self-grade when explicit", () => {
    expect(() =>
      assertJudgeSeparation({
        responseModel: "same",
        judgeModel: "same",
        allowSelfGrade: true,
      }),
    ).not.toThrow();
  });
});
