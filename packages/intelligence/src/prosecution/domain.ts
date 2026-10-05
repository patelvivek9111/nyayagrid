import { LegalIntelligenceError } from "../legal/standards";
import type { SourceProvenance } from "../legal/types";

export const CHARGE_ELEMENT_STATUSES = [
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "CONFLICTED",
  "NO_EVIDENCE_FOUND",
  "UNKNOWN",
] as const;
export type ChargeElementStatus = (typeof CHARGE_ELEMENT_STATUSES)[number];

export const EVIDENCE_RELATIONSHIPS = [
  "SUPPORTS_ELEMENT",
  "UNDERMINES_ELEMENT",
  "CORROBORATES",
  "CONTRADICTS",
  "IMPEACHES",
  "RELATED_TO",
  "FOUND_AT",
  "SEIZED_DURING",
  "MENTIONED_BY",
  "COLLECTED_BY",
  "SOURCE_OF",
] as const;
export type EvidenceRelationship = (typeof EVIDENCE_RELATIONSHIPS)[number];

export const WITNESS_COMPARISON_LABELS = [
  "CONSISTENT",
  "CONTRADICTORY",
  "OMISSION",
  "ADDED_DETAIL",
  "TIMELINE_DIFFERENCE",
  "UNKNOWN",
] as const;
export type WitnessComparisonLabel = (typeof WITNESS_COMPARISON_LABELS)[number];

export const DISCOVERY_STATUSES = [
  "RECEIVED",
  "REVIEWED",
  "FLAGGED",
  "PRODUCED",
  "WITHHELD_FOR_ATTORNEY_REVIEW",
  "UNKNOWN",
] as const;

export const DISCLOSURE_CATEGORIES = [
  "POTENTIALLY_EXCULPATORY",
  "POTENTIAL_IMPEACHMENT",
  "PRIOR_INCONSISTENT_STATEMENT",
  "EVIDENCE_WEAKENING_ELEMENT",
  "ALTERNATE_SUSPECT",
  "WITNESS_BENEFIT_OR_PROMISE",
  "CONTRADICTORY_EVIDENCE",
  "OTHER",
  "UNKNOWN",
] as const;

export const DISCLOSURE_STATUSES = [
  "UNREVIEWED",
  "REVIEW_REQUIRED",
  "REVIEWED_DISCLOSE",
  "REVIEWED_NOT_DISCLOSE",
  "ESCALATE",
] as const;
export type DisclosureStatus = (typeof DISCLOSURE_STATUSES)[number];

export const PROCEDURE_ISSUE_TYPES = [
  "SEARCH",
  "SEIZURE",
  "WARRANT",
  "PROBABLE_CAUSE",
  "CONSENT",
  "PLAIN_VIEW",
  "EXIGENT_CIRCUMSTANCES",
  "TRAFFIC_STOP",
  "SEARCH_INCIDENT_TO_ARREST",
  "MIRANDA",
  "CUSTODY",
  "INTERROGATION",
  "VOLUNTARINESS",
  "WAIVER",
  "IDENTIFICATION",
  "RIGHT_TO_COUNSEL",
  "OTHER",
  "UNKNOWN",
] as const;

export const PROSECUTION_TIMELINE_EVENT_TYPES = [
  "OFFENSE",
  "REPORT",
  "SEARCH",
  "SEIZURE",
  "ARREST",
  "INTERVIEW",
  "WARRANT_ISSUED",
  "WARRANT_EXECUTED",
  "CHARGE_FILED",
  "DISCOVERY_RECEIVED",
  "DISCOVERY_PRODUCED",
  "MOTION_FILED",
  "HEARING",
  "PLEA_EVENT",
  "TRIAL_EVENT",
  "SENTENCING",
  "OTHER",
] as const;
export type ProsecutionTimelineEventType = (typeof PROSECUTION_TIMELINE_EVENT_TYPES)[number];

export const PROSECUTION_GRAPH_NODE_TYPES = [
  "CriminalCase",
  "Defendant",
  "Charge",
  "ChargeElement",
  "Victim",
  "Witness",
  "Officer",
  "Agency",
  "EvidenceItem",
  "DiscoveryItem",
  "Warrant",
  "Motion",
  "Hearing",
  "Subpoena",
  "Authority",
  "LegalIssue",
] as const;

