import { LEGAL_STANDARD_TYPES, type LegalStandard, type LegalStandardType, type SourceProvenance } from "./types";

export class LegalIntelligenceError extends Error {
  readonly code: string;
  readonly abstention: string | null;
  constructor(code: string, message: string, abstention: string | null = null) {
    super(message);
    this.name = "LegalIntelligenceError";
    this.code = code;
    this.abstention = abstention;
  }
}

export function assertProvenance(provenance: SourceProvenance | null | undefined): void {
  if (!provenance) {
    throw new LegalIntelligenceError(
      "PROVENANCE_REQUIRED",
      "Intelligence records need source provenance.",
      "SOURCE_MISSING",
    );
  }
  const human = provenance.humanEntered === true || provenance.extractionOrigin === "human";
  const sourced = Boolean(provenance.documentId || provenance.authorityId || provenance.sourceSpan);
  if (!human && !sourced) {
    throw new LegalIntelligenceError(
      "PROVENANCE_REQUIRED",
      "Provenance must name a document, authority, source span, or a human origin.",
      "SOURCE_MISSING",
    );
  }
  if (!provenance.extractionOrigin && !human) {
    throw new LegalIntelligenceError(
      "PROVENANCE_ORIGIN_REQUIRED",
      "Provenance must record an extraction origin.",
      "SOURCE_MISSING",
    );
  }
}

export function createLegalStandard(
  input: Partial<LegalStandard> & Pick<LegalStandard, "id" | "ruleText" | "standardType" | "provenance">,
): LegalStandard {
  assertProvenance(input.provenance);
  if (!LEGAL_STANDARD_TYPES.includes(input.standardType)) {
    throw new LegalIntelligenceError("INVALID_STANDARD_TYPE", "Unknown legal standard type.");
  }
  const status = input.status ?? "needs_review";
  const standard: LegalStandard = {
    id: input.id,
    authorityId: input.authorityId ?? null,
    issueId: input.issueId ?? null,
    ruleText: input.ruleText,
    standardType: input.standardType,
    elements: input.elements ?? [],
    factors: input.factors ?? [],
    exceptions: input.exceptions ?? [],
    burdens: input.burdens ?? [],
    standardOfReview: input.standardOfReview ?? null,
    proceduralPosture: input.proceduralPosture ?? null,
    remedies: input.remedies ?? [],
    effectiveContext: input.effectiveContext ?? null,
    sourceSpan: input.sourceSpan ?? null,
    sourcePage: input.sourcePage ?? null,
    sourceCitation: input.sourceCitation ?? null,
    confidence: input.confidence ?? "low",
    status,
    provenance: input.provenance,
  };
  if (status === "canonical") {
    if (!standard.authorityId || !standard.sourceSpan || !standard.sourceCitation) {
      throw new LegalIntelligenceError(
        "STANDARD_NOT_GROUNDED",
        "A canonical legal standard requires an authority, a source span, and a citation.",
        "SOURCE_MISSING",
      );
    }
  }
  if (status !== "canonical" && status !== "unknown" && status !== "needs_review") {
    throw new LegalIntelligenceError("INVALID_STANDARD_STATUS", "Unsupported legal standard status.");
  }
  return standard;
}

export function isLegalStandardType(value: string): value is LegalStandardType {
  return (LEGAL_STANDARD_TYPES as readonly string[]).includes(value);
}
