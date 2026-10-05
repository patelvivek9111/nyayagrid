import { assertProvenance, LegalIntelligenceError } from "./standards";
import {
  CONFLICT_TYPES,
  TREATMENT_LABELS,
  type AuthorityConflict,
  type TreatmentLabel,
  type TreatmentRelationship,
} from "./types";

export function createTreatmentRelationship(input: {
  sourceAuthorityId: string;
  targetAuthorityId: string;
  treatment: TreatmentLabel;
  evidenceSpan?: string | null;
  sourcePage?: number | null;
  confidence?: TreatmentRelationship["confidence"];
  authoritativeMetadata?: boolean;
  provenance: TreatmentRelationship["provenance"];
}): TreatmentRelationship {
  assertProvenance(input.provenance);
  if (!TREATMENT_LABELS.includes(input.treatment)) {
    throw new LegalIntelligenceError("INVALID_TREATMENT", "Unsupported treatment label.");
  }
  const evidenceSpan = input.evidenceSpan?.trim() || null;
  const authoritativeMetadata = input.authoritativeMetadata === true;
  let verificationStatus: TreatmentRelationship["verificationStatus"] = "unknown";
  if (input.treatment === "UNKNOWN" || (!evidenceSpan && !authoritativeMetadata)) {
    verificationStatus = evidenceSpan || authoritativeMetadata ? "needs_review" : "unknown";
    if (!evidenceSpan && !authoritativeMetadata) {
      return {
        sourceAuthorityId: input.sourceAuthorityId,
        targetAuthorityId: input.targetAuthorityId,
        treatment: "UNKNOWN",
        evidenceSpan: null,
        sourcePage: input.sourcePage ?? null,
        confidence: "low",
        verificationStatus: "unknown",
        authoritativeMetadata: false,
        provenance: input.provenance,
      };
    }
  }
  if (evidenceSpan || authoritativeMetadata) {
    verificationStatus = "verified";
  }
  if (verificationStatus === "verified" && !evidenceSpan && !authoritativeMetadata) {
    throw new LegalIntelligenceError(
      "TREATMENT_UNVERIFIED",
      "A citation edge alone cannot verify treatment.",
      "TREATMENT_UNVERIFIED",
    );
  }
  return {
    sourceAuthorityId: input.sourceAuthorityId,
    targetAuthorityId: input.targetAuthorityId,
    treatment: verificationStatus === "verified" ? input.treatment : "UNKNOWN",
    evidenceSpan,
    sourcePage: input.sourcePage ?? null,
    confidence: verificationStatus === "verified" ? (input.confidence ?? "medium") : "low",
    verificationStatus,
    authoritativeMetadata,
    provenance: input.provenance,
  };
}

/** Citation existence is not treatment. */
export function treatmentFromCitationOnly(params: {
  sourceAuthorityId: string;
  targetAuthorityId: string;
}): { treatment: "UNKNOWN"; verificationStatus: "unknown"; abstention: "TREATMENT_UNVERIFIED" } {
  return {
    treatment: "UNKNOWN",
    verificationStatus: "unknown",
    abstention: "TREATMENT_UNVERIFIED",
  };
}

export function createAuthorityConflict(input: AuthorityConflict): AuthorityConflict {
  assertProvenance(input.provenance);
  if (!CONFLICT_TYPES.includes(input.conflictType)) {
    throw new LegalIntelligenceError("INVALID_CONFLICT", "Unsupported conflict type.");
  }
  if (input.conflictType !== "UNKNOWN" && input.supportingSourceSpans.length === 0 && input.status === "recorded") {
    return {
      ...input,
      status: "needs_review",
      confidence: "low",
    };
  }
  return input;
}
