/**
 * Prosecution Stage 6 office operations helpers.
 * Deterministic caseload/workload/queues — never outcome or guilt KPIs.
 */

import { ProsecutionError } from "./domain";

export const DUE_DATE_ORIGINS = [
  "USER_ENTERED",
  "COURT_ORDER",
  "DOCUMENT_EXTRACTED",
  "HEARING_DERIVED",
  "SYSTEM_OPERATIONAL",
  "UNKNOWN",
] as const;
export type DueDateOrigin = (typeof DUE_DATE_ORIGINS)[number];

export const CASE_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export const OFFICE_REVIEW_QUEUES = [
  "DISCLOSURE_REVIEW",
  "SUPERVISOR_CASE_REVIEW",
  "DRAFT_REVIEW",
  "PROCEDURE_ISSUE_REVIEW",
  "EVIDENCE_GAP_REVIEW",
  "CUSTODY_WARNING_REVIEW",
  "DISCOVERY_PRODUCTION_REVIEW",
] as const;

export const FORBIDDEN_OFFICE_KPI_LANGUAGE = [
  /\bbest prosecutor\b/i,
  /\bworst prosecutor\b/i,
  /\bconviction[- ]rate\b/i,
  /\bconviction performance\b/i,
  /\bplea efficiency\b/i,
  /\bsentencing score\b/i,
  /\bguilt[- ]outcome\b/i,
  /\bguilt scoring\b/i,
] as const;

export type OfficeCaseSummary = {
  id: string;
  caseNumber: string;
  caseStatus: string;
  priority: string;
  assignedProsecutorId: string | null;
  supervisingProsecutorId: string | null;
  investigatingAgencyId: string | null;
  court: string;
  jurisdiction: string;
  closedDate: string | null;
  updatedAt: string | null;
  lastSupervisorReviewAt: string | null;
};

export type OfficeAggregateCounts = {
  totalActiveCases: number;
  unassignedCases: number;
  missingSupervisorCases: number;
  highPriorityCases: number;
  closedCases: number;
  casesAwaitingSupervisorReview: number;
  disclosureCandidatesAwaitingFinal: number;
  pendingDiscoveryProduction: number;
  upcomingHearings: number;
  overdueTasks: number;
  upcomingTasks: number;
  openInvestigationGaps: number;
  chainOfCustodyWarnings: number;
  openProcedureIssues: number;
  draftsAwaitingReview: number;
  convictionRate: null;
  pleaEfficiencyScore: null;
  prosecutorPerformanceScore: null;
  guiltOutcomeKpi: null;
};

export type WorkloadByProsecutor = {
  userId: string;
  activeCaseCount: number;
  highPriorityCaseCount: number;
  openTaskCount: number;
  upcomingHearingCount: number;
  pendingReviewCount: number;
  convictionRate: null;
  pleaEfficiencyScore: null;
};

export type CalendarEventItem = {
  id: string;
  caseId: string;
  caseNumber: string;
  eventType: string;
  title: string;
  dateTime: string;
  dateOrigin: DueDateOrigin | string;
  priority?: string;
};

export type AttentionFlag = {
  caseId: string;
  caseNumber: string;
  kind: string;
  label: string;
  severity: "high" | "medium" | "normal";
};

export function assertSafeOfficeCopy(text: string | null | undefined): void {
  if (!text) return;
  for (const pattern of FORBIDDEN_OFFICE_KPI_LANGUAGE) {
    if (pattern.test(text)) {
      throw new ProsecutionError(
        "OFFICE_KPI_FORBIDDEN",
        "Outcome-based prosecutor ranking and conviction KPIs are not permitted.",
      );
    }
  }
}

export function normalizeDueDateOrigin(raw: string | null | undefined): DueDateOrigin {
  const value = (raw ?? "UNKNOWN").trim().toUpperCase();
  if ((DUE_DATE_ORIGINS as readonly string[]).includes(value)) return value as DueDateOrigin;
  return "UNKNOWN";
}

