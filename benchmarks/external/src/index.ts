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

export { assertJudgeSeparation, JudgeSeparationError } from "./guards/judge-separation.js";

export { loadDefaultPricingTable, estimateRunCost } from "./cost/estimator.js";
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
