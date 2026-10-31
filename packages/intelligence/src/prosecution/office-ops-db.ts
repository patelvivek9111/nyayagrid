/**
 * Prosecution Stage 6 office overview — aggregate queries, not full case hydration.
 */

import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  auditEvents,
  criminalCases,
  ensureProsecutionRoles,
  memberships,
  permissions,
  prosecutionCaseDrafts,
  prosecutionDisclosureCandidates,
  prosecutionDiscoveryItems,
  prosecutionEvidenceItems,
  prosecutionHearings,
  prosecutionMotions,
  prosecutionPleaOffers,
  prosecutionProcedureIssues,
  prosecutionSubpoenas,
  prosecutionSupervisorReviews,
  prosecutionTasks,
  roles,
  users,
  type Database,
} from "@nyayagrid/database";
import {
  AuthorizationError,
  getMembershipCapabilities,
  writeAuditEvent,
} from "@nyayagrid/permissions";
import { validateChainOfCustody, normalizeCustody } from "../week4/chain-of-custody";
import {
  ProsecutionError,
  prosecutionCapabilityAllows,
  type ProsecutionResourceAction,
} from "./domain";
import {
  assertDueDateNotInvented,
  assertSafeOfficeCopy,
  buildAttentionFlags,
  buildOfficeAggregateCounts,
  buildWorkloadByProsecutor,
  filterCaseloadRows,
  formatProsecutionOfficeAskContext,
  isClosedStatus,
  paginateOfficeRows,
  suggestAssignmentCandidates,
} from "./office-ops";

async function authorizeOffice(
  db: Database,
  params: { userId: string; organizationId: string; action: ProsecutionResourceAction },
) {
  await ensureProsecutionRoles(db, params.organizationId);
  const membership = await getMembershipCapabilities(db, {
    userId: params.userId,
    organizationId: params.organizationId,
  });
  if (!membership || !prosecutionCapabilityAllows(membership.capabilities, params.action)) {
    throw new AuthorizationError("Missing prosecution capability for this action.");
  }
  return membership;
}

