/**
 * Prosecution discovery + disclosure workflow helpers.
 * Surfaces potential candidates and tracks human review — never final Brady/Giglio conclusions.
 */

import type { DisclosureReviewHistoryEntry, RecordProvenance } from "@nyayagrid/database";
import {
  DISCLOSURE_CATEGORIES,
  DISCLOSURE_STATUSES,
  ProsecutionError,
  isFinalDisclosureStatus,
  transitionDisclosure,
  type DisclosureStatus,
} from "./domain";

export const DISCLOSURE_ORIGINS = ["human", "deterministic", "ai_proposal", "imported"] as const;
export type DisclosureOrigin = (typeof DISCLOSURE_ORIGINS)[number];

export const DISCOVERY_SOURCE_CATEGORIES = [
  "police_report",
  "supplemental_report",
  "body_camera",
  "dash_camera",
  "911_record",
  "audio_video",
  "witness_statement",
  "defendant_statement",
  "officer_statement",
  "lab_report",
  "forensic_report",
  "medical_record",
  "photograph",
  "digital_extraction",
  "warrant_material",
  "agency_record",
  "business_record",
  "prior_statement",
  "benefit_or_promise",
  "criminal_history_reference",
  "other",
  "unknown",
] as const;

export const FORBIDDEN_AUTOMATED_DISCLOSURE_LANGUAGE = [
  /\bBrady violation\b/i,
  /\bGiglio violation\b/i,
  /\bconstitutional violation\b/i,
  /\bmust disclose\b/i,
  /\bsuppression required\b/i,
  /\bprosecutorial misconduct\b/i,
] as const;

export type DisclosureCandidateProposal = {
  category: (typeof DISCLOSURE_CATEGORIES)[number] | string;
  reason: string;
  origin: DisclosureOrigin;
  relatedEvidenceIds: string[];
  relatedWitnessIds: string[];
  relatedDefendantIds: string[];
  relatedChargeIds: string[];
  relatedElementIds: string[];
  relatedDiscoveryIds: string[];
  relatedIssueIds: string[];
  provenance: RecordProvenance;
  confidence: "high" | "medium" | "low";
  priority: "high" | "medium" | "normal" | "low";
  status: "REVIEW_REQUIRED";
  legalConclusion: null;
  bradyViolationConclusion: null;
  giglioViolationConclusion: null;
  mustDiscloseConclusion: null;
};

export type SupervisorQueueItem = {
  id: string;
  kind: "candidate" | "discovery" | "production";
  category: string;
  status: string;
  priority: string;
  label: string;
  awaitingFinalReview: boolean;
  escalated: boolean;
};

export function assertSafeDisclosureCopy(text: string | null | undefined): void {
  if (!text) return;
  for (const pattern of FORBIDDEN_AUTOMATED_DISCLOSURE_LANGUAGE) {
    if (pattern.test(text)) {
      throw new ProsecutionError(
        "DISCLOSURE_LANGUAGE_FORBIDDEN",
        "Automated Brady/Giglio or must-disclose conclusions are not permitted. Use potential-candidate wording for human review.",
      );
    }
  }
}

export function appendDisclosureReviewHistory(params: {
  history: DisclosureReviewHistoryEntry[] | null | undefined;
  priorStatus: string;
  nextStatus: string;
  actorUserId: string;
  reason?: string | null;
  notes?: string | null;
  productionId?: string | null;
  now?: string;
}): DisclosureReviewHistoryEntry[] {
  const entry: DisclosureReviewHistoryEntry = {
    priorStatus: params.priorStatus,
    nextStatus: params.nextStatus,
    actorUserId: params.actorUserId,
    timestamp: params.now ?? new Date().toISOString(),
    reason: params.reason ?? null,
    notes: params.notes ?? null,
    productionId: params.productionId ?? null,
  };
  return [...(params.history ?? []), entry];
}

export function requireHumanReasonForConsequentialStatus(params: {
  status: string;
  notes?: string | null;
  reason?: string | null;
}): void {
  if (
    params.status === "REVIEWED_NOT_DISCLOSE" ||
    params.status === "ESCALATE" ||
    params.status === "WITHHELD_FOR_ATTORNEY_REVIEW"
  ) {
    const text = `${params.notes ?? ""}${params.reason ?? ""}`.trim();
    if (!text) {
      throw new ProsecutionError(
        "DISCLOSURE_REASON_REQUIRED",
        "Withhold, escalate, or not-disclose determinations require a human-entered reason.",
      );
    }
  }
}

