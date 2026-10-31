/**
 * Prosecution Stage 5 legal workflow helpers.
 * Source-grounded procedure/motion/research/drafting support — never final legal conclusions.
 */

import type { RecordProvenance } from "@nyayagrid/database";
import { ProsecutionError, PROCEDURE_ISSUE_TYPES } from "./domain";

export const MOTION_TYPES = [
  "MOTION_TO_SUPPRESS",
  "MOTION_IN_LIMINE",
  "MOTION_TO_COMPEL",
  "DISCOVERY_MOTION",
  "CONTINUANCE",
  "DISMISSAL_RELATED",
  "SEVERANCE",
  "JOINDER",
  "PROTECTIVE_ORDER",
  "EVIDENTIARY_MOTION",
  "RECONSIDERATION",
  "OTHER",
] as const;
export type MotionType = (typeof MOTION_TYPES)[number];

export const SUBPOENA_RETURN_STATUSES = [
  "PENDING",
  "RETURNED",
  "PARTIAL_RETURN",
  "NO_RESPONSE",
  "OBJECTED",
  "QUASHED_REFERENCE",
  "SUPPLEMENTAL_RETURN",
] as const;

export const AUTHORITY_HIERARCHY_STATUSES = [
  "BINDING",
  "PERSUASIVE",
  "CONTRARY",
  "UNCERTAIN_APPLICABILITY",
  "UNKNOWN",
] as const;

export const FORBIDDEN_AUTOMATED_LEGAL_LANGUAGE = [
  /\bwarrant invalid\b/i,
  /\bsearch unconstitutional\b/i,
  /\bsuppression required\b/i,
  /\bprobable cause (?:is|was) (?:lacking|absent|insufficient)\b/i,
  /\bmust (?:accept|reject) (?:the )?plea\b/i,
  /\bguilt(?:y)? (?:verdict|prediction|probability)\b/i,
  /\bcharging recommendation\b/i,
  /\bplea recommendation\b/i,
  /\bfile (?:this|the) motion (?:now|automatically)\b/i,
] as const;

export const SAFE_REVIEW_LANGUAGE = [
  "Potential issue requiring review",
  "Record is incomplete",
  "Authority may be relevant",
  "Human determination required",
  "DRAFT — human approval required before filing or sending",
] as const;

export type SuppressionAnalysisSections = {
  factsFromRecord: string[];
  missingFacts: string[];
  legalStandard: string | null;
  supportingAuthority: Array<{ citation: string; proposition: string; hierarchyStatus: string }>;
  contraryAuthority: Array<{ citation: string; proposition: string; hierarchyStatus: string }>;
  potentialArguments: string[];
  uncertainty: string[];
  humanConclusion: string | null;
  suppressionConclusion: null;
  validityConclusion: null;
  probableCauseConclusion: null;
};

export type PleaOfferSnapshot = {
  id: string;
  versionLabel: string | null;
  terms: string;
  conditions: string[];
  relatedChargeIds: string[];
  status: string;
  offerDate: string | null;
  expiration: string | null;
  defenseResponse: string | null;
  prosecutorNotes: string | null;
};

export type PleaComparison = {
  leftId: string;
  rightId: string;
  changedTerms: boolean;
  termDiffSummary: string;
  addedConditions: string[];
  removedConditions: string[];
  chargeSetChanged: boolean;
  missingInformation: string[];
  pleaRecommendation: null;
  acceptRejectRecommendation: null;
  pleaValueScore: null;
  convictionProbability: null;
};

export type HearingPrepView = {
  hearingId: string;
  hearingType: string;
  dateTime: string | null;
  issuesToAddress: string[];
  relevantFacts: string[];
  contraryFacts: string[];
  witnesses: string[];
  evidence: string[];
  motions: string[];
  authorities: string[];
  unresolvedGaps: string[];
  openTasks: string[];
  drafts: string[];
  recentDisclosureChanges: string[];
  argumentStrategyFinal: null;
  dateSource: "HUMAN_OR_SOURCE" | "UNKNOWN_NOT_PROVIDED";
};

