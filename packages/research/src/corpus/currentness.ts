/**
 * Conservative currentness helpers for public primary-law authorities.
 * Never claim Shepard's/KeyCite-level status from these labels alone.
 *
 * Invariant: lack of evidence ≠ CURRENT.
 */

export const CURRENTNESS_STATUSES = [
  "unknown",
  "current_as_of_source_date",
  "current_verified_from_source",
  "historical",
  "superseded",
] as const;

export type CurrentnessStatus = (typeof CURRENTNESS_STATUSES)[number];

const CURRENT_LIKE = new Set<CurrentnessStatus>([
  "current_as_of_source_date",
  "current_verified_from_source",
]);

export function resolveCurrentnessStatus(params: {
  sourceAssertsCurrent?: boolean;
  verifiedFromSourceAt?: string | null;
  superseded?: boolean;
  /** Deterministic repeal evidence maps to superseded (schema has no separate repealed enum). */
  repealed?: boolean;
  historicalOnly?: boolean;
  sourceDatePresent?: boolean;
}): CurrentnessStatus {
  if (params.superseded || params.repealed) return "superseded";
  if (params.historicalOnly) return "historical";
  if (params.sourceAssertsCurrent && params.verifiedFromSourceAt) {
    return "current_verified_from_source";
  }
  // sourceAssertsCurrent alone is insufficient — never silent-current.
  if (params.sourceDatePresent) return "current_as_of_source_date";
  return "unknown";
}

/**
 * Initialize currentness for ingest / incremental authority creation.
 * Explicit caller status is honored only when it does not invent CURRENT without evidence.
 */
export function initializeAuthorityCurrentness(params: {
  authorityType: string;
  explicitStatus?: CurrentnessStatus | null;
  decisionDate?: string | null;
  effectiveDate?: string | null;
  lastCheckedAt?: string | null;
  sourceAssertsCurrent?: boolean;
  verifiedFromSourceAt?: string | null;
  superseded?: boolean;
  repealed?: boolean;
  historicalOnly?: boolean;
}): CurrentnessStatus {
  if (params.superseded || params.repealed) return "superseded";
  if (params.historicalOnly) return "historical";

  if (params.explicitStatus) {
    // Cases are holdings: never keep CURRENT-like labels when a decision date exists.
    if (
      params.authorityType === "case" &&
      params.decisionDate &&
      CURRENT_LIKE.has(params.explicitStatus)
    ) {
      return "historical";
    }
    if (CURRENT_LIKE.has(params.explicitStatus)) {
      const hasEvidence =
        Boolean(params.verifiedFromSourceAt) ||
        Boolean(params.effectiveDate) ||
        (params.explicitStatus === "current_as_of_source_date" &&
          (Boolean(params.sourceAssertsCurrent) || Boolean(params.effectiveDate))) ||
        (params.explicitStatus === "current_verified_from_source" &&
          Boolean(params.verifiedFromSourceAt || params.lastCheckedAt));
      if (!hasEvidence) return "unknown";
    }
    return params.explicitStatus;
  }

  // Cases with a decision date are historical holdings, not "current law".
  if (params.authorityType === "case" && params.decisionDate) {
    return "historical";
  }

  return resolveCurrentnessStatus({
    sourceAssertsCurrent: params.sourceAssertsCurrent,
    verifiedFromSourceAt: params.verifiedFromSourceAt,
    sourceDatePresent: Boolean(params.effectiveDate),
  });
}

/** True when a status claims currentness without the minimum supporting evidence. */
export function isSilentCurrentClaim(params: {
  status: CurrentnessStatus;
  lastCheckedAt?: string | null;
  effectiveDate?: string | null;
  verifiedFromSourceAt?: string | null;
}): boolean {
  if (!CURRENT_LIKE.has(params.status)) return false;
  if (params.status === "current_verified_from_source") {
    return !(params.verifiedFromSourceAt || params.lastCheckedAt);
  }
  // current_as_of_source_date requires an effective/source date marker
  return !(params.effectiveDate || params.lastCheckedAt || params.verifiedFromSourceAt);
}

export function currentnessDisclaimer(status: CurrentnessStatus): string {
  switch (status) {
    case "current_verified_from_source":
      return "Currentness verified against the configured official source as of last check. Not a Shepard's/KeyCite treatment status.";
    case "current_as_of_source_date":
      return "Shown as of the source publication/effective date. Subsequent amendments may exist.";
    case "historical":
      return "Historical text. Do not treat as current law without verification.";
    case "superseded":
      return "Superseded according to corpus relationship metadata. Review successor versions.";
    default:
      return "Currentness is unknown. NyayaGrid does not claim this text is the latest law.";
  }
}
