/**
 * CourtListener bulk citations.csv identity index (resolver-side).
 * Deterministic VRP → cluster mapping. No API. No fuzzy auto-resolve.
 */

import { classifyCaseCitationLookupEligibility } from "./eligibility.js";
import { experimentalNormalize, parseVolReporterPage } from "./normalize.js";

export const BULK_SNAPSHOT_ID = "COURTLISTENER_BULK_2026_09_30";

export type BulkIdentityStatus =
  | "RESOLVED_EXACT"
  | "RESOLVED_NORMALIZED"
  | "RESOLVED_PARALLEL"
  | "RESOLVED_ALIAS"
  | "RESOLVED_BULK_UNIQUE_VRP"
  | "AMBIGUOUS"
  | "NOT_FOUND"
  | "INELIGIBLE";

export type BulkLookupResult = {
  status: BulkIdentityStatus;
  reason: string;
  vrpKey: string | null;
  clusterIds: string[];
  clusterId: string | null;
  parallelCitations: string[];
};

/** Collapse reporter punctuation/spacing for crosswalk keys. */
export function compactReporter(reporter: string | null | undefined): string {
  return String(reporter || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function bulkVrpKey(
  volume: number | string,
  reporter: string | null | undefined,
  page: number | string,
): string | null {
  const v = Number(volume);
  const pageNum = Number(String(page).replace(/[^0-9].*$/, ""));
  const rep = compactReporter(reporter);
  if (!Number.isFinite(v) || !Number.isFinite(pageNum) || !rep) return null;
  return `${v}|${rep}|${pageNum}`;
}

export function citationToBulkVrpKey(rawOrNormalized: string | null | undefined): string | null {
  const lean = experimentalNormalize(rawOrNormalized) || String(rawOrNormalized || "");
  const parsed = parseVolReporterPage(lean);
  if (parsed) return bulkVrpKey(parsed.volume, parsed.reporter, parsed.page);
  const m = lean.match(/^(\d{1,4})\s+([A-Za-z0-9 .']+?)\s+(\d{1,5}[A-Za-z]?)$/);
  if (m) return bulkVrpKey(m[1], m[2], m[3]);
  return null;
}

export function formatBulkCitationDisplay(volume: string | number, reporter: string, page: string | number): string {
  return `${volume} ${String(reporter).trim()} ${page}`.replace(/\s+/g, " ").trim();
}

export function isSecondaryReporter(reporterCompact: string): boolean {
  return /^(sct|led|led2d|uslexis|wl|lexis)/.test(reporterCompact);
}

/**
 * Classify a bulk lookup given distinct cluster IDs and optional parallel display cites.
 * AUTO-resolve only when exactly one cluster.
 */
export function classifyBulkIdentity(input: {
  raw: string;
  normalized: string;
  clusterIds: string[];
  parallelCitations?: string[];
  vrpKey?: string | null;
}): BulkLookupResult {
  const el = classifyCaseCitationLookupEligibility(input.raw, input.normalized);
  const vrpKey = input.vrpKey ?? citationToBulkVrpKey(input.normalized) ?? citationToBulkVrpKey(input.raw);
  if (!el.eligible) {
    return {
      status: "INELIGIBLE",
      reason: el.lane,
      vrpKey,
      clusterIds: [],
      clusterId: null,
      parallelCitations: [],
    };
  }
  if (!vrpKey) {
    return {
      status: "NOT_FOUND",
      reason: "no_vrp_key",
      vrpKey: null,
      clusterIds: [],
      clusterId: null,
      parallelCitations: [],
    };
  }
  const unique = [...new Set(input.clusterIds.map(String).filter(Boolean))];
  if (unique.length === 0) {
    return {
      status: "NOT_FOUND",
      reason: "key_absent",
      vrpKey,
      clusterIds: [],
      clusterId: null,
      parallelCitations: [],
    };
  }
  if (unique.length > 1) {
    return {
      status: "AMBIGUOUS",
      reason: unique.length >= 3 ? "multi_cluster_3plus" : "multi_cluster_2",
      vrpKey,
      clusterIds: unique.slice(0, 12),
      clusterId: null,
      parallelCitations: [],
    };
  }

  const clusterId = unique[0]!;
  const parallels = [...new Set((input.parallelCitations || []).filter(Boolean))];
  const lean = experimentalNormalize(input.normalized) || input.normalized;
  const parsed = parseVolReporterPage(lean);
  const repCompact = parsed ? compactReporter(parsed.reporter) : compactReporter(lean);

  let status: BulkIdentityStatus = "RESOLVED_BULK_UNIQUE_VRP";
  // Prefer parallel/alias flavors before exact when reporter is a known secondary form.
  if (isSecondaryReporter(repCompact)) {
    status =
      parallels.some((p) => /\bU\.S\.\b|\bF\.(?:2d|3d|4th)\b/i.test(p)) || parallels.length > 1
        ? "RESOLVED_PARALLEL"
        : "RESOLVED_BULK_UNIQUE_VRP";
  } else if (
    parallels.some((p) => (experimentalNormalize(p) || p).toLowerCase() === lean.toLowerCase()) &&
    (experimentalNormalize(input.raw) || input.raw) !== lean
  ) {
    status = "RESOLVED_ALIAS";
  } else if ((experimentalNormalize(input.raw) || input.raw) === lean && input.normalized === lean) {
    status = "RESOLVED_EXACT";
  } else if (
    (experimentalNormalize(input.raw) || input.raw) !== lean ||
    experimentalNormalize(input.normalized) !== input.normalized
  ) {
    status = "RESOLVED_NORMALIZED";
  }

  return {
    status,
    reason: "unique_vrp_cluster",
    vrpKey,
    clusterIds: [clusterId],
    clusterId,
    parallelCitations: parallels,
  };
}

export function isDeterministicBulkStatus(status: BulkIdentityStatus): boolean {
  return (
    status === "RESOLVED_EXACT" ||
    status === "RESOLVED_NORMALIZED" ||
    status === "RESOLVED_PARALLEL" ||
    status === "RESOLVED_ALIAS" ||
    status === "RESOLVED_BULK_UNIQUE_VRP"
  );
}