export function transitionDisclosureWithGuards(params: {
  next: string;
  humanActor: boolean;
  notes?: string | null;
  reason?: string | null;
}): DisclosureStatus {
  assertSafeDisclosureCopy(params.notes);
  assertSafeDisclosureCopy(params.reason);
  requireHumanReasonForConsequentialStatus({
    status: params.next,
    notes: params.notes,
    reason: params.reason,
  });
  if (isFinalDisclosureStatus(params.next) && !params.humanActor) {
    throw new ProsecutionError(
      "DISCLOSURE_HUMAN_REQUIRED",
      "Nyaya does not make the final disclosure determination.",
    );
  }
  return transitionDisclosure({
    next: params.next as DisclosureStatus,
    humanActor: params.humanActor,
  });
}

export function buildDisclosureCandidateProposals(input: {
  contraryEvidenceIds: string[];
  weakElementIds: string[];
  conflictedElementIds: string[];
  witnessConflictWitnessIds: string[];
  witnessConflictKeys: string[];
  benefitPromiseNotes?: string[];
  timelineConflictIds?: string[];
  procedureIssueIds?: string[];
  alternateSuspectEvidenceIds?: string[];
  provenance?: RecordProvenance;
}): DisclosureCandidateProposal[] {
  const provenance =
    input.provenance ??
    ({
      extractionOrigin: "deterministic_fixture",
      humanEntered: false,
      sourceSpan: "disclosure candidate engine",
    } satisfies RecordProvenance);
  const out: DisclosureCandidateProposal[] = [];
  const base = {
    status: "REVIEW_REQUIRED" as const,
    legalConclusion: null,
    bradyViolationConclusion: null,
    giglioViolationConclusion: null,
    mustDiscloseConclusion: null,
    provenance,
  };

  if (input.contraryEvidenceIds.length > 0) {
    out.push({
      ...base,
      category: "CONTRADICTORY_EVIDENCE",
      reason:
        "Contrary or conflicting evidence appears in the case record and requires human disclosure review.",
      origin: "deterministic",
      relatedEvidenceIds: input.contraryEvidenceIds,
      relatedWitnessIds: [],
      relatedDefendantIds: [],
      relatedChargeIds: [],
      relatedElementIds: input.conflictedElementIds,
      relatedDiscoveryIds: [],
      relatedIssueIds: [],
      confidence: "medium",
      priority: "high",
    });
  }
  if (input.weakElementIds.length > 0 || input.conflictedElementIds.length > 0) {
    out.push({
      ...base,
      category: "EVIDENCE_WEAKENING_ELEMENT",
      reason:
        "One or more charge elements have contrary or missing support and may include potential disclosure material.",
      origin: "deterministic",
      relatedEvidenceIds: input.contraryEvidenceIds,
      relatedWitnessIds: [],
      relatedDefendantIds: [],
      relatedChargeIds: [],
      relatedElementIds: [...new Set([...input.weakElementIds, ...input.conflictedElementIds])],
      relatedDiscoveryIds: [],
      relatedIssueIds: [],
      confidence: "medium",
      priority: "high",
    });
  }
  if (input.witnessConflictWitnessIds.length > 0 || input.witnessConflictKeys.length > 0) {
    out.push({
      ...base,
      category: "PRIOR_INCONSISTENT_STATEMENT",
      reason: `Structural witness statement differences on: ${input.witnessConflictKeys.join(", ") || "recorded claims"}. This is a potential disclosure candidate, not a truthfulness finding.`,
      origin: "deterministic",
      relatedEvidenceIds: [],
      relatedWitnessIds: input.witnessConflictWitnessIds,
      relatedDefendantIds: [],
      relatedChargeIds: [],
      relatedElementIds: [],
      relatedDiscoveryIds: [],
      relatedIssueIds: [],
      confidence: "medium",
      priority: "high",
    });
  }
  if ((input.benefitPromiseNotes ?? []).length > 0) {
    out.push({
      ...base,
      category: "WITNESS_BENEFIT_OR_PROMISE",
      reason: "Recorded benefit/promise material may require Giglio-related human review.",
      origin: "deterministic",
      relatedEvidenceIds: [],
      relatedWitnessIds: [],
      relatedDefendantIds: [],
      relatedChargeIds: [],
      relatedElementIds: [],
      relatedDiscoveryIds: [],
      relatedIssueIds: [],
      confidence: "low",
      priority: "high",
    });
  }
  if ((input.alternateSuspectEvidenceIds ?? []).length > 0) {
    out.push({
      ...base,
      category: "ALTERNATE_SUSPECT",
      reason:
        "Source-supported alternate-suspect material was recorded and requires prosecutor review.",
      origin: "deterministic",
      relatedEvidenceIds: input.alternateSuspectEvidenceIds ?? [],
      relatedWitnessIds: [],
      relatedDefendantIds: [],
      relatedChargeIds: [],
      relatedElementIds: [],
      relatedDiscoveryIds: [],
      relatedIssueIds: [],
      confidence: "low",
      priority: "high",
    });
  }
  if ((input.timelineConflictIds ?? []).length > 0) {
    out.push({
      ...base,
      category: "OTHER",
      reason:
        "Timeline conflicts may affect discovery/disclosure completeness and require human review.",
      origin: "deterministic",
      relatedEvidenceIds: [],
      relatedWitnessIds: [],
      relatedDefendantIds: [],
      relatedChargeIds: [],
      relatedElementIds: [],
      relatedDiscoveryIds: [],
      relatedIssueIds: input.timelineConflictIds ?? [],
      confidence: "low",
      priority: "medium",
    });
  }
  if ((input.procedureIssueIds ?? []).length > 0) {
    out.push({
      ...base,
      category: "OTHER",
      reason: "Open procedure issues remain linked to potential disclosure review context.",
      origin: "deterministic",
      relatedEvidenceIds: [],
      relatedWitnessIds: [],
      relatedDefendantIds: [],
      relatedChargeIds: [],
      relatedElementIds: [],
      relatedDiscoveryIds: [],
      relatedIssueIds: input.procedureIssueIds ?? [],
      confidence: "low",
      priority: "medium",
    });
  }
  return out.map((row) => {
    assertSafeDisclosureCopy(row.reason);
    return row;
  });
}

