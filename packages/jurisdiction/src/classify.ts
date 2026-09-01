import { getCourtById } from "./registry";
import { canonKey, normalizeCourtId, normalizeStateCode } from "./normalize";
import { US_STATES } from "./states";
import type {
  AuthorityJurisdictionMetadata,
  AuthorityRelationship,
  AuthorityRelationshipResult,
  CourtLevel,
  MatterJurisdictionContext,
} from "./types";

function asLevel(value: string | null | undefined): CourtLevel | null {
  if (
    value === "scotus" ||
    value === "circuit" ||
    value === "district" ||
    value === "state_high" ||
    value === "state_appellate" ||
    value === "state_trial" ||
    value === "administrative" ||
    value === "other" ||
    value === "unknown"
  ) {
    return value;
  }
  return null;
}

export function resolveAuthorityCourt(meta: AuthorityJurisdictionMetadata) {
  const fromId = meta.courtId ? getCourtById(meta.courtId) : null;
  const fromName = !fromId ? getCourtById(normalizeCourtId(meta.court)) : null;
  const court = fromId ?? fromName;
  const state =
    (meta.authorityState ? normalizeStateCode(meta.authorityState) : null) ??
    court?.state ??
    (meta.jurisdiction ? normalizeStateCode(meta.jurisdiction) : null);
  const level = asLevel(meta.courtLevel) ?? court?.level ?? null;
  const circuit = meta.federalCircuit ?? court?.federalCircuit ?? null;
  return { court, state, level, circuit };
}

function implicatedStates(matter: Pick<
  MatterJurisdictionContext,
  "primaryState" | "governingLawState" | "relatedJurisdictions"
>): Set<string> {
  const states = new Set<string>();
  if (matter.primaryState) states.add(matter.primaryState);
  if (matter.governingLawState) states.add(matter.governingLawState);
  for (const related of matter.relatedJurisdictions) {
    if (related.stateCode) states.add(related.stateCode);
  }
  return states;
}

/** True when a free-text jurisdiction label maps to one of the Case's implicated USPS codes. */
export function jurisdictionLabelMatchesStates(
  label: string | null | undefined,
  states: Set<string>,
): boolean {
  if (!label?.trim() || states.size === 0) return false;
  const code = normalizeStateCode(label);
  if (code && states.has(code)) return true;
  const folded = canonKey(label);
  if (!folded) return false;
  for (const state of US_STATES) {
    if (!states.has(state.code)) continue;
    if (canonKey(state.code) === folded || canonKey(state.name) === folded) return true;
    if (state.aliases.some((alias) => canonKey(alias) === folded)) return true;
  }
  return false;
}

/**
 * Deterministic hierarchy relationship. Never upgrades persuasive authority to controlling.
 * Conservative: same-state intermediate and trial courts are persuasive, not controlling.
 */
