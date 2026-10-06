import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runMultiTheoryWarrantReview } from "@nyayagrid/intelligence";
import {
  buildSuppressionAskContextBlock,
  isSuppressionAskQuestion,
  mergeAskContextText,
} from "./nyaya";

const root = resolve(__dirname, "../../..");

function readNyayaSrc(): string {
  return readFileSync(resolve(root, "packages/search/src/nyaya.ts"), "utf8");
}

const WEEK4_STUB = "WEEK4_STRUCTURED_CONTEXT\nknown facts from documents";

describe("Ask Nyaya suppression context gating", () => {
  const { review } = runMultiTheoryWarrantReview();
  const suppressionQuestion = "Was there probable cause for the warrant?";

  it("TEST 1–7: prosecution suppression question includes structured non-deciding context", () => {
    const block = buildSuppressionAskContextBlock({
      workspaceType: "prosecution",
      question: suppressionQuestion,
      suppressionReview: review,
    });
    expect(block).toBeTruthy();
    expect(block!).toContain("KNOWN_FACTS");
    expect(block!).toContain("MISSING_FACTS");
    expect(block!).toMatch(/BINDING_AUTHORITY:|PERSUASIVE_AUTHORITY:/);
    expect(block!).toMatch(/SYNTHETIC-SCOTUS-PC-001|SYNTHETIC-SCOTUS-GF-001|source-supported/);
    expect(block!).toContain("LIMITATIONS");
    expect(block!).toContain("SUPPRESSION_CONCLUSION: null");
    expect(block!).toContain("WARRANT_VALIDITY_CONCLUSION: null");
    expect(block!).toContain("GUILT_CONCLUSION: null");
    expect(block!).not.toMatch(/The warrant was valid\.|The evidence should be suppressed\.|The defendant is guilty\./i);

    const merged = mergeAskContextText(WEEK4_STUB, block);
    expect(merged).toContain(WEEK4_STUB);
    expect(merged).toContain("SUPPRESSION_REVIEW");
    expect(merged).toContain("KNOWN_FACTS");
  });

  it("TEST 8: non-suppression prosecution question remains unchanged", () => {
    const unrelated = [
      "What witnesses contradict each other?",
      "What discovery is still missing?",
      "Summarize the charges.",
      "What evidence relates to defendant A?",
    ];
    for (const question of unrelated) {
      expect(isSuppressionAskQuestion(question)).toBe(false);
      expect(
        buildSuppressionAskContextBlock({
          workspaceType: "prosecution",
          question,
          suppressionReview: review,
        }),
      ).toBeNull();
      expect(mergeAskContextText(WEEK4_STUB, null)).toBe(WEEK4_STUB);
    }
  });

  it("TEST 9: law-firm Ask Nyaya remains unchanged", () => {
    expect(
      buildSuppressionAskContextBlock({
        workspaceType: "professional",
        question: suppressionQuestion,
        suppressionReview: review,
      }),
    ).toBeNull();
    expect(
      buildSuppressionAskContextBlock({
        workspaceType: "law_firm",
        question: suppressionQuestion,
        suppressionReview: review,
      }),
    ).toBeNull();
    expect(mergeAskContextText(WEEK4_STUB, null)).toBe(WEEK4_STUB);
  });

  it("TEST 10: gating does not trigger from warrant text elsewhere in the case", () => {
    const question = "What discovery is still missing?";
    expect(question.toLowerCase()).not.toMatch(/warrant|suppression|probable cause|miranda|exigen|good faith|knock/);
    expect(JSON.stringify(review).toLowerCase()).toContain("warrant");
    expect(isSuppressionAskQuestion(question)).toBe(false);
    expect(
      buildSuppressionAskContextBlock({
        workspaceType: "prosecution",
        question,
        suppressionReview: review,
      }),
    ).toBeNull();
  });

  it("triggers for suppression/warrant question examples", () => {
    const triggers = [
      "Was there probable cause for the warrant?",
      "What suppression issues should I review?",
      "What are the weaknesses in this search warrant?",
      "Does the good-faith exception matter here?",
      "Are there Miranda issues?",
      "Was there an exigent circumstance?",
      "What issues exist with knock and announce?",
    ];
    for (const question of triggers) {
      expect(isSuppressionAskQuestion(question)).toBe(true);
      const block = buildSuppressionAskContextBlock({
        workspaceType: "prosecution",
        question,
        suppressionReview: review,
      });
      expect(block).toContain("SUPPRESSION_CONCLUSION: null");
      expect(block).toContain("WARRANT_VALIDITY_CONCLUSION: null");
      expect(block).toContain("GUILT_CONCLUSION: null");
    }
  });

  it("wires suppression merge into askNyayaAboutMatter without changing week-4 professional default", () => {
    const src = readNyayaSrc();
    expect(src).toContain("buildSuppressionAskContextBlock");
    expect(src).toContain("mergeAskContextText");
    expect(src).toContain("isSuppressionAskQuestion");
    expect(src).toContain("askStructuredContextText");
    expect(src).toMatch(/workspaceType:\s*"professional"/);
    expect(src).toMatch(/workspaceType:\s*"prosecution"/);
  });
});