export function assertDueDateNotInvented(params: {
  dueAt: string | Date | null | undefined;
  origin: string | null | undefined;
}): DueDateOrigin {
  if (!params.dueAt) return "UNKNOWN";
  const origin = normalizeDueDateOrigin(params.origin);
  if (origin === "UNKNOWN" && params.origin == null) {
    return "USER_ENTERED";
  }
  return origin;
}

export function isClosedStatus(status: string): boolean {
  return ["CLOSED", "closed", "DISPOSED", "disposed"].includes(status);
}

export function isHighPriority(priority: string): boolean {
  return ["HIGH", "high", "URGENT", "urgent"].includes(priority);
}

export function buildOfficeAggregateCounts(input: {
  cases: Array<{
    caseStatus: string;
    priority: string;
    assignedProsecutorId: string | null;
    supervisingProsecutorId: string | null;
  }>;
  disclosureAwaitingFinal: number;
  pendingDiscoveryProduction: number;
  upcomingHearings: number;
  overdueTasks: number;
  upcomingTasks: number;
  openInvestigationGaps: number;
  chainOfCustodyWarnings: number;
  openProcedureIssues: number;
  draftsAwaitingReview: number;
  casesAwaitingSupervisorReview: number;
}): OfficeAggregateCounts {
  const active = input.cases.filter((c) => !isClosedStatus(c.caseStatus));
  return {
    totalActiveCases: active.length,
    unassignedCases: active.filter((c) => !c.assignedProsecutorId).length,
    missingSupervisorCases: active.filter((c) => !c.supervisingProsecutorId).length,
    highPriorityCases: active.filter((c) => isHighPriority(c.priority)).length,
    closedCases: input.cases.filter((c) => isClosedStatus(c.caseStatus)).length,
    casesAwaitingSupervisorReview: input.casesAwaitingSupervisorReview,
    disclosureCandidatesAwaitingFinal: input.disclosureAwaitingFinal,
    pendingDiscoveryProduction: input.pendingDiscoveryProduction,
    upcomingHearings: input.upcomingHearings,
    overdueTasks: input.overdueTasks,
    upcomingTasks: input.upcomingTasks,
    openInvestigationGaps: input.openInvestigationGaps,
    chainOfCustodyWarnings: input.chainOfCustodyWarnings,
    openProcedureIssues: input.openProcedureIssues,
    draftsAwaitingReview: input.draftsAwaitingReview,
    convictionRate: null,
    pleaEfficiencyScore: null,
    prosecutorPerformanceScore: null,
    guiltOutcomeKpi: null,
  };
}

export function buildWorkloadByProsecutor(input: {
  cases: Array<{
    id: string;
    caseStatus: string;
    priority: string;
    assignedProsecutorId: string | null;
  }>;
  tasks: Array<{ ownerUserId: string | null; status: string; criminalCaseId: string }>;
  hearingsByCase: Map<string, number>;
  pendingReviewByProsecutor: Map<string, number>;
}): WorkloadByProsecutor[] {
  const byUser = new Map<string, WorkloadByProsecutor>();
  for (const criminalCase of input.cases) {
    if (isClosedStatus(criminalCase.caseStatus) || !criminalCase.assignedProsecutorId) continue;
    const existing = byUser.get(criminalCase.assignedProsecutorId) ?? {
      userId: criminalCase.assignedProsecutorId,
      activeCaseCount: 0,
      highPriorityCaseCount: 0,
      openTaskCount: 0,
      upcomingHearingCount: 0,
      pendingReviewCount: 0,
      convictionRate: null,
      pleaEfficiencyScore: null,
    };
    existing.activeCaseCount += 1;
    if (isHighPriority(criminalCase.priority)) existing.highPriorityCaseCount += 1;
    existing.upcomingHearingCount += input.hearingsByCase.get(criminalCase.id) ?? 0;
    byUser.set(criminalCase.assignedProsecutorId, existing);
  }
  for (const task of input.tasks) {
    if (!task.ownerUserId || task.status === "completed" || task.status === "cancelled") continue;
    const existing = byUser.get(task.ownerUserId) ?? {
      userId: task.ownerUserId,
      activeCaseCount: 0,
      highPriorityCaseCount: 0,
      openTaskCount: 0,
      upcomingHearingCount: 0,
      pendingReviewCount: 0,
      convictionRate: null,
      pleaEfficiencyScore: null,
    };
    existing.openTaskCount += 1;
    byUser.set(task.ownerUserId, existing);
  }
  for (const [userId, count] of input.pendingReviewByProsecutor) {
    const existing = byUser.get(userId) ?? {
      userId,
      activeCaseCount: 0,
      highPriorityCaseCount: 0,
      openTaskCount: 0,
      upcomingHearingCount: 0,
      pendingReviewCount: 0,
      convictionRate: null,
      pleaEfficiencyScore: null,
    };
    existing.pendingReviewCount = count;
    byUser.set(userId, existing);
  }
  return [...byUser.values()].sort((a, b) => b.activeCaseCount - a.activeCaseCount);
}

