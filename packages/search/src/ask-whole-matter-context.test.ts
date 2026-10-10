import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runPass7WholeMatterFixture } from "@nyayagrid/intelligence";
import {
  buildWholeMatterAskContextBlock,
  isWholeMatterAskQuestion,
  mergeAskContextText,
} from "./nyaya";

const root = resolve(__dirname, "../../..");

describe("Ask Nyaya whole-matter context gating", () => {
  const { intelligence } = runPass7WholeMatterFixture();

  it("injects whole-matter context for complete-status questions", () => {
    const question = "Give me the complete status of this matter.";
    expect(isWholeMatterAskQuestion(question)).toBe(true);
    const block = buildWholeMatterAskContextBlock({ question, intelligence });
    expect(block).toContain("WHOLE_MATTER_INTELLIGENCE");
    expect(block).toContain("PREDICTIVE_OUTCOME: null");
  });

  it("does not inject whole-matter for unrelated calendar questions", () => {
    expect(isWholeMatterAskQuestion("What is on the calendar next week?")).toBe(false);
    expect(
      buildWholeMatterAskContextBlock({
        question: "What is on the calendar next week?",
        intelligence,
      }),
    ).toBeNull();
  });

  it("wires whole-matter merge into askNyayaAboutMatter", () => {
    const src = readFileSync(resolve(root, "packages/search/src/nyaya.ts"), "utf8");
    expect(src).toContain("loadWholeMatterIntelligence");
    expect(src).toContain("wholeMatterContextText");
    const merged = mergeAskContextText("WEEK4", null, "WHOLE_MATTER_INTELLIGENCE");
    expect(merged).toContain("WHOLE_MATTER_INTELLIGENCE");
  });
});
