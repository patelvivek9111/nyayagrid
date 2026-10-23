export {
  NormalizedTaskSchema,
  parseNormalizedTask,
  parseNormalizedTasks,
  ContaminationRiskSchema,
  ConversationTurnSchema,
  SupportingDocumentSchema,
  RubricSchema,
  RubricCriterionSchema,
  GoldEvidenceSpanSchema,
} from "./schema/normalized-task.js";
export type {
  NormalizedTask,
  ContaminationRisk,
  ConversationTurn,
  SupportingDocument,
  Rubric,
  RubricCriterion,
  GoldEvidenceSpan,
} from "./schema/normalized-task.js";

export {
  ExternalBenchmarkScorecardSchema,
  parseExternalBenchmarkScorecard,
} from "./schema/scorecard.js";
export type { ExternalBenchmarkScorecard } from "./schema/scorecard.js";

export {
  FAILURE_TAXONOMY,
  FailureCategorySchema,
  isFailureCategory,
} from "./schema/failure-taxonomy.js";
export type { FailureCategory } from "./schema/failure-taxonomy.js";

export {
  getPackageRoot,
  getCacheDir,
  getFixturesDir,
  getRegistryDir,
  resolveFromPackageRoot,
} from "./paths.js";

export {
  loadIntegrityManifest,
  verifyIntegrityManifest,
  sha256File,
  IntegrityManifestSchema,
  IntegrityManifestEntrySchema,
} from "./integrity/manifest.js";
export type {
  IntegrityManifest,
  IntegrityManifestEntry,
  ManifestVerificationResult,
} from "./integrity/manifest.js";

export {
  assertPaidCallsAuthorized,
  isPaidCallsAuthorized,
  buildLiveModelAuthorizationRequiredMessage,
  LIVE_MODEL_BENCHMARK_AUTHORIZATION_REQUIRED,
} from "./guards/paid-call-guard.js";

export {
  LICENSE_STATUSES,
  assertCommercialEvalAllowed,
  loadLegalBenchTaskLicense,
  loadRagSourceLicense,
  isCommercialInternalEvalOk,
  resetLicenseFirewallCachesForTests,
} from "./license/firewall.js";
export type { LicenseStatus, LicenseEvalMode, LicenseAssertionResult } from "./license/firewall.js";

export {
  buildCommercialScreeningSuite,
  rebuildCommercialLegalBenchIds,
  rebuildCommercialRagIds,
  isLegalBenchTaskCommercialCleared,
  isRagTaskProductionCleared,
  COMMERCIAL_SCREENING_LICENSE_FILTER,
} from "./selectors/commercial-screening.js";

export { loadDefaultPricingTable, loadCurrentPricingTable, estimateRunCost } from "./cost/estimator.js";
export { computeStage1Plan, computeStagePlans } from "./cost/plan-stage1.js";

export {
  LIVE_MODEL_BENCHMARK_AUTHORIZATION_REQUIRED as LIVE_AUTH_MESSAGE,
  assertLivePaidExecutionAuthorized,
  isLivePaidExecutionAuthorized,
} from "./live/authorization.js";
export {
  parseMaxCostUsd,
  assertBudgetConfigured,
  assertNextCallWithinBudget,
  recordSpend,
  remainingBudgetUsd,
  worstCaseCallCostUsd,
  BudgetLimitError,
} from "./live/budget.js";
export { buildCacheKey, contentHashFromText } from "./live/cache-key.js";
export {
  appendCompletedCall,
  writeCacheEntryFile,
  persistPaidCallImmediately,
  runArtifactsDir,
} from "./live/persistence.js";
export type { PersistedPaidCallRecord, PersistedCallRecord } from "./live/persistence.js";
export { isResponseCacheHit, readResponseCache } from "./live/response-cache.js";
export { isJudgeCacheHit, readJudgeCache } from "./live/judge-cache.js";
export {
  freezeRunManifest,
  loadRunManifest,
  assertManifestImmutable,
  hashRunConfig,
} from "./live/manifest.js";
export { runPaidBenchmarkPreflight, PAID_BENCHMARK_PREFLIGHT_PASS } from "./live/preflight.js";
export { evaluateResumeSkip, parseResumeRunId } from "./live/resume.js";
export { assessContextFit, assertNoSilentTruncate } from "./live/context-fit.js";
export { findDuplicateInputHashes } from "./live/duplicate-tasks.js";
export { assertSameModelPinned, ModelSwapForbiddenError } from "./live/no-fallback.js";
export { mayStartStage, autoStartStage2FromStage1 } from "./live/stage-gate.js";
export { createRunProgress, bumpProgress, formatProgressLine } from "./live/progress.js";
export { resolveBatchSize, chunk, DEFAULT_BATCH_SIZE_MIN } from "./live/batch.js";
export { shouldRetry, computeBackoffMs, UnknownCompletionError } from "./live/retry.js";
export { buildCanaryPlan, shouldStopAfterCanary } from "./live/canary.js";
export { scoreFromSavedResponses } from "./live/offline-score.js";
export {
  parseProviderCaps,
  assertWithinProviderCaps,
  recordProviderSpend,
  emptyProviderSpend,
  ProviderCapError,
} from "./live/provider-caps.js";
export type {
  ProviderId,
  ProviderCapLimits,
  ProviderCapsConfig,
  ProviderSpendState,
} from "./live/provider-caps.js";
export {
  parseConcurrency,
  mapWithConcurrency,
  DEFAULT_PROVIDER_CONCURRENCY,
} from "./live/concurrency.js";

export { assertJudgeSeparation, JudgeSeparationError } from "./guards/judge-separation.js";

export type {
  PricingTable,
  TokenEstimate,
  CostBreakdown,
  EstimateRunCostOptions,
} from "./cost/estimator.js";

export {
  characterPrecisionRecallF1,
  documentHit,
  evidenceSpanHit,
  topKDocumentRecall,
} from "./scorers/rag-metrics.js";
export type { CharacterSpan, CharacterMetrics } from "./scorers/rag-metrics.js";

export {
  PRBenchRubricMode,
  prepareWeightedRubric,
  scorePrefilledRubricResponse,
  invokeLlmJudge,
} from "./scorers/prbench-rubric.js";
export type {
  PreparedRubric,
  PreparedRubricCriterion,
  RubricScoreResult,
} from "./scorers/prbench-rubric.js";

export { FakeProvider } from "./providers/dummy.js";
export type { DummyCompletionRequest, DummyCompletionResponse } from "./providers/dummy.js";

export type { BenchmarkAdapter, BenchmarkFetchContext } from "./adapters/types.js";

export { PRBenchAdapter, normalizePrbenchRow } from "./adapters/prbench.js";
export {
  LegalBenchAdapter,
  classifyLegalBenchTask,
  inventoryLegalBenchTasks,
} from "./adapters/legalbench.js";
export {
  LegalBenchRagAdapter,
  normalizeLegalBenchRagCase,
  loadLegalBenchRagBenchmarkFile,
} from "./adapters/legalbench-rag.js";

export { selectPrbenchSubset } from "./selectors/prbench.js";
export { filterLegalBenchTasks } from "./selectors/legalbench.js";
export { filterLegalBenchRagTasks } from "./selectors/legalbench-rag.js";
export {
  buildScreeningSelection,
  deterministicSelect,
  SCREENING_TARGETS,
  SCREENING_SEED,
} from "./selectors/screening.js";

export { assertSafeArchiveEntry } from "./security/safe-extract.js";
