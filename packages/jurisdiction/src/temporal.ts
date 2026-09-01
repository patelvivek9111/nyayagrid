import type { AuthorityJurisdictionMetadata, TemporalApplicability } from "./types";

function parseDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const day = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * Decision date alone is not treated as an effective date.
 * Missing effective window → UNKNOWN, not TRUE.
 */
export function isAuthorityTemporallyApplicable(
  authority: Pick<AuthorityJurisdictionMetadata, "decisionDate" | "effectiveStart" | "effectiveEnd">,
  asOfDate: string | null | undefined,
): TemporalApplicability {
  const asOf = parseDay(asOfDate);
  const start = parseDay(authority.effectiveStart);
  const end = parseDay(authority.effectiveEnd);
  if (!asOf || (!start && !end)) return "unknown";
  if (start && asOf < start) return "inapplicable";
  if (end && asOf > end) return "inapplicable";
  if (start || end) return "applicable";
  return "unknown";
}
