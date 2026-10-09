/**
 * Unique unresolved-target queue: collapse edges → canonical target keys.
 */

import {
  experimentalNormalize,
  isLookupSuitableCitation,
  normalizeCitationWhitespace,
  parseVolReporterPage,
  targetKey,
} from "./normalize.js";
import { LocalAuthorityIndex } from "./local-index.js";
import type { LocalMatchBucket, UnresolvedEdgeRow, UnresolvedTarget } from "./types.js";

function toIso(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

function matchBucket(index: LocalAuthorityIndex, raw: string, norm: string): LocalMatchBucket {
  const hit = index.lookupCitation(raw, norm);
  if (hit.kind === "zero") return "NO_LOCAL_MATCH";
  if (hit.kind === "ambiguous") return "ALREADY_PRESENT_AMBIGUOUS";
  if (hit.method === "LOCAL_EXACT") return "ALREADY_PRESENT_EXACT";
  if (hit.method === "LOCAL_PARALLEL") return "ALREADY_PRESENT_PARALLEL";
  return "ALREADY_PRESENT_ALIAS";
}

/**
 * Priority: demand + jurisdiction relevance + lookup suitability.
 * Does not prioritize merely by age.
 */
export function scoreUnresolvedTarget(t: {
  edgeCount: number;
  uniqueCitingCases: number;
  jurisdictions: string[];
  reporter: string | null;
  lookupSuitable: boolean;
  localCandidateStatus: LocalMatchBucket;
}): number {
  let score = 0;
  score += Math.min(40, t.edgeCount * 2);
  score += Math.min(25, t.uniqueCitingCases * 1.5);
  const j = t.jurisdictions.join(" ").toLowerCase();
  if (/us-ca-3|ca3|third/.test(j)) score += 18;
  if (/us-d-pa|paed|edpa|pennsylvania|st-pa/.test(j)) score += 14;
  if (/us-scotus|scotus/.test(j)) score += 10;
  if (/us-ca-|circuit/.test(j)) score += 8;
  if (/^U\.S\.|^S\. Ct|^F\.|^F\. Supp/i.test(t.reporter || "")) score += 10;
  if (t.lookupSuitable) score += 12;
  if (t.localCandidateStatus === "ALREADY_PRESENT_EXACT" || t.localCandidateStatus === "ALREADY_PRESENT_ALIAS") {
    score += 30; // cheap local win
  }
  if (t.localCandidateStatus === "ALREADY_PRESENT_AMBIGUOUS") score -= 20;
  return Math.round(score * 10) / 10;
}

export function buildUnresolvedTargetQueue(
  edges: UnresolvedEdgeRow[],
  index: LocalAuthorityIndex,
): {
  targets: UnresolvedTarget[];
  unresolvedEdges: number;
  uniqueTargets: number;
  dedupRatio: number;
  lookupSuitable: number;
} {
  type Acc = {
    targetKey: string;
    representativeRaw: string;
    normalizedCitation: string;
    edgeIds: string[];
    citing: Set<string>;
    jurisdictions: Set<string>;
    firstSeen: string | null;
    lastSeen: string | null;
  };

  const acc = new Map<string, Acc>();

  for (const e of edges) {
    const raw = e.rawCitation || "";
    const norm = e.normalizedCitation || "";
    const key = targetKey(raw, norm);
    const lean = experimentalNormalize(norm || raw) || normalizeCitationWhitespace(norm || raw);
    let row = acc.get(key);
    if (!row) {
      row = {
        targetKey: key,
        representativeRaw: raw || lean,
        normalizedCitation: lean,
        edgeIds: [],
        citing: new Set(),
        jurisdictions: new Set(),
        firstSeen: null,
        lastSeen: null,
      };
      acc.set(key, row);
    }
    row.edgeIds.push(e.id);
    if (e.fromAuthorityId) row.citing.add(e.fromAuthorityId);
    const court = e.fromCourtId || e.fromCourt;
    if (court) row.jurisdictions.add(String(court));
    const ts = toIso(e.createdAt);
    if (ts) {
      if (!row.firstSeen || ts < row.firstSeen) row.firstSeen = ts;
      if (!row.lastSeen || ts > row.lastSeen) row.lastSeen = ts;
    }
  }

  const targets: UnresolvedTarget[] = [];
  for (const row of acc.values()) {
    const p = parseVolReporterPage(row.normalizedCitation);
    const localCandidateStatus = matchBucket(index, row.representativeRaw, row.normalizedCitation);
    const lookupSuitable = isLookupSuitableCitation(row.normalizedCitation);
    const base = {
      edgeCount: row.edgeIds.length,
      uniqueCitingCases: row.citing.size,
      jurisdictions: [...row.jurisdictions],
      reporter: p?.reporter ?? null,
      lookupSuitable,
      localCandidateStatus,
    };
    targets.push({
      targetKey: row.targetKey,
      representativeRaw: row.representativeRaw,
      normalizedCitation: row.normalizedCitation,
      edgeCount: base.edgeCount,
      uniqueCitingCases: base.uniqueCitingCases,
      jurisdictions: base.jurisdictions,
      reporter: base.reporter,
      volume: p?.volume ?? null,
      page: p?.page ?? null,
      year: null,
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
      localCandidateStatus,
      externalLookupStatus: "NOT_STARTED",
      resolvedAuthorityId: null,
      resolutionConfidence: null,
      fullTextStatus: "UNKNOWN",
      priorityScore: scoreUnresolvedTarget(base),
      edgeIds: row.edgeIds,
      lookupSuitable,
    });
  }

  targets.sort((a, b) => b.priorityScore - a.priorityScore || b.edgeCount - a.edgeCount);

  const unresolvedEdges = edges.length;
  const uniqueTargets = targets.length;
  return {
    targets,
    unresolvedEdges,
    uniqueTargets,
    dedupRatio: uniqueTargets > 0 ? unresolvedEdges / uniqueTargets : 0,
    lookupSuitable: targets.filter((t) => t.lookupSuitable).length,
  };
}

/** Chunk unique targets for external identity batches. Default 1 text/request unless caller raises. */
export function chunkTargetsForBatch<T>(items: T[], batchSize: number): T[][] {
  const size = Math.max(1, Math.floor(batchSize));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