export async function getProsecutionOfficeOverview(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    page?: number;
    pageSize?: number;
    query?: string;
    status?: string;
    priority?: string;
    prosecutorId?: string;
    unassignedOnly?: boolean;
  },
) {
  const membership = await authorizeOffice(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    action: "view",
  });
  const caps = membership.capabilities;
  const canReview = prosecutionCapabilityAllows(caps, "review");
  const canManageCase = prosecutionCapabilityAllows(caps, "case.manage");
  const canAudit = caps.has("audit.view");

  const cases = await db
    .select({
      id: criminalCases.id,
      caseNumber: criminalCases.caseNumber,
      caseStatus: criminalCases.caseStatus,
      priority: criminalCases.priority,
      assignedProsecutorId: criminalCases.assignedProsecutorId,
      supervisingProsecutorId: criminalCases.supervisingProsecutorId,
      investigatingAgencyId: criminalCases.investigatingAgencyId,
      court: criminalCases.court,
      jurisdiction: criminalCases.jurisdiction,
      closedDate: criminalCases.closedDate,
      updatedAt: criminalCases.updatedAt,
      lastSupervisorReviewAt: criminalCases.lastSupervisorReviewAt,
      assignmentNote: criminalCases.assignmentNote,
    })
    .from(criminalCases)
    .where(eq(criminalCases.organizationId, params.organizationId));

  const caseIds = cases.map((c) => c.id);
  const now = new Date();
  const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [
    tasks,
    hearings,
    disclosures,
    discovery,
    drafts,
    procedureIssues,
    evidence,
    motions,
    pleas,
    subpoenas,
  ] =
    caseIds.length === 0
      ? [[], [], [], [], [], [], [], [], [], []]
      : await Promise.all([
          db
            .select({
              id: prosecutionTasks.id,
              criminalCaseId: prosecutionTasks.criminalCaseId,
              title: prosecutionTasks.title,
              status: prosecutionTasks.status,
              priority: prosecutionTasks.priority,
              ownerUserId: prosecutionTasks.ownerUserId,
              dueAt: prosecutionTasks.dueAt,
              dueDateOrigin: prosecutionTasks.dueDateOrigin,
            })
            .from(prosecutionTasks)
            .where(
              and(
                eq(prosecutionTasks.organizationId, params.organizationId),
                inArray(prosecutionTasks.criminalCaseId, caseIds),
              ),
            ),
          db
            .select({
              id: prosecutionHearings.id,
              criminalCaseId: prosecutionHearings.criminalCaseId,
              hearingType: prosecutionHearings.hearingType,
              dateTime: prosecutionHearings.dateTime,
            })
            .from(prosecutionHearings)
            .where(
              and(
                eq(prosecutionHearings.organizationId, params.organizationId),
                inArray(prosecutionHearings.criminalCaseId, caseIds),
              ),
            ),
          db
            .select({
              id: prosecutionDisclosureCandidates.id,
              criminalCaseId: prosecutionDisclosureCandidates.criminalCaseId,
              status: prosecutionDisclosureCandidates.status,
              category: prosecutionDisclosureCandidates.category,
            })
            .from(prosecutionDisclosureCandidates)
            .where(
              and(
                eq(prosecutionDisclosureCandidates.organizationId, params.organizationId),
                inArray(prosecutionDisclosureCandidates.criminalCaseId, caseIds),
              ),
            ),
          db
            .select({
              id: prosecutionDiscoveryItems.id,
              criminalCaseId: prosecutionDiscoveryItems.criminalCaseId,
              productionStatus: prosecutionDiscoveryItems.productionStatus,
              reviewStatus: prosecutionDiscoveryItems.reviewStatus,
            })
            .from(prosecutionDiscoveryItems)
            .where(
              and(
                eq(prosecutionDiscoveryItems.organizationId, params.organizationId),
                inArray(prosecutionDiscoveryItems.criminalCaseId, caseIds),
              ),
            ),
          db
            .select({
              id: prosecutionCaseDrafts.id,
              criminalCaseId: prosecutionCaseDrafts.criminalCaseId,
              status: prosecutionCaseDrafts.status,
              title: prosecutionCaseDrafts.title,
            })
            .from(prosecutionCaseDrafts)
            .where(
              and(
                eq(prosecutionCaseDrafts.organizationId, params.organizationId),
                inArray(prosecutionCaseDrafts.criminalCaseId, caseIds),
              ),
            ),
          db
            .select({
              id: prosecutionProcedureIssues.id,
              criminalCaseId: prosecutionProcedureIssues.criminalCaseId,
              status: prosecutionProcedureIssues.status,
              issueType: prosecutionProcedureIssues.issueType,
            })
            .from(prosecutionProcedureIssues)
            .where(
              and(
                eq(prosecutionProcedureIssues.organizationId, params.organizationId),
                inArray(prosecutionProcedureIssues.criminalCaseId, caseIds),
              ),
            ),
          db
            .select({
              id: prosecutionEvidenceItems.id,
              criminalCaseId: prosecutionEvidenceItems.criminalCaseId,
              chainOfCustody: prosecutionEvidenceItems.chainOfCustody,
            })
            .from(prosecutionEvidenceItems)
            .where(
              and(
                eq(prosecutionEvidenceItems.organizationId, params.organizationId),
                inArray(prosecutionEvidenceItems.criminalCaseId, caseIds),
              ),
            ),
          db
            .select({
              id: prosecutionMotions.id,
              criminalCaseId: prosecutionMotions.criminalCaseId,
              hearingDate: prosecutionMotions.hearingDate,
              responseDueDate: prosecutionMotions.responseDueDate,
              motionType: prosecutionMotions.motionType,
            })
            .from(prosecutionMotions)
            .where(
              and(
                eq(prosecutionMotions.organizationId, params.organizationId),
                inArray(prosecutionMotions.criminalCaseId, caseIds),
              ),
            ),
          db
            .select({
              id: prosecutionPleaOffers.id,
              criminalCaseId: prosecutionPleaOffers.criminalCaseId,
              expiration: prosecutionPleaOffers.expiration,
              versionLabel: prosecutionPleaOffers.versionLabel,
            })
            .from(prosecutionPleaOffers)
            .where(
              and(
                eq(prosecutionPleaOffers.organizationId, params.organizationId),
                inArray(prosecutionPleaOffers.criminalCaseId, caseIds),
              ),
            ),
          db
            .select({
              id: prosecutionSubpoenas.id,
              criminalCaseId: prosecutionSubpoenas.criminalCaseId,
              returnDate: prosecutionSubpoenas.returnDate,
              recipient: prosecutionSubpoenas.recipient,
            })
            .from(prosecutionSubpoenas)
            .where(
              and(
                eq(prosecutionSubpoenas.organizationId, params.organizationId),
                inArray(prosecutionSubpoenas.criminalCaseId, caseIds),
              ),
            ),
        ]);

  const overdueTasks = tasks.filter(
    (t) => t.dueAt && t.dueAt < now && t.status !== "completed" && t.status !== "cancelled",
  );
  const upcomingTasks = tasks.filter(
    (t) =>
      t.dueAt &&
      t.dueAt >= now &&
      t.dueAt <= inSevenDays &&
      t.status !== "completed" &&
      t.status !== "cancelled",
  );
  const upcomingHearings = hearings.filter(
    (h) => h.dateTime && h.dateTime >= now && h.dateTime <= inSevenDays,
  );
  const disclosureAwaiting = disclosures.filter((d) =>
    ["UNREVIEWED", "REVIEW_REQUIRED", "ESCALATE"].includes(d.status),
  );
  const pendingProduction = discovery.filter((d) =>
    ["RECEIVED", "REVIEWED", "FLAGGED"].includes(d.productionStatus),
  );
  const openProcedure = procedureIssues.filter((i) => i.status === "open" || i.status === "OPEN");
  const draftsAwaiting = drafts.filter((d) => d.status === "DRAFT");

  const custodyWarningCaseIds = new Set<string>();
  for (const item of evidence) {
    const chain = normalizeCustody(item.chainOfCustody);
    const findings = validateChainOfCustody(chain);
    if (findings.length > 0) custodyWarningCaseIds.add(item.criminalCaseId);
  }

  // Investigation gaps are approximated from open procedure + custody + disclosure backlog
  // without hydrating full case intelligence for every case.
  const gapCaseIds = new Set<string>([
    ...openProcedure.map((i) => i.criminalCaseId),
    ...custodyWarningCaseIds,
    ...disclosureAwaiting.map((d) => d.criminalCaseId),
  ]);

  const counts = buildOfficeAggregateCounts({
    cases,
    disclosureAwaitingFinal: disclosureAwaiting.length,
    pendingDiscoveryProduction: pendingProduction.length,
    upcomingHearings: upcomingHearings.length,
    overdueTasks: overdueTasks.length,
    upcomingTasks: upcomingTasks.length,
    openInvestigationGaps: gapCaseIds.size,
    chainOfCustodyWarnings: custodyWarningCaseIds.size,
    openProcedureIssues: openProcedure.length,
    draftsAwaitingReview: draftsAwaiting.length,
    casesAwaitingSupervisorReview: cases.filter(
      (c) =>
        !isClosedStatus(c.caseStatus) &&
        (!c.lastSupervisorReviewAt ||
          (c.updatedAt && c.lastSupervisorReviewAt && c.updatedAt > c.lastSupervisorReviewAt)),
    ).length,
  });

  const hearingsByCase = new Map<string, number>();
  for (const hearing of upcomingHearings) {
    hearingsByCase.set(
      hearing.criminalCaseId,
      (hearingsByCase.get(hearing.criminalCaseId) ?? 0) + 1,
    );
  }
  const pendingReviewByProsecutor = new Map<string, number>();
  for (const criminalCase of cases) {
    if (!criminalCase.supervisingProsecutorId) continue;
    const pending =
      disclosureAwaiting.some((d) => d.criminalCaseId === criminalCase.id) ||
      draftsAwaiting.some((d) => d.criminalCaseId === criminalCase.id);
    if (pending) {
      pendingReviewByProsecutor.set(
        criminalCase.supervisingProsecutorId,
        (pendingReviewByProsecutor.get(criminalCase.supervisingProsecutorId) ?? 0) + 1,
      );
    }
  }

  const members = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      roleKey: roles.key,
      capability: permissions.capability,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.roleId, roles.id))
    .where(
      and(eq(memberships.organizationId, params.organizationId), eq(memberships.status, "active")),
    );
  const memberById = new Map<
    string,
    {
      userId: string;
      name: string | null;
      email: string;
      roleKey: string;
      capabilities: Set<string>;
      canBeProsecutor: boolean;
      canBeSupervisor: boolean;
    }
  >();
  for (const row of members) {
    const existing = memberById.get(row.userId) ?? {
      userId: row.userId,
      name: row.name,
      email: row.email,
      roleKey: row.roleKey,
      capabilities: new Set<string>(),
      canBeProsecutor: false,
      canBeSupervisor: false,
    };
    existing.capabilities.add(row.capability);
    memberById.set(row.userId, existing);
  }
  for (const member of memberById.values()) {
    member.canBeProsecutor = prosecutionCapabilityAllows(member.capabilities, "motion.manage");
    member.canBeSupervisor = prosecutionCapabilityAllows(member.capabilities, "review");
  }

  const workload = buildWorkloadByProsecutor({
    cases,
    tasks: tasks.map((t) => ({
      ownerUserId: t.ownerUserId,
      status: t.status,
      criminalCaseId: t.criminalCaseId,
    })),
    hearingsByCase,
    pendingReviewByProsecutor,
  }).map((row) => ({
    ...row,
    name: memberById.get(row.userId)?.name ?? null,
    email: memberById.get(row.userId)?.email ?? null,
  }));

  const activeCaseCountByUser = new Map<string, number>();
  for (const row of workload) activeCaseCountByUser.set(row.userId, row.activeCaseCount);
  const assignmentSuggestions = suggestAssignmentCandidates({
    members: [...memberById.values()],
    activeCaseCountByUser,
  });

  const caseNumberById = new Map(cases.map((c) => [c.id, c.caseNumber]));
  const calendarEvents = [
    ...upcomingHearings.map((h) => ({
      id: h.id,
      caseId: h.criminalCaseId,
      caseNumber: caseNumberById.get(h.criminalCaseId) ?? "",
      eventType: "HEARING",
      title: h.hearingType,
      dateTime: h.dateTime!.toISOString(),
      dateOrigin: "USER_ENTERED" as const,
    })),
    ...upcomingTasks.map((t) => ({
      id: t.id,
      caseId: t.criminalCaseId,
      caseNumber: caseNumberById.get(t.criminalCaseId) ?? "",
      eventType: "TASK_DUE",
      title: t.title,
      dateTime: t.dueAt!.toISOString(),
      dateOrigin: assertDueDateNotInvented({ dueAt: t.dueAt, origin: t.dueDateOrigin }),
      priority: t.priority,
    })),
    ...motions
      .filter((m) => m.responseDueDate || m.hearingDate)
      .flatMap((m) => {
        const events = [];
        if (m.responseDueDate) {
          events.push({
            id: `${m.id}-response`,
            caseId: m.criminalCaseId,
            caseNumber: caseNumberById.get(m.criminalCaseId) ?? "",
            eventType: "MOTION_RESPONSE_DUE",
            title: m.motionType,
            dateTime: `${m.responseDueDate}T12:00:00.000Z`,
            dateOrigin: "USER_ENTERED" as const,
          });
        }
        if (m.hearingDate) {
          events.push({
            id: `${m.id}-hearing`,
            caseId: m.criminalCaseId,
            caseNumber: caseNumberById.get(m.criminalCaseId) ?? "",
            eventType: "MOTION_HEARING",
            title: m.motionType,
            dateTime: `${m.hearingDate}T12:00:00.000Z`,
            dateOrigin: "USER_ENTERED" as const,
          });
        }
        return events;
      }),
    ...subpoenas
      .filter((s) => s.returnDate)
      .map((s) => ({
        id: s.id,
        caseId: s.criminalCaseId,
        caseNumber: caseNumberById.get(s.criminalCaseId) ?? "",
        eventType: "SUBPOENA_RETURN",
        title: s.recipient,
        dateTime: `${s.returnDate}T12:00:00.000Z`,
        dateOrigin: "USER_ENTERED" as const,
      })),
    ...pleas
      .filter((p) => p.expiration)
      .map((p) => ({
        id: p.id,
        caseId: p.criminalCaseId,
        caseNumber: caseNumberById.get(p.criminalCaseId) ?? "",
        eventType: "PLEA_EXPIRATION",
        title: p.versionLabel ?? "Plea offer",
        dateTime: `${p.expiration}T12:00:00.000Z`,
        dateOrigin: "USER_ENTERED" as const,
      })),
  ].sort((a, b) => a.dateTime.localeCompare(b.dateTime));

  const attentionFlags = buildAttentionFlags({
    cases: cases.filter((c) => !isClosedStatus(c.caseStatus)),
    overdueTaskCaseIds: new Set(overdueTasks.map((t) => t.criminalCaseId)),
    hearingSoonCaseIds: new Set(upcomingHearings.map((h) => h.criminalCaseId)),
    disclosurePendingCaseIds: new Set(disclosureAwaiting.map((d) => d.criminalCaseId)),
    productionPendingCaseIds: new Set(pendingProduction.map((d) => d.criminalCaseId)),
    custodyWarningCaseIds,
    procedureIssueCaseIds: new Set(openProcedure.map((i) => i.criminalCaseId)),
    draftReviewCaseIds: new Set(draftsAwaiting.map((d) => d.criminalCaseId)),
    gapCaseIds,
  });

  const openTaskCountByCase = new Map<string, number>();
  for (const task of tasks) {
    if (task.status === "completed" || task.status === "cancelled") continue;
    openTaskCountByCase.set(
      task.criminalCaseId,
      (openTaskCountByCase.get(task.criminalCaseId) ?? 0) + 1,
    );
  }
  const disclosurePendingByCase = new Map<string, number>();
  for (const d of disclosureAwaiting) {
    disclosurePendingByCase.set(
      d.criminalCaseId,
      (disclosurePendingByCase.get(d.criminalCaseId) ?? 0) + 1,
    );
  }
  const procedureByCase = new Map<string, number>();
  for (const i of openProcedure) {
    procedureByCase.set(i.criminalCaseId, (procedureByCase.get(i.criminalCaseId) ?? 0) + 1);
  }

  const caseloadRows = cases.map((c) => ({
    ...c,
    closedDate: c.closedDate,
    updatedAt: c.updatedAt ? c.updatedAt.toISOString() : null,
    lastSupervisorReviewAt: c.lastSupervisorReviewAt
      ? c.lastSupervisorReviewAt.toISOString()
      : null,
    assignedProsecutorName: c.assignedProsecutorId
      ? (memberById.get(c.assignedProsecutorId)?.name ??
        memberById.get(c.assignedProsecutorId)?.email ??
        null)
      : null,
    supervisingProsecutorName: c.supervisingProsecutorId
      ? (memberById.get(c.supervisingProsecutorId)?.name ??
        memberById.get(c.supervisingProsecutorId)?.email ??
        null)
      : null,
    openTaskCount: openTaskCountByCase.get(c.id) ?? 0,
    disclosurePendingCount: disclosurePendingByCase.get(c.id) ?? 0,
    procedureIssueCount: procedureByCase.get(c.id) ?? 0,
    evidenceGapCount: gapCaseIds.has(c.id) ? 1 : 0,
    custodyWarning: custodyWarningCaseIds.has(c.id),
    nextHearing:
      upcomingHearings
        .filter((h) => h.criminalCaseId === c.id)
        .sort((a, b) => (a.dateTime?.getTime() ?? 0) - (b.dateTime?.getTime() ?? 0))[0]
        ?.dateTime?.toISOString() ?? null,
  }));

  const filtered = filterCaseloadRows(caseloadRows, {
    query: params.query,
    status: params.status,
    priority: params.priority,
    prosecutorId: params.prosecutorId,
    unassignedOnly: params.unassignedOnly,
  });
  const caseloadPage = paginateOfficeRows(filtered, params.page ?? 1, params.pageSize ?? 25);

  const myCases = cases.filter(
    (c) =>
      !isClosedStatus(c.caseStatus) &&
      (c.assignedProsecutorId === params.userId || c.supervisingProsecutorId === params.userId),
  );
  const myTasks = tasks.filter(
    (t) => t.ownerUserId === params.userId && t.status !== "completed" && t.status !== "cancelled",
  );
  const myOverdue = myTasks.filter((t) => t.dueAt && t.dueAt < now);
  const myHearings = upcomingHearings.filter((h) => myCases.some((c) => c.id === h.criminalCaseId));

  const reviewQueues = {
    DISCLOSURE_REVIEW: disclosureAwaiting.slice(0, 50).map((d) => ({
      id: d.id,
      caseId: d.criminalCaseId,
      caseNumber: caseNumberById.get(d.criminalCaseId) ?? "",
      label: d.category,
      status: d.status,
    })),
    SUPERVISOR_CASE_REVIEW: cases
      .filter(
        (c) =>
          !isClosedStatus(c.caseStatus) &&
          (!c.lastSupervisorReviewAt ||
            (c.updatedAt && c.lastSupervisorReviewAt && c.updatedAt > c.lastSupervisorReviewAt)),
      )
      .slice(0, 50)
      .map((c) => ({
        id: c.id,
        caseId: c.id,
        caseNumber: c.caseNumber,
        label: "Supervisor case review",
        status: "PENDING_REVIEW",
      })),
    DRAFT_REVIEW: draftsAwaiting.slice(0, 50).map((d) => ({
      id: d.id,
      caseId: d.criminalCaseId,
      caseNumber: caseNumberById.get(d.criminalCaseId) ?? "",
      label: d.title,
      status: d.status,
    })),
    PROCEDURE_ISSUE_REVIEW: openProcedure.slice(0, 50).map((i) => ({
      id: i.id,
      caseId: i.criminalCaseId,
      caseNumber: caseNumberById.get(i.criminalCaseId) ?? "",
      label: i.issueType,
      status: i.status,
    })),
    EVIDENCE_GAP_REVIEW: [...gapCaseIds].slice(0, 50).map((caseId) => ({
      id: caseId,
      caseId,
      caseNumber: caseNumberById.get(caseId) ?? "",
      label: "Investigation / evidence gap",
      status: "OPEN",
    })),
    CUSTODY_WARNING_REVIEW: [...custodyWarningCaseIds].slice(0, 50).map((caseId) => ({
      id: caseId,
      caseId,
      caseNumber: caseNumberById.get(caseId) ?? "",
      label: "Chain-of-custody warning",
      status: "WARNING",
    })),
    DISCOVERY_PRODUCTION_REVIEW: pendingProduction.slice(0, 50).map((d) => ({
      id: d.id,
      caseId: d.criminalCaseId,
      caseNumber: caseNumberById.get(d.criminalCaseId) ?? "",
      label: d.productionStatus,
      status: d.reviewStatus,
    })),
  };

  const recentActivity = canAudit
    ? await db
        .select({
          id: auditEvents.id,
          action: auditEvents.action,
          targetType: auditEvents.targetType,
          targetId: auditEvents.targetId,
          actorUserId: auditEvents.actorUserId,
          createdAt: auditEvents.createdAt,
          metadata: auditEvents.metadata,
        })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organizationId, params.organizationId),
            sql`${auditEvents.action} like 'prosecution.%'`,
          ),
        )
        .orderBy(sql`${auditEvents.createdAt} desc`)
        .limit(40)
    : [];

  const askContext = formatProsecutionOfficeAskContext({
    counts,
    myAssignedCases: myCases.filter((c) => c.assignedProsecutorId === params.userId).length,
    myOverdueTasks: myOverdue.length,
    myUpcomingHearings: myHearings.length,
  });

  return {
    counts,
    caseload: caseloadPage,
    workload,
    assignmentSuggestions,
    calendarEvents: calendarEvents.slice(0, 100),
    attentionFlags: attentionFlags.slice(0, 100),
    reviewQueues,
    recentActivity,
    myWork: {
      cases: myCases.map((c) => ({
        id: c.id,
        caseNumber: c.caseNumber,
        caseStatus: c.caseStatus,
        priority: c.priority,
        role:
          c.assignedProsecutorId === params.userId
            ? "assigned_prosecutor"
            : "supervising_prosecutor",
      })),
      tasks: myTasks.slice(0, 50),
      overdueTasks: myOverdue.slice(0, 50),
      upcomingHearings: myHearings.slice(0, 50).map((h) => ({
        ...h,
        caseNumber: caseNumberById.get(h.criminalCaseId) ?? "",
        dateTime: h.dateTime?.toISOString() ?? null,
      })),
      disclosurePending: disclosureAwaiting
        .filter((d) => myCases.some((c) => c.id === d.criminalCaseId))
        .slice(0, 50),
    },
    members: [...memberById.values()].map((m) => ({
      userId: m.userId,
      name: m.name,
      email: m.email,
      roleKey: m.roleKey,
      canBeProsecutor: m.canBeProsecutor,
      canBeSupervisor: m.canBeSupervisor,
    })),
    viewer: {
      userId: params.userId,
      canReview,
      canManageCase,
      canAudit,
      capabilities: [...caps],
    },
    askOfficeContext: askContext,
    safety: {
      convictionRate: null,
      pleaEfficiencyScore: null,
      prosecutorPerformanceScore: null,
      guiltOutcomeKpi: null,
      inventedDeadlines: false,
      outcomeBasedRanking: false,
    },
  };
}

