import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const queries = readFileSync(resolve(here, "queries.ts"), "utf8");

describe("getReviewQueueCounts Graph contract", () => {
  it("counts proposed Graph edges with org + matter scope and proposed status only", () => {
    const fn = queries.slice(
      queries.indexOf("export async function getReviewQueueCounts"),
      queries.indexOf("export async function listTimelineEvents"),
    );
    expect(fn).toContain("graphEdges");
    expect(fn).toContain("proposedGraphEdges");
    expect(fn).toContain("pendingCount");
    expect(fn).toContain("eq(graphEdges.status, \"proposed\")");
    expect(fn).toContain("eq(graphEdges.organizationId, params.organizationId)");
    expect(fn).toContain("eq(graphEdges.matterId, params.matterId)");
    expect(fn).not.toContain("approved");
    expect(fn).not.toContain("edited_and_approved");
    expect(fn).not.toContain("rejected");
  });

  it("lists proposed Graph edges for Review without inventing sources", () => {
    const list = queries.slice(queries.indexOf("export async function listProposedIntelligence"));
    expect(list).toContain("graphEdgesProposed");
    expect(list).toContain("eq(graphEdges.status, \"proposed\")");
    expect(list).toContain("supportingText: s.supportingText");
    expect(list).toContain("documentTitle");
    expect(list).not.toContain("fabricat");
  });
});
