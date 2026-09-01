import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const queries = readFileSync(resolve(here, "queries.ts"), "utf8");
const memoryIndex = readFileSync(resolve(here, "memory/index.ts"), "utf8");
const memoryTrust = readFileSync(resolve(here, "memory/trust.ts"), "utf8");

describe("getReviewQueueCounts Memory contract", () => {
  const fn = queries.slice(
    queries.indexOf("export async function getReviewQueueCounts"),
    queries.indexOf("export async function listTimelineEvents"),
  );

  it("counts proposed Memory separately from intelligence and Analysis", () => {
    expect(fn).toContain("proposedEvents");
    expect(fn).toContain("proposedGraphEdges");
    expect(fn).toContain("intelligencePendingCount");
    expect(fn).toContain("analysisPendingCount");
    expect(fn).toContain("proposedMemories");
    expect(fn).toContain("memory:");
    expect(fn).toContain('eq(matterMemories.status, "proposed")');
    expect(fn).toContain("eq(matterMemories.organizationId, params.organizationId)");
    expect(fn).toContain("eq(matterMemories.matterId, params.matterId)");
    expect(fn).toContain("isNull(matterMemories.supersededBy)");
    expect(fn).toContain(
      "pendingCount: intelligencePendingCount + analysisPendingCount + proposedMemories",
    );
  });

  it("does not fold Memory into the five intelligence counters", () => {
    expect(fn).toContain(
      "proposedEvents + proposedFacts + proposedEntities + proposedDeadlines + proposedGraphEdges",
    );
    expect(fn).not.toContain("proposedMemories + proposedEvents");
  });
});

describe("Memory downstream trust remains frozen (read-only)", () => {
  it("proposed Memory is still excluded from trusted downstream context", () => {
    expect(memoryTrust).toContain("export function isDownstreamEligibleMemory");
    expect(memoryTrust).toContain("isVerifiedReviewStatus(row.status ?? \"\")");
    expect(memoryIndex).toContain("inArray(matterMemories.status, [...ACTIVE])");
    expect(memoryIndex).toContain("isNull(matterMemories.supersededBy)");
    expect(memoryIndex).toContain("active.filter((row) => isDownstreamEligibleMemory(row))");
  });

  it("retrieveActiveMatterMemories still uses approved statuses only", () => {
    expect(memoryIndex).toContain('const ACTIVE = ["approved", "edited_and_approved"] as const;');
    const retrieve = memoryIndex.slice(
      memoryIndex.indexOf("export async function retrieveActiveMatterMemories"),
      memoryIndex.indexOf("export function formatActiveMemoryForPrompt"),
    );
    expect(retrieve).toContain("inArray(matterMemories.status, [...ACTIVE])");
    expect(retrieve).toContain("isDownstreamEligibleMemory");
    expect(retrieve).not.toContain('eq(matterMemories.status, "proposed")');
  });
});
