import { emptyAntiRegressionMetrics, type AntiRegressionMetrics, type ResolutionMethod } from "./types.js";

export function recordLocalResolution(
  metrics: AntiRegressionMetrics,
  method: ResolutionMethod,
  edgeCount: number,
): void {
  metrics.NEW_EDGES_TOTAL += edgeCount;
  switch (method) {
    case "LOCAL_EXACT":
      metrics.NEW_EDGES_RESOLVED_LOCAL_EXACT += edgeCount;
      break;
    case "LOCAL_NORMALIZED":
      metrics.NEW_EDGES_RESOLVED_NORMALIZATION += edgeCount;
      break;
    case "LOCAL_ALIAS":
      metrics.NEW_EDGES_RESOLVED_ALIAS += edgeCount;
      break;
    case "LOCAL_PARALLEL":
      metrics.NEW_EDGES_RESOLVED_PARALLEL += edgeCount;
      break;
    case "CONTEXTUAL_SHORT_CITE":
      metrics.NEW_EDGES_RESOLVED_CONTEXTUAL += edgeCount;
      break;
    case "COURTLISTENER_CITATION_LOOKUP":
    case "COURTLISTENER_CLUSTER":
      metrics.NEW_EDGES_AUTHORITY_RESOLVED_EXTERNAL += edgeCount;
      break;
    default:
      break;
  }
  refreshDerived(metrics);
}

export function recordUnresolved(metrics: AntiRegressionMetrics, edgeCount: number, uniqueTargets: number): void {
  metrics.NEW_EDGES_TOTAL += edgeCount;
  metrics.NEW_EDGES_IDENTITY_UNRESOLVED += edgeCount;
  metrics.UNIQUE_NEW_UNRESOLVED_TARGETS += uniqueTargets;
  refreshDerived(metrics);
}

export function recordBackfill(metrics: AntiRegressionMetrics, edgeCount: number): void {
  metrics.OLD_EDGES_BACKFILLED += edgeCount;
  refreshDerived(metrics);
}

export function recordAuthorityResolvedWithoutAcquisition(metrics: AntiRegressionMetrics, n = 1): void {
  metrics.AUTHORITIES_RESOLVED_WITHOUT_ACQUISITION += n;
}

export function recordFullTextAcquisition(metrics: AntiRegressionMetrics, n = 1): void {
  metrics.FULL_TEXT_ACQUISITIONS += n;
}

export function recordLookupsAvoided(metrics: AntiRegressionMetrics, n: number): void {
  metrics.EXTERNAL_LOOKUPS_AVOIDED += n;
}

export function recordExternalLookups(metrics: AntiRegressionMetrics, lookups: number, newCases: number): void {
  if (newCases > 0) {
    metrics.EXTERNAL_LOOKUPS_PER_1000_NEW_CASES = (lookups / newCases) * 1000;
  }
  refreshDerived(metrics);
}

function refreshDerived(metrics: AntiRegressionMetrics): void {
  const resolved =
    metrics.NEW_EDGES_RESOLVED_LOCAL_EXACT +
    metrics.NEW_EDGES_RESOLVED_NORMALIZATION +
    metrics.NEW_EDGES_RESOLVED_ALIAS +
    metrics.NEW_EDGES_RESOLVED_PARALLEL +
    metrics.NEW_EDGES_RESOLVED_CONTEXTUAL +
    metrics.NEW_EDGES_AUTHORITY_RESOLVED_EXTERNAL;
  metrics.LOCAL_RESOLUTION_RATE =
    metrics.NEW_EDGES_TOTAL > 0
      ? (resolved - metrics.NEW_EDGES_AUTHORITY_RESOLVED_EXTERNAL) / metrics.NEW_EDGES_TOTAL
      : 0;
}

export function metricsForNewCaseBatch(input: {
  newEdgesTotal: number;
  byMethod: Partial<Record<ResolutionMethod, number>>;
  uniqueUnresolvedTargets: number;
  oldEdgesBackfilled: number;
  authoritiesResolvedWithoutAcquisition: number;
  fullTextAcquisitions: number;
  externalLookups: number;
  externalLookupsAvoided: number;
  newCases: number;
}): AntiRegressionMetrics {
  const m = emptyAntiRegressionMetrics();
  m.NEW_EDGES_TOTAL = input.newEdgesTotal;
  m.NEW_EDGES_RESOLVED_LOCAL_EXACT = input.byMethod.LOCAL_EXACT ?? 0;
  m.NEW_EDGES_RESOLVED_NORMALIZATION = input.byMethod.LOCAL_NORMALIZED ?? 0;
  m.NEW_EDGES_RESOLVED_ALIAS = input.byMethod.LOCAL_ALIAS ?? 0;
  m.NEW_EDGES_RESOLVED_PARALLEL = input.byMethod.LOCAL_PARALLEL ?? 0;
  m.NEW_EDGES_RESOLVED_CONTEXTUAL = input.byMethod.CONTEXTUAL_SHORT_CITE ?? 0;
  m.NEW_EDGES_AUTHORITY_RESOLVED_EXTERNAL =
    (input.byMethod.COURTLISTENER_CITATION_LOOKUP ?? 0) + (input.byMethod.COURTLISTENER_CLUSTER ?? 0);
  const resolved =
    m.NEW_EDGES_RESOLVED_LOCAL_EXACT +
    m.NEW_EDGES_RESOLVED_NORMALIZATION +
    m.NEW_EDGES_RESOLVED_ALIAS +
    m.NEW_EDGES_RESOLVED_PARALLEL +
    m.NEW_EDGES_RESOLVED_CONTEXTUAL +
    m.NEW_EDGES_AUTHORITY_RESOLVED_EXTERNAL;
  m.NEW_EDGES_IDENTITY_UNRESOLVED = Math.max(0, input.newEdgesTotal - resolved);
  m.UNIQUE_NEW_UNRESOLVED_TARGETS = input.uniqueUnresolvedTargets;
  m.OLD_EDGES_BACKFILLED = input.oldEdgesBackfilled;
  m.AUTHORITIES_RESOLVED_WITHOUT_ACQUISITION = input.authoritiesResolvedWithoutAcquisition;
  m.FULL_TEXT_ACQUISITIONS = input.fullTextAcquisitions;
  m.EXTERNAL_LOOKUPS_AVOIDED = input.externalLookupsAvoided;
  m.LOCAL_RESOLUTION_RATE = input.newEdgesTotal > 0 ? (resolved - m.NEW_EDGES_AUTHORITY_RESOLVED_EXTERNAL) / input.newEdgesTotal : 0;
  m.EXTERNAL_LOOKUPS_PER_1000_NEW_CASES = input.newCases > 0 ? (input.externalLookups / input.newCases) * 1000 : 0;
  m.IDENTITY_UNRESOLVED_PER_1000_NEW_CASES =
    input.newCases > 0 ? (m.NEW_EDGES_IDENTITY_UNRESOLVED / input.newCases) * 1000 : 0;
  return m;
}