export function suggestAssignmentCandidates(input: {
  members: Array<{ userId: string; canBeProsecutor: boolean }>;
  activeCaseCountByUser: Map<string, number>;
}): Array<{ userId: string; activeCaseCount: number; suggestionOnly: true }> {
  return input.members
    .filter((m) => m.canBeProsecutor)
    .map((m) => ({
      userId: m.userId,
      activeCaseCount: input.activeCaseCountByUser.get(m.userId) ?? 0,
      suggestionOnly: true as const,
    }))
    .sort((a, b) => a.activeCaseCount - b.activeCaseCount);
}

export function buildAttentionFlags(input: {
  cases: Array<{
    id: string;
    caseNumber: string;
    assignedProsecutorId: string | null;
    supervisingProsecutorId: string | null;
    priority: string;
  }>;
  overdueTaskCaseIds: Set<string>;
  hearingSoonCaseIds: Set<string>;
  disclosurePendingCaseIds: Set<string>;
  productionPendingCaseIds: Set<string>;
  custodyWarningCaseIds: Set<string>;
  procedureIssueCaseIds: Set<string>;
  draftReviewCaseIds: Set<string>;
  gapCaseIds: Set<string>;
}): AttentionFlag[] {
  const flags: AttentionFlag[] = [];
  for (const criminalCase of input.cases) {
    if (!criminalCase.assignedProsecutorId) {
      flags.push({
        caseId: criminalCase.id,
        caseNumber: criminalCase.caseNumber,
        kind: "CASE_UNASSIGNED",
        label: "Case unassigned",
        severity: "high",
      });
    }
    if (!criminalCase.supervisingProsecutorId) {
      flags.push({
        caseId: criminalCase.id,
        caseNumber: criminalCase.caseNumber,
        kind: "SUPERVISOR_MISSING",
        label: "Supervisor missing",
        severity: "medium",
      });
    }
    if (input.overdueTaskCaseIds.has(criminalCase.id)) {
      flags.push({
        caseId: criminalCase.id,
        caseNumber: criminalCase.caseNumber,
        kind: "OVERDUE_TASK",
        label: "Overdue task",
        severity: "high",
      });
    }
    if (input.hearingSoonCaseIds.has(criminalCase.id)) {
      flags.push({
        caseId: criminalCase.id,
        caseNumber: criminalCase.caseNumber,
        kind: "HEARING_APPROACHING",
        label: "Hearing approaching",
        severity: "high",
      });
    }
    if (input.disclosurePendingCaseIds.has(criminalCase.id)) {
      flags.push({
        caseId: criminalCase.id,
        caseNumber: criminalCase.caseNumber,
        kind: "DISCLOSURE_CANDIDATE_WAITING",
        label: "Disclosure candidate waiting",
        severity: "high",
      });
    }
    if (input.productionPendingCaseIds.has(criminalCase.id)) {
      flags.push({
        caseId: criminalCase.id,
        caseNumber: criminalCase.caseNumber,
        kind: "PRODUCTION_PENDING",
        label: "Production pending",
        severity: "medium",
      });
    }
    if (input.custodyWarningCaseIds.has(criminalCase.id)) {
      flags.push({
        caseId: criminalCase.id,
        caseNumber: criminalCase.caseNumber,
        kind: "CUSTODY_WARNING",
        label: "Chain-of-custody warning unresolved",
        severity: "high",
      });
    }
    if (input.procedureIssueCaseIds.has(criminalCase.id)) {
      flags.push({
        caseId: criminalCase.id,
        caseNumber: criminalCase.caseNumber,
        kind: "PROCEDURE_ISSUE_UNRESOLVED",
        label: "Procedure issue unresolved",
        severity: "medium",
      });
    }
    if (input.draftReviewCaseIds.has(criminalCase.id)) {
      flags.push({
        caseId: criminalCase.id,
        caseNumber: criminalCase.caseNumber,
        kind: "DRAFT_AWAITING_REVIEW",
        label: "Draft awaiting review",
        severity: "normal",
      });
    }
    if (input.gapCaseIds.has(criminalCase.id)) {
      flags.push({
        caseId: criminalCase.id,
        caseNumber: criminalCase.caseNumber,
        kind: "INVESTIGATION_GAP",
        label: "Investigation gap unresolved",
        severity: "medium",
      });
    }
  }
  return flags;
}

