/**
 * Deterministic / source-grounded prosecution case intelligence.
 * Organizes gaps, conflicts, and review queues — never guilt or charging conclusions.
 */

import type { RecordProvenance } from "@nyayagrid/database";
import {
  normalizeCustody,
  validateChainOfCustody,
  type CustodyFinding,
} from "../week4/chain-of-custody";
import { suggestDisclosureCandidates } from "../week4/discovery-ops";
import {
  detectTimelineConflicts,
  unifyCriminalTimeline,
  type ChronologyEvent,
  type TimelineConflict,
} from "../week4/timeline";
import type { InvestigationGap } from "../week4/types";
import {
  buildWitnessIntelligence,
  type WitnessIntelligenceResult,
  type WitnessStatementView,
} from "../week4/witness-intelligence";
import type { ElementMatrixRow } from "./domain";
import { compareWitnessStatements, type StatementClaim } from "./domain";

export type ProsecutionGapType =
  | "ELEMENT_NO_SUPPORT"
  | "ELEMENT_CONFLICTED"
  | "MISSING_PROVENANCE"
  | "CHAIN_OF_CUSTODY"
  | "WITNESS_CONFLICT"
  | "TIMELINE_CONFLICT"
  | "UNASSIGNED_EVIDENCE"
  | "JOINT_SCOPE_REVIEW"
  | "MISSING_STATEMENT_SOURCE"
  | "PROCEDURE_OPEN"
  | "DISCLOSURE_REVIEW_REQUIRED"
  | "OTHER";

export type ProsecutionInvestigationGap = {
  id: string;
  gapType: ProsecutionGapType;
  description: string;
  relatedChargeId: string | null;
  relatedElementId: string | null;
  relatedEvidenceIds: string[];
  relatedWitnessIds: string[];
  relatedTimelineEventIds: string[];
  relatedProcedureIssueIds: string[];
  relatedDisclosureIds: string[];
  reviewSeverity: "high" | "medium" | "low";
  humanStatus: "PROPOSED" | "REVIEW_REQUIRED" | "RESOLVED";
  sourceBasis: RecordProvenance;
  suggestedAction: string;
  priority: "high" | "medium" | "low";
  whyNeeded: string;
};

export type EvidenceLinkView = {
  id: string;
  evidenceId: string;
  relationship: string;
  targetType: string;
  targetId: string;
  provenance: RecordProvenance;
  origin: "human" | "import" | "deterministic" | "ai_proposal";
  reviewStatus: "PROPOSED" | "REVIEW_REQUIRED" | "APPROVED" | "REJECTED" | "RESOLVED";
  createdAt: string | Date;
};

export type CaseIntelligenceSnapshot = {
  investigationGaps: ProsecutionInvestigationGap[];
  timelineEvents: ChronologyEvent[];
  timelineConflicts: TimelineConflict[];
  witnessIntelligence: WitnessIntelligenceResult;
  suggestedDisclosureCandidates: ReturnType<typeof suggestDisclosureCandidates>;
  evidenceLinks: EvidenceLinkView[];
  overviewStats: {
    evidenceCount: number;
    witnessCount: number;
    discoveryCount: number;
    disclosureReviewRequired: number;
    elementSupported: number;
    elementConflicted: number;
    elementMissingSupport: number;
    custodyWarningCount: number;
    witnessConflictCount: number;
    timelineConflictCount: number;
    openProcedureIssues: number;
    openTasks: number;
  };
  guiltConclusion: null;
  chargingRecommendation: null;
  witnessCredibilityScore: null;
};

function provenanceOf(value: RecordProvenance | null | undefined): RecordProvenance {
  return (
    value ?? {
      extractionOrigin: "deterministic_fixture",
      humanEntered: false,
      sourceSpan: "case intelligence",
    }
  );
}

function hasUsableProvenance(value: RecordProvenance | null | undefined): boolean {
  if (!value) return false;
  return Boolean(
    value.humanEntered === true ||
    value.extractionOrigin === "human" ||
    value.documentId ||
    value.authorityId ||
    value.sourceSpan,
  );
}

