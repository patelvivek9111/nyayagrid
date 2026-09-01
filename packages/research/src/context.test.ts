import { describe, expect, it } from "vitest";
import { looksLikeLegalDoctrineQuestion } from "./context";

describe("looksLikeLegalDoctrineQuestion", () => {
  it("treats governing-law limitations questions as doctrine so Ask retrieves authorities", () => {
    expect(
      looksLikeLegalDoctrineQuestion(
        "Under the governing law for this Case, within what period must an action for breach of a contract for the sale of goods be commenced?",
      ),
    ).toBe(true);
  });

  it("treats an unseen Ohio wage-statute question as doctrine without matching 6U fixtures", () => {
    expect(
      looksLikeLegalDoctrineQuestion(
        "Under the recorded law, does the imported Ohio wage statute require payment of the statutory minimum wage?",
      ),
    ).toBe(true);
  });

  it("does not treat a pure document-exhibit question as doctrine", () => {
    expect(
      looksLikeLegalDoctrineQuestion("Use Exhibit R. What does Exhibit R say about late fees?"),
    ).toBe(false);
  });
});
