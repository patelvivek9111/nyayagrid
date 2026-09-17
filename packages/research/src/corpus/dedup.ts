/**
 * Duplicate-candidate keys for corpus authorities.
 * Prefer strongest available identity when merging.
 */

export type DuplicateKeyKind =
  | "providerExternalId"
  | "canonicalCitation"
  | "courtDocketDate"
  | "canonicalUrl"
  | "contentHash";

export type DuplicateKeyCandidate = {
  kind: DuplicateKeyKind;
  value: string;
};

export type AuthorityDedupFields = {
  sourceProvider?: string | null;
  sourceExternalId?: string | null;
  normalizedCitation?: string | null;
  citation?: string | null;
  court?: string | null;
  docketNumber?: string | null;
  decisionDate?: string | null;
  canonicalSourceUrl?: string | null;
  contentHash?: string | null;
};

const KEY_STRENGTH: Record<DuplicateKeyKind, number> = {
  providerExternalId: 5,
  contentHash: 4,
  canonicalCitation: 3,
  courtDocketDate: 2,
  canonicalUrl: 1,
};

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Build ordered duplicate-key candidates from authority identity fields. */
export function findDuplicateKeyCandidates(fields: AuthorityDedupFields): DuplicateKeyCandidate[] {
  const out: DuplicateKeyCandidate[] = [];

  const provider = fields.sourceProvider?.trim();
  const externalId = fields.sourceExternalId?.trim();
  if (provider && externalId) {
    out.push({
      kind: "providerExternalId",
      value: `${normalizeKeyPart(provider)}::${normalizeKeyPart(externalId)}`,
    });
  }

  const citation = (fields.normalizedCitation ?? fields.citation)?.trim();
  if (citation) {
    out.push({ kind: "canonicalCitation", value: normalizeKeyPart(citation) });
  }

  const court = fields.court?.trim();
  const docket = fields.docketNumber?.trim();
  const date = fields.decisionDate?.trim();
  if (court && docket && date) {
    out.push({
      kind: "courtDocketDate",
      value: `${normalizeKeyPart(court)}::${normalizeKeyPart(docket)}::${normalizeKeyPart(date)}`,
    });
  }

  const url = fields.canonicalSourceUrl?.trim();
  if (url) {
    out.push({ kind: "canonicalUrl", value: normalizeKeyPart(url) });
  }

  const hash = fields.contentHash?.trim();
  if (hash) {
    out.push({ kind: "contentHash", value: normalizeKeyPart(hash) });
  }

  return out;
}

/** Pick the single strongest duplicate key among candidates. */
export function mergeDuplicateKeys(
  candidates: DuplicateKeyCandidate[],
): DuplicateKeyCandidate | null {
  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  for (let i = 1; i < candidates.length; i++) {
    const next = candidates[i]!;
    if (KEY_STRENGTH[next.kind] > KEY_STRENGTH[best.kind]) {
      best = next;
    }
  }
  return best;
}
