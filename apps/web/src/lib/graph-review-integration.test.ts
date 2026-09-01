import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { totalPendingReviewCount } from "./review-queue";

const webRoot = resolve(__dirname, "../..");

function src(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("Graph Review integration", () => {
  it("proposed Graph edges increment pending count; other statuses are not in the helper", () => {
    expect(totalPendingReviewCount({ proposedGraphEdges: 1 })).toBe(1);
    expect(totalPendingReviewCount({ proposedEvents: 2, proposedGraphEdges: 1 })).toBe(3);
    expect(totalPendingReviewCount({ pendingCount: 0, proposedGraphEdges: 9 })).toBe(0);
  });

  it("Graph-only pending is non-zero; all-zero is zero", () => {
    expect(
      totalPendingReviewCount({
        proposedEvents: 0,
        proposedFacts: 0,
        proposedEntities: 0,
        proposedDeadlines: 0,
        proposedGraphEdges: 2,
      }),
    ).toBe(2);
    expect(
      totalPendingReviewCount({
        proposedEvents: 0,
        proposedFacts: 0,
        proposedEntities: 0,
        proposedDeadlines: 0,
        proposedGraphEdges: 0,
      }),
    ).toBe(0);
  });

  it("Review page lists Graph, inspects provenance, and does not fabricate sources", () => {
    const page = src("src/app/app/cases/[matterId]/review/page.tsx");
    expect(page).toContain("Suggested relationships");
    expect(page).toContain("Confirm only if the cited source supports this relationship");
    expect(page).toContain("Manually added relationship. No document support is stored.");
    expect(page).toContain("/graph/edges/${selected.item.id}/review");
    expect(page).toContain("documentTitle");
    expect(page).not.toContain("Source-verified relationship");
    expect(page).not.toContain("Verified relationship");
  });

  it("approve and reject refetch the queue (count decreases on next GET)", () => {
    const page = src("src/app/app/cases/[matterId]/review/page.tsx");
    expect(page).toContain('review("approve")');
    expect(page).toContain('review("reject")');
    expect(page).toContain("await load()");
    expect(page).toContain("refreshChrome");
  });

  it("view-only users cannot approve or reject Graph from Review", () => {
    const page = src("src/app/app/cases/[matterId]/review/page.tsx");
    expect(page).toContain("canReview");
    expect(page).toContain("Approving or rejecting these suggestions requires review");
  });

  it("Review queue GET does not alter Graph edge status", () => {
    const reviewApi = src("src/app/api/v1/matters/[matterId]/intelligence/review/route.ts");
    expect(reviewApi).toContain("export async function GET");
    expect(reviewApi).not.toContain("export async function POST");
    expect(reviewApi).toContain("listProposedIntelligence");
    expect(reviewApi).not.toContain("reviewGraphEdge");
  });

  it("existing Timeline/Facts/People/Deadlines counts remain in the query", () => {
    const queries = readFileSync(
      resolve(webRoot, "../../packages/intelligence/src/queries.ts"),
      "utf8",
    );
    const fn = queries.slice(
      queries.indexOf("export async function getReviewQueueCounts"),
      queries.indexOf("export async function listTimelineEvents"),
    );
    expect(fn).toContain("proposedEvents");
    expect(fn).toContain("proposedFacts");
    expect(fn).toContain("proposedEntities");
    expect(fn).toContain("proposedDeadlines");
    expect(fn).toContain("proposedGraphEdges");
    expect(fn).toContain('eq(timelineEvents.status, "proposed")');
    expect(fn).toContain('eq(graphEdges.status, "proposed")');
    expect(fn).toContain("eq(graphEdges.matterId, params.matterId)");
  });

  it("Home still uses a generic suggestions CTA powered by the shared pending total", () => {
    const home = src("src/app/app/cases/[matterId]/page.tsx");
    expect(home).toContain("totalPendingReviewCount(reviewCounts)");
    expect(home).toContain("items waiting for review");
  });

  it("Agent-disabled Ask gating remains in place", () => {
    const ask = src("src/app/api/v1/matters/[matterId]/ask/route.ts");
    expect(ask).toContain('isFeatureEnabled("agents")');
  });
});
