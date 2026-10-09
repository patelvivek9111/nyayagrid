/**
 * Product-facing Pass 5 citation-resolution contract.
 *
 * Reuses Chat B's certified corpus citation-resolution engine.
 * Do NOT create a second resolver. Prefer these APIs from Research / Ask /
 * Draft / Professor / Guide productization.
 *
 * Persisted ResolutionState values remain:
 *   IDENTITY_UNRESOLVED | AUTHORITY_RESOLVED | CORPUS_COMPLETE
 * AUTHORITY_RESOLVED never implies CORPUS_COMPLETE.
 */

import { LocalAuthorityIndex } from "./corpus/citation-resolution/local-index.js";
import {
  RESOLVER_VERSION,
  authorityCorpusState,
  classifyCaseCitationLookupEligibility,
  experimentalNormalize,
  resolveNewCitationsLocalFirst,
  targetKey,
  type AuthorityIndexRow,
  type CaseCitationEligibility,
  type CitationResolutionRecord,
  type IngestCitationInput,
  type LocalMatchBucket,
  type LookupCandidateResult,
  type ResolutionConfidence,
  type ResolutionMethod,
  type ResolutionState,
} from "./corpus/citation-resolution/index.js";

/** Product UI / service outcome vocabulary (maps over engine results; does not rename persisted states). */
export type ProductResolutionOutcome =
  | "RESOLVED_HIGH_CONFIDENCE"
  | "AMBIGUOUS"
  | "NOT_FOUND"
  | "NOT_CASE_CITATION"
  | "MALFORMED"
  | "DEFERRED";

export type ProductCitationResolution = {
  rawCitation: string;
  normalizedCitation: string | null;
  targetKey: string;
  outcome: ProductResolutionOutcome;
  /** Persisted engine state — never collapse AUTHORITY_RESOLVED into CORPUS_COMPLETE. */
  authorityState: ResolutionState;
  authorityId: string | null;
  confidence: ResolutionConfidence | null;
  method: ResolutionMethod | null;
  ambiguityAuthorityIds: string[];
  eligibility: CaseCitationEligibility;
  corpusComplete: boolean;
  evidence: string[];
  resolverVersion: string;
  /** Treatment verification is out of band; null until a treatment layer supplies it. */
  treatmentVerificationStatus: string | null;
};

export function mapLookupToProductOutcome(
  hit: LookupCandidateResult,
  eligibility: CaseCitationEligibility,
): ProductResolutionOutcome {
  if (!eligibility.eligible) {
    if (eligibility.lane === "MALFORMED_CASE_REFERENCE") return "MALFORMED";
    if (
      eligibility.lane === "STATUTE_RULE_REGULATION" ||
      eligibility.lane === "NON_CASE_REFERENCE" ||
      eligibility.lane === "PIN_CITE_ONLY"
    ) {
      return "NOT_CASE_CITATION";
    }
    return "DEFERRED";
  }
  if (hit.kind === "one") return "RESOLVED_HIGH_CONFIDENCE";
  if (hit.kind === "ambiguous") return "AMBIGUOUS";
  return "NOT_FOUND";
}

/**
 * Local-first product resolve for a single citation against an in-memory authority index snapshot.
 * Never calls CourtListener. Ambiguity is explicit — never a silent best-guess.
 */
export function resolveCitationForProduct(params: {
  rawCitation: string;
  normalizedCitation?: string | null;
  authorities: AuthorityIndexRow[];
  fromAuthorityId?: string;
}): ProductCitationResolution {
  const normalized =
    params.normalizedCitation ?? experimentalNormalize(params.rawCitation);
  const key = targetKey(params.rawCitation, normalized);
  const eligibility = classifyCaseCitationLookupEligibility(
    params.rawCitation,
    normalized,
  );

  const index = new LocalAuthorityIndex(params.authorities);
  const hit = index.lookupCitation(params.rawCitation, normalized);

  // Keep batch path exercised for future ingestion metrics compatibility.
  resolveNewCitationsLocalFirst(
    [
      {
        fromAuthorityId: params.fromAuthorityId ?? "product",
        rawCitation: params.rawCitation,
        normalizedCitation: normalized,
        edgeId: "product-1",
      } satisfies IngestCitationInput,
    ],
    params.authorities,
  );

  const outcome = mapLookupToProductOutcome(hit, eligibility);
  const authorityId = hit.kind === "one" ? hit.authorityId : null;
  const authorityRow = authorityId
    ? params.authorities.find((row) => row.id === authorityId) ?? null
    : null;
  const authorityState = authorityRow
    ? authorityCorpusState(authorityRow)
    : "IDENTITY_UNRESOLVED";

  return {
    rawCitation: params.rawCitation,
    normalizedCitation: normalized,
    targetKey: key,
    outcome: hit.kind === "zero" && eligibility.eligible ? "DEFERRED" : outcome,
    authorityState,
    authorityId,
    confidence: hit.kind === "one" ? "HIGH" : null,
    method: hit.kind === "one" ? hit.method : null,
    ambiguityAuthorityIds: hit.kind === "ambiguous" ? hit.authorityIds : [],
    eligibility,
    corpusComplete: authorityState === "CORPUS_COMPLETE",
    evidence:
      hit.kind === "zero"
        ? eligibility.eligible
          ? ["local_unresolved"]
          : eligibility.reasons
        : hit.evidence,
    resolverVersion: RESOLVER_VERSION,
    treatmentVerificationStatus: null,
  };
}

export type {
  AuthorityIndexRow,
  CaseCitationEligibility,
  CitationResolutionRecord,
  LocalMatchBucket,
  LookupCandidateResult,
  ResolutionConfidence,
  ResolutionMethod,
  ResolutionState,
};

export {
  RESOLVER_VERSION,
  authorityCorpusState,
  classifyCaseCitationLookupEligibility,
  experimentalNormalize,
  resolveNewCitationsLocalFirst,
  targetKey,
  LocalAuthorityIndex,
};
