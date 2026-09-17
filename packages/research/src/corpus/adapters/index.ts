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

export { createUscHouseAdapter, normalizeUscCitation, uscViewerUrl } from "./usc";
export type { UscHouseAdapterOptions, UscSectionRef } from "./usc";

export {
  createStateStatuteAdapter,
  parsePrefetchedStateStatute,
} from "./state-statute";
export type { StateStatuteSourceConfig } from "./state-statute";

export { runAdapterBatch } from "./batch-runner";
export type { AdapterBatchPersistFn, AdapterBatchSummary } from "./batch-runner";
