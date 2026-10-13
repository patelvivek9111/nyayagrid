/**
 * Deterministic ambiguous-citation disambiguation from LOCAL citing context.
 * No API. No fuzzy auto-resolve. Supports target-level and edge-level collision splits.
 */

import { experimentalNormalize } from "./normalize.js";
import {
  extractCaptionBeforeCitation,
  normalizeCaseCaption,
  type ClusterMetaCandidate,
} from "./ambiguous-metadata-resolver.js";

export type CitingContextStatus =
  | "RESOLVED_BY_EXACT_CASE_NAME_CONTEXT"
  | "RESOLVED_BY_NORMALIZED_CASE_NAME_CONTEXT"
  | "RESOLVED_BY_CONTEXT_PARALLELS"
  | "RESOLVED_BY_SAME_OPINION_CONTEXT"
  | "RESOLVED_BY_CROSS_CITER_CONSENSUS"
  | "RESOLVED_BY_SIBLING_RESOLVED_CLUSTER"
  | "TRUE_COLLISION"
  | "STILL_AMBIGUOUS"
  | "CONTEXT_INSUFFICIENT";

export type EdgeContextEvidence = {
  edgeId: string;
  fromAuthorityId: string | null;
  rawCitation: string;
  normalizedCitation: string;
  /** Other citation strings in the same citing opinion (normalized lowercase) */
  siblingCitationNorms: string[];
  /** Cluster IDs already resolved from sibling edges in the same opinion */
  siblingResolvedClusterIds: string[];
  /** Optional caption extracted from this edge's raw citation */
  captionNorm?: string | null;
};

export type EdgeContextResolution = {
  edgeId: string;
  status: CitingContextStatus;
  clusterId: string | null;
  reason: string;
  scope: "edge" | "none";
};

export type TargetContextResolution = {
  status: CitingContextStatus;
  clusterId: string | null;
  reason: string;
  scope: "target" | "edge_split" | "none";
  edgeResolutions: EdgeContextResolution[];
  /** When TRUE_COLLISION: distinct clusters supported by different edges */
  collidingClusterIds: string[];
};

function candidateNameNorms(c: ClusterMetaCandidate): Set<string> {
  const out = new Set<string>();
  for (const v of [c.caseNameNormalized, c.caseName, c.caseNameFull, c.caseNameShort]) {
    const n = normalizeCaseCaption(v);
    if (n) out.add(n);
  }
  return out;
}

function parallelNormSet(c: ClusterMetaCandidate): Set<string> {
  const out = new Set<string>();
  for (const p of c.parallelCitations || []) {
    const lean = experimentalNormalize(p) || p;
    if (lean) out.add(lean.toLowerCase());
  }
  return out;
}

export function isDeterministicCitingContextStatus(status: CitingContextStatus): boolean {
  return (
    status === "RESOLVED_BY_EXACT_CASE_NAME_CONTEXT" ||
    status === "RESOLVED_BY_NORMALIZED_CASE_NAME_CONTEXT" ||
    status === "RESOLVED_BY_CONTEXT_PARALLELS" ||
    status === "RESOLVED_BY_SAME_OPINION_CONTEXT" ||
    status === "RESOLVED_BY_CROSS_CITER_CONSENSUS" ||
    status === "RESOLVED_BY_SIBLING_RESOLVED_CLUSTER"
  );
}

/**
 * Resolve a single citation occurrence using only that occurrence's local context.
 */
