import { describe, expect, it } from "vitest";
import {
  alignContractSummary,
  collapseNearDuplicateContractItems,
  locateContractSupportingSpan,
  preserveLimitationLanguage,
  preserveSourceQuantities,
} from "./analysis/contract-span";

const msa = `Harbor Point Office Lease - Main Agreement
1. Parties and Purpose
This synthetic agreement is between Party A and Party B.
4. Notice
Except where a later amendment expressly provides otherwise, formal notice requires 45 days and must be delivered by tracked courier.
9. Liability
Aggregate contractual liability will not exceed $255,000, except for obligations expressly excluded from the cap in this synthetic agreement.`;

describe("contract supporting spans", () => {
  it("locates the notice clause instead of the parties header", () => {
    const span = locateContractSupportingSpan({
      chunkText: msa,
      item: {
        category: "notice",
        title: "Notice provision identified",
        explanation: "Formal notice is required.",
        attention: "review",
        sourceChunkIds: ["11111111-1111-1111-1111-111111111111"],
        originalText: "formal notice requires 45 days",
      },
    });
    expect(span).toMatch(/45 days/i);
    expect(span).not.toMatch(/Parties and Purpose/i);
  });

  it("copies omitted source quantities into the explanation", () => {
    const next = preserveSourceQuantities("Notice provision identified.", "formal notice requires 45 days");
    expect(next).toMatch(/45/);
  });

  it("preserves not-exceed limitation language", () => {
    const next = preserveLimitationLanguage(
      "Liability is $255,000.",
      "Aggregate contractual liability will not exceed $255,000, except for obligations expressly excluded.",
    );
    expect(next.toLowerCase()).toMatch(/not exceed|source limitation/);
  });

  it("aligns a denying summary with persisted items", () => {
    const summary = alignContractSummary("There are no significant terms.", [
      { title: "Formal notice requires 45 days", explanation: "45 days" },
    ]);
    expect(summary).toMatch(/45 days/i);
    expect(summary).not.toMatch(/no significant/i);
  });

  it("collapses near-duplicate notice findings without merging distinct obligations", () => {
    const collapsed = collapseNearDuplicateContractItems([
      {
        category: "notice",
        title: "Notice requires 45 days",
        explanation: "Formal notice requires 45 days.",
        attention: "review",
        sourceChunkIds: ["11111111-1111-1111-1111-111111111111"],
      },
      {
        category: "notice",
        title: "Notice period is 45 days",
        explanation: "Formal notice requires 45 days.",
        attention: "review",
        sourceChunkIds: ["11111111-1111-1111-1111-111111111111"],
      },
      {
        category: "liability",
        title: "Liability cap",
        explanation: "Aggregate contractual liability will not exceed $255,000.",
        attention: "high_attention",
        sourceChunkIds: ["11111111-1111-1111-1111-111111111111"],
      },
    ]);
    expect(collapsed.duplicateSuppressed).toBe(1);
    expect(collapsed.items).toHaveLength(2);
  });
});
