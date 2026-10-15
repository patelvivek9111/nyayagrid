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
} from "./types";

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
} from "./normalize";

export {
  classifyCaseCitationLookupEligibility,
  isCaseCitationLookupEligible,
  isStrategicIdentityException,
  classifyDemandLanePolicy,
  type CitationLookupLane,
  type CaseCitationEligibility,
  type DemandLanePolicy,
} from "./eligibility";

export {
  CITATION_TARGET_CLASSIFICATIONS,
  CITATION_ARTIFACT_CLASSIFICATIONS,
  isCaseIdentityEligible,
  isCitationArtifactClassification,
  isTrueCaseIdentityClassification,
  isUnknownClassification,
  normalizeClassification,
  caseIdentityEligibleClassifications,
  citationArtifactClassifications,
  filterCaseIdentityQueueByClassification,
  type CitationTargetClassification,
  type CitationArtifactClassification,
} from "./classification";

export { LocalAuthorityIndex } from "./local-index";
export {
  buildUnresolvedTargetQueue,
  chunkTargetsForBatch,
  scoreUnresolvedTarget,
} from "./target-queue";
export { dryRunLocalHighResolver, planBackfillFromProposals } from "./local-resolver";
export { planGlobalBackfill, selectDemandFullTextTargets } from "./backfill";
export {
  createResolutionRecord,
  supersedeRecord,
  appendLedger,
  loadLedger,
  activeRecordsByEdge,
  writeJsonAtomic,
} from "./ledger";
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
} from "./cl-identity-client";
export {
  metricsForNewCaseBatch,
  computeCitationIdentityAccounting,
  emptyCitationIdentityAccounting,
  type CitationAccountingEdge,
} from "./metrics";
export {
  filterExternalIdentityQueueTargets,
  resolveNewCitationsLocalFirst,
  planBackfillAfterIdentity,
  edgeTargetKey,
  type IngestCitationInput,
  type IngestResolveResult,
} from "./pipeline";
export type { CitationIdentityAccountingMetrics } from "./types";
