/**
 * Pending Review queue is counted by getReviewQueueCounts.
 *
 * Intelligence (status === "proposed"):
 * timeline, facts, people, deadlines, Graph edges.
 *
 * Analysis (separate object; not mixed into the five intelligence fields):
 * contract items and analysis findings with status === "proposed",
 * redline suggestions with status === "proposed".
 *
 * Memory (separate object):
 * matter_memories with status === "proposed" and no successor.
 *
 * Reviewed, dismissed, accepted, and rejected Analysis rows are excluded.
 * Approved, edited-and-approved, rejected, archived, and superseded Memory are excluded.
 * Evidence Matrix derived rows and Compare output are not counted.
 */
export type ReviewQueueAnalysisCounts = {
  pendingContractItems?: number;
  pendingFindings?: number;
  pendingRedlines?: number;
  pendingCount?: number;
};

export type ReviewQueueMemoryCounts = {
  proposedMemories?: number;
  pendingCount?: number;
};

export type ReviewQueueCounts = {
  proposedEvents?: number;
  proposedFacts?: number;
  proposedEntities?: number;
  proposedDeadlines?: number;
  proposedGraphEdges?: number;
  intelligencePendingCount?: number;
  analysis?: ReviewQueueAnalysisCounts;
  memory?: ReviewQueueMemoryCounts;
  pendingCount?: number;
};

function analysisPendingFromCounts(counts: ReviewQueueCounts): number {
  if (typeof counts.analysis?.pendingCount === "number") return counts.analysis.pendingCount;
  return (
    (counts.analysis?.pendingContractItems ?? 0) +
    (counts.analysis?.pendingFindings ?? 0) +
    (counts.analysis?.pendingRedlines ?? 0)
  );
}

function intelligencePendingFromCounts(counts: ReviewQueueCounts): number {
  if (typeof counts.intelligencePendingCount === "number") return counts.intelligencePendingCount;
  return (
    (counts.proposedEvents ?? 0) +
    (counts.proposedFacts ?? 0) +
    (counts.proposedEntities ?? 0) +
    (counts.proposedDeadlines ?? 0) +
    (counts.proposedGraphEdges ?? 0)
  );
}

function memoryPendingFromCounts(counts: ReviewQueueCounts): number {
  if (typeof counts.memory?.pendingCount === "number") return counts.memory.pendingCount;
  return counts.memory?.proposedMemories ?? 0;
}

export function totalPendingReviewCount(counts: ReviewQueueCounts | null | undefined): number {
  if (!counts) return 0;
  if (typeof counts.pendingCount === "number") return counts.pendingCount;
  return (
    intelligencePendingFromCounts(counts) +
    analysisPendingFromCounts(counts) +
    memoryPendingFromCounts(counts)
  );
}

export function reviewQueueBreakdown(counts: ReviewQueueCounts): string[] {
  const analysis = analysisPendingFromCounts(counts);
  const memory = memoryPendingFromCounts(counts);
  return [
    counts.proposedEvents ? `${counts.proposedEvents} Timeline events` : "",
    counts.proposedEntities ? `${counts.proposedEntities} People` : "",
    counts.proposedFacts ? `${counts.proposedFacts} Facts` : "",
    counts.proposedDeadlines ? `${counts.proposedDeadlines} Deadlines` : "",
    counts.proposedGraphEdges ? `${counts.proposedGraphEdges} Graph relationships` : "",
    memory ? `${memory} Nyaya Memory` : "",
    analysis ? `${analysis} Analysis findings` : "",
  ].filter(Boolean);
}