export function paginateOfficeRows<T>(
  rows: T[],
  page: number,
  pageSize: number,
): { rows: T[]; page: number; pageSize: number; total: number; totalPages: number } {
  const safePage = Math.max(1, page);
  const safeSize = Math.min(100, Math.max(1, pageSize));
  const total = rows.length;
  const start = (safePage - 1) * safeSize;
  return {
    rows: rows.slice(start, start + safeSize),
    page: safePage,
    pageSize: safeSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeSize)),
  };
}

export function formatProsecutionOfficeAskContext(input: {
  counts: OfficeAggregateCounts;
  myAssignedCases: number;
  myOverdueTasks: number;
  myUpcomingHearings: number;
}): string {
  const lines = [
    "PROSECUTION_OFFICE_OPERATIONS_CONTEXT (deterministic; draft work product)",
    `ACTIVE_CASES: ${input.counts.totalActiveCases}`,
    `UNASSIGNED_CASES: ${input.counts.unassignedCases}`,
    `HIGH_PRIORITY_CASES: ${input.counts.highPriorityCases}`,
    `DISCLOSURE_AWAITING_FINAL: ${input.counts.disclosureCandidatesAwaitingFinal}`,
    `OVERDUE_TASKS: ${input.counts.overdueTasks}`,
    `UPCOMING_HEARINGS: ${input.counts.upcomingHearings}`,
    `OPEN_INVESTIGATION_GAPS: ${input.counts.openInvestigationGaps}`,
    `CUSTODY_WARNINGS: ${input.counts.chainOfCustodyWarnings}`,
    `OPEN_PROCEDURE_ISSUES: ${input.counts.openProcedureIssues}`,
    `MY_ASSIGNED_CASES: ${input.myAssignedCases}`,
    `MY_OVERDUE_TASKS: ${input.myOverdueTasks}`,
    `MY_UPCOMING_HEARINGS: ${input.myUpcomingHearings}`,
    "CONVICTION_RATE: null",
    "PROSECUTOR_PERFORMANCE_SCORE: null",
    "PLEA_EFFICIENCY_SCORE: null",
    "GUILT_OUTCOME_KPI: null",
    "Prefer deterministic office answers. Do not invent deadlines or rank prosecutors by outcomes.",
  ];
  return lines.join("\n");
}

export function filterCaseloadRows<T extends OfficeCaseSummary>(
  rows: T[],
  filters: {
    query?: string;
    status?: string;
    priority?: string;
    prosecutorId?: string | null;
    unassignedOnly?: boolean;
  },
): T[] {
  const q = filters.query?.trim().toLowerCase() ?? "";
  return rows.filter((row) => {
    if (filters.unassignedOnly && row.assignedProsecutorId) return false;
    if (filters.status && filters.status !== "all" && row.caseStatus !== filters.status)
      return false;
    if (filters.priority && filters.priority !== "all" && row.priority !== filters.priority) {
      return false;
    }
    if (filters.prosecutorId && row.assignedProsecutorId !== filters.prosecutorId) return false;
    if (!q) return true;
    const haystack =
      `${row.caseNumber} ${row.court} ${row.jurisdiction} ${row.caseStatus} ${row.priority}`.toLowerCase();
    return haystack.includes(q);
  });
}