export function resolveEdgeCitingContext(input: {
  edge: EdgeContextEvidence;
  candidates: ClusterMetaCandidate[];
  /** Target VRP normalized forms to ignore when matching sibling parallels */
  targetCitationNorms?: string[];
}): EdgeContextResolution {
  const candidates = input.candidates.filter((c) => c.clusterId);
  const edge = input.edge;
  if (candidates.length <= 1) {
    return {
      edgeId: edge.edgeId,
      status: candidates.length === 1 ? "RESOLVED_BY_SAME_OPINION_CONTEXT" : "CONTEXT_INSUFFICIENT",
      clusterId: candidates[0]?.clusterId ?? null,
      reason: candidates.length === 1 ? "single_candidate" : "no_candidates",
      scope: candidates.length === 1 ? "edge" : "none",
    };
  }

  const targetNorms = new Set(
    (input.targetCitationNorms || [edge.rawCitation, edge.normalizedCitation])
      .map((c) => (experimentalNormalize(c) || c || "").toLowerCase())
      .filter(Boolean),
  );

  // 1. Case-name caption on this edge
  const captionRaw = extractCaptionBeforeCitation(edge.rawCitation);
  const captionExact = captionRaw ? String(captionRaw).trim() : null;
  const captionNorm = edge.captionNorm || normalizeCaseCaption(captionRaw);
  if (captionExact) {
    const exactHits = candidates.filter((c) =>
      [c.caseName, c.caseNameFull, c.caseNameShort].some((n) => n && String(n).trim() === captionExact),
    );
    if (exactHits.length === 1) {
      return {
        edgeId: edge.edgeId,
        status: "RESOLVED_BY_EXACT_CASE_NAME_CONTEXT",
        clusterId: String(exactHits[0]!.clusterId),
        reason: "exact_case_name_caption",
        scope: "edge",
      };
    }
  }
  if (captionNorm) {
    const normHits = candidates.filter((c) => candidateNameNorms(c).has(captionNorm));
    if (normHits.length === 1) {
      return {
        edgeId: edge.edgeId,
        status: "RESOLVED_BY_NORMALIZED_CASE_NAME_CONTEXT",
        clusterId: String(normHits[0]!.clusterId),
        reason: "normalized_case_name_caption",
        scope: "edge",
      };
    }
  }

  // 2. Sibling already resolved to one of the candidate clusters
  const sibResolved = [...new Set(edge.siblingResolvedClusterIds.map(String))];
  const resolvedHits = candidates.filter((c) => sibResolved.includes(String(c.clusterId)));
  if (resolvedHits.length === 1) {
    return {
      edgeId: edge.edgeId,
      status: "RESOLVED_BY_SIBLING_RESOLVED_CLUSTER",
      clusterId: String(resolvedHits[0]!.clusterId),
      reason: "same_opinion_resolved_cluster",
      scope: "edge",
    };
  }

  // 3. Sibling citation strings match parallels of exactly one candidate
  const sibling = edge.siblingCitationNorms
    .map((s) => s.toLowerCase())
    .filter((s) => s && !targetNorms.has(s));
  const parallelOwners: string[] = [];
  for (const c of candidates) {
    const pars = parallelNormSet(c);
    let hit = false;
    for (const s of sibling) {
      if (pars.has(s)) {
        hit = true;
        break;
      }
    }
    if (hit) parallelOwners.push(String(c.clusterId));
  }
  const uniqueOwners = [...new Set(parallelOwners)];
  if (uniqueOwners.length === 1) {
    return {
      edgeId: edge.edgeId,
      status: "RESOLVED_BY_CONTEXT_PARALLELS",
      clusterId: uniqueOwners[0]!,
      reason: "same_opinion_sibling_parallel_unique",
      scope: "edge",
    };
  }

  if (uniqueOwners.length > 1) {
    return {
      edgeId: edge.edgeId,
      status: "STILL_AMBIGUOUS",
      clusterId: null,
      reason: "sibling_parallels_hit_multiple_candidates",
      scope: "none",
    };
  }

  return {
    edgeId: edge.edgeId,
    status: "CONTEXT_INSUFFICIENT",
    clusterId: null,
    reason: "no_deterministic_citing_context",
    scope: "none",
  };
}

/**
 * Aggregate edge-level evidence into target-level or edge-split collision resolution.
 */
