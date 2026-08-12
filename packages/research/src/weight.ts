export type AuthorityWeightLabel = "potentially_binding" | "persuasive" | "unknown";

export type AuthorityWeightInput = {
  authorityJurisdiction?: string | null;
  authorityCourt?: string | null;
  queryJurisdiction?: string | null;
};

export type AuthorityWeightAssessment = {
  label: AuthorityWeightLabel;
  /** Plain-language reason, safe to show a lawyer without implying a verified precedential ruling. */
  reason: string;
};

function normalize(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Court metadata must identify an actual court, not a placeholder, before we will consider
 * calling an authority potentially binding.
 */
const PLACEHOLDER_COURTS = new Set(["unknown", "n/a", "na", "none", "unspecified", "-", "--"]);

function hasUsableCourt(court: string | null): boolean {
  if (!court) return false;
  if (PLACEHOLDER_COURTS.has(court)) return false;
  return court.length >= 3;
}

/**
 * Coarse, conservative weight classification. NyayaGrid never produces numeric authority scores
 * and never claims binding force unless jurisdiction matches and court metadata is present.
 * "potentially_binding" means "may be binding — verify"; it is not a precedential determination.
 */
export function classifyAuthorityWeight(input: AuthorityWeightInput): AuthorityWeightAssessment {
  const authorityJurisdiction = normalize(input.authorityJurisdiction);
  const queryJurisdiction = normalize(input.queryJurisdiction);
  const court = normalize(input.authorityCourt);

  if (!queryJurisdiction) {
    return {
      label: "unknown",
      reason: "No jurisdiction was specified for the research question.",
    };
  }
  if (!authorityJurisdiction) {
    return {
      label: "unknown",
      reason: "This authority has no recorded jurisdiction.",
    };
  }
  if (authorityJurisdiction !== queryJurisdiction) {
    return {
      label: "persuasive",
      reason: `Authority jurisdiction (${input.authorityJurisdiction}) differs from the research jurisdiction (${input.queryJurisdiction}).`,
    };
  }
  if (!hasUsableCourt(court)) {
    return {
      label: "unknown",
      reason:
        "Jurisdiction matches, but the authority has insufficient court metadata to assess binding force.",
    };
  }
  return {
    label: "potentially_binding",
    reason: `Same jurisdiction (${input.authorityJurisdiction}) and a recorded court (${input.authorityCourt}). Binding force still requires attorney verification of court hierarchy and currentness.`,
  };
}