export function classifyAuthorityRelationship(
  matter: Pick<
    MatterJurisdictionContext,
    | "jurisdictionMode"
    | "forumType"
    | "primaryState"
    | "governingLawState"
    | "federalCircuit"
    | "relatedJurisdictions"
    | "courtId"
  >,
  authority: AuthorityJurisdictionMetadata,
): AuthorityRelationshipResult {
  if (matter.jurisdictionMode === "unknown" && !matter.primaryState && !matter.governingLawState) {
    return {
      relationship: "unknown",
      reason: "Case jurisdiction is unknown, so authority weight cannot be classified.",
    };
  }

  const resolved = resolveAuthorityCourt(authority);
  const states = implicatedStates(matter);
  const governing = matter.governingLawState ?? matter.primaryState ?? null;
  const type = (authority.authorityType ?? "").toLowerCase();
  const isCase = type === "case" || type === "" || type === "other";
  const isEnacted = type === "statute" || type === "regulation" || type === "constitution" || type === "rule";

  if (resolved.level === "scotus") {
    return {
      relationship: "controlling",
      reason: "U.S. Supreme Court authority is controlling on federal questions nationally.",
    };
  }

  if (isEnacted) {
    const authorityState = resolved.state ?? normalizeStateCode(authority.jurisdiction);
    if (!authorityState && /federal|united states|u\.s\./i.test(authority.jurisdiction ?? "")) {
      return {
        relationship: matter.forumType === "federal" || matter.jurisdictionMode === "federal" ? "controlling" : "persuasive",
        reason: "Federal enacted law. Binding effect still depends on the issue and requires attorney verification.",
      };
    }
    if (authorityState && governing && authorityState === governing) {
      return {
        relationship: "controlling",
        reason: `Enacted ${authorityState} law matches the Case governing/forum state. Not a determination that this provision is operative.`,
      };
    }
    if (authorityState && states.has(authorityState)) {
      return {
        relationship: "persuasive",
        reason: `${authorityState} enacted law is implicated but is not the governing/forum state for this Case.`,
      };
    }
    if (authorityState && !states.has(authorityState)) {
      return {
        relationship: "out_of_jurisdiction",
        reason: `${authorityState} enacted law is outside the Case forum and governing-law states.`,
      };
    }
    const rawJurisdiction = (authority.jurisdiction ?? "").trim();
    if (rawJurisdiction) {
      if (jurisdictionLabelMatchesStates(rawJurisdiction, states)) {
        return {
          relationship:
            governing && normalizeStateCode(rawJurisdiction) === governing
              ? "controlling"
              : "persuasive",
          reason:
            "Enacted-law jurisdiction label matches an implicated Case state, but court/code metadata is incomplete.",
        };
      }
      if (!/federal|united states|u\.s\./i.test(rawJurisdiction)) {
        return {
          relationship: "out_of_jurisdiction",
          reason: `Enacted-law jurisdiction "${rawJurisdiction}" is not the Case forum or governing-law state.`,
        };
      }
    }
    return { relationship: "unknown", reason: "Enacted authority lacks usable jurisdiction metadata." };
  }

  if (resolved.level === "circuit") {
    if (matter.federalCircuit && resolved.circuit === matter.federalCircuit) {
      return {
        relationship: "controlling",
        reason: `Same U.S. Court of Appeals (${resolved.circuit}) as the Case forum, subject to the Supreme Court.`,
      };
    }
    if (resolved.circuit && matter.federalCircuit && resolved.circuit !== matter.federalCircuit) {
      return {
        relationship: "persuasive",
        reason: `Out-of-circuit federal appellate authority (${resolved.circuit}) is generally persuasive, not controlling.`,
      };
    }
    return {
      relationship: "unknown",
      reason: "Federal circuit metadata is incomplete for this Case or authority.",
    };
  }

  if (resolved.level === "district") {
    return {
      relationship: "persuasive",
      reason: "Federal district court decisions are not circuit precedent and are not treated as controlling.",
    };
  }

  if (resolved.level === "state_high") {
    if (resolved.state && governing && resolved.state === governing) {
      return {
        relationship: "controlling",
        reason: `${resolved.state} court of last resort is controlling state-law authority within that state.`,
      };
    }
    if (resolved.state && states.has(resolved.state)) {
      return {
        relationship: "persuasive",
        reason: `${resolved.state} high-court authority is related to this Case but is not the governing-law state.`,
      };
    }
    if (resolved.state) {
      return {
        relationship: "out_of_jurisdiction",
        reason: `${resolved.state} high-court authority is not the forum or governing-law state for this Case.`,
      };
    }
  }

  if (resolved.level === "state_appellate" || resolved.level === "state_trial") {
    if (resolved.state && governing && resolved.state === governing) {
      return {
        relationship: "persuasive",
        reason: `Same-state ${resolved.level.replace("state_", "")} authority is not automatically controlling.`,
      };
    }
    if (resolved.state && !states.has(resolved.state)) {
      return {
        relationship: "out_of_jurisdiction",
        reason: `${resolved.state} ${resolved.level} authority is outside the Case jurisdictions.`,
      };
    }
    return {
      relationship: "persuasive",
      reason: "Lower or intermediate state-court authority is treated as persuasive unless a more specific rule applies.",
    };
  }

  if (isCase && resolved.state) {
    if (governing && resolved.state !== governing && !states.has(resolved.state)) {
      return {
        relationship: "out_of_jurisdiction",
        reason: `Authority from ${resolved.state} is not the Case forum or governing-law state.`,
      };
    }
    if (governing && resolved.state !== governing) {
      return {
        relationship: "persuasive",
        reason: `Authority from ${resolved.state} may be persuasive; it is not controlling ${governing} law.`,
      };
    }
    return {
      relationship: "unknown",
      reason: "Same-state case law lacks court-level metadata, so it is not labeled controlling.",
    };
  }

  const queryLabel = matter.governingLawState ?? matter.primaryState;
  const authorityLabel = normalizeStateCode(authority.jurisdiction) ?? authority.jurisdiction;
  if (queryLabel && authorityLabel && typeof authorityLabel === "string") {
    const authState = normalizeStateCode(String(authorityLabel));
    if (authState && authState !== queryLabel && !states.has(authState)) {
      return {
        relationship: "out_of_jurisdiction",
        reason: `Authority jurisdiction differs from the Case states.`,
      };
    }
  }

  return {
    relationship: "unknown",
    reason: "Insufficient court or jurisdiction metadata to classify this authority.",
  };
}

export function relationshipRank(relationship: AuthorityRelationship): number {
  switch (relationship) {
    case "controlling":
      return 4;
    case "persuasive":
      return 2;
    case "unknown":
      return 1;
    case "out_of_jurisdiction":
      return 0;
    default:
      return 1;
  }
}
