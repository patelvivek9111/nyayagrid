import { extractCitationsFromText } from "./citations";

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

export type WeightGuardHit = {
  citation?: string | null;
  title?: string | null;
  jurisdiction?: string | null;
  hierarchyRelationship?: string | null;
};

const CONTROLLING_TAIL =
  /is\s+(?:the\s+)?(?:controlling|binding)(?:\s+(?:authority|precedent|law))?\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function demoteControllingAfterNeedle(text: string, needle: string): string {
  const trimmed = needle.replace(/\s+/g, " ").trim();
  if (trimmed.length < 4) return text;
  const re = new RegExp(`(${escapeRegExp(trimmed)})(\\s+)(${CONTROLLING_TAIL.source})`, "gi");
  return text.replace(re, (full, cite: string, space: string, tail: string) => {
    if (/\bis\s+not\b/i.test(tail)) return full;
    return `${cite}${space}is not ${tail.replace(/^is\s+/i, "")}`;
  });
}

function forumLabels(queryJurisdiction?: string | null, extra?: string[]): string[] {
  return [queryJurisdiction, ...(extra ?? [])]
    .map((value) => value?.replace(/\s+/g, " ").trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
}

const STOP_TOKENS = new Set(["code", "the", "of", "and", "act", "stat", "ann", "for", "a"]);

function significantTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !STOP_TOKENS.has(token));
}

function citationSharesForum(citation: string, labels: string[]): boolean {
  const citeTokens = significantTokens(citation);
  const forumTokens = labels.flatMap(significantTokens);
  if (citeTokens.length === 0 || forumTokens.length === 0) return true;
  return citeTokens.some((token) => forumTokens.includes(token));
}

function labelConflictsWithForum(authorityJurisdiction: string, labels: string[]): boolean {
  const auth = authorityJurisdiction.replace(/\s+/g, " ").trim().toLowerCase();
  if (!auth || labels.length === 0) return false;
  if (labels.some((label) => label === auth || label.includes(auth) || auth.includes(label))) {
    return false;
  }
  return true;
}

/**
 * Deterministic post-synthesis guard: an authority that is not classified controlling
 * (or whose recorded jurisdiction conflicts with the query/forum) must not be described
 * as controlling or binding. Relationship comes from jurisdiction architecture, not model prose.
 */
export function rewriteUnsupportedControllingClaims(params: {
  text: string;
  hits: WeightGuardHit[];
  queryJurisdiction?: string | null;
  forumLabels?: string[];
}): string {
  let text = params.text;
  const labels = forumLabels(params.queryJurisdiction, params.forumLabels);
  for (const hit of params.hits) {
    const relationship = (hit.hierarchyRelationship ?? "unknown").toLowerCase();
    const outOfWeight =
      relationship === "persuasive" ||
      relationship === "out_of_jurisdiction" ||
      relationship === "unknown";
    const jurisdictionConflict =
      Boolean(hit.jurisdiction) && labelConflictsWithForum(hit.jurisdiction ?? "", labels);
    if (!outOfWeight && !jurisdictionConflict) continue;
    for (const needle of [hit.citation, hit.title, hit.jurisdiction]) {
      if (needle) text = demoteControllingAfterNeedle(text, needle);
    }
  }
  for (const parsed of extractCitationsFromText(text)) {
    const raw = parsed.raw?.trim();
    if (!raw) continue;
    if (citationSharesForum(raw, labels) || citationSharesForum(parsed.reporter ?? "", labels)) {
      continue;
    }
    text = demoteControllingAfterNeedle(text, raw);
  }
  return text;
}
