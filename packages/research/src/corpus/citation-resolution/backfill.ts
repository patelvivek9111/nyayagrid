/**
 * Global backfill: one AUTHORITY_RESOLVED identity → all matching unresolved edges.
 * Idempotent planning — does not mutate.
 */

import { targetKey } from "./normalize.js";
import type { LocalResolveProposal, UnresolvedEdgeRow } from "./types.js";

export type BackfillPlanItem = {
  edgeId: string;
  fromAuthorityId: string;
  rawCitation: string;
  normalizedCitation: string | null;
  targetKey: string;
  toAuthorityId: string;
  method: LocalResolveProposal["method"];
  confidence: "HIGH";
};

export type BackfillPlan = {
  items: BackfillPlanItem[];
  uniqueTargets: number;
  edgesPlanned: number;
  /** Edges already pointing at the same authority would be no-ops (caller filters unresolved). */
  idempotentSafe: true;
};

/**
 * Given resolved target→authority mappings, plan updates for every unresolved edge
 * whose deterministic target key matches.
 */
export function planGlobalBackfill(
  unresolvedEdges: UnresolvedEdgeRow[],
  resolutions: Array<{
    targetKey: string;
    toAuthorityId: string;
    method: LocalResolveProposal["method"];
  }>,
): BackfillPlan {
  const byKey = new Map<string, { toAuthorityId: string; method: LocalResolveProposal["method"] }>();
  for (const r of resolutions) {
    // First HIGH mapping wins; do not overwrite with a different authority
    if (!byKey.has(r.targetKey)) {
      byKey.set(r.targetKey, { toAuthorityId: r.toAuthorityId, method: r.method });
    } else if (byKey.get(r.targetKey)!.toAuthorityId !== r.toAuthorityId) {
      // Competing mappings for same key → skip entirely (NO_AUTO_RESOLVE)
      byKey.delete(r.targetKey);
    }
  }

  const items: BackfillPlanItem[] = [];
  for (const e of unresolvedEdges) {
    const key = targetKey(e.rawCitation, e.normalizedCitation);
    const hit = byKey.get(key);
    if (!hit) continue;
    items.push({
      edgeId: e.id,
      fromAuthorityId: e.fromAuthorityId,
      rawCitation: e.rawCitation || "",
      normalizedCitation: e.normalizedCitation,
      targetKey: key,
      toAuthorityId: hit.toAuthorityId,
      method: hit.method,
      confidence: "HIGH",
    });
  }

  return {
    items,
    uniqueTargets: byKey.size,
    edgesPlanned: items.length,
    idempotentSafe: true,
  };
}

/** Demand-driven full-text acquisition candidates (separate from identity). */
export function selectDemandFullTextTargets(
  targets: Array<{
    targetKey: string;
    edgeCount: number;
    lookupSuitable: boolean;
    localCandidateStatus: string;
    reporter: string | null;
    jurisdictions: string[];
  }>,
  opts: { minEdges?: number } = {},
): string[] {
  const minEdges = opts.minEdges ?? 3;
  return targets
    .filter((t) => {
      if (t.localCandidateStatus !== "NO_LOCAL_MATCH") return false;
      if (!t.lookupSuitable) return false;
      if (t.edgeCount < minEdges) return false;
      const rep = t.reporter || "";
      return /^U\.S\.|^F\.|^F\.Supp|^S\. Ct/i.test(rep);
    })
    .map((t) => t.targetKey);
}