export function filterDiscoveryItems<
  T extends {
    reviewStatus: string;
    productionStatus: string;
    category: string;
    source: string;
    disclosureReviewStatus?: string | null;
    relatedDefendantIds?: string[];
    relatedWitnessIds?: string[];
    priority?: string | null;
  },
>(
  items: T[],
  filters: {
    status?: string | null;
    category?: string | null;
    source?: string | null;
    defendantId?: string | null;
    witnessId?: string | null;
    disclosureCandidateStatus?: string | null;
    priority?: string | null;
    query?: string | null;
  },
): T[] {
  const q = filters.query?.trim().toLowerCase() ?? "";
  return items.filter((item) => {
    if (
      filters.status &&
      item.reviewStatus !== filters.status &&
      item.productionStatus !== filters.status
    ) {
      return false;
    }
    if (filters.category && item.category !== filters.category) return false;
    if (filters.source && item.source !== filters.source) return false;
    if (filters.priority && item.priority !== filters.priority) return false;
    if (
      filters.disclosureCandidateStatus &&
      item.disclosureReviewStatus !== filters.disclosureCandidateStatus
    ) {
      return false;
    }
    if (filters.defendantId && !(item.relatedDefendantIds ?? []).includes(filters.defendantId)) {
      return false;
    }
    if (filters.witnessId && !(item.relatedWitnessIds ?? []).includes(filters.witnessId)) {
      return false;
    }
    if (q) {
      const hay =
        `${item.source} ${item.category} ${item.reviewStatus} ${item.productionStatus}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function buildSupervisorDisclosureQueue(input: {
  candidates: Array<{
    id: string;
    category: string;
    status: string;
    priority?: string | null;
  }>;
  discovery: Array<{
    id: string;
    category: string;
    reviewStatus: string;
    productionStatus: string;
    priority?: string | null;
  }>;
  productions: Array<{ id: string; label: string; status: string }>;
}): SupervisorQueueItem[] {
  const items: SupervisorQueueItem[] = [];
  for (const candidate of input.candidates) {
    const awaitingFinalReview =
      candidate.status === "REVIEW_REQUIRED" || candidate.status === "UNREVIEWED";
    const escalated = candidate.status === "ESCALATE";
    if (awaitingFinalReview || escalated) {
      items.push({
        id: candidate.id,
        kind: "candidate",
        category: candidate.category,
        status: candidate.status,
        priority: candidate.priority ?? "normal",
        label: `Potential disclosure candidate — ${candidate.category}`,
        awaitingFinalReview,
        escalated,
      });
    }
  }
  for (const row of input.discovery) {
    if (
      row.reviewStatus === "FLAGGED" ||
      row.productionStatus === "WITHHELD_FOR_ATTORNEY_REVIEW" ||
      row.reviewStatus === "RECEIVED"
    ) {
      items.push({
        id: row.id,
        kind: "discovery",
        category: row.category,
        status: row.reviewStatus,
        priority: row.priority ?? "normal",
        label: `Discovery review — ${row.category}`,
        awaitingFinalReview: row.reviewStatus === "FLAGGED" || row.reviewStatus === "RECEIVED",
        escalated: row.productionStatus === "WITHHELD_FOR_ATTORNEY_REVIEW",
      });
    }
  }
  for (const production of input.productions) {
    if (production.status === "PREPARED" || production.status === "PENDING") {
      items.push({
        id: production.id,
        kind: "production",
        category: "PRODUCTION",
        status: production.status,
        priority: "normal",
        label: production.label,
        awaitingFinalReview: false,
        escalated: false,
      });
    }
  }
  return items.sort((a, b) => {
    const rank = (p: string) => (p === "high" ? 0 : p === "medium" ? 1 : 2);
    return rank(a.priority) - rank(b.priority);
  });
}

export function formatProsecutionDisclosureAskContext(input: {
  discoveryCount: number;
  unreviewedDiscovery: number;
  producedDiscovery: number;
  candidates: Array<{
    id: string;
    category: string;
    status: string;
    reason?: string | null;
    origin?: string | null;
  }>;
  productions: Array<{ id: string; label: string; status: string; isSupplemental?: boolean }>;
  supervisorQueueCount: number;
}): string {
  const awaiting = input.candidates.filter((c) =>
    ["UNREVIEWED", "REVIEW_REQUIRED", "ESCALATE"].includes(c.status),
  );
  const finalized = input.candidates.filter((c) => isFinalDisclosureStatus(c.status));
  return [
    "PROSECUTION_DISCOVERY_DISCLOSURE_CONTEXT (case-scoped; draft work product)",
    `DISCOVERY_TOTAL: ${input.discoveryCount}`,
    `DISCOVERY_UNREVIEWED: ${input.unreviewedDiscovery}`,
    `DISCOVERY_PRODUCED: ${input.producedDiscovery}`,
    `CANDIDATES_AWAITING_HUMAN_REVIEW: ${awaiting.length}`,
    `CANDIDATES_HUMAN_FINALIZED: ${finalized.length}`,
    `SUPERVISOR_QUEUE_ITEMS: ${input.supervisorQueueCount}`,
    `PRODUCTION_SETS: ${input.productions.length}`,
    "BRADY_VIOLATION_CONCLUSION: null",
    "GIGLIO_VIOLATION_CONCLUSION: null",
    "MUST_DISCLOSE_CONCLUSION: null",
    "WITNESS_CREDIBILITY_SCORE: null",
    "CANDIDATES:",
    ...awaiting
      .slice(0, 30)
      .map(
        (c) =>
          `- [CANDIDATE not final] ${c.category} status=${c.status} origin=${c.origin ?? "unknown"} reason=${c.reason ?? "(none)"}`,
      ),
    "HUMAN_FINAL_DECISIONS:",
    ...finalized
      .slice(0, 20)
      .map((c) => `- [HUMAN DETERMINATION] ${c.category} status=${c.status}`),
    "PRODUCTIONS:",
    ...input.productions
      .slice(0, 20)
      .map(
        (p) =>
          `- ${p.label} status=${p.status}${p.isSupplemental ? " supplemental" : ""} (tracking only; no external send)`,
      ),
    "Distinguish candidates from human final determinations. Do not invent Brady/Giglio conclusions.",
  ].join("\n");
}

export function paginateRows<T>(
  rows: T[],
  page = 1,
  pageSize = 50,
): {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
} {
  const safePage = Math.max(1, page);
  const safeSize = Math.min(100, Math.max(1, pageSize));
  const start = (safePage - 1) * safeSize;
  return {
    rows: rows.slice(start, start + safeSize),
    page: safePage,
    pageSize: safeSize,
    total: rows.length,
  };
}

export { DISCLOSURE_CATEGORIES, DISCLOSURE_STATUSES };
