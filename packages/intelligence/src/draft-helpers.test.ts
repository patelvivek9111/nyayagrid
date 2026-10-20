import { describe, expect, it } from "vitest";
import {
  appendExternalResearchNoteIfNeeded,
  buildComparisonIdempotencyKey,
  buildContractAnalysisIdempotencyKey,
  computeParagraphDiffs,
  needsExternalResearchNote,
  neutralizeUnsupportedQuotes,
  applySourceLimitationGuard,
  normalizeDraftGenerationRaw,
  splitParagraphs,
  validateDraftAssertions,
  withInsufficientSourceAssumption,
} from "./draft/helpers";

describe("phase 5 draft helpers", () => {
  it("builds contract analysis idempotency keys", () => {
    expect(buildContractAnalysisIdempotencyKey("version-1")).toBe("contract_analysis:version-1");
  });

  it("builds comparison idempotency keys with sorted version ids", () => {
    expect(buildComparisonIdempotencyKey("b", "a")).toBe("document_comparison:a:b");
    expect(buildComparisonIdempotencyKey("a", "b")).toBe("document_comparison:a:b");
  });

  it("detects external legal research needs", () => {
    expect(needsExternalResearchNote(["Need case law support"], "")).toBe(true);
    expect(needsExternalResearchNote([], "Please verify the statute citation.")).toBe(true);
    expect(needsExternalResearchNote([], "Based on the agreement text only.")).toBe(false);
  });

  it("appends external research note once", () => {
    const content = appendExternalResearchNoteIfNeeded("Draft body", ["legal authority required"]);
    expect(content).toContain("External legal research is not enabled");
    expect(appendExternalResearchNoteIfNeeded(content, ["legal authority required"])).toBe(content);
  });

  it("filters draft assertions to authorized chunk ids", () => {
    const validated = validateDraftAssertions(
      [
        { text: "Grounded claim", chunkIds: ["c1", "c2"] },
        { text: "Ungrounded claim", chunkIds: ["c3"] },
      ],
      new Set(["c1", "c2"]),
    );
    expect(validated).toEqual([{ text: "Grounded claim", chunkIds: ["c1", "c2"] }]);
  });

  it("coerces object draft content into a string before schema parse", () => {
    const normalized = normalizeDraftGenerationRaw({
      content: { heading: "Memo", body: "Notice is 45 days." },
      assertions: [{ text: "Notice is 45 days.", chunkIds: ["11111111-1111-1111-1111-111111111111"] }],
    });
    expect(typeof normalized.content).toBe("string");
    expect(normalized.content).toContain("45 days");
  });

  it("removes quotation marks when the span is not in source text", () => {
    const out = neutralizeUnsupportedQuotes(
      'The clause says "no such obligation exists anywhere".',
      "Notice shall be forty-five (45) days.",
    );
    expect(out).not.toContain('"no such obligation exists anywhere"');
    expect(out).toContain("no such obligation exists anywhere");
  });

  it("does not leave user-requested physical entry as an established fact when sources limit it", () => {
    const out = applySourceLimitationGuard(
      "It is unequivocally clear that Priya Calderon entered the archive vault. Exhibit Q substantiates the damages.",
      "This register does not independently prove which person carried the badge. Exhibit Q is not attached to this file.",
    );
    expect(out).not.toMatch(/unequivocally clear that Priya Calderon entered/i);
    expect(out).toMatch(/does not independently prove|not independently proven/i);
    expect(out).toMatch(/not in the Case file/i);
  });

  it("does not leave current-law certainty when sources mark currentness unknown", () => {
    const out = applySourceLimitationGuard(
      "Delaware law is currently effective with no temporal uncertainty and is definitely the current law.",
      "LEGAL_AUTHORITY. Treatment and currentness are unknown unless a treatment note says a source reported them.",
    );
    expect(out).not.toMatch(/currently effective/i);
    expect(out).not.toMatch(/no temporal uncertainty/i);
    expect(out).not.toMatch(/definitely the current law/i);
    expect(out).toMatch(/not shown as current|unresolved temporal|not proven/i);
  });

  it("still strips current-law overclaims when a contract effective date is in the sources", () => {
    const out = applySourceLimitationGuard(
      "Under Pennsylvania law the contract is currently effective, with no temporal uncertainty.",
      "MASTER SUPPLY AGREEMENT Effective Date: January 8, 2025. Harborline Components, Inc.",
    );
    expect(out).not.toMatch(/currently effective/i);
    expect(out).not.toMatch(/no temporal uncertainty/i);
  });

  it("drops invalid assertion chunk ids before schema parse", () => {
    const normalized = normalizeDraftGenerationRaw({
      content: "Notice is 45 days.",
      assertions: [{ text: "Notice is 45 days.", chunkIds: ["not-a-uuid"] }],
    });
    expect(normalized.assertions).toEqual([]);
  });

  it("adds an insufficient source material assumption when no chunks are available", () => {
    const { assumptions, insufficientSourceMaterial } = withInsufficientSourceAssumption({
      chunkCount: 0,
      assumptions: [],
    });
    expect(insufficientSourceMaterial).toBe(true);
    expect(assumptions.some((item) => /insufficient source material/i.test(item))).toBe(true);
  });

  it("computes paragraph diffs deterministically", () => {
    const textA = "Alpha clause.\n\nBeta clause.";
    const textB = "Alpha clause.\n\nBeta clause revised.";
    const changes = computeParagraphDiffs(textA, textB);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((c) => c.changeType === "changed" || c.changeType === "added")).toBe(true);
    expect(splitParagraphs(textA)).toEqual(["Alpha clause.", "Beta clause."]);
  });

  it("returns no changes for identical texts (CC-03 empty diff)", () => {
    const text = "Same paragraph one.\n\nSame paragraph two.";
    expect(computeParagraphDiffs(text, text)).toEqual([]);
  });
});
