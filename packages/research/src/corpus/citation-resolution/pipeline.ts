/**
 * Future ingestion integration: local-first → unique-target queue → external identity → backfill.
 * External lookup is never per-edge.
 */

import { planGlobalBackfill } from "./backfill.js";
import { LocalAuthorityIndex } from "./local-index.js";
import { dryRunLocalHighResolver } from "./local-resolver.js";
import { metricsForNewCaseBatch } from "./metrics.js";
import { experimentalNormalize, targetKey } from "./normalize.js";
import { buildUnresolvedTargetQueue } from "./target-queue.js";
import type {
  AntiRegressionMetrics,
  AuthorityIndexRow,
  LocalResolveProposal,
  ResolutionMethod,
  UnresolvedEdgeRow,
} from "./types.js";

export type IngestCitationInput = {
  fromAuthorityId: string;
  rawCitation: string;
  normalizedCitation?: string | null;
  edgeId?: string;
};

export type IngestResolveResult = {
  edge: UnresolvedEdgeRow & { toAuthorityId: string | null; method: ResolutionMethod | null; confidence: "HIGH" | null };
  unresolvedForQueue: boolean;
};

/**
 * Local-first resolution for newly extracted citations (in-memory).
 * Does not call CourtListener.
 */
export function resolveNewCitationsLocalFirst(
  citations: IngestCitationInput[],
  authorities: AuthorityIndexRow[],
): {
  results: IngestResolveResult[];
  unresolvedEdges: UnresolvedEdgeRow[];
  proposals: LocalResolveProposal[];
  metrics: AntiRegressionMetrics;
} {
  const index = new LocalAuthorityIndex(authorities);
  const results: IngestResolveResult[] = [];
  const unresolvedEdges: UnresolvedEdgeRow[] = [];
  const byMethod: Partial<Record<ResolutionMethod, number>> = {};

  for (let i = 0; i < citations.length; i++) {
    const c = citations[i]!;
    const norm = c.normalizedCitation ?? experimentalNormalize(c.rawCitation);
    const edgeId = c.edgeId ?? `new-${i}`;
    const hit = index.lookupCitation(c.rawCitation, norm);
    if (hit.kind === "one") {
      byMethod[hit.method] = (byMethod[hit.method] ?? 0) + 1;
      results.push({
        edge: {
          id: edgeId,
          fromAuthorityId: c.fromAuthorityId,
          rawCitation: c.rawCitation,
          normalizedCitation: norm,
          toAuthorityId: hit.authorityId,
          method: hit.method,
          confidence: "HIGH",
        },
        unresolvedForQueue: false,
      });
    } else {
      const row: UnresolvedEdgeRow = {
        id: edgeId,
        fromAuthorityId: c.fromAuthorityId,
        rawCitation: c.rawCitation,
        normalizedCitation: norm,
      };
      unresolvedEdges.push(row);
      results.push({
        edge: { ...row, toAuthorityId: null, method: null, confidence: null },
        unresolvedForQueue: true,
      });
    }
  }

  const queue = buildUnresolvedTargetQueue(unresolvedEdges, index);
  const local = dryRunLocalHighResolver(queue.targets, index);
  const metrics = metricsForNewCaseBatch({
    newEdgesTotal: citations.length,
    byMethod,
    uniqueUnresolvedTargets: queue.uniqueTargets,
    oldEdgesBackfilled: 0,
    authoritiesResolvedWithoutAcquisition: 0,
    fullTextAcquisitions: 0,
    externalLookups: 0,
    externalLookupsAvoided: Math.max(0, unresolvedEdges.length - queue.uniqueTargets),
    newCases: 1,
  });

  return { results, unresolvedEdges, proposals: local.proposals, metrics };
}

/**
 * After identity becomes known, plan corpus-wide backfill for matching target keys.
 */
export function planBackfillAfterIdentity(
  allUnresolvedEdges: UnresolvedEdgeRow[],
  resolved: Array<{ targetKey: string; toAuthorityId: string; method: ResolutionMethod }>,
) {
  return planGlobalBackfill(allUnresolvedEdges, resolved);
}

export function edgeTargetKey(raw: string | null, normalized: string | null): string {
  return targetKey(raw, normalized);
}