export function buildProsecutionCaseIntelligence(input: {
  caseId: string;
  matrix: ElementMatrixRow[];
  evidence: Array<{
    id: string;
    evidenceType: string;
    relatedDefendantIds: string[];
    relatedChargeIds: string[];
    relatedElementIds: string[];
    chainOfCustody: unknown;
    provenance: RecordProvenance;
    custodyFindings?: CustodyFinding[];
  }>;
  evidenceLinks: Array<{
    id: string;
    evidenceId: string;
    relationship: string;
    targetType: string;
    targetId: string;
    provenance: RecordProvenance;
    createdAt: string | Date;
  }>;
  witnesses: Array<{ id: string; displayName: string }>;
  statements: Array<{
    id: string;
    witnessId: string;
    claims: Array<{ key: string; value: string; kind?: string }>;
    provenance: RecordProvenance;
    statementDate?: string | Date | null;
    sourceDocumentId?: string | null;
  }>;
  timeline: Array<{
    id: string;
    eventType: string;
    title: string;
    eventDate: string | Date | null;
    provenance: RecordProvenance;
  }>;
  procedureIssues: Array<{
    id: string;
    issueType: string;
    status: string;
    missingFacts?: string[];
  }>;
  disclosures: Array<{ id: string; status: string; category: string }>;
  discoveryCount: number;
  openTaskCount: number;
  defendantCount: number;
}): CaseIntelligenceSnapshot {
  const gaps: ProsecutionInvestigationGap[] = [];
  let gapSeq = 0;
  const nextId = (prefix: string) => `${prefix}-${input.caseId.slice(0, 8)}-${gapSeq++}`;

  for (const row of input.matrix) {
    if (row.status === "NO_EVIDENCE_FOUND" || row.status === "UNKNOWN") {
      gaps.push({
        id: nextId("elem"),
        gapType: "ELEMENT_NO_SUPPORT",
        description: `Element lacks supporting evidence: ${row.elementText}`,
        relatedChargeId: row.chargeId,
        relatedElementId: row.elementId,
        relatedEvidenceIds: [],
        relatedWitnessIds: [],
        relatedTimelineEventIds: [],
        relatedProcedureIssueIds: [],
        relatedDisclosureIds: [],
        reviewSeverity: "high",
        humanStatus: "REVIEW_REQUIRED",
        sourceBasis: provenanceOf(row.provenance as RecordProvenance),
        suggestedAction:
          "Identify source-linked evidence that addresses this element, or mark human-reviewed as unresolved.",
        priority: "high",
        whyNeeded: "Element coverage is incomplete in the case record.",
      });
    }
    if (row.status === "CONFLICTED") {
      gaps.push({
        id: nextId("conf"),
        gapType: "ELEMENT_CONFLICTED",
        description: `Element has conflicting evidence coverage: ${row.elementText}`,
        relatedChargeId: row.chargeId,
        relatedElementId: row.elementId,
        relatedEvidenceIds: [...row.supportingEvidenceIds, ...row.contraryEvidenceIds],
        relatedWitnessIds: [],
        relatedTimelineEventIds: [],
        relatedProcedureIssueIds: [],
        relatedDisclosureIds: [],
        reviewSeverity: "high",
        humanStatus: "REVIEW_REQUIRED",
        sourceBasis: provenanceOf(row.provenance as RecordProvenance),
        suggestedAction:
          "Review supporting and contrary evidence for this element. Do not treat status as a guilt finding.",
        priority: "high",
        whyNeeded: "Contrary and supporting evidence both appear for the same element.",
      });
    }
    for (const missing of row.missingEvidenceIds) {
      gaps.push({
        id: nextId("miss"),
        gapType: "ELEMENT_NO_SUPPORT",
        description: `Recorded missing evidence for element: ${missing}`,
        relatedChargeId: row.chargeId,
        relatedElementId: row.elementId,
        relatedEvidenceIds: [],
        relatedWitnessIds: [],
        relatedTimelineEventIds: [],
        relatedProcedureIssueIds: [],
        relatedDisclosureIds: [],
        reviewSeverity: "medium",
        humanStatus: "REVIEW_REQUIRED",
        sourceBasis: provenanceOf(row.provenance as RecordProvenance),
        suggestedAction:
          "Locate or document the missing item with provenance, or resolve as unavailable.",
        priority: "medium",
        whyNeeded: "An expected evidence item was marked missing on the element.",
      });
    }
  }

  let custodyWarningCount = 0;
  for (const item of input.evidence) {
    const findings =
      item.custodyFindings ?? validateChainOfCustody(normalizeCustody(item.chainOfCustody));
    const serious = findings.filter(
      (f) =>
        f.code === "CHAIN_GAP" ||
        f.code === "SEQUENCE_INCONSISTENCY" ||
        f.code === "MISSING_RECORD",
    );
    custodyWarningCount += serious.length;
    if (serious.length > 0) {
      gaps.push({
        id: nextId("coc"),
        gapType: "CHAIN_OF_CUSTODY",
        description: `Chain-of-custody review warnings on evidence ${item.evidenceType} (${item.id.slice(0, 8)}): ${serious.map((f) => f.code).join(", ")}`,
        relatedChargeId: item.relatedChargeIds[0] ?? null,
        relatedElementId: item.relatedElementIds[0] ?? null,
        relatedEvidenceIds: [item.id],
        relatedWitnessIds: [],
        relatedTimelineEventIds: [],
        relatedProcedureIssueIds: [],
        relatedDisclosureIds: [],
        reviewSeverity: "medium",
        humanStatus: "REVIEW_REQUIRED",
        sourceBasis: provenanceOf(item.provenance),
        suggestedAction:
          "Review custody sequence as an operational warning. Do not treat this as a finding of tampering unless a source or human review states that.",
        priority: "medium",
        whyNeeded: "Custody transfers are incomplete, inconsistent, or lack provenance.",
      });
    }
    if (!hasUsableProvenance(item.provenance)) {
      gaps.push({
        id: nextId("prov"),
        gapType: "MISSING_PROVENANCE",
        description: `Evidence item lacks usable provenance: ${item.evidenceType}`,
        relatedChargeId: null,
        relatedElementId: null,
        relatedEvidenceIds: [item.id],
        relatedWitnessIds: [],
        relatedTimelineEventIds: [],
        relatedProcedureIssueIds: [],
        relatedDisclosureIds: [],
        reviewSeverity: "medium",
        humanStatus: "REVIEW_REQUIRED",
        sourceBasis: {
          extractionOrigin: "deterministic_fixture",
          humanEntered: false,
          sourceSpan: item.id,
        },
        suggestedAction:
          "Attach a document, source span, or mark as human-entered with reviewer identity.",
        priority: "medium",
        whyNeeded: "Source traceability is required for case evidence intelligence.",
      });
    }
    if ((item.relatedDefendantIds?.length ?? 0) === 0 && input.defendantCount > 1) {
      gaps.push({
        id: nextId("unas"),
        gapType: "UNASSIGNED_EVIDENCE",
        description: `Evidence is unassigned while the case has multiple defendants: ${item.evidenceType}`,
        relatedChargeId: null,
        relatedElementId: null,
        relatedEvidenceIds: [item.id],
        relatedWitnessIds: [],
        relatedTimelineEventIds: [],
        relatedProcedureIssueIds: [],
        relatedDisclosureIds: [],
        reviewSeverity: "low",
        humanStatus: "PROPOSED",
        sourceBasis: provenanceOf(item.provenance),
        suggestedAction: "Confirm whether this evidence is joint or defendant-specific.",
        priority: "low",
        whyNeeded: "Multi-defendant scope should be explicit.",
      });
    }
    if ((item.relatedDefendantIds?.length ?? 0) > 1) {
      gaps.push({
        id: nextId("joint"),
        gapType: "JOINT_SCOPE_REVIEW",
        description: `Joint evidence linked to ${item.relatedDefendantIds.length} defendants — confirm charge/element applicability.`,
        relatedChargeId: item.relatedChargeIds[0] ?? null,
        relatedElementId: null,
        relatedEvidenceIds: [item.id],
        relatedWitnessIds: [],
        relatedTimelineEventIds: [],
        relatedProcedureIssueIds: [],
        relatedDisclosureIds: [],
        reviewSeverity: "low",
        humanStatus: "PROPOSED",
        sourceBasis: provenanceOf(item.provenance),
        suggestedAction:
          "Review whether joint evidence should also link to specific elements per defendant.",
        priority: "low",
        whyNeeded: "Joint evidence can apply differently across co-defendants.",
      });
    }
  }

  const witnessViews: WitnessStatementView[] = input.statements.map((statement) => {
    const witness = input.witnesses.find((w) => w.id === statement.witnessId);
    return {
      id: statement.id,
      witnessId: statement.witnessId,
      witnessName: witness?.displayName ?? "Witness",
      claims: (statement.claims ?? []).map((claim): StatementClaim => ({
        key: claim.key,
        value: claim.value,
        kind: claim.kind === "time" ? "time" : "fact",
      })),
      provenance: provenanceOf(statement.provenance),
      eventTime: statement.statementDate ? String(statement.statementDate) : null,
    };
  });

  for (const statement of input.statements) {
    if (!statement.sourceDocumentId && !hasUsableProvenance(statement.provenance)) {
      gaps.push({
        id: nextId("stmt"),
        gapType: "MISSING_STATEMENT_SOURCE",
        description: `Witness statement lacks document/source provenance (${statement.id.slice(0, 8)})`,
        relatedChargeId: null,
        relatedElementId: null,
        relatedEvidenceIds: [],
        relatedWitnessIds: [statement.witnessId],
        relatedTimelineEventIds: [],
        relatedProcedureIssueIds: [],
        relatedDisclosureIds: [],
        reviewSeverity: "medium",
        humanStatus: "REVIEW_REQUIRED",
        sourceBasis: provenanceOf(statement.provenance),
        suggestedAction: "Link the source document or record a human-entered provenance span.",
        priority: "medium",
        whyNeeded: "Statement comparisons require source-grounded passages.",
      });
    }
  }

  const witnessIntelligence = buildWitnessIntelligence({ statements: witnessViews });
  for (const row of witnessIntelligence.contradictions) {
    gaps.push({
      id: nextId("wit"),
      gapType: "WITNESS_CONFLICT",
      description: `Structural witness statement difference on "${row.key}": ${row.detail}`,
      relatedChargeId: null,
      relatedElementId: row.relatedElementId,
      relatedEvidenceIds: [],
      relatedWitnessIds: [
        ...new Set(
          witnessViews
            .filter((s) => s.id === row.statementA.id || s.id === row.statementB.id)
            .map((s) => s.witnessId),
        ),
      ],
      relatedTimelineEventIds: [],
      relatedProcedureIssueIds: [],
      relatedDisclosureIds: [],
      reviewSeverity: "high",
      humanStatus: "REVIEW_REQUIRED",
      sourceBasis: provenanceOf(row.statementA.source as RecordProvenance),
      suggestedAction:
        "Compare the source-backed statements. This is a structural difference, not a finding that a witness is untruthful.",
      priority: "high",
      whyNeeded:
        "Conflicting statement claims may affect elements, disclosure review, or investigation follow-up.",
    });
  }

  const chronology: ChronologyEvent[] = input.timeline.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    title: event.title,
    occurredAt: event.eventDate ? String(event.eventDate) : null,
    peopleIds: [],
    chargeIds: [],
    evidenceIds: [],
    documentIds: event.provenance?.documentId ? [event.provenance.documentId] : [],
    provenance: provenanceOf(event.provenance),
    confidence: "medium",
  }));
  const timelineEvents = unifyCriminalTimeline(chronology);
  const timelineConflicts = detectTimelineConflicts(timelineEvents);
  for (const conflict of timelineConflicts) {
    gaps.push({
      id: nextId("tl"),
      gapType: "TIMELINE_CONFLICT",
      description: `Timeline ${conflict.conflict} on ${conflict.eventType}`,
      relatedChargeId: null,
      relatedElementId: null,
      relatedEvidenceIds: [],
      relatedWitnessIds: [],
      relatedTimelineEventIds: [conflict.versionA.id, conflict.versionB.id],
      relatedProcedureIssueIds: [],
      relatedDisclosureIds: [],
      reviewSeverity: conflict.conflict === "ORDER_CONFLICT" ? "low" : "medium",
      humanStatus: "REVIEW_REQUIRED",
      sourceBasis: provenanceOf(conflict.versionA.provenance as RecordProvenance),
      suggestedAction:
        "Review both source-backed timeline entries. Do not silently reconcile the conflict.",
      priority: "medium",
      whyNeeded: "Date/time/order conflicts affect chronology reliability.",
    });
  }

  for (const issue of input.procedureIssues) {
    if (issue.status === "open" || issue.status === "OPEN") {
      gaps.push({
        id: nextId("proc"),
        gapType: "PROCEDURE_OPEN",
        description: `Open procedure issue: ${issue.issueType}${issue.missingFacts?.length ? ` — missing facts: ${issue.missingFacts.join("; ")}` : ""}`,
        relatedChargeId: null,
        relatedElementId: null,
        relatedEvidenceIds: [],
        relatedWitnessIds: [],
        relatedTimelineEventIds: [],
        relatedProcedureIssueIds: [issue.id],
        relatedDisclosureIds: [],
        reviewSeverity: "medium",
        humanStatus: "REVIEW_REQUIRED",
        sourceBasis: {
          extractionOrigin: "deterministic_fixture",
          humanEntered: false,
          sourceSpan: issue.id,
        },
        suggestedAction:
          "Complete human suppression/procedure review. Nyaya does not decide warrant validity.",
        priority: "medium",
        whyNeeded: "Open procedure issues remain for attorney review.",
      });
    }
  }

  for (const disclosure of input.disclosures) {
    if (
      disclosure.status === "REVIEW_REQUIRED" ||
      disclosure.status === "UNREVIEWED" ||
      disclosure.status === "ESCALATE"
    ) {
      gaps.push({
        id: nextId("disc"),
        gapType: "DISCLOSURE_REVIEW_REQUIRED",
        description: `Potential disclosure candidate (${disclosure.category}) awaits human review`,
        relatedChargeId: null,
        relatedElementId: null,
        relatedEvidenceIds: [],
        relatedWitnessIds: [],
        relatedTimelineEventIds: [],
        relatedProcedureIssueIds: [],
        relatedDisclosureIds: [disclosure.id],
        reviewSeverity: "high",
        humanStatus: "REVIEW_REQUIRED",
        sourceBasis: {
          extractionOrigin: "deterministic_fixture",
          humanEntered: false,
          sourceSpan: disclosure.id,
        },
        suggestedAction:
          "Complete human disclosure review. This is a potential disclosure candidate, not a final determination.",
        priority: "high",
        whyNeeded: "Final disclose / not-disclose determinations require prosecution.review.",
      });
    }
  }

  const suggestedDisclosureCandidates = suggestDisclosureCandidates({
    contradictoryEvidenceIds: input.evidence
      .filter((item) =>
        input.evidenceLinks.some(
          (link) =>
            link.evidenceId === item.id &&
            (link.relationship === "CONTRADICTS" || link.relationship === "UNDERMINES_ELEMENT"),
        ),
      )
      .map((item) => item.id),
    witnessConflictKeys: witnessIntelligence.contradictions.map((row) => row.key),
    weakElementIds: input.matrix
      .filter((row) => row.status === "CONFLICTED" || row.status === "NO_EVIDENCE_FOUND")
      .map((row) => row.elementId),
  });

  const evidenceLinks: EvidenceLinkView[] = input.evidenceLinks.map((link) => ({
    ...link,
    origin:
      link.provenance.humanEntered || link.provenance.extractionOrigin === "human"
        ? ("human" as const)
        : link.provenance.extractionOrigin === "import"
          ? ("import" as const)
          : ("deterministic" as const),
    reviewStatus: "APPROVED" as const,
  }));

  return {
    investigationGaps: gaps,
    timelineEvents,
    timelineConflicts,
    witnessIntelligence,
    suggestedDisclosureCandidates,
    evidenceLinks,
    overviewStats: {
      evidenceCount: input.evidence.length,
      witnessCount: input.witnesses.length,
      discoveryCount: input.discoveryCount,
      disclosureReviewRequired: input.disclosures.filter((d) =>
        ["REVIEW_REQUIRED", "UNREVIEWED", "ESCALATE"].includes(d.status),
      ).length,
      elementSupported: input.matrix.filter((r) => r.status === "SUPPORTED").length,
      elementConflicted: input.matrix.filter((r) => r.status === "CONFLICTED").length,
      elementMissingSupport: input.matrix.filter(
        (r) => r.status === "NO_EVIDENCE_FOUND" || r.status === "UNKNOWN",
      ).length,
      custodyWarningCount,
      witnessConflictCount: witnessIntelligence.contradictions.length,
      timelineConflictCount: timelineConflicts.length,
      openProcedureIssues: input.procedureIssues.filter(
        (i) => i.status === "open" || i.status === "OPEN",
      ).length,
      openTasks: input.openTaskCount,
    },
    guiltConclusion: null,
    chargingRecommendation: null,
    witnessCredibilityScore: null,
  };
}