export function resolveTargetCitingContext(input: {
  candidates: ClusterMetaCandidate[];
  edges: EdgeContextEvidence[];
  targetCitationNorms?: string[];
}): TargetContextResolution {
  const edgeResolutions = input.edges.map((edge) =>
    resolveEdgeCitingContext({
      edge,
      candidates: input.candidates,
      targetCitationNorms: input.targetCitationNorms,
    }),
  );

  const decisive = edgeResolutions.filter((e) => isDeterministicCitingContextStatus(e.status) && e.clusterId);
  if (decisive.length === 0) {
    const anyAmb = edgeResolutions.some((e) => e.status === "STILL_AMBIGUOUS");
    return {
      status: anyAmb ? "STILL_AMBIGUOUS" : "CONTEXT_INSUFFICIENT",
      clusterId: null,
      reason: anyAmb ? "edges_ambiguous_without_unique_context" : "no_edge_had_deterministic_context",
      scope: "none",
      edgeResolutions,
      collidingClusterIds: [],
    };
  }

  const clusters = [...new Set(decisive.map((e) => String(e.clusterId)))];

  // Same-opinion propagation: if one edge in an opinion resolved, other edges of same opinion
  // without their own evidence can inherit — handled by caller applying edge resolutions;
  // here we only classify target vs collision.

  if (clusters.length === 1) {
    const id = clusters[0]!;
    const methods = new Set(decisive.map((e) => e.status));
    let status: CitingContextStatus = "RESOLVED_BY_CROSS_CITER_CONSENSUS";
    let reason = "all_decisive_edges_agree";
    if (decisive.length === 1 && input.edges.length === 1) {
      status = decisive[0]!.status;
      reason = decisive[0]!.reason;
    } else if (methods.size === 1 && methods.has("RESOLVED_BY_CONTEXT_PARALLELS")) {
      status = "RESOLVED_BY_CONTEXT_PARALLELS";
      reason = "context_parallels_agree_across_edges";
    } else if (methods.size === 1 && methods.has("RESOLVED_BY_SAME_OPINION_CONTEXT")) {
      status = "RESOLVED_BY_SAME_OPINION_CONTEXT";
      reason = "same_opinion_context_agree";
    } else if (decisive.length >= 2) {
      status = "RESOLVED_BY_CROSS_CITER_CONSENSUS";
      reason = "cross_citer_context_consensus";
    } else {
      status = decisive[0]!.status;
      reason = decisive[0]!.reason;
    }

    // Propagate identity to undecided edges of the same target when consensus is unique
    const propagated = edgeResolutions.map((er) => {
      if (isDeterministicCitingContextStatus(er.status) && er.clusterId) return er;
      return {
        ...er,
        status: "RESOLVED_BY_SAME_OPINION_CONTEXT" as const,
        clusterId: id,
        reason: "propagated_from_target_consensus",
        scope: "edge" as const,
      };
    });

    return {
      status,
      clusterId: id,
      reason,
      scope: "target",
      edgeResolutions: propagated,
      collidingClusterIds: [],
    };
  }

  // TRUE COLLISION: different edges deterministically imply different clusters
  return {
    status: "TRUE_COLLISION",
    clusterId: null,
    reason: "cross_citer_context_disagreement",
    scope: "edge_split",
    edgeResolutions: edgeResolutions.map((er) =>
      isDeterministicCitingContextStatus(er.status) && er.clusterId
        ? er
        : { ...er, status: "STILL_AMBIGUOUS" as const, clusterId: null, reason: "collision_undecided_edge", scope: "none" as const },
    ),
    collidingClusterIds: clusters,
  };
}

/** Weak fuzzy helper used only in tests to prove we do NOT resolve on it. */
export function weakFuzzyCaseNameScore(a: string, b: string): number {
  const na = normalizeCaseCaption(a) || "";
  const nb = normalizeCaseCaption(b) || "";
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // crude token overlap — never used for auto-resolve
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.max(ta.size, tb.size);
}