export type DraftSourcePackage = {
  caseId: string;
  approvedFacts: string[];
  evidenceIds: string[];
  witnessStatementIds: string[];
  timelineEventIds: string[];
  legalIssueIds: string[];
  authorityIds: string[];
  legalStandardIds: string[];
  motionIds: string[];
  discoveryDisclosureNotes: string[];
  userInstructions: string[];
  status: "DRAFT";
  autonomousFiling: false;
};

export type CaseAuthorityPersistInput = {
  citation: string;
  proposition: string;
  jurisdiction?: string | null;
  court?: string | null;
  hierarchyStatus: (typeof AUTHORITY_HIERARCHY_STATUSES)[number] | string;
  treatmentStatus?: string;
  relation?: "RELEVANT" | "CONTRARY" | "DISTINGUISHABLE" | string;
  sourceSpan?: string | null;
  sourcePage?: number | null;
  authorityId?: string | null;
  relatedIssueIds?: string[];
  relatedMotionIds?: string[];
  relatedWarrantIds?: string[];
  provenance: RecordProvenance;
};

export function assertSafeLegalWorkflowCopy(text: string | null | undefined): void {
  if (!text) return;
  for (const pattern of FORBIDDEN_AUTOMATED_LEGAL_LANGUAGE) {
    if (pattern.test(text)) {
      throw new ProsecutionError(
        "LEGAL_WORKFLOW_LANGUAGE_FORBIDDEN",
        "Automated suppression, plea, or filing conclusions are not permitted. Use review-required wording for human judgment.",
      );
    }
  }
}

export function normalizeMotionType(raw: string): MotionType | string {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, MotionType> = {
    SUPPRESS: "MOTION_TO_SUPPRESS",
    MOTION_TO_SUPPRESS: "MOTION_TO_SUPPRESS",
    IN_LIMINE: "MOTION_IN_LIMINE",
    MOTION_IN_LIMINE: "MOTION_IN_LIMINE",
    COMPEL: "MOTION_TO_COMPEL",
    MOTION_TO_COMPEL: "MOTION_TO_COMPEL",
    DISCOVERY: "DISCOVERY_MOTION",
    DISCOVERY_MOTION: "DISCOVERY_MOTION",
    CONTINUANCE: "CONTINUANCE",
    DISMISSAL: "DISMISSAL_RELATED",
    DISMISSAL_RELATED: "DISMISSAL_RELATED",
    SEVERANCE: "SEVERANCE",
    JOINDER: "JOINDER",
    PROTECTIVE_ORDER: "PROTECTIVE_ORDER",
    EVIDENTIARY: "EVIDENTIARY_MOTION",
    EVIDENTIARY_MOTION: "EVIDENTIARY_MOTION",
    RECONSIDERATION: "RECONSIDERATION",
    OTHER: "OTHER",
  };
  return (
    aliases[upper] ?? (MOTION_TYPES.includes(upper as MotionType) ? (upper as MotionType) : trimmed)
  );
}

export function assertProcedureIssueType(issueType: string): void {
  if (!(PROCEDURE_ISSUE_TYPES as readonly string[]).includes(issueType)) {
    throw new ProsecutionError("INVALID_PROCEDURE_ISSUE", "Unsupported procedure issue type.");
  }
}

export function assertHumanFinalLegalAction(params: {
  action:
    "suppression_conclusion" | "plea_decision" | "filing" | "subpoena_issuance" | "draft_approval";
  hasReviewCapability: boolean;
  humanActor: boolean;
}): void {
  if (!params.humanActor) {
    throw new ProsecutionError(
      "LEGAL_ACTION_HUMAN_REQUIRED",
      "Nyaya does not take final legal actions. A human actor is required.",
      403,
    );
  }
  if (!params.hasReviewCapability && params.action !== "draft_approval") {
    // draft approval can use motion.manage; other finals need review for consequential strategy
    if (params.action === "filing" || params.action === "subpoena_issuance") {
      throw new ProsecutionError(
        "LEGAL_ACTION_FORBIDDEN",
        "Filing and subpoena issuance are human-controlled and not available as autonomous Nyaya actions.",
        403,
      );
    }
  }
  if (
    (params.action === "suppression_conclusion" || params.action === "plea_decision") &&
    !params.hasReviewCapability
  ) {
    throw new ProsecutionError(
      "LEGAL_CONCLUSION_REVIEW_REQUIRED",
      "Final suppression conclusions and plea decisions require prosecution.review.",
      403,
    );
  }
  if (params.action === "filing" || params.action === "subpoena_issuance") {
    throw new ProsecutionError(
      "AUTONOMOUS_LEGAL_ACTION_FORBIDDEN",
      "Nyaya does not file documents, issue subpoenas, or communicate with the court.",
      403,
    );
  }
}

