import { describe, expect, it } from "vitest";
import { researchTurnAnswer } from "./research-chat";

describe("researchTurnAnswer", () => {
  it("uses conciseAnswer from the research API", () => {
    expect(
      researchTurnAnswer({
        synthesis: { conciseAnswer: "Nyaya cannot tell you whether to sign." },
      }),
    ).toBe("Nyaya cannot tell you whether to sign.");
  });

  it("does not treat a missing synthesis.answer as an empty corpus miss when conciseAnswer exists", () => {
    expect(
      researchTurnAnswer({
        synthesis: { conciseAnswer: "No legal authority passages were retrieved." },
        hits: [],
      }),
    ).toBe("No legal authority passages were retrieved.");
  });
});
