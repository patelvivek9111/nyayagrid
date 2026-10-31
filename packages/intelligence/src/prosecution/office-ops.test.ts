import { describe, expect, it } from "vitest";
import {
  assertDueDateNotInvented,
  assertSafeOfficeCopy,
  buildAttentionFlags,
  buildOfficeAggregateCounts,
  buildWorkloadByProsecutor,
  filterCaseloadRows,
  formatProsecutionOfficeAskContext,
  paginateOfficeRows,
  suggestAssignmentCandidates,
} from "./office-ops";
import { ProsecutionError } from "./domain";

describe("prosecution office operations Stage 6", () => {
  it("builds aggregates without outcome KPIs", () => {
    const counts = buildOfficeAggregateCounts({
      cases: [
        {
          caseStatus: "open",
          priority: "HIGH",
          assignedProsecutorId: null,
          supervisingProsecutorId: null,
        },
        {
          caseStatus: "open",
          priority: "normal",
          assignedProsecutorId: "u1",
          supervisingProsecutorId: "s1",
        },
        {
          caseStatus: "CLOSED",
          priority: "normal",
          assignedProsecutorId: "u1",
          supervisingProsecutorId: "s1",
        },
      ],
      disclosureAwaitingFinal: 2,
      pendingDiscoveryProduction: 1,
      upcomingHearings: 3,
      overdueTasks: 4,
      upcomingTasks: 5,
      openInvestigationGaps: 6,
      chainOfCustodyWarnings: 1,
      openProcedureIssues: 2,
      draftsAwaitingReview: 1,
      casesAwaitingSupervisorReview: 1,
    });
    expect(counts.totalActiveCases).toBe(2);
    expect(counts.unassignedCases).toBe(1);
    expect(counts.highPriorityCases).toBe(1);
    expect(counts.convictionRate).toBeNull();
    expect(counts.prosecutorPerformanceScore).toBeNull();
    expect(counts.pleaEfficiencyScore).toBeNull();
    expect(counts.guiltOutcomeKpi).toBeNull();
  });

  it("rejects outcome-based KPI language", () => {
    expect(() => assertSafeOfficeCopy("best prosecutor ranking")).toThrow(ProsecutionError);
    expect(() => assertSafeOfficeCopy("conviction-rate dashboard")).toThrow(ProsecutionError);
    expect(() => assertSafeOfficeCopy("Assign case to prosecutor A")).not.toThrow();
  });

  it("preserves due-date origin and never invents dates", () => {
    expect(assertDueDateNotInvented({ dueAt: null, origin: null })).toBe("UNKNOWN");
    expect(assertDueDateNotInvented({ dueAt: "2026-01-01", origin: "COURT_ORDER" })).toBe(
      "COURT_ORDER",
    );
    expect(assertDueDateNotInvented({ dueAt: "2026-01-01", origin: null })).toBe("USER_ENTERED");
  });

  it("builds workload without conviction ranking", () => {
    const workload = buildWorkloadByProsecutor({
      cases: [
        {
          id: "c1",
          caseStatus: "open",
          priority: "HIGH",
          assignedProsecutorId: "u1",
        },
        {
          id: "c2",
          caseStatus: "open",
          priority: "normal",
          assignedProsecutorId: "u1",
        },
      ],
      tasks: [{ ownerUserId: "u1", status: "open", criminalCaseId: "c1" }],
      hearingsByCase: new Map([["c1", 1]]),
      pendingReviewByProsecutor: new Map([["u1", 2]]),
    });
    expect(workload[0]?.activeCaseCount).toBe(2);
    expect(workload[0]?.highPriorityCaseCount).toBe(1);
    expect(workload[0]?.openTaskCount).toBe(1);
    expect(workload[0]?.convictionRate).toBeNull();
    expect(workload[0]?.pleaEfficiencyScore).toBeNull();
  });

  it("keeps assignment suggestions as suggestions only", () => {
    const suggestions = suggestAssignmentCandidates({
      members: [
        { userId: "a", canBeProsecutor: true },
        { userId: "b", canBeProsecutor: true },
        { userId: "c", canBeProsecutor: false },
      ],
      activeCaseCountByUser: new Map([
        ["a", 5],
        ["b", 1],
      ]),
    });
    expect(suggestions[0]?.userId).toBe("b");
    expect(suggestions.every((row) => row.suggestionOnly)).toBe(true);
    expect(suggestions.some((row) => row.userId === "c")).toBe(false);
  });

  it("builds attention flags without guilt alerts", () => {
    const flags = buildAttentionFlags({
      cases: [
        {
          id: "c1",
          caseNumber: "CR-1",
          assignedProsecutorId: null,
          supervisingProsecutorId: null,
          priority: "HIGH",
        },
      ],
      overdueTaskCaseIds: new Set(["c1"]),
      hearingSoonCaseIds: new Set(),
      disclosurePendingCaseIds: new Set(["c1"]),
      productionPendingCaseIds: new Set(),
      custodyWarningCaseIds: new Set(),
      procedureIssueCaseIds: new Set(),
      draftReviewCaseIds: new Set(),
      gapCaseIds: new Set(),
    });
    expect(flags.some((f) => f.kind === "CASE_UNASSIGNED")).toBe(true);
    expect(flags.some((f) => f.kind === "OVERDUE_TASK")).toBe(true);
    expect(flags.every((f) => !/guilt|conviction/i.test(f.label))).toBe(true);
  });

  it("paginates and filters caseload server-side style", () => {
    const rows = [
      {
        id: "1",
        caseNumber: "A-1",
        caseStatus: "open",
        priority: "HIGH",
        assignedProsecutorId: null,
        supervisingProsecutorId: null,
        investigatingAgencyId: null,
        court: "st-pa-trial",
        jurisdiction: "PA",
        closedDate: null,
        updatedAt: null,
        lastSupervisorReviewAt: null,
      },
      {
        id: "2",
        caseNumber: "B-2",
        caseStatus: "CLOSED",
        priority: "normal",
        assignedProsecutorId: "u1",
        supervisingProsecutorId: "s1",
        investigatingAgencyId: null,
        court: "st-pa-trial",
        jurisdiction: "PA",
        closedDate: "2026-01-01",
        updatedAt: null,
        lastSupervisorReviewAt: null,
      },
    ];
    const filtered = filterCaseloadRows(rows, { unassignedOnly: true });
    expect(filtered).toHaveLength(1);
    const page = paginateOfficeRows(rows, 1, 1);
    expect(page.rows).toHaveLength(1);
    expect(page.totalPages).toBe(2);
  });

  it("formats deterministic Ask office context", () => {
    const text = formatProsecutionOfficeAskContext({
      counts: buildOfficeAggregateCounts({
        cases: [],
        disclosureAwaitingFinal: 0,
        pendingDiscoveryProduction: 0,
        upcomingHearings: 0,
        overdueTasks: 1,
        upcomingTasks: 0,
        openInvestigationGaps: 0,
        chainOfCustodyWarnings: 0,
        openProcedureIssues: 0,
        draftsAwaitingReview: 0,
        casesAwaitingSupervisorReview: 0,
      }),
      myAssignedCases: 2,
      myOverdueTasks: 1,
      myUpcomingHearings: 0,
    });
    expect(text).toContain("CONVICTION_RATE: null");
    expect(text).toContain("MY_ASSIGNED_CASES: 2");
    expect(text).toContain("Prefer deterministic office answers");
  });

  it("handles synthetic office-scale caseload pagination without outcome ranking", () => {
    const prosecutors = ["p1", "p2", "p3", "p4", "p5"];
    const cases = Array.from({ length: 250 }, (_, i) => ({
      id: `case-${i}`,
      caseNumber: `CR-2026-${String(i).padStart(4, "0")}`,
      caseStatus: i === 249 ? "CLOSED" : "open",
      priority: i % 20 === 0 ? "HIGH" : "normal",
      assignedProsecutorId: i % 11 === 0 ? null : prosecutors[i % prosecutors.length]!,
      supervisingProsecutorId: i % 7 === 0 ? null : "s1",
      investigatingAgencyId: i % 13 === 0 ? null : "agency-1",
      court: "st-pa-trial",
      jurisdiction: "PA",
      closedDate: i === 249 ? "2026-01-01" : null,
      updatedAt: null,
      lastSupervisorReviewAt: null,
    }));
    const counts = buildOfficeAggregateCounts({
      cases,
      disclosureAwaitingFinal: 12,
      pendingDiscoveryProduction: 8,
      upcomingHearings: 40,
      overdueTasks: 15,
      upcomingTasks: 60,
      openInvestigationGaps: 22,
      chainOfCustodyWarnings: 5,
      openProcedureIssues: 9,
      draftsAwaitingReview: 3,
      casesAwaitingSupervisorReview: 7,
    });
    expect(counts.totalActiveCases).toBe(249);
    expect(counts.unassignedCases).toBeGreaterThan(0);
    expect(counts.convictionRate).toBeNull();
    const page = paginateOfficeRows(filterCaseloadRows(cases, { unassignedOnly: true }), 1, 25);
    expect(page.rows.length).toBeLessThanOrEqual(25);
    expect(page.total).toBe(counts.unassignedCases);
    const workload = buildWorkloadByProsecutor({
      cases,
      tasks: Array.from({ length: 500 }, (_, i) => ({
        ownerUserId: prosecutors[i % prosecutors.length]!,
        status: i % 9 === 0 ? "completed" : "open",
        criminalCaseId: `case-${i % 250}`,
      })),
      hearingsByCase: new Map(cases.slice(0, 40).map((c) => [c.id, 1])),
      pendingReviewByProsecutor: new Map(prosecutors.map((id) => [id, 2])),
    });
    expect(workload).toHaveLength(5);
    expect(workload.every((row) => row.convictionRate === null)).toBe(true);
  });
});