export function assertDateProvidedOrUnknown(params: {
  value: string | null | undefined;
  fieldLabel: string;
}): string | null {
  if (params.value == null || String(params.value).trim() === "") {
    return null;
  }
  return String(params.value);
}

export function dateDisplayLabel(value: string | null | undefined): string {
  if (value == null || String(value).trim() === "") return "UNKNOWN / NOT PROVIDED";
  return String(value);
}

export function buildSuppressionAnalysisSections(input: {
  knownFacts?: string[];
  disputedFacts?: string[];
  missingFacts?: string[];
  legalStandard?: string | null;
  supportingAuthority?: SuppressionAnalysisSections["supportingAuthority"];
  contraryAuthority?: SuppressionAnalysisSections["contraryAuthority"];
  potentialArguments?: string[];
  uncertainty?: string[];
  humanConclusion?: string | null;
}): SuppressionAnalysisSections {
  return {
    factsFromRecord: [...(input.knownFacts ?? []), ...(input.disputedFacts ?? [])],
    missingFacts: input.missingFacts ?? [],
    legalStandard: input.legalStandard ?? null,
    supportingAuthority: input.supportingAuthority ?? [],
    contraryAuthority: input.contraryAuthority ?? [],
    potentialArguments: input.potentialArguments ?? [],
    uncertainty: input.uncertainty ?? [],
    humanConclusion: input.humanConclusion ?? null,
    suppressionConclusion: null,
    validityConclusion: null,
    probableCauseConclusion: null,
  };
}

export function comparePleaOffers(
  left: PleaOfferSnapshot,
  right: PleaOfferSnapshot,
): PleaComparison {
  const leftConditions = new Set(left.conditions);
  const rightConditions = new Set(right.conditions);
  const addedConditions = right.conditions.filter((c) => !leftConditions.has(c));
  const removedConditions = left.conditions.filter((c) => !rightConditions.has(c));
  const leftCharges = new Set(left.relatedChargeIds);
  const rightCharges = new Set(right.relatedChargeIds);
  const chargeSetChanged =
    left.relatedChargeIds.length !== right.relatedChargeIds.length ||
    left.relatedChargeIds.some((id) => !rightCharges.has(id)) ||
    right.relatedChargeIds.some((id) => !leftCharges.has(id));
  const changedTerms = left.terms.trim() !== right.terms.trim();
  const missingInformation: string[] = [];
  if (!left.offerDate && !right.offerDate) missingInformation.push("offer date not provided");
  if (!left.expiration && !right.expiration) {
    missingInformation.push("expiration date UNKNOWN / NOT PROVIDED");
  }
  if (left.relatedChargeIds.length === 0 && right.relatedChargeIds.length === 0) {
    missingInformation.push("no linked charges");
  }
  return {
    leftId: left.id,
    rightId: right.id,
    changedTerms,
    termDiffSummary: changedTerms
      ? "Terms differ between offers. Review both versions; Nyaya does not recommend accept or reject."
      : "Terms text is identical across versions.",
    addedConditions,
    removedConditions,
    chargeSetChanged,
    missingInformation,
    pleaRecommendation: null,
    acceptRejectRecommendation: null,
    pleaValueScore: null,
    convictionProbability: null,
  };
}