export async function searchProsecutionOffice(
  db: Database,
  params: { userId: string; organizationId: string; query: string; limit?: number },
) {
  await authorizeOffice(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    action: "view",
  });
  const q = params.query.trim();
  if (!q) return { results: [] as Array<Record<string, unknown>> };
  const limit = Math.min(50, Math.max(1, params.limit ?? 25));
  const pattern = `%${q.replace(/[%_]/g, "")}%`;
  const rows = await db
    .select({
      id: criminalCases.id,
      caseNumber: criminalCases.caseNumber,
      caseStatus: criminalCases.caseStatus,
      court: criminalCases.court,
      jurisdiction: criminalCases.jurisdiction,
      priority: criminalCases.priority,
      assignedProsecutorId: criminalCases.assignedProsecutorId,
    })
    .from(criminalCases)
    .where(
      and(
        eq(criminalCases.organizationId, params.organizationId),
        or(
          sql`${criminalCases.caseNumber} ilike ${pattern}`,
          sql`${criminalCases.court} ilike ${pattern}`,
          sql`${criminalCases.jurisdiction} ilike ${pattern}`,
          sql`${criminalCases.summary} ilike ${pattern}`,
        ),
      ),
    )
    .limit(limit);
  return {
    results: rows.map((row) => ({
      ...row,
      kind: "criminal_case" as const,
    })),
  };
}

