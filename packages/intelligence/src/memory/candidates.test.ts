import { describe, expect, it } from "vitest";
import {
  extractGroundedMemoryCandidates,
  selectMemoryProposalChunks,
} from "./candidates";

describe("memory proposal candidates", () => {
  it("ranks question-overlapping chunks ahead of unrelated filler", () => {
    const ranked = selectMemoryProposalChunks(
      "What formal notice period currently applies under Amendment 1?",
      [
        { id: "unrelated", content: "The warehouse address is 100 Industrial Way." },
        { id: "notice", content: "Amendment 1 requires thirty (30) days written notice." },
      ],
      1,
    );
    expect(ranked[0]?.id).toBe("notice");
  });

  it("extracts a source-backed numeric notice term without approving it", () => {
    const candidates = extractGroundedMemoryCandidates({
      question: "Cite Amendment 1 for the current notice period.",
      chunks: [
        {
          id: "chunk-amend",
          content: "Amendment 1 requires 30 days' notice. The original lease said 60 days.",
        },
        {
          id: "chunk-email",
          content: "I think the contract still says 60 days.",
        },
      ],
    });
    expect(candidates.some((row) => /\b30\b/.test(row.content))).toBe(true);
    expect(candidates.every((row) => row.sourceChunkId !== "chunk-email")).toBe(true);
  });

  it("does not invent a service-credit fact from an operative-term extractor", () => {
    const candidates = extractGroundedMemoryCandidates({
      question: "What service credit was issued on INV-2601?",
      chunks: [{ id: "inv", content: "Invoice INV-2601 amount due $68,000. No credits listed." }],
    });
    expect(candidates).toEqual([]);
  });
});