export function buildHearingPrepView(input: {
  hearingId: string;
  hearingType: string;
  dateTime: string | null;
  issuesToAddress?: string[];
  relevantFacts?: string[];
  contraryFacts?: string[];
  witnesses?: string[];
  evidence?: string[];
  motions?: string[];
  authorities?: string[];
  unresolvedGaps?: string[];
  openTasks?: string[];
  drafts?: string[];
  recentDisclosureChanges?: string[];
}): HearingPrepView {
  return {
    hearingId: input.hearingId,
    hearingType: input.hearingType,
    dateTime: input.dateTime,
    issuesToAddress: input.issuesToAddress ?? [],
    relevantFacts: input.relevantFacts ?? [],
    contraryFacts: input.contraryFacts ?? [],
    witnesses: input.witnesses ?? [],
    evidence: input.evidence ?? [],
    motions: input.motions ?? [],
    authorities: input.authorities ?? [],
    unresolvedGaps: input.unresolvedGaps ?? [],
    openTasks: input.openTasks ?? [],
    drafts: input.drafts ?? [],
    recentDisclosureChanges: input.recentDisclosureChanges ?? [],
    argumentStrategyFinal: null,
    dateSource: input.dateTime ? "HUMAN_OR_SOURCE" : "UNKNOWN_NOT_PROVIDED",
  };
}

export function buildDraftSourcePackage(input: {
  caseId: string;
  approvedFacts?: string[];
  evidenceIds?: string[];
  witnessStatementIds?: string[];
  timelineEventIds?: string[];
  legalIssueIds?: string[];
  authorityIds?: string[];
  legalStandardIds?: string[];
  motionIds?: string[];
  discoveryDisclosureNotes?: string[];
  userInstructions?: string[];
}): DraftSourcePackage {
  return {
    caseId: input.caseId,
    approvedFacts: input.approvedFacts ?? [],
    evidenceIds: input.evidenceIds ?? [],
    witnessStatementIds: input.witnessStatementIds ?? [],
    timelineEventIds: input.timelineEventIds ?? [],
    legalIssueIds: input.legalIssueIds ?? [],
    authorityIds: input.authorityIds ?? [],
    legalStandardIds: input.legalStandardIds ?? [],
    motionIds: input.motionIds ?? [],
    discoveryDisclosureNotes: input.discoveryDisclosureNotes ?? [],
    userInstructions: input.userInstructions ?? [],
    status: "DRAFT",
    autonomousFiling: false,
  };
}

export function assertPersistedAuthorityGrounded(input: CaseAuthorityPersistInput): void {
  if (!input.citation.trim() || !input.proposition.trim()) {
    throw new ProsecutionError(
      "AUTHORITY_SOURCE_REQUIRED",
      "Case authorities require a citation and proposition. Unsupported AI-created authority cannot be persisted.",
    );
  }
  const hasSource =
    Boolean(input.authorityId) ||
    Boolean(input.sourceSpan?.trim()) ||
    input.provenance.humanEntered === true ||
    input.provenance.extractionOrigin === "human" ||
    Boolean(input.provenance.documentId) ||
    Boolean(input.provenance.authorityId);
  if (!hasSource) {
    throw new ProsecutionError(
      "AUTHORITY_SOURCE_INSUFFICIENT",
      "Authority persistence requires a retrieved authority ID, source span, document, or human-entered provenance.",
    );
  }
  assertSafeLegalWorkflowCopy(input.proposition);
  assertSafeLegalWorkflowCopy(input.citation);
}

export function classifyDraftCitationMarker(params: {
  citationText: string;
  retrievedAuthorityIds: string[];
  matchedAuthorityId?: string | null;
}): "RETRIEVED" | "UNRESOLVED_UNVERIFIED" {
  if (
    params.matchedAuthorityId &&
    params.retrievedAuthorityIds.includes(params.matchedAuthorityId)
  ) {
    return "RETRIEVED";
  }
  if (
    /\[\s*citation needed\s*\]/i.test(params.citationText) ||
    /unverified/i.test(params.citationText)
  ) {
    return "UNRESOLVED_UNVERIFIED";
  }
  if (!params.matchedAuthorityId) {
    return "UNRESOLVED_UNVERIFIED";
  }
  return "UNRESOLVED_UNVERIFIED";
}

