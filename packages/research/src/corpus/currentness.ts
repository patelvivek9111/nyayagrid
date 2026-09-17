/**
 * Conservative currentness helpers for public primary-law authorities.
 * Never claim Shepard's/KeyCite-level status from these labels alone.
 */

export const CURRENTNESS_STATUSES = [
  "unknown",
  "current_as_of_source_date",
  "current_verified_from_source",
  "historical",
  "superseded",
] as const;

export type CurrentnessStatus = (typeof CURRENTNESS_STATUSES)[number];

export function resolveCurrentnessStatus(params: {
  sourceAssertsCurrent?: boolean;
  verifiedFromSourceAt?: string | null;
  superseded?: boolean;
  historicalOnly?: boolean;
  sourceDatePresent?: boolean;
}): CurrentnessStatus {
  if (params.superseded) return "superseded";
  if (params.historicalOnly) return "historical";
  if (params.sourceAssertsCurrent && params.verifiedFromSourceAt) {
    return "current_verified_from_source";
  }
  if (params.sourceDatePresent) return "current_as_of_source_date";
  return "unknown";
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
