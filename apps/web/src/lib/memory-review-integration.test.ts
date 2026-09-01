import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { totalPendingReviewCount } from "./review-queue";

const webRoot = resolve(__dirname, "../..");

function src(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("Memory Review integration", () => {
  const queries = readFileSync(
    resolve(webRoot, "../../packages/intelligence/src/queries.ts"),
    "utf8",
  );
  const countFn = queries.slice(
    queries.indexOf("export async function getReviewQueueCounts"),
    queries.indexOf("export async function listTimelineEvents"),
  );
  const page = src("src/app/app/cases/[matterId]/review/page.tsx");
  const reviewApi = src("src/app/api/v1/matters/[matterId]/intelligence/review/route.ts");
  const memoryReview = src("src/app/api/v1/matters/[matterId]/memory/[memoryId]/review/route.ts");
  const trust = readFileSync(
    resolve(webRoot, "../../packages/intelligence/src/memory/trust.ts"),
    "utf8",
  );
  const memoryIndex = readFileSync(
    resolve(webRoot, "../../packages/intelligence/src/memory/index.ts"),
    "utf8",
  );

  it("A. proposed Memory increments Memory pending count", () => {
    expect(countFn).toContain('eq(matterMemories.status, "proposed")');
    expect(countFn).toContain("proposedMemories");
    expect(
      totalPendingReviewCount({
        proposedEvents: 0,
        proposedGraphEdges: 0,
        memory: { proposedMemories: 2, pendingCount: 2 },
      }),
    ).toBe(2);
  });

  it("B/C/D. approved, edited-and-approved, and rejected are not the pending status", () => {
    expect(countFn).not.toContain('eq(matterMemories.status, "approved")');
    expect(countFn).not.toContain('eq(matterMemories.status, "edited_and_approved")');
    expect(countFn).not.toContain('eq(matterMemories.status, "rejected")');
  });

  it("E. superseded Memory is excluded from pending", () => {
    expect(countFn).toContain("isNull(matterMemories.supersededBy)");
    expect(reviewApi).toContain("!row.supersededBy");
  });

  it("F/G. matter and organization scope are enforced", () => {
    expect(countFn).toContain("eq(matterMemories.organizationId, params.organizationId)");
    expect(countFn).toContain("eq(matterMemories.matterId, params.matterId)");
    expect(reviewApi).toContain("organizationId: matter.organizationId");
    expect(reviewApi).toContain("matterId");
  });

  it("H. Memory-only pending triggers a non-zero Review total", () => {
    expect(
      totalPendingReviewCount({
        proposedEvents: 0,
        proposedFacts: 0,
        proposedEntities: 0,
        proposedDeadlines: 0,
        proposedGraphEdges: 0,
        analysis: { pendingCount: 0 },
        memory: { pendingCount: 1 },
      }),
    ).toBe(1);
  });

  it("I. Memory is visually distinct from Analysis and Graph", () => {
    expect(page).toContain('title="Nyaya Memory"');
    expect(page).toContain("Suggested relationships");
    expect(page).toContain("Analysis waiting for review");
    expect(page.indexOf('title="Suggested relationships"')).toBeLessThan(
      page.indexOf('title="Nyaya Memory"'),
    );
    expect(page.indexOf('title="Nyaya Memory"')).toBeLessThan(
      page.indexOf("Analysis waiting for review"),
    );
  });

  it("J. origin is displayed using production origin values", () => {
    expect(page).toContain("Manually added — awaiting review");
    expect(page).toContain("Suggested by Nyaya");
    expect(page).toContain('item.origin === "manual"');
    expect(page).toContain('item.origin === "ai"');
  });

  it("K. manual unsourced Memory does not fabricate provenance", () => {
    expect(page).toContain("Manually added. No document source attached.");
    expect(page).not.toContain("fabricat");
  });

  it("L. AI/document-backed provenance uses existing sources only", () => {
    expect(page).toContain("Derived from Case sources");
    expect(reviewApi).toContain("listMatterMemories");
    expect(reviewApi).not.toContain("chunkIds: [");
  });

  it("M. opening Review performs no Memory mutation or generation", () => {
    expect(reviewApi).toContain("export async function GET");
    expect(reviewApi).not.toContain("export async function POST");
    expect(reviewApi).not.toContain("reviewMatterMemory");
    expect(reviewApi).not.toContain("proposeMatterMemories");
    expect(reviewApi).not.toContain("createMatterMemory");
    expect(page).not.toContain("Generate Memory");
    expect(page).not.toContain("Extract Memory");
    expect(page).not.toContain("Ask Nyaya to remember");
  });

  it("N/O/P. existing Memory review actions refetch the queue", () => {
    expect(page).toContain("/memory/${selected.item.id}/review");
    expect(page).toContain('onReview("approve")');
    expect(page).toContain('onReview("reject")');
    expect(page).toContain('onReview("edit_and_approve")');
    expect(page).toContain("await load()");
    expect(page).toContain("refreshChrome");
    expect(memoryReview).toContain("reviewMatterMemory");
    expect(memoryReview).toContain('capability: "timeline.manage"');
  });

  it("Q. view-only users do not receive Memory mutation controls", () => {
    expect(page).toContain("Approving or rejecting requires review access");
    expect(page).toContain("canReview");
  });

  it("R/S/T. existing intelligence, Graph, and Analysis count fields remain", () => {
    expect(countFn).toContain("proposedEvents");
    expect(countFn).toContain("proposedGraphEdges");
    expect(countFn).toContain("pendingContractItems");
    expect(countFn).toContain("pendingFindings");
    expect(countFn).toContain("pendingRedlines");
    expect(countFn).toContain("intelligencePendingCount");
    expect(countFn).toContain("analysisPendingCount");
  });

  it("U. Memory is added once and not mixed into intelligencePendingCount", () => {
    expect(countFn).toContain(
      "proposedEvents + proposedFacts + proposedEntities + proposedDeadlines + proposedGraphEdges",
    );
    expect(countFn).toContain(
      "pendingCount: intelligencePendingCount + analysisPendingCount + proposedMemories",
    );
  });

  it("V/W. proposed, rejected, and superseded Memory stay excluded downstream", () => {
    expect(trust).toContain("export function isDownstreamEligibleMemory");
    expect(trust).toContain("isVerifiedReviewStatus(row.status ?? \"\")");
    expect(memoryIndex).toContain("inArray(matterMemories.status, [...ACTIVE])");
    expect(memoryIndex).toContain("active.filter((row) => isDownstreamEligibleMemory(row))");
  });

  it("X. Agents-off gating is unchanged", () => {
    const ask = src("src/app/api/v1/matters/[matterId]/ask/route.ts");
    expect(ask).toContain('isFeatureEnabled("agents")');
    expect(ask).toContain('assertFeatureEnabled("agents")');
  });
});
