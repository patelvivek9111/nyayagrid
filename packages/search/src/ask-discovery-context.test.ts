import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runComplexDiscoveryLedgerFixture } from "@nyayagrid/intelligence";
import {
  buildDiscoveryAskContextBlock,
  isDiscoveryAskQuestion,
  mergeAskContextText,
} from "./nyaya";

const root = resolve(__dirname, "../../..");

function readNyayaSrc(): string {
  return readFileSync(resolve(root, "packages/search/src/nyaya.ts"), "utf8");
}

const WEEK4_STUB = "WEEK4_STRUCTURED_CONTEXT\nknown facts from documents";

describe("Ask Nyaya discovery ledger context gating", () => {
  const { review } = runComplexDiscoveryLedgerFixture();

  it("includes structured non-deciding discovery context for discovery questions", () => {
    const question = "Which discovery requests are still unanswered?";
    expect(isDiscoveryAskQuestion(question)).toBe(true);
    const block = buildDiscoveryAskContextBlock({
      question,
      discoveryReview: review,
    });
    expect(block).toBeTruthy();
    expect(block!).toContain("DISCOVERY_LEDGER_REVIEW");
    expect(block!).toContain("SANCTIONS_CONCLUSION: null");
    expect(block!).toContain("PRIVILEGE_LEGAL_CONCLUSION: null");
    expect(block!).not.toMatch(/\bimpose sanctions\b|\bthe document is privileged\b/i);

    const merged = mergeAskContextText(WEEK4_STUB, null, null, block);
    expect(merged).toContain(WEEK4_STUB);
    expect(merged).toContain("DISCOVERY_LEDGER_REVIEW");
  });

  it("answers production and Bates questions with source-backed ranges", () => {
    const block = buildDiscoveryAskContextBlock({
      question: "What Bates ranges were produced on September 18?",
      discoveryReview: review,
    });
    expect(block).toContain("ACME000200–ACME000220");
    expect(block).toContain("SANCTIONS_CONCLUSION: null");
  });

  it("does not inject discovery context for unrelated questions", () => {
    const question = "What is on the calendar next week?";
    expect(isDiscoveryAskQuestion(question)).toBe(false);
    expect(
      buildDiscoveryAskContextBlock({
        question,
        discoveryReview: review,
      }),
    ).toBeNull();
  });

  it("wires discovery merge into askNyayaAboutMatter without redesigning prior gates", () => {
    const src = readNyayaSrc();
    expect(src).toContain("buildDiscoveryAskContextBlock");
    expect(src).toContain("isDiscoveryAskQuestion");
    expect(src).toContain("loadDiscoveryLedgerReview");
    expect(src).toContain("buildCivilClaimsAskContextBlock");
    expect(src).toContain("mergeAskContextText");
  });
});
