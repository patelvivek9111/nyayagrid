/**
 * Corpus source adapter factories and shared types.
 */

export type {
  AdapterAuthorityRecord,
  AdapterDiscoverItem,
  AdapterFetchResult,
  AdapterParseResult,
  IngestCheckpoint,
  LegalSourceAdapter,
  SourceAdapterCapabilities,
} from "./types";

export { emptyCheckpoint, sanitizeUntrustedLegalText } from "./types";

export { createCourtListenerAdapter, COURT_ID_MAP } from "./courtlistener";
export type { CourtListenerAdapterOptions } from "./courtlistener";

export { createEcfrAdapter, fetchEcfrSection, resolveEcfrAsOfDate } from "./ecfr";
export type { EcfrAdapterOptions } from "./ecfr";

export { createUscHouseAdapter, normalizeUscCitation, uscViewerUrl, USC_DEFAULT_SECTIONS } from "./usc";
export type { UscHouseAdapterOptions, UscSectionRef } from "./usc";

export {
  createUsReportsLocAdapter,
  locUsReportsItemId,
  locUsReportsItemUrl,
  parseUsReportsTarget,
  usReportsCitation,
} from "./us-reports";
export type { UsReportsAdapterOptions, UsReportsTarget } from "./us-reports";

export {
  createUscourtsRulesAdapter,
  federalRuleCitation,
  uscourtsRuleUrl,
  DEFAULT_FEDERAL_RULE_TARGETS,
} from "./uscourts-rules";
export type { UscourtsRulesAdapterOptions, FederalRuleTarget, FederalRuleKind } from "./uscourts-rules";

export {
  createStateStatuteAdapter,
  parsePrefetchedStateStatute,
} from "./state-statute";
export type { StateStatuteSourceConfig } from "./state-statute";

export {
  createStateRegulationAdapter,
  parsePrefetchedStateRegulation,
  WAVE1_STATE_REGULATION_CONFIGS,
} from "./state-regulation";
export type {
  StateRegulationPlatformFamily,
  StateRegulationSourceConfig,
} from "./state-regulation";

export { runAdapterBatch } from "./batch-runner";
export type { AdapterBatchPersistFn, AdapterBatchSummary } from "./batch-runner";
