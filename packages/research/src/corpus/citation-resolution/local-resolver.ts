/**
 * HIGH-confidence local identity resolver.
 * MEDIUM/LOW never auto-resolve. Ambiguous → NO_AUTO_RESOLVE.
 */

import { LocalAuthorityIndex } from "./local-index.js";
import type { LocalResolveProposal, UnresolvedTarget } from "./types.js";

export type LocalResolveDryRun = {
  proposals: LocalResolveProposal[];
  highTargets: number;
  highEdges: number;
  ambiguousSkipped: number;
  noMatch: number;
  mediumSkipped: number;
};

/**
 * Produce auto-apply proposals for HIGH confidence only.
 * Reproduces the diagnostic contract: exactly one authority, no competing targets.
 */
export function dryRunLocalHighResolver(
  targets: UnresolvedTarget[],
  index: LocalAuthorityIndex,
): LocalResolveDryRun {
  const proposals: LocalResolveProposal[] = [];
  let ambiguousSkipped = 0;
  let noMatch = 0;
  let mediumSkipped = 0;

  for (const t of targets) {
    const hit = index.lookupCitation(t.representativeRaw, t.normalizedCitation);
    if (hit.kind === "zero") {
      noMatch += 1;
      continue;
    }
    if (hit.kind === "ambiguous") {
      ambiguousSkipped += 1;
      continue;
    }

    // Only HIGH auto-resolve methods from local index
    const highMethods = new Set(["LOCAL_EXACT", "LOCAL_NORMALIZED", "LOCAL_ALIAS", "LOCAL_PARALLEL", "COURTLISTENER_CLUSTER"]);
    if (!highMethods.has(hit.method)) {
      mediumSkipped += 1;
      continue;
    }

    proposals.push({
      targetKey: t.targetKey,
      toAuthorityId: hit.authorityId,
      method: hit.method,
      confidence: "HIGH",
      evidence: hit.evidence,
      edgeIds: t.edgeIds,
      edgeCount: t.edgeCount,
      rawCitation: t.representativeRaw,
      normalizedCitation: t.normalizedCitation,
    });
  }

  const highEdges = proposals.reduce((s, p) => s + p.edgeCount, 0);
  return {
    proposals,
    highTargets: proposals.length,
    highEdges,
    ambiguousSkipped,
    noMatch,
    mediumSkipped,
  };
}

/** Plan edge backfill IDs from a set of HIGH proposals (idempotent set). */
export function planBackfillFromProposals(proposals: LocalResolveProposal[]): {
  edgeIds: string[];
  byAuthority: Map<string, string[]>;
  edgesBackfillable: number;
} {
  const edgeIds: string[] = [];
  const byAuthority = new Map<string, string[]>();
  for (const p of proposals) {
    if (p.confidence !== "HIGH") continue;
    const list = byAuthority.get(p.toAuthorityId) || [];
    for (const id of p.edgeIds) {
      edgeIds.push(id);
      list.push(id);
    }
    byAuthority.set(p.toAuthorityId, list);
  }
  return { edgeIds: [...new Set(edgeIds)], byAuthority, edgesBackfillable: new Set(edgeIds).size };
}