export async function closeCriminalCase(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    caseId: string;
    closedDate?: string | null;
    closureReason?: string | null;
    confirm: boolean;
  },
) {
  if (!params.confirm) {
    throw new ProsecutionError(
      "CONFIRMATION_REQUIRED",
      "Case closure requires explicit confirmation.",
      400,
    );
  }
  await authorizeOffice(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    action: "case.manage",
  });
  assertSafeOfficeCopy(params.closureReason);
  const [existing] = await db
    .select()
    .from(criminalCases)
    .where(
      and(
        eq(criminalCases.id, params.caseId),
        eq(criminalCases.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!existing) throw new ProsecutionError("NOT_FOUND", "Criminal case not found.", 404);
  const closedDate = params.closedDate ?? new Date().toISOString().slice(0, 10);
  const [updated] = await db
    .update(criminalCases)
    .set({
      caseStatus: "CLOSED",
      closedDate,
      closureReason: params.closureReason ?? null,
      updatedByUserId: params.userId,
      updatedAt: new Date(),
    })
    .where(eq(criminalCases.id, existing.id))
    .returning();
  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: existing.matterId,
    action: "prosecution.case_closed",
    targetType: "criminal_case",
    targetId: existing.id,
    metadata: {
      closedDate,
      closureReason: params.closureReason ?? null,
      historyPreserved: true,
    },
  });
  return updated;
}

