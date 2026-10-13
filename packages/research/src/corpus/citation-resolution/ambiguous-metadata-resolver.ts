/**
 * Deterministic disambiguation of multi-cluster VRP collisions using
 * CourtListener bulk cluster metadata + local Nyaya evidence.
 * No API. No fuzzy auto-resolve. Auto-resolve only when exactly one candidate survives.
 */

import { experimentalNormalize } from "./normalize.js";

export type AmbiguousResolutionStatus =
  | "RESOLVED_METADATA_UNIQUE"
  | "RESOLVED_PARALLEL_UNIQUE"
  | "RESOLVED_TEMPORAL_UNIQUE"
  | "RESOLVED_EXISTING_NYAYA_IDENTITY"
  | "RESOLVED_MULTI_CITER_CONSENSUS"
  | "STILL_AMBIGUOUS"
  | "METADATA_INSUFFICIENT"
  | "COLLISION_CONFIRMED";

export type ClusterMetaCandidate = {
  clusterId: string;
  caseName?: string | null;
  caseNameFull?: string | null;
  caseNameShort?: string | null;
  caseNameNormalized?: string | null;
  dateFiled?: string | null; // YYYY-MM-DD
  dateFiledIsApproximate?: boolean;
  precedentialStatus?: string | null;
  docketId?: string | null;
  parallelCitations?: string[];
  /** Existing Nyaya authority id if cl-cluster-{id} already present */
  existingAuthorityId?: string | null;
  /** Normalized citations/aliases/parallels already known on that Nyaya authority */
  existingAuthorityCitations?: string[];
};

export type CitingOccurrence = {
  edgeId?: string;
  fromAuthorityId?: string;
  decisionDate?: string | null; // YYYY-MM-DD
  courtId?: string | null;
  rawCitation?: string | null;
  normalizedCitation?: string | null;
};

export type AmbiguousDisambiguationResult = {
  status: AmbiguousResolutionStatus;
  reason: string;
  clusterId: string | null;
  survivingClusterIds: string[];
  eliminatedByDate: string[];
  method:
    | "existing_nyaya"
    | "parallel"
    | "temporal"
    | "case_name"
    | "multi_citer_consensus"
    | "none";
};

/** Deterministic legal caption normalization — not fuzzy similarity. */
export function normalizeCaseCaption(raw: string | null | undefined): string | null {
  let s = String(raw || "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9&./'\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  s = s.replace(/\bvs\.?\b/g, "v");
  s = s.replace(/\bv\b/g, "v");
  s = s.replace(/\s+v\s+/g, " v ");
  // Common party suffixes / role markers
  s = s
    .replace(
      /\b(inc|incorporated|llc|l\.l\.c|co|company|corp|corporation|ltd|limited|assoc|association|bros|brothers)\b\.?/g,
      " ",
    )
    .replace(/\b(et\s+al|etal)\b\.?/g, " ")
    .replace(/\b(appellant|appellee|petitioner|respondent|plaintiff|defendant)s?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/\s*&\s*/g, " and ");
  s = s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return s || null;
}

export function parseIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
}

export function dateIsAfter(a: string | null | undefined, b: string | null | undefined): boolean {
  const aa = parseIsoDate(a);
  const bb = parseIsoDate(b);
  if (!aa || !bb) return false;
  return aa > bb;
}

/** Extract a caption preceding a reporter citation, if present. */
export function extractCaptionBeforeCitation(raw: string | null | undefined): string | null {
  const t = String(raw || "").trim();
  if (!t) return null;
  // "Foo v. Bar, 410 U.S. 113" or "Foo v. Bar, 410 U.S. 113 (1973)"
  const m = t.match(/^(.{3,120}?),\s*\d{1,4}\s+[A-Za-z]/);
  if (!m) return null;
  const cap = m[1]!.trim();
  if (!/\bv\.?\b|\bvs\.?\b/i.test(cap) && !/\bin\s+re\b/i.test(cap)) return null;
  return cap;
}

function normCiteSet(values: Iterable<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const v of values) {
    const lean = experimentalNormalize(v) || String(v || "").trim();
    if (lean) out.add(lean.toLowerCase());
  }
  return out;
}

function candidateNameNorms(c: ClusterMetaCandidate): Set<string> {
  const out = new Set<string>();
  for (const v of [c.caseNameNormalized, c.caseName, c.caseNameFull, c.caseNameShort]) {
    const n = normalizeCaseCaption(v);
    if (n) out.add(n);
  }
  return out;
}

export function isDeterministicAmbiguousStatus(status: AmbiguousResolutionStatus): boolean {
  return (
    status === "RESOLVED_METADATA_UNIQUE" ||
    status === "RESOLVED_PARALLEL_UNIQUE" ||
    status === "RESOLVED_TEMPORAL_UNIQUE" ||
    status === "RESOLVED_EXISTING_NYAYA_IDENTITY" ||
    status === "RESOLVED_MULTI_CITER_CONSENSUS"
  );
}

