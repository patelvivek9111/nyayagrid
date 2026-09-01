import { describe, expect, it } from "vitest";
import { reviewQueueBreakdown, totalPendingReviewCount } from "./review-queue";

describe("totalPendingReviewCount", () => {
  it("sums Timeline, Facts, People, Deadlines, and proposed Graph edges", () => {
    expect(
      totalPendingReviewCount({
        proposedEvents: 2,
        proposedFacts: 1,
        proposedEntities: 3,
        proposedDeadlines: 1,
        proposedGraphEdges: 4,
      }),
    ).toBe(11);
  });

  it("uses pendingCount from the server as the single total when present", () => {
    expect(
      totalPendingReviewCount({
        proposedEvents: 1,
        proposedGraphEdges: 2,
        pendingCount: 3,
      }),
    ).toBe(3);
  });

  it("counts Graph-only pending so Review discovery still fires", () => {
    expect(
      totalPendingReviewCount({
        proposedEvents: 0,
        proposedFacts: 0,
        proposedEntities: 0,
        proposedDeadlines: 0,
        proposedGraphEdges: 5,
      }),
    ).toBe(5);
  });

  it("counts Analysis-only pending without changing the five intelligence fields", () => {
    expect(
      totalPendingReviewCount({
        proposedEvents: 0,
        proposedFacts: 0,
        proposedEntities: 0,
        proposedDeadlines: 0,
        proposedGraphEdges: 0,
        analysis: { pendingContractItems: 2, pendingFindings: 1, pendingRedlines: 0, pendingCount: 3 },
      }),
    ).toBe(3);
  });

  it("counts Memory-only pending separately from intelligence and Analysis", () => {
    expect(
      totalPendingReviewCount({
        proposedEvents: 0,
        proposedFacts: 0,
        proposedEntities: 0,
        proposedDeadlines: 0,
        proposedGraphEdges: 0,
        memory: { proposedMemories: 2, pendingCount: 2 },
      }),
    ).toBe(2);
  });

  it("treats missing keys as zero, including Graph", () => {
    expect(totalPendingReviewCount({ proposedEvents: 4 })).toBe(4);
    expect(totalPendingReviewCount({})).toBe(0);
    expect(totalPendingReviewCount(undefined)).toBe(0);
  });

  it("keeps Analysis nested and can include Memory as its own object", () => {
    const counts = {
      proposedEvents: 1,
      proposedGraphEdges: 2,
      analysis: { pendingCount: 3 },
      memory: { pendingCount: 2 },
      pendingCount: 8,
    };
    expect(totalPendingReviewCount(counts)).toBe(8);
    expect(counts.analysis?.pendingCount).toBe(3);
    expect(counts.memory?.pendingCount).toBe(2);
  });
});

describe("reviewQueueBreakdown", () => {
  it("omits zero queues and can show Graph-only pending", () => {
    expect(
      reviewQueueBreakdown({
        proposedEvents: 0,
        proposedFacts: 0,
        proposedEntities: 0,
        proposedDeadlines: 0,
        proposedGraphEdges: 2,
      }),
    ).toEqual(["2 Graph relationships"]);
  });

  it("can show Analysis-only pending separately from Graph", () => {
    expect(
      reviewQueueBreakdown({
        proposedEvents: 0,
        proposedGraphEdges: 0,
        analysis: { pendingCount: 3 },
      }),
    ).toEqual(["3 Analysis findings"]);
  });

  it("can show Memory-only pending separately from Analysis", () => {
    expect(
      reviewQueueBreakdown({
        proposedEvents: 0,
        proposedGraphEdges: 0,
        memory: { pendingCount: 2 },
      }),
    ).toEqual(["2 Nyaya Memory"]);
  });
});
