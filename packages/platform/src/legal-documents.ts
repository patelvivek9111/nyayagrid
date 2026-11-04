/**
 * Versioned Terms / Privacy identifiers for acceptance tracking.
 *
 * Content pages remain draft until independent attorney review. Acceptance records
 * prove a user acknowledged a specific version string — they do not create a
 * counsel-approved contract by themselves.
 */

export const LEGAL_DOCUMENT_STATUS = {
  terms: "DRAFT_PENDING_ATTORNEY_REVIEW",
  privacy: "DRAFT_PENDING_ATTORNEY_REVIEW",
} as const;

/** Bump when substantive Terms copy changes. */
export const CURRENT_TERMS_VERSION = "2026-11-04.wp04-draft.1";
/** Bump when substantive Privacy copy changes. */
export const CURRENT_PRIVACY_VERSION = "2026-11-04.wp04-draft.1";

export type LegalDocumentKind = "terms" | "privacy";

export type LegalDocumentDescriptor = {
  kind: LegalDocumentKind;
  version: string;
  status: string;
  path: string;
  attorneyReview: "PENDING";
};

export function getCurrentLegalDocuments(): LegalDocumentDescriptor[] {
  return [
    {
      kind: "terms",
      version: CURRENT_TERMS_VERSION,
      status: LEGAL_DOCUMENT_STATUS.terms,
      path: "/terms",
      attorneyReview: "PENDING",
    },
    {
      kind: "privacy",
      version: CURRENT_PRIVACY_VERSION,
      status: LEGAL_DOCUMENT_STATUS.privacy,
      path: "/privacy",
      attorneyReview: "PENDING",
    },
  ];
}

export function isKnownLegalVersion(kind: LegalDocumentKind, version: string): boolean {
  if (kind === "terms") return version === CURRENT_TERMS_VERSION;
  if (kind === "privacy") return version === CURRENT_PRIVACY_VERSION;
  return false;
}

export type LegalAcceptanceRecord = {
  kind: LegalDocumentKind;
  version: string;
  acceptedAt: string;
  userId: string;
  organizationId?: string | null;
};

export function buildLegalAcceptanceAuditAction(kind: LegalDocumentKind): string {
  return kind === "terms" ? "legal.terms_accepted" : "legal.privacy_accepted";
}
