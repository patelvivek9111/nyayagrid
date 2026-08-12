export const TREATMENT_UNVERIFIED_NOTICE = "Current treatment has not been independently verified.";

export type AuthorityTreatmentStatus = "unknown" | "source_reported";

export type TreatmentRelationship = {
  relationshipType: string;
  label?: string | null;
  origin?: string | null;
  toAuthorityId?: string | null;
};

export type TreatmentDisplayInput = {
  treatmentStatus?: AuthorityTreatmentStatus | string | null;
  sourceProvider?: string | null;
  relationships?: TreatmentRelationship[];
};

export type TreatmentDisplay = {
  status: AuthorityTreatmentStatus;
  label: string;
  /** Notices that must be rendered with the authority. Never empty. */
  notes: string[];
  /** Relationship rows reported by the source, passed through without editorial interpretation. */
  reportedRelationships: TreatmentRelationship[];
};

/**
 * Editorial treatment vocabulary NyayaGrid must never generate on its own. These conclusions can
 * only be displayed when a source explicitly reported them.
 */
const EDITORIAL_TREATMENT_TERMS = [
  "overruled",
  "reversed",
  "vacated",
  "abrogated",
  "superseded",
  "questioned",
  "criticized",
  "distinguished",
  "followed",
  "affirmed",
  "good law",
  "still valid",
];

export function containsEditorialTreatmentClaim(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return EDITORIAL_TREATMENT_TERMS.some((term) => normalized.includes(term));
}

/**
 * Guard for any treatment text that reaches a user: editorial conclusions are only allowed when
 * they came from a source that reported them.
 */
export function assertTreatmentClaimIsSourced(value: string | null | undefined, sourced: boolean) {
  if (!sourced && containsEditorialTreatmentClaim(value)) {
    throw new Error(
      "Refusing to display an editorial treatment conclusion that no source reported",
    );
  }
}

function isSourceReported(input: TreatmentDisplayInput): boolean {
  if (input.treatmentStatus !== "source_reported") return false;
  const relationships = input.relationships ?? [];
  return relationships.some(
    (relationship) =>
      Boolean(relationship.relationshipType) &&
      (relationship.origin === "source_metadata" || relationship.origin === "reviewed"),
  );
}

/**
 * Build the treatment block for an authority. Without source-reported relationship data, the
 * only honest answer is "unknown" plus the unverified-treatment notice.
 */
export function getTreatmentDisplay(input: TreatmentDisplayInput): TreatmentDisplay {
  if (!isSourceReported(input)) {
    return {
      status: "unknown",
      label: "Treatment unknown",
      notes: [TREATMENT_UNVERIFIED_NOTICE],
      reportedRelationships: [],
    };
  }

  const reportedRelationships = (input.relationships ?? []).filter(
    (relationship) =>
      relationship.origin === "source_metadata" || relationship.origin === "reviewed",
  );
  const provider = input.sourceProvider?.trim();

  return {
    status: "source_reported",
    label: "Treatment as reported by source",
    notes: [
      provider
        ? `Treatment signals below are reported by ${provider} and are passed through without NyayaGrid editorial analysis.`
        : "Treatment signals below are reported by the ingesting source and are passed through without NyayaGrid editorial analysis.",
    ],
    reportedRelationships,
  };
}

/** Short, display-safe treatment sentence for lists and summaries. */
export function getTreatmentSummaryLine(input: TreatmentDisplayInput): string {
  const display = getTreatmentDisplay(input);
  return `${display.label}. ${display.notes.join(" ")}`.trim();
}