export const PROSECUTION_ROLES = [
  "PROSECUTION_OFFICE_ADMIN",
  "SUPERVISING_PROSECUTOR",
  "PROSECUTOR",
  "INVESTIGATOR",
  "LEGAL_SUPPORT",
  "PROSECUTION_READ_ONLY",
] as const;

export class ProsecutionError extends LegalIntelligenceError {
  readonly status: number;
  constructor(code: string, message: string, status = 400, abstention: string | null = null) {
    super(code, message, abstention);
    this.name = "ProsecutionError";
    this.status = status;
  }
}

export function assertTenant(organizationId: string, resourceOrganizationId: string): void {
  if (organizationId !== resourceOrganizationId) {
    throw new ProsecutionError("CROSS_TENANT", "Organization cannot access another organization's prosecution data.", 403);
  }
}

export function assertSameCase(caseId: string, resourceCaseId: string): void {
  if (caseId !== resourceCaseId) {
    throw new ProsecutionError("CROSS_CASE", "Evidence and charges cannot reference another criminal case.", 403);
  }
}

export function assertElementStatus(status: string): asserts status is ChargeElementStatus {
  if (status === "GUILTY" || status === "NOT_GUILTY") {
    throw new ProsecutionError("GUILT_STATUS_FORBIDDEN", "Element status cannot be a guilt verdict.");
  }
  if (!(CHARGE_ELEMENT_STATUSES as readonly string[]).includes(status)) {
    throw new ProsecutionError("INVALID_ELEMENT_STATUS", "Unsupported element status.");
  }
}

export function deriveElementStatus(input: {
  supportingEvidenceIds: string[];
  contraryEvidenceIds: string[];
  uncertainEvidenceIds: string[];
  missingEvidenceIds: string[];
}): ChargeElementStatus {
  const support = input.supportingEvidenceIds.length > 0;
  const contrary = input.contraryEvidenceIds.length > 0;
  const uncertain = input.uncertainEvidenceIds.length > 0;
  const missing = input.missingEvidenceIds.length > 0;
  if (support && contrary) return "CONFLICTED";
  if (support && uncertain) return "PARTIALLY_SUPPORTED";
  if (support) return "SUPPORTED";
  if (missing && !support) return "NO_EVIDENCE_FOUND";
  if (uncertain) return "PARTIALLY_SUPPORTED";
  return "UNKNOWN";
}

export type StatementClaim = {
  key: string;
  value: string;
  kind?: "fact" | "time";
};

export function compareWitnessStatements(left: StatementClaim[], right: StatementClaim[]): Array<{
  key: string;
  label: WitnessComparisonLabel;
  detail: string;
}> {
  const rightByKey = new Map(right.map((claim) => [claim.key, claim]));
  const leftKeys = new Set(left.map((claim) => claim.key));
  const out: Array<{ key: string; label: WitnessComparisonLabel; detail: string }> = [];
  for (const claim of left) {
    const other = rightByKey.get(claim.key);
    if (!other) {
      out.push({ key: claim.key, label: "OMISSION", detail: "The claim appears in one statement only." });
      continue;
    }
    if (claim.kind === "time" || other.kind === "time") {
      if (claim.value !== other.value) {
        out.push({ key: claim.key, label: "TIMELINE_DIFFERENCE", detail: "The statements give different times." });
        continue;
      }
    }
    if (claim.value === other.value) {
      out.push({ key: claim.key, label: "CONSISTENT", detail: "The statements match on this claim." });
    } else {
      out.push({
        key: claim.key,
        label: "CONTRADICTORY",
        detail: "The statements conflict. This is not a finding that a witness is untruthful.",
      });
    }
  }
  for (const claim of right) {
    if (!leftKeys.has(claim.key)) {
      out.push({ key: claim.key, label: "ADDED_DETAIL", detail: "The later statement adds a claim." });
    }
  }
  if (out.length === 0) {
    out.push({ key: "none", label: "UNKNOWN", detail: "No comparable claims were provided." });
  }
  return out;
}

