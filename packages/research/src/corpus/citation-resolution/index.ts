/**
 * Canonical authority citation-resolution engine (Pass 5 foundation).
 * Selective barrel — avoids colliding with Research citations / corpus adapters names.
 */

export {
  RESOLVER_VERSION,
  authorityCorpusState,
  emptyAntiRegressionMetrics,
  type ResolutionState,
  type ResolutionMethod,
  type ResolutionConfidence,
  type LocalMatchBucket,
  type CitationResolutionRecord,
  type AuthorityIndexRow,
  type UnresolvedEdgeRow,
  type UnresolvedTarget,
  type LocalResolveProposal,
  type LookupCandidateResult,
  type ClIdentityLookupResult,
  type AntiRegressionMetrics,
} from "./types.js";

export {
  collapseWhitespace,
  experimentalNormalize,
  parseVolReporterPage,
  vrpKey,
  targetKey,
  isLookupSuitableCitation,
  type VolReporterPage,
  // Avoid colliding with Research citations.ts exports of the same names.
  normalizeCitationWhitespace as normalizeResolutionCitationWhitespace,
  citationLookupAliases as resolutionCitationLookupAliases,
} from "./normalize.js";

export {
  classifyCaseCitationLookupEligibility,
  isCaseCitationLookupEligible,
  isStrategicIdentityException,
  classifyDemandLanePolicy,
  type CitationLookupLane,
  type CaseCitationEligibility,
  type DemandLanePolicy,
} from "./eligibility.js";

export { LocalAuthorityIndex } from "./local-index.js";
export {
  buildUnresolvedTargetQueue,
  chunkTargetsForBatch,
  scoreUnresolvedTarget,
} from "./target-queue.js";
export { dryRunLocalHighResolver, planBackfillFromProposals } from "./local-resolver.js";
export { planGlobalBackfill, selectDemandFullTextTargets } from "./backfill.js";
export {
  createResolutionRecord,
  supersedeRecord,
  appendLedger,
  loadLedger,
  activeRecordsByEdge,
  writeJsonAtomic,
} from "./ledger.js";
export {
  CL_CITATION_LOOKUP_PATH,
  CL_DEFAULT_BASE,
  CL_LOOKUP_TEXTS_PER_REQUEST,
  CL_QUOTA_DEFAULTS,
  emptyCheckpoint as emptyClLookupCheckpoint,
  buildCitationLookupPayload,
  dedupeLookupTexts,
  parseCitationLookupResponse,
  simulateLookupFromFixture,
  CourtListenerIdentityClient,
  runIdentityBatch,
  type ClIdentityClientOptions,
  type ClLookupCheckpoint,
} from "./cl-identity-client.js";
export { metricsForNewCaseBatch } from "./metrics.js";
export {
  filterExternalIdentityQueueTargets,
  resolveNewCitationsLocalFirst,
  planBackfillAfterIdentity,
  edgeTargetKey,
  type IngestCitationInput,
  type IngestResolveResult,
} from "./pipeline.js";