/**
 * Disambiguate multi-cluster candidates with deterministic local evidence only.
 */
export function disambiguateAmbiguousCitation(input: {
  rawCitation: string;
  normalizedCitation: string;
  candidates: ClusterMetaCandidate[];
  citers?: CitingOccurrence[];
  /** Extra normalized citations already known in Nyaya citation family / aliases */
  nyayaFamilyCitations?: string[];
  /**
   * Optional: for each candidate clusterId, parallels whose bulk VRP maps
   * uniquely back to that same cluster (deterministic fingerprint).
   */
  uniqueParallelFingerprintsByCluster?: Record<string, string[]>;
}): AmbiguousDisambiguationResult {
  const candidates = input.candidates.filter((c) => c.clusterId);
  const allIds = candidates.map((c) => String(c.clusterId));
  if (candidates.length <= 1) {
    return {
      status: candidates.length === 1 ? "RESOLVED_METADATA_UNIQUE" : "METADATA_INSUFFICIENT",
      reason: candidates.length === 1 ? "single_candidate_input" : "no_candidates",
      clusterId: candidates[0]?.clusterId ?? null,
      survivingClusterIds: allIds,
      eliminatedByDate: [],
      method: candidates.length === 1 ? "case_name" : "none",
    };
  }

  const targetNorms = normCiteSet([input.rawCitation, input.normalizedCitation, ...(input.nyayaFamilyCitations || [])]);
  const citers = input.citers || [];

  // ---- 1. Existing Nyaya identity with citation-family overlap ----
  const existingHits = candidates.filter((c) => {
    if (!c.existingAuthorityId) return false;
    const authCites = normCiteSet(c.existingAuthorityCitations || []);
    for (const t of targetNorms) if (authCites.has(t)) return true;
    // Or any parallel of this cluster already known on the authority
    const pars = normCiteSet(c.parallelCitations || []);
    for (const p of pars) if (authCites.has(p)) return true;
    return false;
  });
  if (existingHits.length === 1) {
    return {
      status: "RESOLVED_EXISTING_NYAYA_IDENTITY",
      reason: "existing_cluster_authority_citation_family",
      clusterId: String(existingHits[0]!.clusterId),
      survivingClusterIds: [String(existingHits[0]!.clusterId)],
      eliminatedByDate: [],
      method: "existing_nyaya",
    };
  }

  // ---- 2a. Bulk-unique parallel fingerprints (VRP of parallel → only this cluster) ----
  const fpMap = input.uniqueParallelFingerprintsByCluster || {};
  const fpHits = candidates.filter((c) => (fpMap[String(c.clusterId)] || []).length > 0);
  if (fpHits.length === 1) {
    return {
      status: "RESOLVED_PARALLEL_UNIQUE",
      reason: "bulk_unique_parallel_fingerprint",
      clusterId: String(fpHits[0]!.clusterId),
      survivingClusterIds: [String(fpHits[0]!.clusterId)],
      eliminatedByDate: [],
      method: "parallel",
    };
  }

  // ---- 2b. Parallel citation uniqueness vs Nyaya family ----
  const familyExtras = normCiteSet(input.nyayaFamilyCitations || []);
  const parallelUnique: ClusterMetaCandidate[] = [];
  for (const c of candidates) {
    const pars = normCiteSet(c.parallelCitations || []);
    let hit = false;
    for (const f of familyExtras) {
      if (!pars.has(f)) continue;
      const owners = candidates.filter((o) => normCiteSet(o.parallelCitations || []).has(f));
      if (owners.length === 1) hit = true;
    }
    if (hit) parallelUnique.push(c);
  }
  if (parallelUnique.length === 1) {
    return {
      status: "RESOLVED_PARALLEL_UNIQUE",
      reason: "nyaya_family_parallel_unique_to_one_cluster",
      clusterId: String(parallelUnique[0]!.clusterId),
      survivingClusterIds: [String(parallelUnique[0]!.clusterId)],
      eliminatedByDate: [],
      method: "parallel",
    };
  }

  const parallelOverlap = candidates.filter((c) => {
    const pars = normCiteSet(c.parallelCitations || []);
    for (const f of familyExtras) if (pars.has(f)) return true;
    return false;
  });
  if (parallelOverlap.length === 1) {
    return {
      status: "RESOLVED_PARALLEL_UNIQUE",
      reason: "only_one_candidate_shares_nyaya_family_parallel",
      clusterId: String(parallelOverlap[0]!.clusterId),
      survivingClusterIds: [String(parallelOverlap[0]!.clusterId)],
      eliminatedByDate: [],
      method: "parallel",
    };
  }

  // ---- 3. Case-name exact match from caption(s) ----
  const caption = extractCaptionBeforeCitation(input.rawCitation);
  const captionNorm = normalizeCaseCaption(caption);
  if (captionNorm) {
    const nameHits = candidates.filter((c) => candidateNameNorms(c).has(captionNorm));
    if (nameHits.length === 1) {
      return {
        status: "RESOLVED_METADATA_UNIQUE",
        reason: "exact_normalized_case_name_from_citation_caption",
        clusterId: String(nameHits[0]!.clusterId),
        survivingClusterIds: [String(nameHits[0]!.clusterId)],
        eliminatedByDate: [],
        method: "case_name",
      };
    }
  }

  // Per-citer caption votes (deterministic exact match only)
  const captionVotes: string[] = [];
  for (const citer of citers) {
    const cap = normalizeCaseCaption(extractCaptionBeforeCitation(citer.rawCitation));
    if (!cap) continue;
    const hits = candidates.filter((c) => candidateNameNorms(c).has(cap));
    if (hits.length === 1) captionVotes.push(String(hits[0]!.clusterId));
  }
  const uniqueCaptionVotes = [...new Set(captionVotes)];
  if (uniqueCaptionVotes.length > 1) {
    return {
      status: "COLLISION_CONFIRMED",
      reason: "multi_citer_case_name_conflict",
      clusterId: null,
      survivingClusterIds: uniqueCaptionVotes,
      eliminatedByDate: [],
      method: "none",
    };
  }
  if (uniqueCaptionVotes.length === 1 && captionVotes.length >= 2) {
    return {
      status: "RESOLVED_MULTI_CITER_CONSENSUS",
      reason: "multi_citer_case_name_consensus",
      clusterId: uniqueCaptionVotes[0]!,
      survivingClusterIds: [uniqueCaptionVotes[0]!],
      eliminatedByDate: [],
      method: "multi_citer_consensus",
    };
  }

  // ---- 4. Temporal elimination across citers ----
  const eliminatedByDate = new Set<string>();
  const datedCiters = citers.filter((c) => parseIsoDate(c.decisionDate));
  let survivorSets: string[][] = [];

  if (datedCiters.length > 0) {
    for (const citer of datedCiters) {
      const survivors = candidates
        .filter((cand) => {
          const filed = parseIsoDate(cand.dateFiled);
          if (!filed) return true; // cannot eliminate without date
          if (cand.dateFiledIsApproximate) return true; // do not overclaim on approx dates
          return !dateIsAfter(filed, citer.decisionDate);
        })
        .map((c) => String(c.clusterId));
      for (const cand of candidates) {
        const filed = parseIsoDate(cand.dateFiled);
        if (
          filed &&
          !cand.dateFiledIsApproximate &&
          dateIsAfter(filed, citer.decisionDate)
        ) {
          eliminatedByDate.add(String(cand.clusterId));
        }
      }
      survivorSets.push(survivors);
    }

    // Consensus intersection across all dated citers
    let intersection = new Set(survivorSets[0] || []);
    for (const s of survivorSets.slice(1)) {
      const setS = new Set(s);
      intersection = new Set([...intersection].filter((id) => setS.has(id)));
    }

    // Conflict: different citers imply disjoint single survivors
    const singletonSurvivors = survivorSets
      .filter((s) => s.length === 1)
      .map((s) => s[0]!);
    const uniqueSingletons = [...new Set(singletonSurvivors)];
    if (uniqueSingletons.length > 1) {
      return {
        status: "COLLISION_CONFIRMED",
        reason: "multi_citer_temporal_conflict",
        clusterId: null,
        survivingClusterIds: uniqueSingletons,
        eliminatedByDate: [...eliminatedByDate],
        method: "none",
      };
    }

    if (intersection.size === 1) {
      const id = [...intersection][0]!;
      const method =
        datedCiters.length > 1 && survivorSets.every((s) => s.length === 1 && s[0] === id)
          ? "multi_citer_consensus"
          : "temporal";
      return {
        status: method === "multi_citer_consensus" ? "RESOLVED_MULTI_CITER_CONSENSUS" : "RESOLVED_TEMPORAL_UNIQUE",
        reason: method === "multi_citer_consensus" ? "all_citers_agree_after_date_filter" : "date_leaves_one_candidate",
        clusterId: id,
        survivingClusterIds: [id],
        eliminatedByDate: [...eliminatedByDate],
        method,
      };
    }

    if (intersection.size === 0) {
      return {
        status: "METADATA_INSUFFICIENT",
        reason: "date_filter_eliminated_all_candidates",
        clusterId: null,
        survivingClusterIds: [],
        eliminatedByDate: [...eliminatedByDate],
        method: "none",
      };
    }

    // Still >1 after date filter
    return {
      status: "STILL_AMBIGUOUS",
      reason: "multiple_candidates_survive_date_and_metadata",
      clusterId: null,
      survivingClusterIds: [...intersection],
      eliminatedByDate: [...eliminatedByDate],
      method: "none",
    };
  }

  // No dated citers / no decisive metadata
  return {
    status: "METADATA_INSUFFICIENT",
    reason: "no_deterministic_signal",
    clusterId: null,
    survivingClusterIds: allIds,
    eliminatedByDate: [],
    method: "none",
  };
}
