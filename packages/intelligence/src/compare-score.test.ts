import { describe, expect, it } from "vitest";
import {
  COMPARISON_SUMMARY_MISALIGN_NOTE,
  applyComparisonSummaryAlignmentPolicy,
  computeParagraphDiffs,
  scoreComparisonSummaryAgainstDiffs,
} from "./draft/helpers";

describe("clause-aligned redline / comparison summary scoring", () => {
  it("scores equal texts + honest empty summary as aligned", () => {
    const changes = computeParagraphDiffs(
      "Alpha clause stays.\n\nBeta clause stays.",
      "Alpha clause stays.\n\nBeta clause stays.",
    );
    expect(changes).toEqual([]);
    const score = scoreComparisonSummaryAgainstDiffs(
      "No substantive differences detected between the compared document versions.",
      changes,
    );
    expect(score.alignment).toBe("aligned");
    expect(score.score).toBe(1);
  });

  it("flags empty-diff summaries that invent changes", () => {
    const changes = computeParagraphDiffs("Same text.", "Same text.");
    const score = scoreComparisonSummaryAgainstDiffs(
      "The amendment added a broad indemnity clause shifting all liability to Tenant.",
      changes,
    );
    expect(score.alignment).toBe("misaligned");
    expect(score.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("replaces inventing empty-diff summaries via alignment policy", () => {
    const changes: ReturnType<typeof computeParagraphDiffs> = [];
    const result = applyComparisonSummaryAlignmentPolicy(
      "Landlord deleted the termination notice and added unlimited indemnity.",
      changes,
    );
    expect(result.summary).toMatch(/No substantive differences/i);
    expect(result.score.alignment).toBe("aligned");
  });

  it("supports add/remove summaries that track the digest", () => {
    const changes = computeParagraphDiffs(
      "The parties agree to cooperate.\n\nBase rent is four thousand dollars.",
      "The parties agree to cooperate.\n\nBase rent is five thousand dollars.\n\nTenant shall maintain insurance.",
    );
    expect(changes.some((c) => c.changeType === "added" || c.changeType === "changed")).toBe(true);
    const alignedSummary =
      "Base rent changed from four thousand dollars to five thousand dollars, and a requirement that Tenant shall maintain insurance was added.";
    const score = scoreComparisonSummaryAgainstDiffs(alignedSummary, changes);
    expect(score.alignment).toBe("aligned");
    expect(score.unsupportedClaims).toEqual([]);
  });

  it("rejects summary claims absent from the diff digest", () => {
    const changes = computeParagraphDiffs(
      "The parties agree to cooperate.\n\nBase rent is four thousand dollars.",
      "The parties agree to cooperate.\n\nBase rent is five thousand dollars.",
    );
    const score = scoreComparisonSummaryAgainstDiffs(
      "Base rent increased. The amendment also replaced the indemnity with a mutual waiver of consequential damages.",
      changes,
    );
    expect(score.alignment === "partial" || score.alignment === "misaligned").toBe(true);
    expect(score.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("marks high-attention indemnity edits and appends misalign note when summary drifts", () => {
    const changes = computeParagraphDiffs(
      "Tenant shall indemnify Landlord for all claims without limitation.",
      "Tenant shall indemnify Landlord only for third-party claims arising from Tenant negligence.",
    );
    expect(changes.some((c) => c.attention === "high_attention")).toBe(true);

    const drifted =
      "The notice period was shortened to five days and arbitration was made mandatory in Delaware.";
    const applied = applyComparisonSummaryAlignmentPolicy(drifted, changes);
    expect(applied.summary).toContain(COMPARISON_SUMMARY_MISALIGN_NOTE);
    expect(applied.score.alignment).not.toBe("aligned");
  });

  it("treats high-attention mention without high-attention diffs as a flag", () => {
    const changes = computeParagraphDiffs(
      "The parties agree to cooperate on scheduling.",
      "The parties agree to cooperate on scheduling and logistics.",
    );
    const score = scoreComparisonSummaryAgainstDiffs(
      "A minor scheduling clarification was added; no indemnity change.",
      changes,
    );
    // "indemnity" in summary while no high_attention diff → flag
    expect(score.flags.some((f) => /high-attention themes/i.test(f))).toBe(true);
  });
});
