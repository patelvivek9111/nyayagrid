/**
 * Corpus-owned citation identity resolution model.
 * Persistence of provenance uses the corpus ledger + authority metadata;
 * edge identity uses existing legal_authority_citations.to_authority_id.
 * Does NOT require a shared product schema migration.
 */

export const RESOLVER_VERSION = "citation-resolution-engine/v1";

export type ResolutionState =
  | "IDENTITY_UNRESOLVED"
  | "AUTHORITY_RESOLVED"
  | "CORPUS_COMPLETE";

export type ResolutionMethod =
  | "LOCAL_EXACT"
  | "LOCAL_NORMALIZED"
  | "LOCAL_ALIAS"
  | "LOCAL_PARALLEL"
  | "CONTEXTUAL_SHORT_CITE"
  | "COURTLISTENER_CITATION_LOOKUP"
  | "COURTLISTENER_CLUSTER"
  | "MANUAL";

export type ResolutionConfidence = "HIGH" | "MEDIUM" | "LOW";

export type LocalMatchBucket =
  | "ALREADY_PRESENT_EXACT"
  | "ALREADY_PRESENT_ALIAS"
  | "ALREADY_PRESENT_PARALLEL"
  | "ALREADY_PRESENT_AMBIGUOUS"
  | "NO_LOCAL_MATCH";

/** One reversible identity mapping (corpus ledger row). Never overwrites raw citation text. */
export type CitationResolutionRecord = {
  id: string;
  rawCitation: string;
  normalizedCitation: string | null;
  targetKey: string;
  fromAuthorityId?: string | null;
  citationEdgeId?: string | null;
  toAuthorityId: string | null;
  externalIdentity?: {
    provider: "courtlistener";
    clusterId?: string | null;
    opinionId?: string | null;
  } | null;
  method: ResolutionMethod;
  confidence: ResolutionConfidence;
  state: ResolutionState;
  evidence: string[];
  resolverVersion: string;
  createdAt: string;
  supersededAt?: string | null;
  supersededBy?: string | null;
  active: boolean;
};

export type AuthorityIndexRow = {
  id: string;
  citation: string | null;
  normalizedCitation: string | null;
  title?: string | null;
  shortTitle?: string | null;
  court?: string | null;
  courtId?: string | null;
  decisionDate?: string | Date | null;
  sourceProvider?: string | null;
  sourceExternalId?: string | null;
  authorityType?: string | null;
  ingestionStatus?: string | null;
  metadata?: Record<string, unknown> | null;
  /** True when full opinion text + embeddings are present (CORPUS_COMPLETE). */
  corpusComplete?: boolean;
};

export type UnresolvedEdgeRow = {
  id: string;
  fromAuthorityId: string;
  rawCitation: string | null;
  normalizedCitation: string | null;
  createdAt?: string | Date | null;
  fromCourtId?: string | null;
  fromCourt?: string | null;
};

export type UnresolvedTarget = {
  targetKey: string;
  representativeRaw: string;
  normalizedCitation: string;
  edgeCount: number;
  uniqueCitingCases: number;
  jurisdictions: string[];
  reporter: string | null;
  volume: number | null;
  page: number | null;
  year: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  localCandidateStatus: LocalMatchBucket;
  externalLookupStatus: "NOT_STARTED" | "QUEUED" | "DONE" | "AMBIGUOUS" | "NOT_FOUND" | "FAILED";
  resolvedAuthorityId: string | null;
  resolutionConfidence: ResolutionConfidence | null;
  fullTextStatus: "UNKNOWN" | "ABSENT" | "PRESENT" | "QUEUED";
  priorityScore: number;
  edgeIds: string[];
  lookupSuitable: boolean;
};

export type LocalResolveProposal = {
  targetKey: string;
  toAuthorityId: string;
  method: ResolutionMethod;
  confidence: ResolutionConfidence;
  evidence: string[];
  edgeIds: string[];
  edgeCount: number;
  rawCitation: string;
  normalizedCitation: string;
};

export type LookupCandidateResult =
  | { kind: "zero" }
  | { kind: "one"; authorityId: string; method: ResolutionMethod; evidence: string[] }
  | { kind: "ambiguous"; authorityIds: string[]; evidence: string[] };

export type ClIdentityLookupResult =
  | {
      status: "resolved";
      clusterId: string;
      opinionIds: string[];
      citations: string[];
      caseName: string | null;
      court: string | null;
      dateFiled: string | null;
      evidence: string[];
    }
  | { status: "ambiguous"; candidates: Array<{ clusterId: string | null; citations: string[] }>; evidence: string[] }
  | { status: "not_found"; evidence: string[] }
  | { status: "failed"; reason: string; evidence: string[] };

export type AntiRegressionMetrics = {
  NEW_EDGES_TOTAL: number;
  NEW_EDGES_RESOLVED_LOCAL_EXACT: number;
  NEW_EDGES_RESOLVED_NORMALIZATION: number;
  NEW_EDGES_RESOLVED_ALIAS: number;
  NEW_EDGES_RESOLVED_PARALLEL: number;
  NEW_EDGES_RESOLVED_CONTEXTUAL: number;
  NEW_EDGES_AUTHORITY_RESOLVED_EXTERNAL: number;
  NEW_EDGES_IDENTITY_UNRESOLVED: number;
  UNIQUE_NEW_UNRESOLVED_TARGETS: number;
  OLD_EDGES_BACKFILLED: number;
  AUTHORITIES_RESOLVED_WITHOUT_ACQUISITION: number;
  FULL_TEXT_ACQUISITIONS: number;
  EXTERNAL_LOOKUPS_AVOIDED: number;
  LOCAL_RESOLUTION_RATE: number;
  EXTERNAL_LOOKUPS_PER_1000_NEW_CASES: number;
  IDENTITY_UNRESOLVED_PER_1000_NEW_CASES: number;
};

export function emptyAntiRegressionMetrics(): AntiRegressionMetrics {
  return {
    NEW_EDGES_TOTAL: 0,
    NEW_EDGES_RESOLVED_LOCAL_EXACT: 0,
    NEW_EDGES_RESOLVED_NORMALIZATION: 0,
    NEW_EDGES_RESOLVED_ALIAS: 0,
    NEW_EDGES_RESOLVED_PARALLEL: 0,
    NEW_EDGES_RESOLVED_CONTEXTUAL: 0,
    NEW_EDGES_AUTHORITY_RESOLVED_EXTERNAL: 0,
    NEW_EDGES_IDENTITY_UNRESOLVED: 0,
    UNIQUE_NEW_UNRESOLVED_TARGETS: 0,
    OLD_EDGES_BACKFILLED: 0,
    AUTHORITIES_RESOLVED_WITHOUT_ACQUISITION: 0,
    FULL_TEXT_ACQUISITIONS: 0,
    EXTERNAL_LOOKUPS_AVOIDED: 0,
    LOCAL_RESOLUTION_RATE: 0,
    EXTERNAL_LOOKUPS_PER_1000_NEW_CASES: 0,
    IDENTITY_UNRESOLVED_PER_1000_NEW_CASES: 0,
  };
}

/** AUTHORITY_RESOLVED never implies CORPUS_COMPLETE. */
export function authorityCorpusState(row: AuthorityIndexRow): ResolutionState {
  if (row.corpusComplete === true || row.ingestionStatus === "ready") {
    // ingestion_status=ready is necessary but not sufficient alone; prefer explicit flag.
    if (row.corpusComplete === true) return "CORPUS_COMPLETE";
  }
  if (row.id) return "AUTHORITY_RESOLVED";
  return "IDENTITY_UNRESOLVED";
}
