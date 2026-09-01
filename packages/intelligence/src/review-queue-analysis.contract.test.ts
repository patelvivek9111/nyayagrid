import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const queries = readFileSync(resolve(here, "queries.ts"), "utf8");
const evidence = readFileSync(resolve(here, "evidence/index.ts"), "utf8");

describe("getReviewQueueCounts Analysis contract", () => {
  const fn = queries.slice(
    queries.indexOf("export async function getReviewQueueCounts"),
    queries.indexOf("export async function listTimelineEvents"),
  );
  const list = queries.slice(queries.indexOf("export async function listProposedAnalysisForReview"));

  it("counts proposed Analysis objects separately from intelligence/Graph fields", () => {
    expect(fn).toContain("proposedEvents");
    expect(fn).toContain("proposedGraphEdges");
    expect(fn).toContain("intelligencePendingCount");
    expect(fn).toContain("pendingContractItems");
    expect(fn).toContain("pendingFindings");
    expect(fn).toContain("pendingRedlines");
    expect(fn).toContain("analysisPendingCount");
    expect(fn).toContain("eq(documentAnalysisItems.status, \"proposed\")");
    expect(fn).toContain("eq(analysisFindings.status, \"proposed\")");
    expect(fn).toContain("eq(redlineSuggestions.status, \"proposed\")");
    expect(fn).toContain("eq(documentAnalysisItems.organizationId, params.organizationId)");
    expect(fn).toContain("eq(documentAnalysisItems.matterId, params.matterId)");
    expect(fn).toContain("eq(analysisFindings.organizationId, params.organizationId)");
    expect(fn).toContain("eq(analysisFindings.matterId, params.matterId)");
    expect(fn).not.toContain("getEvidenceIntelligence");
    expect(fn).not.toContain("documentComparisons");
    expect(fn).not.toContain("document_comparison");
  });

  it("does not fold Analysis into the five intelligence counters", () => {
    expect(fn).toContain("intelligencePendingCount");
    expect(fn).toContain(
      "proposedEvents + proposedFacts + proposedEntities + proposedDeadlines + proposedGraphEdges",
    );
    expect(fn).toContain("pendingCount: intelligencePendingCount + analysisPendingCount + proposedMemories");
  });

  it("lists proposed Analysis for Review without generating or mutating", () => {
    expect(list).toContain("eq(documentAnalysisItems.status, \"proposed\")");
    expect(list).toContain("eq(analysisFindings.status, \"proposed\")");
    expect(list).not.toContain("analyzeContract");
    expect(list).not.toContain("reviewAnalysisItem");
    expect(list).not.toContain("reviewFinding(");
    expect(list).not.toContain("generateRedline");
  });

  it("does not treat Evidence Matrix derived rows as a second pending object", () => {
    expect(fn).not.toContain("EvidenceMatrix");
    expect(evidence).toContain("getEvidenceIntelligence");
  });
});