export function formatProsecutionAskIntelligenceContext(
  snapshot: CaseIntelligenceSnapshot,
): string {
  const lines = [
    "PROSECUTION_CASE_INTELLIGENCE (case-scoped; draft work product)",
    `EVIDENCE_COUNT: ${snapshot.overviewStats.evidenceCount}`,
    `WITNESS_COUNT: ${snapshot.overviewStats.witnessCount}`,
    `ELEMENT_SUPPORTED: ${snapshot.overviewStats.elementSupported}`,
    `ELEMENT_CONFLICTED: ${snapshot.overviewStats.elementConflicted}`,
    `ELEMENT_MISSING_SUPPORT: ${snapshot.overviewStats.elementMissingSupport}`,
    `CUSTODY_WARNINGS: ${snapshot.overviewStats.custodyWarningCount}`,
    `WITNESS_STRUCTURAL_CONFLICTS: ${snapshot.overviewStats.witnessConflictCount}`,
    `TIMELINE_CONFLICTS: ${snapshot.overviewStats.timelineConflictCount}`,
    `DISCLOSURE_REVIEW_REQUIRED: ${snapshot.overviewStats.disclosureReviewRequired}`,
    `OPEN_PROCEDURE_ISSUES: ${snapshot.overviewStats.openProcedureIssues}`,
    "GUILT_CONCLUSION: null",
    "CHARGING_RECOMMENDATION: null",
    "WITNESS_CREDIBILITY_SCORE: null",
    "INVESTIGATION_GAPS:",
    ...snapshot.investigationGaps
      .slice(0, 40)
      .map(
        (gap) =>
          `- [${gap.gapType}] ${gap.description} | severity=${gap.reviewSeverity} | status=${gap.humanStatus}`,
      ),
    "EVIDENCE_LINKS:",
    ...snapshot.evidenceLinks
      .slice(0, 40)
      .map(
        (link) =>
          `- ${link.relationship} evidence=${link.evidenceId} -> ${link.targetType}:${link.targetId} origin=${link.origin}`,
      ),
    "WITNESS_COMPARISON_LABELS_ONLY: CONSISTENT|CONTRADICTORY|OMISSION|ADDED_DETAIL|TIMELINE_DIFFERENCE|UNKNOWN",
    "Do not invent facts, evidence, guilt predictions, or final disclosure determinations.",
  ];
  return lines.join("\n");
}

/** Re-export for tests that assert pairwise structural labels remain available. */
export { compareWitnessStatements };
