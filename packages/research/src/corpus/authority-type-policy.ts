/**
 * Deterministic authority-type collision policy for corpus identity.
 * Source semantics win; do not arbitrarily relabel.
 */

export type AuthorityType = "case" | "statute" | "regulation" | "rule" | "constitution";

export type TypeCollisionDecision =
  | "keep_both_distinct"
  | "prefer_canonical_type"
  | "alias_normalized_citation"
  | "manual_review";

export type TypeCollisionInput = {
  citationA: string;
  typeA: AuthorityType;
  citationB: string;
  typeB: AuthorityType;
  jurisdiction?: string | null;
  sourceClassA?: string | null;
  sourceClassB?: string | null;
};

function collapse(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/§/g, "")
    .replace(/\./g, "")
    .replace(/,/g, "");
}

/** NY CPLR / similar codes are statutory procedure codes, not court "rules" families. */
const STATUTORY_PROCEDURE_MARKERS = [
  /n\.?\s*y\.?\s*c\.?\s*p\.?\s*l\.?\s*r/i,
  /n\.?\s*y\.?\s*cplr/i,
  /pa\.?\s*r\.?\s*c\.?\s*p/i, // Pa.R.C.P. is court rule — excluded below
];

const COURT_RULE_MARKERS = [
  /\br\.?\s*civ\.?\s*p\b/i,
  /\br\.?\s*evid\b/i,
  /\br\.?\s*app\.?\s*p\b/i,
  /\bpractice\s+book\b/i,
  /\brules?\s+of\s+court\b/i,
  /\bsup(?:er|r)?\.?\s*ct\.?\s*r\b/i,
  /\bmcr\b/i,
  /\bcrcp\b/i,
];

export function preferredAuthorityType(citation: string): AuthorityType | null {
  const c = citation.trim();
  if (/n\.?\s*y\.?\s*c\.?\s*p\.?\s*l\.?\s*r|n\.?\s*y\.?\s*cplr/i.test(c)) return "statute";
  if (/admin\.?\s*code|c\.?\s*f\.?\s*r|cmr|ricr|wac\b|o\.?\s*a\.?\s*c/i.test(c)) return "regulation";
  if (COURT_RULE_MARKERS.some((re) => re.test(c)) && !/n\.?\s*y\.?\s*c\.?\s*p\.?\s*l\.?\s*r/i.test(c)) {
    return "rule";
  }
  if (/u\.?\s*s\.?\s*c|rev\.?\s*stat|gen\.?\s*stat|code\s+ann/i.test(c)) return "statute";
  return null;
}

export function citationsLikelySameAuthority(a: string, b: string): boolean {
  const ca = collapse(a);
  const cb = collapse(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  // CPLR punctuation variants
  const norm = (x: string) =>
    x
      .replace(/n\.?y\.?c\.?p\.?l\.?r\.?/g, "nycplr")
      .replace(/n\.?y\.?cplr/g, "nycplr");
  return norm(ca) === norm(cb);
}

/**
 * Policy:
 * - Same authority, conflicting types → prefer preferredAuthorityType; alias the other cite.
 * - Distinct authorities (different section/rule) → keep both.
 * - Ambiguous → manual_review (never destructive auto-merge).
 */
export function resolveTypeCollision(input: TypeCollisionInput): {
  decision: TypeCollisionDecision;
  preferredType: AuthorityType | null;
  reason: string;
} {
  const same = citationsLikelySameAuthority(input.citationA, input.citationB);
  if (!same) {
    return {
      decision: "keep_both_distinct",
      preferredType: null,
      reason: "citations do not collapse to the same authority identity",
    };
  }
  if (input.typeA === input.typeB) {
    return {
      decision: "alias_normalized_citation",
      preferredType: input.typeA,
      reason: "same type duplicate — alias normalized citation forms",
    };
  }
  const preferred =
    preferredAuthorityType(input.citationA) ||
    preferredAuthorityType(input.citationB) ||
    null;
  if (!preferred) {
    return {
      decision: "manual_review",
      preferredType: null,
      reason: "same identity but no deterministic preferred type",
    };
  }
  return {
    decision: "prefer_canonical_type",
    preferredType: preferred,
    reason: `source semantics prefer ${preferred} for this citation family`,
  };
}

export const TYPE_COLLISION_POLICY_VERSION = "wave2i-v1";
