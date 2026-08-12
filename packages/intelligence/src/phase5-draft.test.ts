import { describe, expect, it } from "vitest";
import {
  appendExternalResearchNoteIfNeeded,
  buildComparisonIdempotencyKey,
  buildContractAnalysisIdempotencyKey,
  computeParagraphDiffs,
  needsExternalResearchNote,
  splitParagraphs,
  validateDraftAssertions,
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

  it("computes paragraph diffs deterministically", () => {
    const textA = "Alpha clause.\n\nBeta clause.";
    const textB = "Alpha clause.\n\nBeta clause revised.";
    const changes = computeParagraphDiffs(textA, textB);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((c) => c.changeType === "changed" || c.changeType === "added")).toBe(true);
    expect(splitParagraphs(textA)).toEqual(["Alpha clause.", "Beta clause."]);
  });
});
