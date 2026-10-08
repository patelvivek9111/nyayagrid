import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runComplexCivilClaimsFixture } from "@nyayagrid/intelligence";
import {
  buildCivilClaimsAskContextBlock,
  isCivilClaimsAskQuestion,
  mergeAskContextText,
} from "./nyaya";

const root = resolve(__dirname, "../../..");

function readNyayaSrc(): string {
  return readFileSync(resolve(root, "packages/search/src/nyaya.ts"), "utf8");
}

const WEEK4_STUB = "WEEK4_STRUCTURED_CONTEXT\nknown facts from documents";

describe("Ask Nyaya civil claims context gating", () => {
  const { review } = runComplexCivilClaimsFixture();

  it("includes structured non-deciding civil context for claim questions", () => {
    const question = "What claims are currently pleaded and which elements of breach are unsupported?";
    expect(isCivilClaimsAskQuestion(question)).toBe(true);
    const block = buildCivilClaimsAskContextBlock({
      question,
      civilReview: review,
    });
    expect(block).toBeTruthy();
    expect(block!).toContain("CIVIL_CLAIMS_REVIEW");
    expect(block!).toContain("LIABILITY_CONCLUSION: null");
    expect(block!).toContain("OUTCOME_CONCLUSION: null");
    expect(block!).not.toMatch(/\bthe (plaintiff|defendant) is liable\b|\bwill (win|lose)\b/i);

    const merged = mergeAskContextText(WEEK4_STUB, null, block);
    expect(merged).toContain(WEEK4_STUB);
    expect(merged).toContain("CIVIL_CLAIMS_REVIEW");
  });

  it("scopes party-specific civil questions", () => {
    const block = buildCivilClaimsAskContextBlock({
      question: "Which claims involve Defendant Beta?",
      civilReview: review,
    });
    expect(block).toContain("CLAIMS:");
    expect(block).toContain("LIABILITY_CONCLUSION: null");
  });

  it("answers whole-matter civil investigation without liability conclusions", () => {
    const block = buildCivilClaimsAskContextBlock({
      question: "What are the major evidentiary weaknesses in this case and what should counsel investigate next?",
      civilReview: review,
    });
    expect(block).toMatch(/INVESTIGATION_NOTES:|FACTS_EVIDENCE_NOTES:/);
    expect(block).toContain("LIABILITY_CONCLUSION: null");
  });

  it("does not inject civil context for unrelated questions", () => {
    const question = "What is on the calendar next week?";
    expect(isCivilClaimsAskQuestion(question)).toBe(false);
    expect(
      buildCivilClaimsAskContextBlock({
        question,
        civilReview: review,
      }),
    ).toBeNull();
  });

  it("wires civil merge into askNyayaAboutMatter without redesigning week-4 or suppression gates", () => {
    const src = readNyayaSrc();
    expect(src).toContain("buildCivilClaimsAskContextBlock");
    expect(src).toContain("isCivilClaimsAskQuestion");
    expect(src).toContain("loadCivilClaimsReview");
    expect(src).toContain("buildSuppressionAskContextBlock");
    expect(src).toContain("mergeAskContextText");
  });
});