export async function recordSupervisorCaseReview(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    caseId: string;
    note?: string | null;
    followUpRequested?: boolean;
    followUpTaskTitle?: string | null;
  },
) {
  await authorizeOffice(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    action: "review",
  });
  assertSafeOfficeCopy(params.note);
  const [existing] = await db
    .select()
    .from(criminalCases)
    .where(
      and(
        eq(criminalCases.id, params.caseId),
        eq(criminalCases.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!existing) throw new ProsecutionError("NOT_FOUND", "Criminal case not found.", 404);

  let followUpTaskId: string | null = null;
  if (params.followUpRequested && params.followUpTaskTitle) {
    const [task] = await db
      .insert(prosecutionTasks)
      .values({
        organizationId: params.organizationId,
        criminalCaseId: existing.id,
        title: params.followUpTaskTitle,
        status: "open",
        priority: "high",
        ownerUserId: existing.assignedProsecutorId,
        createdByUserId: params.userId,
        dueDateOrigin: "SYSTEM_OPERATIONAL",
        notes: "Created from supervisor review follow-up request.",
      })
      .returning();
    followUpTaskId = task?.id ?? null;
  }

  const [review] = await db
    .insert(prosecutionSupervisorReviews)
    .values({
      organizationId: params.organizationId,
      criminalCaseId: existing.id,
      reviewerUserId: params.userId,
      status: "COMPLETED",
      note: params.note ?? null,
      followUpRequested: Boolean(params.followUpRequested),
      followUpTaskId,
      snapshot: {
        caseStatus: existing.caseStatus,
        priority: existing.priority,
        assignedProsecutorId: existing.assignedProsecutorId,
        reviewedAt: new Date().toISOString(),
      },
    })
    .returning();

  await db
    .update(criminalCases)
    .set({
      lastSupervisorReviewAt: new Date(),
      lastSupervisorReviewByUserId: params.userId,
      updatedByUserId: params.userId,
      updatedAt: new Date(),
    })
    .where(eq(criminalCases.id, existing.id));

  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: existing.matterId,
    action: "prosecution.supervisor_case_review",
    targetType: "supervisor_review",
    targetId: review?.id,
    metadata: {
      criminalCaseId: existing.id,
      followUpRequested: Boolean(params.followUpRequested),
      followUpTaskId,
    },
  });
  return review;
}