export function formatProsecutionLegalWorkflowAskContext(input: {
  openProcedureIssues: number;
  unresolvedSuppressionIssues: number;
  motions: Array<{ id: string; motionType: string; status: string }>;
  hearings: Array<{ id: string; hearingType: string; dateTime: string | null }>;
  subpoenas: Array<{ id: string; recipient: string; status: string; returnStatus: string }>;
  pleas: Array<{ id: string; versionLabel: string | null; status: string }>;
  authorities: Array<{
    id: string;
    citation: string;
    hierarchyStatus: string;
    relation: string;
  }>;
  drafts: Array<{ id: string; title: string; status: string }>;
}): string {
  const lines = [
    "PROSECUTION_LEGAL_WORKFLOW_CONTEXT (case-scoped; draft work product)",
    `OPEN_PROCEDURE_ISSUES: ${input.openProcedureIssues}`,
    `UNRESOLVED_SUPPRESSION_ISSUES: ${input.unresolvedSuppressionIssues}`,
    "MOTIONS:",
    ...(input.motions.length
      ? input.motions.slice(0, 40).map((m) => `- ${m.motionType} id=${m.id} status=${m.status}`)
      : ["- (none)"]),
    "HEARINGS:",
    ...(input.hearings.length
      ? input.hearings
          .slice(0, 40)
          .map(
            (h) => `- ${h.hearingType} id=${h.id} date=${h.dateTime ?? "UNKNOWN / NOT PROVIDED"}`,
          )
      : ["- (none)"]),
    "SUBPOENAS:",
    ...(input.subpoenas.length
      ? input.subpoenas
          .slice(0, 40)
          .map((s) => `- ${s.recipient} id=${s.id} status=${s.status} return=${s.returnStatus}`)
      : ["- (none)"]),
    "PLEA_OFFERS (tracking only; no recommendation):",
    ...(input.pleas.length
      ? input.pleas
          .slice(0, 40)
          .map((p) => `- ${p.versionLabel ?? "offer"} id=${p.id} status=${p.status}`)
      : ["- (none)"]),
    "CASE_AUTHORITIES:",
    ...(input.authorities.length
      ? input.authorities
          .slice(0, 40)
          .map(
            (a) =>
              `- ${a.citation} hierarchy=${a.hierarchyStatus} relation=${a.relation} id=${a.id}`,
          )
      : ["- (none)"]),
    "DRAFTS (remain DRAFT until human approval):",
    ...(input.drafts.length
      ? input.drafts.slice(0, 40).map((d) => `- ${d.title} id=${d.id} status=${d.status}`)
      : ["- (none)"]),
    "SUPPRESSION_CONCLUSION: null",
    "WARRANT_VALIDITY_CONCLUSION: null",
    "PLEA_RECOMMENDATION: null",
    "AUTONOMOUS_FILING: false",
    "AUTONOMOUS_SUBPOENA_ISSUANCE: false",
    "Distinguish potential issues for review from human legal determinations.",
    "Do not invent deadlines, citations, or final constitutional conclusions.",
  ];
  return lines.join("\n");
}

export function suggestLegalWorkflowTasks(input: {
  openProcedureIssues: number;
  motionsNeedingResponse: number;
  hearingsWithoutPrep: number;
  pendingSubpoenaReturns: number;
  pleaVersions: number;
  researchOpen: number;
}): string[] {
  const tasks: string[] = [];
  if (input.openProcedureIssues > 0) tasks.push("review warrant affidavit / procedure issue");
  if (input.motionsNeedingResponse > 0) tasks.push("prepare motion response");
  if (input.hearingsWithoutPrep > 0) tasks.push("prepare hearing");
  if (input.pendingSubpoenaReturns > 0) tasks.push("review subpoena return");
  if (input.pleaVersions > 1) tasks.push("review plea changes");
  if (input.researchOpen > 0) tasks.push("finish research memo");
  return tasks;
}