export function transitionDisclosure(params: {
  next: DisclosureStatus;
  humanActor: boolean;
}): DisclosureStatus {
  if (!DISCLOSURE_STATUSES.includes(params.next)) {
    throw new ProsecutionError("INVALID_DISCLOSURE_STATUS", "Unsupported disclosure status.");
  }
  if ((params.next === "REVIEWED_DISCLOSE" || params.next === "REVIEWED_NOT_DISCLOSE") && !params.humanActor) {
    throw new ProsecutionError(
      "DISCLOSURE_HUMAN_REQUIRED",
      "Nyaya does not make the final disclosure determination.",
    );
  }
  return params.next;
}

export function assertTimelineEventType(eventType: string): asserts eventType is ProsecutionTimelineEventType {
  if (!(PROSECUTION_TIMELINE_EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw new ProsecutionError("INVALID_TIMELINE_EVENT", "Unsupported prosecution timeline event.");
  }
}

export function prosecutionCapabilityAllows(
  capabilities: ReadonlySet<string>,
  action: "view" | "edit" | "review",
): boolean {
  if (action === "view") return capabilities.has("prosecution.view") || capabilities.has("prosecution.edit") || capabilities.has("prosecution.review");
  if (action === "edit") return capabilities.has("prosecution.edit");
  return capabilities.has("prosecution.review");
}

export type ElementMatrixRow = {
  chargeId: string;
  offenseName: string;
  elementId: string;
  elementText: string;
  status: ChargeElementStatus;
  supportingEvidenceIds: string[];
  contraryEvidenceIds: string[];
  uncertainEvidenceIds: string[];
  missingEvidenceIds: string[];
  authorityIds: string[];
  provenance: SourceProvenance;
  humanReviewStatus: string;
  legalStandard:
    | {
        id: string;
        ruleText: string;
        sourceSpan: string;
        sourceCitation: string;
        authorityId: string;
      }
    | "STANDARD_NOT_EXTRACTED";
  bindingAuthorities: Array<{ authorityId: string; status: string; reasonCode: string; citation: string | null }>;
  persuasiveAuthorities: Array<{ authorityId: string; status: string; reasonCode: string; citation: string | null }>;
  contraryAuthorities: Array<{ authorityId: string; status: string; reasonCode: string; citation: string | null }>;
  guiltConclusion: null;
};

export function buildElementsMatrix(input: {
  charges: Array<{ id: string; offenseName: string }>;
  elements: Array<{
    id: string;
    chargeId: string;
    elementText: string;
    supportingEvidenceIds: string[];
    contraryEvidenceIds: string[];
    uncertainEvidenceIds: string[];
    missingEvidenceIds: string[];
    relatedAuthorityIds: string[];
    provenance: SourceProvenance;
    humanReviewStatus?: string;
    legalStandard?: ElementMatrixRow["legalStandard"];
    bindingAuthorities?: ElementMatrixRow["bindingAuthorities"];
    persuasiveAuthorities?: ElementMatrixRow["persuasiveAuthorities"];
    contraryAuthorities?: ElementMatrixRow["contraryAuthorities"];
  }>;
}): ElementMatrixRow[] {
  return input.elements.map((element) => {
    const charge = input.charges.find((item) => item.id === element.chargeId);
    if (!charge) {
      throw new ProsecutionError("ORPHAN_ELEMENT", "Charge element is missing its charge.");
    }
    const status = deriveElementStatus(element);
    assertElementStatus(status);
    return {
      chargeId: charge.id,
      offenseName: charge.offenseName,
      elementId: element.id,
      elementText: element.elementText,
      status,
      supportingEvidenceIds: element.supportingEvidenceIds,
      contraryEvidenceIds: element.contraryEvidenceIds,
      uncertainEvidenceIds: element.uncertainEvidenceIds,
      missingEvidenceIds: element.missingEvidenceIds,
      authorityIds: element.relatedAuthorityIds,
      provenance: element.provenance,
      humanReviewStatus: element.humanReviewStatus ?? "unreviewed",
      legalStandard: element.legalStandard ?? "STANDARD_NOT_EXTRACTED",
      bindingAuthorities: element.bindingAuthorities ?? [],
      persuasiveAuthorities: element.persuasiveAuthorities ?? [],
      contraryAuthorities: element.contraryAuthorities ?? [],
      guiltConclusion: null,
    };
  });
}
