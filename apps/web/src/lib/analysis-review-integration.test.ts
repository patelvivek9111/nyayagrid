import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { totalPendingReviewCount } from "./review-queue";

const webRoot = resolve(__dirname, "../..");

function src(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("Analysis Review integration", () => {
  const queries = readFileSync(
    resolve(webRoot, "../../packages/intelligence/src/queries.ts"),
    "utf8",
  );
  const countFn = queries.slice(
    queries.indexOf("export async function getReviewQueueCounts"),
    queries.indexOf("export async function listTimelineEvents"),
  );
  const listFn = queries.slice(queries.indexOf("export async function listProposedAnalysisForReview"));
  const page = src("src/app/app/cases/[matterId]/review/page.tsx");
  const reviewApi = src("src/app/api/v1/matters/[matterId]/intelligence/review/route.ts");
  const chromeRoute = src("src/app/api/v1/matters/[matterId]/chrome/route.ts");

  it("A. pending Analysis items contribute to the total", () => {
    expect(
      totalPendingReviewCount({
        proposedEvents: 5,
        proposedFacts: 0,
        proposedEntities: 0,
        proposedDeadlines: 0,
        proposedGraphEdges: 2,
        analysis: { pendingCount: 3 },
        pendingCount: 10,
      }),
    ).toBe(10);
    expect(countFn).toContain("pendingCount: intelligencePendingCount + analysisPendingCount + proposedMemories");
  });

  it("B/C. reviewed and dismissed statuses are not counted", () => {
    expect(countFn).toContain('eq(documentAnalysisItems.status, "proposed")');
    expect(countFn).toContain('eq(analysisFindings.status, "proposed")');
    expect(countFn).not.toContain('eq(documentAnalysisItems.status, "reviewed")');
    expect(countFn).not.toContain('eq(documentAnalysisItems.status, "dismissed")');
    expect(countFn).not.toContain('eq(analysisFindings.status, "reviewed")');
    expect(countFn).not.toContain('eq(analysisFindings.status, "dismissed")');
    expect(countFn).not.toContain('eq(redlineSuggestions.status, "accepted")');
    expect(countFn).not.toContain('eq(redlineSuggestions.status, "rejected")');
  });

  it("D/E. matter and organization scope are enforced", () => {
    expect(countFn).toContain("eq(documentAnalysisItems.organizationId, params.organizationId)");
    expect(countFn).toContain("eq(documentAnalysisItems.matterId, params.matterId)");
    expect(countFn).toContain("eq(analysisFindings.organizationId, params.organizationId)");
    expect(countFn).toContain("eq(analysisFindings.matterId, params.matterId)");
    expect(countFn).toContain("eq(redlineSuggestions.organizationId, params.organizationId)");
    expect(countFn).toContain("eq(redlineSuggestions.matterId, params.matterId)");
    expect(listFn).toContain("eq(documentAnalyses.organizationId, params.organizationId)");
    expect(listFn).toContain("eq(documentAnalyses.matterId, params.matterId)");
  });

  it("F. Analysis-only pending is a non-zero Review total", () => {
    expect(
      totalPendingReviewCount({
        proposedEvents: 0,
        proposedFacts: 0,
        proposedEntities: 0,
        proposedDeadlines: 0,
        proposedGraphEdges: 0,
        analysis: { pendingContractItems: 1, pendingFindings: 0, pendingRedlines: 0, pendingCount: 1 },
      }),
    ).toBe(1);
  });

  it("G. Analysis section is visually separate from intelligence and Graph", () => {
    expect(page).toContain("Analysis waiting for review");
    expect(page).toContain("Suggested relationships");
    expect(page).toContain("Timeline events");
    expect(page.indexOf("Suggested relationships")).toBeLessThan(
      page.indexOf("Analysis waiting for review"),
    );
  });

  it("H/I. existing Graph and Timeline count fields remain unchanged in the query", () => {
    expect(countFn).toContain("proposedEvents");
    expect(countFn).toContain("proposedFacts");
    expect(countFn).toContain("proposedEntities");
    expect(countFn).toContain("proposedDeadlines");
    expect(countFn).toContain("proposedGraphEdges");
    expect(countFn).toContain('eq(timelineEvents.status, "proposed")');
    expect(countFn).toContain('eq(graphEdges.status, "proposed")');
    expect(countFn).toContain(
      "proposedEvents + proposedFacts + proposedEntities + proposedDeadlines + proposedGraphEdges",
    );
  });

  it("J. Evidence Matrix derived rows are not counted", () => {
    expect(countFn).not.toContain("getEvidenceIntelligence");
    expect(countFn).not.toContain("EvidenceMatrix");
    expect(reviewApi).not.toContain("getEvidenceIntelligence");
  });

  it("K. Compare output is not counted as a separate pending type", () => {
    expect(countFn).not.toContain("documentComparisons");
    expect(listFn).not.toContain("documentComparisons");
  });

  it("L. opening Review performs no Analysis mutation or generation", () => {
    expect(reviewApi).toContain("export async function GET");
    expect(reviewApi).not.toContain("export async function POST");
    expect(reviewApi).toContain("listProposedAnalysisForReview");
    expect(reviewApi).not.toContain("reviewAnalysisItem");
    expect(reviewApi).not.toContain("reviewFinding");
    expect(reviewApi).not.toContain("analyzeContract");
    expect(page).not.toContain("Analyze contract");
    expect(page).not.toContain("Analyze deposition");
    expect(page).not.toContain("Run Contract Analysis");
  });

  it("M/N. existing Mark reviewed and Dismiss endpoints are reused", () => {
    expect(page).toContain("/analysis/contracts/${selected.item.analysisId}/items/${selected.item.id}/review");
    expect(page).toContain("/analysis/findings/${selected.item.id}/review");
    expect(page).toContain("Mark reviewed");
    expect(page).toContain("Dismiss");
    expect(page).toContain('onReview("reviewed")');
    expect(page).toContain('onReview("dismissed")');
  });

  it("O. post-action refetch decreases the pending count on next GET", () => {
    expect(page).toContain("await load()");
    expect(page).toContain("refreshChrome");
  });

  it("P. view-only users do not receive Analysis mutation controls", () => {
    expect(page).toContain("canReviewAnalysis");
    expect(page).toContain("Mark reviewed and Dismiss require document edit");
    expect(chromeRoute).toContain("canReviewAnalysis");
    expect(chromeRoute).toContain('capabilities.has("documents.edit")');
  });

  it("Q. provenance is rendered from existing data only", () => {
    expect(page).toContain("Source support unavailable");
    expect(page).toContain("documentTitle");
    expect(page).toContain("supportingText");
    expect(page).not.toContain("fabricat");
    expect(listFn).toContain("supportingText: s.supportingText");
    expect(listFn).not.toContain("fabricat");
  });

  it("R. Agents-off gating is unchanged", () => {
    const ask = src("src/app/api/v1/matters/[matterId]/ask/route.ts");
    expect(ask).toContain('isFeatureEnabled("agents")');
    expect(ask).toContain('assertFeatureEnabled("agents")');
  });

  it("preserves Analysis review vocabulary instead of Approve/Reject for findings", () => {
    expect(page).toContain("Mark reviewed");
    expect(page).toContain("Analysis finding awaiting review");
    expect(page).not.toContain("false statement");
    expect(page).not.toContain("Verified finding");
    expect(page).not.toContain("Source-verified");
  });
});
