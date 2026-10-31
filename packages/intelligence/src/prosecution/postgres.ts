import { and, eq, inArray } from "drizzle-orm";
import {
  criminalCases,
  documents,
  ensureProsecutionRoles,
  memberships,
  permissions,
  prosecutionAgencies,
  prosecutionCaseAuthorities,
  prosecutionCaseDrafts,
  prosecutionChargeElements,
  prosecutionCharges,
  prosecutionDefendants,
  prosecutionDisclosureCandidates,
  prosecutionDisclosureProductions,
  prosecutionDiscoveryItems,
  prosecutionDispositions,
  prosecutionEvidenceItems,
  prosecutionEvidenceLinks,
  prosecutionHearings,
  prosecutionMotions,
  prosecutionOfficers,
  prosecutionPleaOffers,
  prosecutionProcedureIssues,
  prosecutionSentences,
  prosecutionSubpoenas,
  prosecutionTasks,
  prosecutionTimelineEvents,
  prosecutionWarrantAffidavits,
  prosecutionWarrantExecutions,
  prosecutionWarrantReturns,
  prosecutionWarrants,
  prosecutionWitnesses,
  prosecutionWitnessStatements,
  roles,
  users,
  type Database,
  type RecordProvenance,
} from "@nyayagrid/database";
import { createDraft } from "../draft";
import {
  AuthorizationError,
  getMembershipCapabilities,
  writeAuditEvent,
} from "@nyayagrid/permissions";
import { assertProvenance } from "../legal/standards";
import {
  partitionEvidenceByDefendant,
  separateProsecutionCaseIssues,
} from "../deepening/evidence-scope";
import { notifyProsecutionEvent } from "../week4/notifications";
import { normalizeCustody, validateChainOfCustody } from "../week4/chain-of-custody";
import { suppressionPayload } from "./suppression-review";
import {
  buildProsecutionCaseIntelligence,
  formatProsecutionAskIntelligenceContext,
} from "./case-intelligence";
import {
  EVIDENCE_RELATIONSHIPS,
  ProsecutionError,
  assertElementStatus,
  assertSameCase,
  assertTenant,
  assertTimelineEventType,
  buildElementsMatrix,
  compareWitnessStatements,
  deriveElementStatus,
  isFinalDisclosureStatus,
  normalizeProsecutionEvidenceType,
  prosecutionCapabilityAllows,
  prosecutionResourceCapability,
  type ChargeElementStatus,
  type ProsecutionResourceAction,
  type StatementClaim,
} from "./domain";
import { buildDiscoveryDashboard } from "../week4/discovery-ops";
import {
  appendDisclosureReviewHistory,
  buildDisclosureCandidateProposals,
  buildSupervisorDisclosureQueue,
  filterDiscoveryItems,
  formatProsecutionDisclosureAskContext,
  paginateRows,
  transitionDisclosureWithGuards,
  assertSafeDisclosureCopy,
} from "./disclosure-workflow";
import {
  assertDateProvidedOrUnknown,
  assertPersistedAuthorityGrounded,
  assertProcedureIssueType,
  assertSafeLegalWorkflowCopy,
  buildHearingPrepView,
  buildSuppressionAnalysisSections,
  classifyDraftCitationMarker,
  comparePleaOffers,
  dateDisplayLabel,
  formatProsecutionLegalWorkflowAskContext,
  normalizeMotionType,
  suggestLegalWorkflowTasks,
} from "./legal-workflow";

async function authorize(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    action: ProsecutionResourceAction;
  },
) {
  await ensureProsecutionRoles(db, params.organizationId);
  const membership = await getMembershipCapabilities(db, {
    userId: params.userId,
    organizationId: params.organizationId,
  });
  if (!membership || !prosecutionCapabilityAllows(membership.capabilities, params.action)) {
    throw new AuthorizationError("Missing prosecution capability for this action.");
  }
}

async function requireCase(db: Database, organizationId: string, caseId: string) {
  const [row] = await db
    .select()
    .from(criminalCases)
    .where(and(eq(criminalCases.id, caseId), eq(criminalCases.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new ProsecutionError("NOT_FOUND", "Criminal case not found.", 404);
  assertTenant(organizationId, row.organizationId);
  return row;
}

function provenanceOf(value: RecordProvenance): RecordProvenance {
  assertProvenance(value);
  return value;
}

export async function listCriminalCases(
  db: Database,
  params: { userId: string; organizationId: string },
) {
  await authorize(db, { ...params, action: "view" });
  return db
    .select()
    .from(criminalCases)
    .where(eq(criminalCases.organizationId, params.organizationId));
}

export async function createCriminalCase(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    caseNumber: string;
    jurisdiction: string;
    court: string;
    courthouse?: string | null;
    caseStatus?: string;
    priority?: string;
    summary?: string | null;
    matterId?: string | null;
  },
) {
  await authorize(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    action: "case.manage",
  });
  const [created] = await db
    .insert(criminalCases)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId ?? null,
      caseNumber: params.caseNumber,
      jurisdiction: params.jurisdiction,
      court: params.court,
      courthouse: params.courthouse ?? null,
      caseStatus: params.caseStatus ?? "open",
      priority: params.priority ?? "normal",
      summary: params.summary ?? null,
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();
  if (!created) throw new ProsecutionError("INSERT_FAILED", "Criminal case was not created.", 500);
  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: created.matterId,
    action: "prosecution.case_created",
    targetType: "criminal_case",
    targetId: created.id,
  });
  return created;
}

function dateLabel(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function listAssignableProsecutionMembers(db: Database, organizationId: string) {
  const rows = await db
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
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, "active")));
  const byUser = new Map<
    string,
    {
      userId: string;
      name: string | null;
      email: string;
      roleKey: string;
      capabilities: Set<string>;
    }
  >();
  for (const row of rows) {
    const existing = byUser.get(row.userId) ?? {
      userId: row.userId,
      name: row.name,
      email: row.email,
      roleKey: row.roleKey,
      capabilities: new Set<string>(),
    };
    existing.capabilities.add(row.capability);
    byUser.set(row.userId, existing);
  }
  return [...byUser.values()]
    .filter(
      (member) =>
        member.capabilities.has("prosecution.view") || member.capabilities.has("prosecution.edit"),
    )
    .map((member) => ({
      userId: member.userId,
      name: member.name,
      email: member.email,
      roleKey: member.roleKey,
      canBeProsecutor:
        prosecutionCapabilityAllows(member.capabilities, "charge.manage") ||
        prosecutionCapabilityAllows(member.capabilities, "case.manage"),
      canBeSupervisor: prosecutionCapabilityAllows(member.capabilities, "review"),
    }));
}

async function assertAssignableProsecutor(
  db: Database,
  params: { organizationId: string; userId: string },
) {
  const membership = await getMembershipCapabilities(db, params);
  if (
    !membership ||
    !(
      prosecutionCapabilityAllows(membership.capabilities, "charge.manage") ||
      prosecutionCapabilityAllows(membership.capabilities, "case.manage")
    )
  ) {
    throw new ProsecutionError(
      "INVALID_ASSIGNMENT",
      "Assigned prosecutor must belong to this organization with an allowed prosecution role.",
      400,
    );
  }
}

async function assertAssignableSupervisor(
  db: Database,
  params: { organizationId: string; userId: string },
) {
  const membership = await getMembershipCapabilities(db, params);
  if (!membership || !prosecutionCapabilityAllows(membership.capabilities, "review")) {
    throw new ProsecutionError(
      "INVALID_ASSIGNMENT",
      "Assigned supervisor must belong to this organization with review authority.",
      400,
    );
  }
}

export async function updateCriminalCase(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    caseId: string;
    patch: {
      caseNumber?: string;
      caseStatus?: string;
      jurisdiction?: string;
      court?: string;
      courthouse?: string | null;
      priority?: string;
      summary?: string | null;
      notes?: string | null;
      assignmentNote?: string | null;
      assignedProsecutorId?: string | null;
      supervisingProsecutorId?: string | null;
      investigatingAgencyId?: string | null;
      closedDate?: string | null;
      closureReason?: string | null;
    };
  },
) {
  await authorize(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    action: "case.manage",
  });
  const criminalCase = await requireCase(db, params.organizationId, params.caseId);
  const patch = params.patch;
  if (patch.assignedProsecutorId) {
    await assertAssignableProsecutor(db, {
      organizationId: params.organizationId,
      userId: patch.assignedProsecutorId,
    });
  }
  if (patch.supervisingProsecutorId) {
    await assertAssignableSupervisor(db, {
      organizationId: params.organizationId,
      userId: patch.supervisingProsecutorId,
    });
  }
  if (patch.investigatingAgencyId) {
    const [agency] = await db
      .select()
      .from(prosecutionAgencies)
      .where(
        and(
          eq(prosecutionAgencies.id, patch.investigatingAgencyId),
          eq(prosecutionAgencies.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!agency) {
      throw new ProsecutionError(
        "ORPHAN_REFERENCE",
        "Investigating agency not found in this organization.",
        404,
      );
    }
  }
  const priorProsecutor = criminalCase.assignedProsecutorId;
  const [updated] = await db
    .update(criminalCases)
    .set({
      ...(patch.caseNumber !== undefined ? { caseNumber: patch.caseNumber } : {}),
      ...(patch.caseStatus !== undefined ? { caseStatus: patch.caseStatus } : {}),
      ...(patch.jurisdiction !== undefined ? { jurisdiction: patch.jurisdiction } : {}),
      ...(patch.court !== undefined ? { court: patch.court } : {}),
      ...(patch.courthouse !== undefined ? { courthouse: patch.courthouse } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.assignmentNote !== undefined ? { assignmentNote: patch.assignmentNote } : {}),
      ...(patch.assignedProsecutorId !== undefined
        ? { assignedProsecutorId: patch.assignedProsecutorId }
        : {}),
      ...(patch.supervisingProsecutorId !== undefined
        ? { supervisingProsecutorId: patch.supervisingProsecutorId }
        : {}),
      ...(patch.investigatingAgencyId !== undefined
        ? { investigatingAgencyId: patch.investigatingAgencyId }
        : {}),
      ...(patch.closedDate !== undefined ? { closedDate: patch.closedDate } : {}),
      ...(patch.closureReason !== undefined ? { closureReason: patch.closureReason } : {}),
      updatedByUserId: params.userId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(criminalCases.id, criminalCase.id),
        eq(criminalCases.organizationId, params.organizationId),
      ),
    )
    .returning();
  if (!updated) throw new ProsecutionError("NOT_FOUND", "Criminal case not found.", 404);
  const reassigned =
    patch.assignedProsecutorId !== undefined &&
    patch.assignedProsecutorId !== priorProsecutor &&
    Boolean(patch.assignedProsecutorId);
  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: updated.matterId,
    action: reassigned ? "prosecution.case_reassigned" : "prosecution.case_updated",
    targetType: "criminal_case",
    targetId: updated.id,
    metadata: {
      fields: Object.keys(patch),
      assignedProsecutorId: updated.assignedProsecutorId,
      supervisingProsecutorId: updated.supervisingProsecutorId,
      investigatingAgencyId: updated.investigatingAgencyId,
      priorProsecutorId: priorProsecutor,
      assignmentNote: updated.assignmentNote,
    },
  });
  if (reassigned && updated.assignedProsecutorId) {
    await notifyProsecutionEvent(db, {
      organizationId: params.organizationId,
      userId: updated.assignedProsecutorId,
      kind: "new_assigned_case",
      title: `Case assigned: ${updated.caseNumber}`,
      body: priorProsecutor
        ? `Case ${updated.caseNumber} was reassigned to you.`
        : `Case ${updated.caseNumber} was assigned to you.`,
      href: `/app/prosecution/${updated.id}`,
      matterId: updated.matterId,
    });
  }
  return updated;
}

export async function reviewDisclosureCandidate(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    caseId: string;
    candidateId: string;
    status: string;
    notes?: string | null;
    reason?: string | null;
  },
) {
  const action = isFinalDisclosureStatus(params.status) ? "review" : "disclosure.flag";
  await authorize(db, { userId: params.userId, organizationId: params.organizationId, action });
  const criminalCase = await requireCase(db, params.organizationId, params.caseId);
  const [existing] = await db
    .select()
    .from(prosecutionDisclosureCandidates)
    .where(
      and(
        eq(prosecutionDisclosureCandidates.id, params.candidateId),
        eq(prosecutionDisclosureCandidates.organizationId, params.organizationId),
        eq(prosecutionDisclosureCandidates.criminalCaseId, criminalCase.id),
      ),
    )
    .limit(1);
  if (!existing) throw new ProsecutionError("NOT_FOUND", "Disclosure candidate not found.", 404);
  // Consequential withhold/escalate must include a reason on this transition — do not reuse prior notes alone.
  const status = transitionDisclosureWithGuards({
    next: params.status,
    humanActor: true,
    notes: params.notes ?? null,
    reason: params.reason ?? null,
  });
  const nextNotes = params.notes !== undefined ? params.notes : existing.notes;
  const nextReason = params.reason !== undefined ? params.reason : existing.reason;
  const reviewHistory = appendDisclosureReviewHistory({
    history: existing.reviewHistory ?? [],
    priorStatus: existing.status,
    nextStatus: status,
    actorUserId: params.userId,
    reason: params.reason ?? null,
    notes: params.notes ?? null,
  });
  const [updated] = await db
    .update(prosecutionDisclosureCandidates)
    .set({
      status,
      notes: nextNotes,
      reason: nextReason,
      reviewHistory,
      humanActorId: params.userId,
      updatedAt: new Date(),
    })
    .where(eq(prosecutionDisclosureCandidates.id, existing.id))
    .returning();
  if (!updated) throw new ProsecutionError("NOT_FOUND", "Disclosure candidate not found.", 404);
  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: criminalCase.matterId,
    action: "prosecution.disclosure_review_changed",
    targetType: "disclosure_review",
    targetId: updated.id,
    metadata: {
      criminalCaseId: criminalCase.id,
      previousStatus: existing.status,
      status: updated.status,
      reason: params.reason ?? null,
      finalDetermination: isFinalDisclosureStatus(updated.status),
      reviewHistoryLength: reviewHistory.length,
    },
  });
  return updated;
}

export async function getProsecutionOverview(
  db: Database,
  params: { userId: string; organizationId: string; caseId: string },
) {
  await authorize(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    action: "view",
  });
  const criminalCase = await requireCase(db, params.organizationId, params.caseId);
  const [
    defendants,
    charges,
    elements,
    evidence,
    discovery,
    disclosures,
    witnesses,
    hearings,
    motions,
    subpoenas,
    tasks,
    issues,
    agencies,
    officers,
    warrants,
    timeline,
    statements,
    evidenceLinks,
    productions,
    pleas,
    caseAuthorities,
    caseDrafts,
  ] = await Promise.all([
    db
      .select()
      .from(prosecutionDefendants)
      .where(eq(prosecutionDefendants.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionCharges)
      .where(eq(prosecutionCharges.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionChargeElements)
      .where(eq(prosecutionChargeElements.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionEvidenceItems)
      .where(eq(prosecutionEvidenceItems.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionDiscoveryItems)
      .where(eq(prosecutionDiscoveryItems.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionDisclosureCandidates)
      .where(eq(prosecutionDisclosureCandidates.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionWitnesses)
      .where(eq(prosecutionWitnesses.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionHearings)
      .where(eq(prosecutionHearings.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionMotions)
      .where(eq(prosecutionMotions.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionSubpoenas)
      .where(eq(prosecutionSubpoenas.criminalCaseId, criminalCase.id)),
    db.select().from(prosecutionTasks).where(eq(prosecutionTasks.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionProcedureIssues)
      .where(eq(prosecutionProcedureIssues.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionAgencies)
      .where(eq(prosecutionAgencies.organizationId, params.organizationId)),
    db
      .select()
      .from(prosecutionOfficers)
      .where(eq(prosecutionOfficers.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionWarrants)
      .where(eq(prosecutionWarrants.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionTimelineEvents)
      .where(eq(prosecutionTimelineEvents.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionWitnessStatements)
      .where(eq(prosecutionWitnessStatements.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionEvidenceLinks)
      .where(eq(prosecutionEvidenceLinks.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionDisclosureProductions)
      .where(eq(prosecutionDisclosureProductions.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionPleaOffers)
      .where(eq(prosecutionPleaOffers.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionCaseAuthorities)
      .where(eq(prosecutionCaseAuthorities.criminalCaseId, criminalCase.id)),
    db
      .select()
      .from(prosecutionCaseDrafts)
      .where(eq(prosecutionCaseDrafts.criminalCaseId, criminalCase.id)),
  ]);
  const warrantIds = warrants.map((warrant) => warrant.id);
  const affidavits = warrantIds.length
    ? await db
        .select()
        .from(prosecutionWarrantAffidavits)
        .where(
          and(
            eq(prosecutionWarrantAffidavits.organizationId, params.organizationId),
            inArray(prosecutionWarrantAffidavits.warrantId, warrantIds),
          ),
        )
    : [];
  const executions = warrantIds.length
    ? await db
        .select()
        .from(prosecutionWarrantExecutions)
        .where(
          and(
            eq(prosecutionWarrantExecutions.organizationId, params.organizationId),
            inArray(prosecutionWarrantExecutions.warrantId, warrantIds),
          ),
        )
    : [];
  const returns = warrantIds.length
    ? await db
        .select()
        .from(prosecutionWarrantReturns)
        .where(
          and(
            eq(prosecutionWarrantReturns.organizationId, params.organizationId),
            inArray(prosecutionWarrantReturns.warrantId, warrantIds),
          ),
        )
    : [];
  const matrix = buildElementsMatrix({
    charges: charges.map((charge) => ({ id: charge.id, offenseName: charge.offenseName })),
    elements: elements.map((element) => ({
      id: element.id,
      chargeId: element.chargeId,
      elementText: element.elementText,
      supportingEvidenceIds: element.supportingEvidenceIds,
      contraryEvidenceIds: element.contraryEvidenceIds,
      uncertainEvidenceIds: element.uncertainEvidenceIds,
      missingEvidenceIds: element.missingEvidenceIds,
      relatedAuthorityIds: element.relatedAuthorityIds,
      provenance: element.provenance,
      humanReviewStatus: element.humanReviewStatus,
    })),
  });
  const discoveryDashboard = buildDiscoveryDashboard({
    items: discovery.map((item) => ({
      id: item.id,
      reviewStatus: item.reviewStatus,
      productionStatus: item.productionStatus,
      disclosureReviewStatus: item.disclosureReviewStatus,
      category: item.category,
      relatedEvidenceIds: item.relatedEvidenceIds,
      relatedDocumentIds: item.relatedDocumentIds,
      receivedDate: item.receivedDate,
      producedDate: item.producedDate,
    })),
    disclosureCandidates: disclosures.map((item) => ({
      id: item.id,
      category: item.category,
      status: item.status,
      origin: "other" as const,
      notes: item.notes,
    })),
  });
  const elementGaps = matrix.filter((row) => row.status !== "SUPPORTED");
  const issueSeparation = separateProsecutionCaseIssues({
    charges: charges.map((charge) => ({
      id: charge.id,
      offenseName: charge.offenseName,
      countNumber: charge.countNumber,
      status: charge.status,
      defendantId: charge.defendantId,
    })),
    procedureIssues: issues.map((issue) => ({
      id: issue.id,
      issueType: issue.issueType,
      status: issue.status,
    })),
    elementGaps: elementGaps.map((gap) => ({
      id: gap.elementId,
      elementText: gap.elementText,
      status: gap.status,
    })),
  });
  const evidenceScope = partitionEvidenceByDefendant({
    defendants: defendants.map((defendant) => ({
      id: defendant.id,
      displayName: defendant.displayName,
    })),
    evidence: evidence.map((item) => ({
      id: item.id,
      relatedDefendantIds: item.relatedDefendantIds ?? [],
    })),
  });
  const evidenceItems = evidence.map((item) => {
    const transfers = normalizeCustody(item.chainOfCustody);
    const custodyFindings = validateChainOfCustody(transfers);
    return {
      ...item,
      custodyTransfers: transfers,
      custodyFindings,
      scope:
        (item.relatedDefendantIds?.length ?? 0) === 0
          ? "joint_or_unassigned"
          : (item.relatedDefendantIds?.length ?? 0) > 1
            ? "joint"
            : "defendant_specific",
    };
  });
  const caseIntelligence = buildProsecutionCaseIntelligence({
    caseId: criminalCase.id,
    matrix,
    evidence: evidenceItems.map((item) => ({
      id: item.id,
      evidenceType: item.evidenceType,
      relatedDefendantIds: item.relatedDefendantIds ?? [],
      relatedChargeIds: item.relatedChargeIds ?? [],
      relatedElementIds: item.relatedElementIds ?? [],
      chainOfCustody: item.chainOfCustody,
      provenance: item.provenance,
      custodyFindings: item.custodyFindings,
    })),
    evidenceLinks: evidenceLinks.map((link) => ({
      id: link.id,
      evidenceId: link.evidenceId,
      relationship: link.relationship,
      targetType: link.targetType,
      targetId: link.targetId,
      provenance: link.provenance,
      createdAt: link.createdAt,
    })),
    witnesses: witnesses.map((witness) => ({ id: witness.id, displayName: witness.displayName })),
    statements: statements.map((statement) => ({
      id: statement.id,
      witnessId: statement.witnessId,
      claims: statement.claims ?? [],
      provenance: statement.provenance,
      statementDate: statement.statementDate,
      sourceDocumentId: statement.sourceDocumentId,
    })),
    timeline: timeline.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      title: event.title,
      eventDate: event.eventDate,
      provenance: event.provenance,
    })),
    procedureIssues: issues.map((issue) => ({
      id: issue.id,
      issueType: issue.issueType,
      status: issue.status,
      missingFacts: issue.missingFacts ?? [],
    })),
    disclosures: disclosures.map((item) => ({
      id: item.id,
      status: item.status,
      category: item.category,
    })),
    discoveryCount: discovery.length,
    openTaskCount: tasks.filter((task) => task.status === "open").length,
    defendantCount: defendants.length,
  });
  const witnessProfiles = witnesses.map((witness) => {
    const witnessStatements = statements.filter((statement) => statement.witnessId === witness.id);
    const comparison =
      witnessStatements.length >= 2
        ? compareWitnessStatements(
            (witnessStatements[0]!.claims ?? []).map((claim): StatementClaim => ({
              key: claim.key,
              value: claim.value,
              kind: claim.kind === "time" ? "time" : "fact",
            })),
            (witnessStatements[1]!.claims ?? []).map((claim): StatementClaim => ({
              key: claim.key,
              value: claim.value,
              kind: claim.kind === "time" ? "time" : "fact",
            })),
          )
        : [];
    const discrepancies = [
      ...caseIntelligence.witnessIntelligence.contradictions,
      ...caseIntelligence.witnessIntelligence.omissions,
      ...caseIntelligence.witnessIntelligence.addedDetail,
      ...caseIntelligence.witnessIntelligence.timelineDifferences,
      ...caseIntelligence.witnessIntelligence.consistent,
    ].filter((row) =>
      witnessStatements.some((s) => s.id === row.statementA.id || s.id === row.statementB.id),
    );
    return {
      ...witness,
      statements: witnessStatements,
      statementComparison: comparison,
      statementDiscrepancies: discrepancies,
      truthfulnessConclusion: null as null,
    };
  });
  const membership = await getMembershipCapabilities(db, {
    userId: params.userId,
    organizationId: params.organizationId,
  });
  const viewerCapabilities = membership ? [...membership.capabilities] : [];
  const assignableMembers = await listAssignableProsecutionMembers(db, params.organizationId);
  const reviewerIds = [
    ...new Set(
      disclosures.map((item) => item.humanActorId).filter((id): id is string => Boolean(id)),
    ),
  ];
  const reviewers =
    reviewerIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, reviewerIds))
      : [];
  const reviewerById = new Map(reviewers.map((row) => [row.id, row]));
  const surfacedDisclosureCandidates = buildDisclosureCandidateProposals({
    contraryEvidenceIds: [...new Set(matrix.flatMap((row) => row.contraryEvidenceIds))],
    weakElementIds: matrix
      .filter((row) => row.status === "NO_EVIDENCE_FOUND" || row.status === "UNKNOWN")
      .map((row) => row.elementId),
    conflictedElementIds: matrix
      .filter((row) => row.status === "CONFLICTED")
      .map((row) => row.elementId),
    witnessConflictWitnessIds: [
      ...new Set(
        caseIntelligence.witnessIntelligence.contradictions.flatMap((row) => {
          const a = statements.find((s) => s.id === row.statementA.id)?.witnessId;
          const b = statements.find((s) => s.id === row.statementB.id)?.witnessId;
          return [a, b].filter((id): id is string => Boolean(id));
        }),
      ),
    ],
    witnessConflictKeys: caseIntelligence.witnessIntelligence.contradictions.map((row) => row.key),
    timelineConflictIds: caseIntelligence.timelineConflicts.flatMap((c) => [
      c.versionA.id,
      c.versionB.id,
    ]),
    procedureIssueIds: issues
      .filter((i) => i.status === "open" || i.status === "OPEN")
      .map((i) => i.id),
  });
  const supervisorQueue = buildSupervisorDisclosureQueue({
    candidates: disclosures.map((item) => ({
      id: item.id,
      category: item.category,
      status: item.status,
      priority: item.priority,
    })),
    discovery: discovery.map((item) => ({
      id: item.id,
      category: item.category,
      reviewStatus: item.reviewStatus,
      productionStatus: item.productionStatus,
      priority: item.priority,
    })),
    productions: productions.map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
    })),
  });
  const discoveryQueue = {
    total: discovery.length,
    unreviewed: discovery.filter((item) => ["RECEIVED", "UNREVIEWED"].includes(item.reviewStatus))
      .length,
    reviewRequired: discovery.filter((item) => item.disclosureReviewStatus === "REVIEW_REQUIRED")
      .length,
    flagged: discovery.filter((item) => item.reviewStatus === "FLAGGED").length,
    potentialDisclosureCandidate: disclosures.filter((item) =>
      ["UNREVIEWED", "REVIEW_REQUIRED", "ESCALATE"].includes(item.status),
    ).length,
    produced: discovery.filter((item) => item.productionStatus === "PRODUCED").length,
    pendingProduction: discovery.filter(
      (item) =>
        item.productionStatus !== "PRODUCED" &&
        item.productionStatus !== "WITHHELD_FOR_ATTORNEY_REVIEW",
    ).length,
    withheldForAttorneyReview: discovery.filter(
      (item) => item.productionStatus === "WITHHELD_FOR_ATTORNEY_REVIEW",
    ).length,
    escalated: disclosures.filter((item) => item.status === "ESCALATE").length,
    missingOrExpected: discovery.filter(
      (item) => item.category === "MISSING_EXPECTED" || item.reviewStatus === "UNKNOWN",
    ).length,
    unknown: discovery.filter((item) => item.reviewStatus === "UNKNOWN").length,
    items: paginateRows(discovery, 1, 50),
    filtered: filterDiscoveryItems(discovery, {}),
  };
  const disclosureAskContext = formatProsecutionDisclosureAskContext({
    discoveryCount: discovery.length,
    unreviewedDiscovery: discoveryQueue.unreviewed,
    producedDiscovery: discoveryQueue.produced,
    candidates: disclosures.map((item) => ({
      id: item.id,
      category: item.category,
      status: item.status,
      reason: item.reason,
      origin: item.origin,
    })),
    productions: productions.map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
      isSupplemental: item.isSupplemental,
    })),
    supervisorQueueCount: supervisorQueue.length,
  });
  const legalWorkflowAskContext = formatProsecutionLegalWorkflowAskContext({
    openProcedureIssues: issues.filter((i) => i.status === "open" || i.status === "OPEN").length,
    unresolvedSuppressionIssues: issues.filter(
      (i) =>
        (i.humanReviewStatus ?? "UNREVIEWED") !== "REVIEWED" &&
        [
          "SEARCH",
          "SEIZURE",
          "WARRANT",
          "PROBABLE_CAUSE",
          "MIRANDA",
          "CUSTODY",
          "INTERROGATION",
        ].includes(i.issueType),
    ).length,
    motions: motions.map((m) => ({ id: m.id, motionType: m.motionType, status: m.status })),
    hearings: hearings.map((h) => ({
      id: h.id,
      hearingType: h.hearingType,
      dateTime: h.dateTime ? h.dateTime.toISOString() : null,
    })),
    subpoenas: subpoenas.map((s) => ({
      id: s.id,
      recipient: s.recipient,
      status: s.status,
      returnStatus: s.returnStatus ?? "PENDING",
    })),
    pleas: pleas.map((p) => ({
      id: p.id,
      versionLabel: p.versionLabel,
      status: p.status,
    })),
    authorities: caseAuthorities.map((a) => ({
      id: a.id,
      citation: a.citation,
      hierarchyStatus: a.hierarchyStatus,
      relation: a.relation,
    })),
    drafts: caseDrafts.map((d) => ({ id: d.id, title: d.title, status: d.status })),
  });
  const sortedPleas = [...pleas].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const pleaComparison =
    sortedPleas.length >= 2
      ? comparePleaOffers(
          {
            id: sortedPleas[0]!.id,
            versionLabel: sortedPleas[0]!.versionLabel,
            terms: sortedPleas[0]!.terms,
            conditions: sortedPleas[0]!.conditions ?? [],
            relatedChargeIds: sortedPleas[0]!.relatedChargeIds ?? [],
            status: sortedPleas[0]!.status,
            offerDate: sortedPleas[0]!.offerDate,
            expiration: sortedPleas[0]!.expiration,
            defenseResponse: sortedPleas[0]!.defenseResponse,
            prosecutorNotes: sortedPleas[0]!.prosecutorNotes,
          },
          {
            id: sortedPleas[sortedPleas.length - 1]!.id,
            versionLabel: sortedPleas[sortedPleas.length - 1]!.versionLabel,
            terms: sortedPleas[sortedPleas.length - 1]!.terms,
            conditions: sortedPleas[sortedPleas.length - 1]!.conditions ?? [],
            relatedChargeIds: sortedPleas[sortedPleas.length - 1]!.relatedChargeIds ?? [],
            status: sortedPleas[sortedPleas.length - 1]!.status,
            offerDate: sortedPleas[sortedPleas.length - 1]!.offerDate,
            expiration: sortedPleas[sortedPleas.length - 1]!.expiration,
            defenseResponse: sortedPleas[sortedPleas.length - 1]!.defenseResponse,
            prosecutorNotes: sortedPleas[sortedPleas.length - 1]!.prosecutorNotes,
          },
        )
      : null;
  const hearingPrep = hearings.slice(0, 20).map((hearing) =>
    buildHearingPrepView({
      hearingId: hearing.id,
      hearingType: hearing.hearingType,
      dateTime: hearing.dateTime ? hearing.dateTime.toISOString() : null,
      issuesToAddress: issues
        .filter(
          (issue) =>
            (hearing.issueIds ?? []).includes(issue.id) ||
            (hearing.relatedMotionIds ?? []).some((motionId) =>
              (motions.find((m) => m.id === motionId)?.issueIds ?? []).includes(issue.id),
            ),
        )
        .map((issue) => `${issue.issueType}: ${issue.description ?? "procedure issue"}`),
      relevantFacts: issues.flatMap((issue) => issue.supportingFacts ?? []).slice(0, 20),
      contraryFacts: issues.flatMap((issue) => issue.contraryFacts ?? []).slice(0, 20),
      witnesses: witnesses.map((w) => w.displayName).slice(0, 20),
      evidence: evidence.map((e) => e.evidenceType).slice(0, 20),
      motions: motions
        .filter((m) => (hearing.relatedMotionIds ?? []).includes(m.id))
        .map((m) => m.motionType),
      authorities: caseAuthorities.map((a) => `${a.citation} (${a.hierarchyStatus})`).slice(0, 20),
      unresolvedGaps: [
        ...issues
          .filter((i) => (i.missingFacts ?? []).length > 0)
          .flatMap((i) => i.missingFacts ?? []),
        ...disclosures
          .filter((d) => ["UNREVIEWED", "REVIEW_REQUIRED", "ESCALATE"].includes(d.status))
          .map((d) => `Unresolved disclosure candidate: ${d.category}`),
      ].slice(0, 30),
      openTasks: tasks.filter((t) => t.status === "open").map((t) => t.title),
      drafts: caseDrafts.map((d) => d.title),
      recentDisclosureChanges: disclosures
        .filter((d) => isFinalDisclosureStatus(d.status))
        .map((d) => `${d.category}:${d.status}`)
        .slice(0, 10),
    }),
  );
  const suggestedLegalTasks = suggestLegalWorkflowTasks({
    openProcedureIssues: issues.filter((i) => i.status === "open" || i.status === "OPEN").length,
    motionsNeedingResponse: motions.filter((m) =>
      ["filed", "PENDING_RESPONSE", "pending_response"].includes(m.status),
    ).length,
    hearingsWithoutPrep: hearings.filter((h) => !h.dateTime).length,
    pendingSubpoenaReturns: subpoenas.filter((s) => (s.returnStatus ?? "PENDING") === "PENDING")
      .length,
    pleaVersions: pleas.length,
    researchOpen: caseAuthorities.filter((a) => a.humanReviewStatus === "UNREVIEWED").length,
  });
  const suppressionAnalysisByIssue = issues.map((issue) => {
    const relatedAuthorities = caseAuthorities.filter((a) =>
      (a.relatedIssueIds ?? []).includes(issue.id),
    );
    return {
      issueId: issue.id,
      issueType: issue.issueType,
      ...buildSuppressionAnalysisSections({
        knownFacts: issue.supportingFacts ?? [],
        disputedFacts: issue.contraryFacts ?? [],
        missingFacts: issue.missingFacts ?? [],
        legalStandard: null,
        supportingAuthority: relatedAuthorities
          .filter((a) => a.relation !== "CONTRARY")
          .map((a) => ({
            citation: a.citation,
            proposition: a.proposition,
            hierarchyStatus: a.hierarchyStatus,
          })),
        contraryAuthority: relatedAuthorities
          .filter((a) => a.relation === "CONTRARY")
          .map((a) => ({
            citation: a.citation,
            proposition: a.proposition,
            hierarchyStatus: a.hierarchyStatus,
          })),
        potentialArguments: [
          "Potential issue requiring review",
          ...(issue.missingFacts ?? []).map((fact) => `Record is incomplete: ${fact}`),
        ],
        uncertainty: issue.missingFacts ?? [],
        humanConclusion: issue.humanConclusion,
      }),
    };
  });
  const matrixWithDisclosure = matrix.map((row) => {
    const relatedCandidates = disclosures.filter(
      (candidate) =>
        (candidate.relatedElementIds ?? []).includes(row.elementId) ||
        row.contraryEvidenceIds.some((id) => (candidate.relatedEvidenceIds ?? []).includes(id)),
    );
    return {
      ...row,
      disclosureCandidateCount: relatedCandidates.length,
      disclosureCandidateStatuses: relatedCandidates.map((c) => c.status),
      disclosureProductionStatuses: relatedCandidates.map((c) => c.productionStatus),
    };
  });
  return {
    case: criminalCase,
    defendants,
    charges,
    hearings,
    motions,
    subpoenas,
    agencies,
    officers,
    openTasks: tasks.filter((task) => task.status === "open"),
    evidenceCount: evidence.length,
    discoveryCount: discovery.length,
    witnessCount: witnesses.length,
    evidenceItems,
    evidenceLinks: caseIntelligence.evidenceLinks,
    witnesses: witnessProfiles,
    statements,
    discoveryItems: discovery,
    discoveryQueue,
    disclosureProductions: productions,
    supervisorDisclosureQueue: supervisorQueue,
    surfacedDisclosureCandidates,
    timelineEvents: caseIntelligence.timelineEvents,
    timelineConflicts: caseIntelligence.timelineConflicts,
    investigationGaps: caseIntelligence.investigationGaps,
    suggestedDisclosureCandidates: caseIntelligence.suggestedDisclosureCandidates,
    witnessIntelligence: caseIntelligence.witnessIntelligence,
    caseIntelligenceStats: caseIntelligence.overviewStats,
    askIntelligenceContext: [
      formatProsecutionAskIntelligenceContext(caseIntelligence),
      disclosureAskContext,
      legalWorkflowAskContext,
    ].join("\n\n"),
    disclosureAskContext,
    legalWorkflowAskContext,
    pleas: pleas.map((plea) => ({
      ...plea,
      offerDateLabel: dateDisplayLabel(plea.offerDate),
      expirationLabel: dateDisplayLabel(plea.expiration),
      pleaRecommendation: null as null,
      acceptRejectRecommendation: null as null,
      pleaValueScore: null as null,
    })),
    pleaComparison,
    hearingPrep,
    suggestedLegalTasks,
    suppressionAnalysisByIssue,
    caseAuthorities: caseAuthorities.map((authority) => ({
      ...authority,
      binding: authority.hierarchyStatus === "BINDING",
      persuasive: authority.hierarchyStatus === "PERSUASIVE",
      contrary: authority.relation === "CONTRARY" || authority.hierarchyStatus === "CONTRARY",
    })),
    caseDrafts: caseDrafts.map((draft) => ({
      ...draft,
      remainsDraftUntilApproved: draft.status === "DRAFT",
      autonomousFiling: false as const,
    })),
    procedureIssues: issues.map((issue) => ({
      ...issue,
      humanConclusion: issue.humanConclusion,
      automaticSuppressionConclusion: null as null,
      automaticValidityConclusion: null as null,
    })),
    motionsDetail: motions.map((motion) => ({
      ...motion,
      responseDueDateLabel: dateDisplayLabel(motion.responseDueDate),
      hearingDateLabel: dateDisplayLabel(motion.hearingDate),
      rulingDateLabel: dateDisplayLabel(motion.rulingDate),
      filedDateLabel: dateDisplayLabel(motion.filedDate),
      deadlineInvented: false as const,
    })),
    subpoenasDetail: subpoenas.map((subpoena) => ({
      ...subpoena,
      issueDateLabel: dateDisplayLabel(subpoena.issueDate),
      serviceDateLabel: dateDisplayLabel(subpoena.serviceDate),
      returnDateLabel: dateDisplayLabel(subpoena.returnDate),
      autonomousIssuance: false as const,
    })),
    warrantsDetail: warrants.map((warrant) => ({
      ...warrant,
      applicationDateLabel: dateDisplayLabel(warrant.applicationDate),
      issueDateLabel: dateDisplayLabel(warrant.issueDate),
      executionDateLabel: dateDisplayLabel(warrant.executionDate),
      automaticInvalidityConclusion: null as null,
    })),
    legalSafety: {
      automaticSuppressionConclusion: null as null,
      automaticWarrantInvalidity: null as null,
      automaticProbableCauseConclusion: null as null,
      pleaRecommendation: null as null,
      autonomousFiling: false as const,
      autonomousSubpoenaIssuance: false as const,
      inventedDeadlines: false as const,
    },
    disclosureCandidates: disclosures.map((item) => ({
      ...item,
      label: "Potential disclosure candidate",
      reviewer: item.humanActorId ? (reviewerById.get(item.humanActorId) ?? null) : null,
      reviewedAt: item.humanActorId ? item.updatedAt : null,
      bradyViolationConclusion: null as null,
      giglioViolationConclusion: null as null,
      mustDiscloseConclusion: null as null,
      witnessCredibilityScore: null as null,
    })),
    assignableMembers,
    viewerCapabilities,
    canReviewDisclosure: prosecutionCapabilityAllows(new Set(viewerCapabilities), "review"),
    canManageCase: prosecutionCapabilityAllows(new Set(viewerCapabilities), "case.manage"),
    canManageEvidence: prosecutionCapabilityAllows(new Set(viewerCapabilities), "evidence.manage"),
    canManageWitnesses: prosecutionCapabilityAllows(new Set(viewerCapabilities), "witness.manage"),
    canManageDiscovery: prosecutionCapabilityAllows(
      new Set(viewerCapabilities),
      "discovery.manage",
    ),
    elementGaps,
    issueFlags: issues,
    issueSeparation,
    evidenceScope,
    matrix: matrixWithDisclosure,
    discoveryDashboard,
    ...suppressionPayload({
      jurisdiction: criminalCase.jurisdiction,
      forumCourtId: criminalCase.court,
      warrants: warrants.map((warrant) => ({
        id: warrant.id,
        warrantType: warrant.warrantType,
        issuingCourt: warrant.issuingCourt,
        issuingJudge: warrant.issuingJudge,
        applicationDate: dateLabel(warrant.applicationDate),
        issueDate: dateLabel(warrant.issueDate),
        executionDate:
          dateLabel(warrant.executionDate) ??
          dateLabel(executions.find((row) => row.warrantId === warrant.id)?.executedAt),
        scope: warrant.scope,
        probableCauseFacts: warrant.probableCauseFacts ?? [],
        sourceFactIds: warrant.sourceFactIds ?? [],
        seizedEvidenceIds: warrant.seizedEvidenceIds ?? [],
        returnNotes: warrant.returnNotes,
        relatedSuppressionIssueIds: warrant.relatedSuppressionIssueIds ?? [],
        affidavitStatements: affidavits
          .filter((row) => row.warrantId === warrant.id)
          .map((row) => row.statement),
        executionNotes: executions
          .filter((row) => row.warrantId === warrant.id)
          .map((row) => row.notes)
          .filter((note): note is string => Boolean(note)),
        returnInventory: returns
          .filter((row) => row.warrantId === warrant.id)
          .flatMap((row) => row.inventory ?? []),
      })),
      procedureIssues: issues.map((issue) => ({
        id: issue.id,
        issueType: issue.issueType,
        relatedEvidenceIds: issue.relatedEvidenceIds ?? [],
        relatedAuthorityIds: issue.relatedAuthorityIds ?? [],
        missingFacts: issue.missingFacts ?? [],
        status: issue.status,
      })),
      evidence: evidence.map((item) => ({
        id: item.id,
        evidenceType: item.evidenceType,
        documentId: item.documentId,
        storageReference: item.storageReference,
        relatedDefendantIds: item.relatedDefendantIds ?? [],
        relatedWitnessIds: item.relatedWitnessIds ?? [],
        provenanceDocumentId: item.documentId,
      })),
      officers: officers.map((officer) => ({
        id: officer.id,
        name: officer.name,
        warrantIds: officer.warrantIds ?? [],
        reportIds: officer.reportIds ?? [],
      })),
      witnesses: witnesses.map((witness) => ({ id: witness.id, displayName: witness.displayName })),
      statements: statements.map((statement) => ({
        witnessId: statement.witnessId,
        claims: (statement.claims ?? []).map((claim) => ({
          key: claim.key,
          value: claim.value,
          kind: claim.kind === "time" ? ("time" as const) : ("fact" as const),
        })),
      })),
      timeline: timeline.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        title: event.title,
        eventDate: dateLabel(event.eventDate),
      })),
    }),
    guiltConclusion: null,
    chargingRecommendation: null,
    witnessCredibilityScore: null,
  };
}

async function assertLinkTarget(
  db: Database,
  params: { organizationId: string; criminalCaseId: string; targetType: string; targetId: string },
) {
  const kind = params.targetType.toLowerCase();
  if (kind === "charge") {
    const [row] = await db
      .select()
      .from(prosecutionCharges)
      .where(
        and(
          eq(prosecutionCharges.id, params.targetId),
          eq(prosecutionCharges.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!row) throw new ProsecutionError("ORPHAN_REFERENCE", "Charge not found.", 404);
    assertSameCase(params.criminalCaseId, row.criminalCaseId);
    return;
  }
  if (kind === "chargeelement" || kind === "element") {
    const [row] = await db
      .select()
      .from(prosecutionChargeElements)
      .where(
        and(
          eq(prosecutionChargeElements.id, params.targetId),
          eq(prosecutionChargeElements.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!row) throw new ProsecutionError("ORPHAN_REFERENCE", "Element not found.", 404);
    assertSameCase(params.criminalCaseId, row.criminalCaseId);
    return;
  }
  if (kind === "warrant") {
    const [row] = await db
      .select()
      .from(prosecutionWarrants)
      .where(
        and(
          eq(prosecutionWarrants.id, params.targetId),
          eq(prosecutionWarrants.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!row) throw new ProsecutionError("ORPHAN_REFERENCE", "Warrant not found.", 404);
    assertSameCase(params.criminalCaseId, row.criminalCaseId);
  }
}

async function assertEvidenceIdsInCase(
  db: Database,
  params: { organizationId: string; criminalCaseId: string; evidenceIds: string[] },
) {
  if (params.evidenceIds.length === 0) return;
  const rows = await db
    .select()
    .from(prosecutionEvidenceItems)
    .where(
      and(
        eq(prosecutionEvidenceItems.organizationId, params.organizationId),
        inArray(prosecutionEvidenceItems.id, params.evidenceIds),
      ),
    );
  if (rows.length !== params.evidenceIds.length) {
    throw new ProsecutionError("ORPHAN_REFERENCE", "Evidence item not found.", 404);
  }
  for (const row of rows) assertSameCase(params.criminalCaseId, row.criminalCaseId);
}

export async function addProsecutionRecord(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    caseId: string;
    resource: string;
    body: Record<string, unknown>;
  },
) {
  let action = prosecutionResourceCapability(params.resource);
  if (params.resource === "disclosure") {
    const requested = String(params.body.status ?? "UNREVIEWED");
    action = isFinalDisclosureStatus(requested) ? "review" : "disclosure.flag";
  }
  await authorize(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    action,
  });
  const criminalCase = await requireCase(db, params.organizationId, params.caseId);
  const needsProvenance = !["agencies", "officers", "tasks"].includes(params.resource);
  const provenance: RecordProvenance = needsProvenance
    ? provenanceOf((params.body.provenance ?? {}) as RecordProvenance)
    : { extractionOrigin: "human", humanEntered: true };
  const organizationId = params.organizationId;
  const criminalCaseId = criminalCase.id;

  if (params.resource === "defendants") {
    const [row] = await db
      .insert(prosecutionDefendants)
      .values({
        organizationId,
        criminalCaseId,
        displayName: String(params.body.displayName ?? ""),
        aliases: (params.body.aliases as string[]) ?? [],
        custodyStatus: (params.body.custodyStatus as string) ?? null,
        defenseCounsel: (params.body.defenseCounsel as string) ?? null,
        notes: (params.body.notes as string) ?? null,
        status: (params.body.status as string) ?? "active",
        provenance,
        privacy: { dobRestricted: true },
      })
      .returning();
    return row;
  }

  if (params.resource === "charges") {
    const defendantId = String(params.body.defendantId ?? "");
    const [defendant] = await db
      .select()
      .from(prosecutionDefendants)
      .where(
        and(
          eq(prosecutionDefendants.id, defendantId),
          eq(prosecutionDefendants.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!defendant) throw new ProsecutionError("ORPHAN_REFERENCE", "Defendant not found.");
    assertSameCase(criminalCaseId, defendant.criminalCaseId);
    const [row] = await db
      .insert(prosecutionCharges)
      .values({
        organizationId,
        criminalCaseId,
        defendantId,
        countNumber: String(params.body.countNumber ?? ""),
        statuteCitation: (params.body.statuteCitation as string) ?? null,
        offenseName: String(params.body.offenseName ?? ""),
        offenseClassification: (params.body.offenseClassification as string) ?? null,
        jurisdiction: String(params.body.jurisdiction ?? criminalCase.jurisdiction),
        status: (params.body.status as string) ?? "pending",
        provenance,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.charge_modified",
      targetType: "charge",
      targetId: row?.id,
      metadata: { criminalCaseId },
    });
    return row;
  }

  if (params.resource === "elements") {
    const chargeId = String(params.body.chargeId ?? "");
    const [charge] = await db
      .select()
      .from(prosecutionCharges)
      .where(
        and(
          eq(prosecutionCharges.id, chargeId),
          eq(prosecutionCharges.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!charge) throw new ProsecutionError("ORPHAN_REFERENCE", "Charge not found.");
    assertSameCase(criminalCaseId, charge.criminalCaseId);
    const supportingEvidenceIds = (params.body.supportingEvidenceIds as string[]) ?? [];
    const contraryEvidenceIds = (params.body.contraryEvidenceIds as string[]) ?? [];
    const uncertainEvidenceIds = (params.body.uncertainEvidenceIds as string[]) ?? [];
    const missingEvidenceIds = (params.body.missingEvidenceIds as string[]) ?? [];
    const status =
      (params.body.status as string) ??
      deriveElementStatus({
        supportingEvidenceIds,
        contraryEvidenceIds,
        uncertainEvidenceIds,
        missingEvidenceIds,
      });
    assertElementStatus(status);
    const [row] = await db
      .insert(prosecutionChargeElements)
      .values({
        organizationId,
        criminalCaseId,
        chargeId,
        elementOrder: Number(params.body.elementOrder ?? 1),
        elementText: String(params.body.elementText ?? ""),
        elementType: String(params.body.elementType ?? "element"),
        supportingEvidenceIds,
        contraryEvidenceIds,
        uncertainEvidenceIds,
        missingEvidenceIds,
        relatedAuthorityIds: (params.body.relatedAuthorityIds as string[]) ?? [],
        status: status as ChargeElementStatus,
        confidence: (params.body.confidence as string) ?? "low",
        humanReviewStatus: (params.body.humanReviewStatus as string) ?? "unreviewed",
        provenance,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.element_modified",
      targetType: "charge_element",
      targetId: row?.id,
      metadata: { criminalCaseId },
    });
    return row;
  }

  if (params.resource === "evidence") {
    const relatedDefendantIds = Array.isArray(params.body.relatedDefendantIds)
      ? [...new Set(params.body.relatedDefendantIds.map((id) => String(id)))]
      : [];
    if (relatedDefendantIds.length > 0) {
      const known = await db
        .select({ id: prosecutionDefendants.id })
        .from(prosecutionDefendants)
        .where(
          and(
            eq(prosecutionDefendants.organizationId, organizationId),
            eq(prosecutionDefendants.criminalCaseId, criminalCaseId),
          ),
        );
      const knownIds = new Set(known.map((defendant) => defendant.id));
      if (relatedDefendantIds.some((id) => !knownIds.has(id))) {
        throw new ProsecutionError("ORPHAN_REFERENCE", "Defendant not found for evidence scope.");
      }
    }
    const [row] = await db
      .insert(prosecutionEvidenceItems)
      .values({
        organizationId,
        criminalCaseId,
        evidenceType: normalizeProsecutionEvidenceType(String(params.body.evidenceType ?? "other")),
        sourceAgency: (params.body.sourceAgency as string) ?? null,
        collector: (params.body.collector as string) ?? null,
        collectionDate: (params.body.collectionDate as string) ?? null,
        storageReference: (params.body.storageReference as string) ?? null,
        // JSONB accepts structured transfers; schema typing remains string[] for legacy rows.
        chainOfCustody: normalizeCustody(params.body.chainOfCustody ?? []).map((transfer) => ({
          actor: transfer.actor,
          timestamp: transfer.timestamp,
          from: transfer.from,
          to: transfer.to,
          location: transfer.location ?? null,
          notes: transfer.notes ?? null,
          source: transfer.source,
        })) as unknown as string[],
        relatedDefendantIds,
        relatedChargeIds: Array.isArray(params.body.relatedChargeIds)
          ? params.body.relatedChargeIds.map(String)
          : [],
        relatedElementIds: Array.isArray(params.body.relatedElementIds)
          ? params.body.relatedElementIds.map(String)
          : [],
        relatedWitnessIds: Array.isArray(params.body.relatedWitnessIds)
          ? params.body.relatedWitnessIds.map(String)
          : [],
        sensitivity: (params.body.sensitivity as string) ?? "standard",
        reviewStatus: (params.body.reviewStatus as string) ?? "received",
        provenance,
      })
      .returning();
    return row;
  }

  if (params.resource === "evidence-links") {
    const evidenceId = String(params.body.evidenceId ?? "");
    const [evidence] = await db
      .select()
      .from(prosecutionEvidenceItems)
      .where(
        and(
          eq(prosecutionEvidenceItems.id, evidenceId),
          eq(prosecutionEvidenceItems.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!evidence) throw new ProsecutionError("ORPHAN_REFERENCE", "Evidence item not found.");
    assertSameCase(criminalCaseId, evidence.criminalCaseId);
    const relationship = String(params.body.relationship ?? "");
    if (!(EVIDENCE_RELATIONSHIPS as readonly string[]).includes(relationship)) {
      throw new ProsecutionError(
        "INVALID_EVIDENCE_RELATIONSHIP",
        "Unsupported evidence relationship.",
      );
    }
    await assertLinkTarget(db, {
      organizationId,
      criminalCaseId,
      targetType: String(params.body.targetType ?? ""),
      targetId: String(params.body.targetId ?? ""),
    });
    const [row] = await db
      .insert(prosecutionEvidenceLinks)
      .values({
        organizationId,
        criminalCaseId,
        evidenceId,
        relationship,
        targetType: String(params.body.targetType ?? ""),
        targetId: String(params.body.targetId ?? ""),
        provenance,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.evidence_link_changed",
      targetType: "evidence_link",
      targetId: row?.id,
      metadata: { criminalCaseId },
    });
    return row;
  }

  if (params.resource === "witnesses") {
    const [row] = await db
      .insert(prosecutionWitnesses)
      .values({
        organizationId,
        criminalCaseId,
        displayName: String(params.body.displayName ?? ""),
        witnessType: String(params.body.witnessType ?? "civilian"),
        relationship: (params.body.relationship as string) ?? null,
        notes: (params.body.notes as string) ?? null,
        sensitivity: (params.body.sensitivity as string) ?? "standard",
        provenance,
      })
      .returning();
    return row;
  }

  if (params.resource === "statements") {
    const witnessId = String(params.body.witnessId ?? "");
    const [witness] = await db
      .select()
      .from(prosecutionWitnesses)
      .where(
        and(
          eq(prosecutionWitnesses.id, witnessId),
          eq(prosecutionWitnesses.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!witness) throw new ProsecutionError("ORPHAN_REFERENCE", "Witness not found.");
    assertSameCase(criminalCaseId, witness.criminalCaseId);
    const [row] = await db
      .insert(prosecutionWitnessStatements)
      .values({
        organizationId,
        criminalCaseId,
        witnessId,
        statementType: String(params.body.statementType ?? "interview"),
        sourceSpan: (params.body.sourceSpan as string) ?? null,
        interviewer: (params.body.interviewer as string) ?? null,
        eventContext: (params.body.eventContext as string) ?? null,
        claims: (params.body.claims as Array<{ key: string; value: string; kind?: string }>) ?? [],
        confidence: (params.body.confidence as string) ?? "low",
        provenance,
      })
      .returning();
    return row;
  }

  if (params.resource === "discovery") {
    const relatedDocumentIds = Array.isArray(params.body.relatedDocumentIds)
      ? params.body.relatedDocumentIds.map(String)
      : [];
    if (relatedDocumentIds.length > 0) {
      const rows = await db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.organizationId, organizationId),
            inArray(documents.id, relatedDocumentIds),
          ),
        );
      if (rows.length !== relatedDocumentIds.length) {
        throw new ProsecutionError(
          "ORPHAN_REFERENCE",
          "A discovery document was not found in this organization.",
          404,
        );
      }
      for (const document of rows) {
        if (
          criminalCase.matterId &&
          document.matterId &&
          document.matterId !== criminalCase.matterId
        ) {
          throw new ProsecutionError(
            "CROSS_CASE",
            "Discovery cannot attach a document from another matter.",
            403,
          );
        }
      }
    }
    const reviewStatus = (params.body.reviewStatus as string) ?? "RECEIVED";
    const productionStatus = (params.body.productionStatus as string) ?? "RECEIVED";
    assertSafeDisclosureCopy((params.body.notes as string) ?? null);
    const [row] = await db
      .insert(prosecutionDiscoveryItems)
      .values({
        organizationId,
        criminalCaseId,
        title: (params.body.title as string) ?? null,
        source: String(params.body.source ?? ""),
        sourceAgency: (params.body.sourceAgency as string) ?? null,
        category: String(params.body.category ?? "unknown"),
        receivedDate: (params.body.receivedDate as string) ?? null,
        reviewStatus,
        productionStatus,
        producedDate: (params.body.producedDate as string) ?? null,
        notes: (params.body.notes as string) ?? null,
        relatedDocumentIds,
        relatedEvidenceIds: Array.isArray(params.body.relatedEvidenceIds)
          ? params.body.relatedEvidenceIds.map(String)
          : [],
        relatedWitnessIds: Array.isArray(params.body.relatedWitnessIds)
          ? params.body.relatedWitnessIds.map(String)
          : [],
        relatedDefendantIds: Array.isArray(params.body.relatedDefendantIds)
          ? params.body.relatedDefendantIds.map(String)
          : [],
        relatedChargeIds: Array.isArray(params.body.relatedChargeIds)
          ? params.body.relatedChargeIds.map(String)
          : [],
        relatedElementIds: Array.isArray(params.body.relatedElementIds)
          ? params.body.relatedElementIds.map(String)
          : [],
        privilegeReviewStatus: (params.body.privilegeReviewStatus as string) ?? "UNREVIEWED",
        confidentialityReviewStatus:
          (params.body.confidentialityReviewStatus as string) ?? "UNREVIEWED",
        priority: (params.body.priority as string) ?? "normal",
        createdByUserId: params.userId,
        auditHistory: [
          `created:${params.userId}:${new Date().toISOString()}:status=${reviewStatus}`,
        ],
        provenance,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.discovery_intake",
      targetType: "discovery_item",
      targetId: row?.id,
      metadata: { criminalCaseId, reviewStatus, productionStatus },
    });
    if (productionStatus === "PRODUCED" || reviewStatus === "RECEIVED") {
      await db.insert(prosecutionTimelineEvents).values({
        organizationId,
        criminalCaseId,
        matterId: criminalCase.matterId,
        eventType: productionStatus === "PRODUCED" ? "DISCOVERY_PRODUCED" : "DISCOVERY_RECEIVED",
        title:
          productionStatus === "PRODUCED"
            ? `Discovery produced: ${row?.category ?? "item"}`
            : `Discovery received: ${row?.category ?? "item"}`,
        eventDate: new Date(),
        provenance,
      });
    }
    return row;
  }

  if (params.resource === "disclosure") {
    const status = transitionDisclosureWithGuards({
      next: (params.body.status as string) ?? "UNREVIEWED",
      humanActor: true,
      notes: (params.body.notes as string) ?? null,
      reason: (params.body.reason as string) ?? null,
    });
    const reason = (params.body.reason as string) ?? null;
    assertSafeDisclosureCopy(reason);
    assertSafeDisclosureCopy((params.body.notes as string) ?? null);
    const [row] = await db
      .insert(prosecutionDisclosureCandidates)
      .values({
        organizationId,
        criminalCaseId,
        category: String(params.body.category ?? "UNKNOWN"),
        status,
        reason,
        origin: (params.body.origin as string) ?? "human",
        relatedEvidenceIds: Array.isArray(params.body.relatedEvidenceIds)
          ? params.body.relatedEvidenceIds.map(String)
          : [],
        relatedWitnessIds: Array.isArray(params.body.relatedWitnessIds)
          ? params.body.relatedWitnessIds.map(String)
          : [],
        relatedDefendantIds: Array.isArray(params.body.relatedDefendantIds)
          ? params.body.relatedDefendantIds.map(String)
          : [],
        relatedChargeIds: Array.isArray(params.body.relatedChargeIds)
          ? params.body.relatedChargeIds.map(String)
          : [],
        relatedElementIds: Array.isArray(params.body.relatedElementIds)
          ? params.body.relatedElementIds.map(String)
          : [],
        relatedDiscoveryIds: Array.isArray(params.body.relatedDiscoveryIds)
          ? params.body.relatedDiscoveryIds.map(String)
          : [],
        relatedIssueIds: Array.isArray(params.body.relatedIssueIds)
          ? params.body.relatedIssueIds.map(String)
          : [],
        confidence: (params.body.confidence as string) ?? "low",
        priority: (params.body.priority as string) ?? "normal",
        reviewHistory: [
          {
            priorStatus: "NONE",
            nextStatus: status,
            actorUserId: params.userId,
            timestamp: new Date().toISOString(),
            reason,
            notes: (params.body.notes as string) ?? null,
          },
        ],
        notes: (params.body.notes as string) ?? null,
        humanActorId: params.userId,
        flaggedByUserId: params.userId,
        provenance,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.disclosure_candidate_created",
      targetType: "disclosure_review",
      targetId: row?.id,
      metadata: { criminalCaseId, status, category: row?.category },
    });
    return row;
  }

  if (params.resource === "productions") {
    const candidateIds = Array.isArray(params.body.candidateIds)
      ? params.body.candidateIds.map(String)
      : [];
    const discoveryItemIds = Array.isArray(params.body.discoveryItemIds)
      ? params.body.discoveryItemIds.map(String)
      : [];
    const status = (params.body.status as string) ?? "PREPARED";
    assertSafeDisclosureCopy((params.body.notes as string) ?? null);
    const [row] = await db
      .insert(prosecutionDisclosureProductions)
      .values({
        organizationId,
        criminalCaseId,
        label: String(params.body.label ?? "Production set"),
        productionDate: (params.body.productionDate as string) ?? null,
        recipientReference: (params.body.recipientReference as string) ?? null,
        deliveryMethod: (params.body.deliveryMethod as string) ?? null,
        batesReference: (params.body.batesReference as string) ?? null,
        candidateIds,
        discoveryItemIds,
        isSupplemental: Boolean(params.body.isSupplemental),
        status,
        notes: (params.body.notes as string) ?? null,
        producedByUserId: params.userId,
        provenance,
      })
      .returning();
    if (candidateIds.length > 0) {
      for (const candidateId of candidateIds) {
        const [candidate] = await db
          .select()
          .from(prosecutionDisclosureCandidates)
          .where(
            and(
              eq(prosecutionDisclosureCandidates.id, candidateId),
              eq(prosecutionDisclosureCandidates.criminalCaseId, criminalCaseId),
              eq(prosecutionDisclosureCandidates.organizationId, organizationId),
            ),
          )
          .limit(1);
        if (!candidate) {
          throw new ProsecutionError(
            "CROSS_CASE",
            "Production cannot include a candidate from another case.",
            403,
          );
        }
        await db
          .update(prosecutionDisclosureCandidates)
          .set({
            productionStatus: status === "PRODUCED" ? "PRODUCED" : "IN_PRODUCTION_SET",
            reviewHistory: appendDisclosureReviewHistory({
              history: candidate.reviewHistory ?? [],
              priorStatus: candidate.status,
              nextStatus: candidate.status,
              actorUserId: params.userId,
              reason: "production_set_link",
              notes: (params.body.notes as string) ?? null,
              productionId: row?.id ?? null,
            }),
            updatedAt: new Date(),
          })
          .where(eq(prosecutionDisclosureCandidates.id, candidate.id));
      }
    }
    if (status === "PRODUCED") {
      await db.insert(prosecutionTimelineEvents).values({
        organizationId,
        criminalCaseId,
        matterId: criminalCase.matterId,
        eventType: "DISCOVERY_PRODUCED",
        title: `Disclosure production prepared: ${row?.label ?? "set"}`,
        eventDate: new Date(),
        provenance,
      });
    }
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.disclosure_production_created",
      targetType: "disclosure_production",
      targetId: row?.id,
      metadata: {
        criminalCaseId,
        status,
        candidateCount: candidateIds.length,
        discoveryItemCount: discoveryItemIds.length,
        externalSend: false,
      },
    });
    return row;
  }

  if (params.resource === "procedure-issues") {
    const issueType = String(params.body.issueType ?? "UNKNOWN");
    assertProcedureIssueType(issueType);
    assertSafeLegalWorkflowCopy(params.body.description as string | undefined);
    assertSafeLegalWorkflowCopy(params.body.humanConclusion as string | undefined);
    if (params.body.humanConclusion) {
      const membership = await getMembershipCapabilities(db, {
        userId: params.userId,
        organizationId,
      });
      if (!membership || !prosecutionCapabilityAllows(membership.capabilities, "review")) {
        throw new ProsecutionError(
          "LEGAL_CONCLUSION_REVIEW_REQUIRED",
          "Final suppression conclusions require prosecution.review.",
          403,
        );
      }
    }
    const [row] = await db
      .insert(prosecutionProcedureIssues)
      .values({
        organizationId,
        criminalCaseId,
        issueType,
        description: (params.body.description as string) ?? null,
        relatedEvidenceIds: (params.body.relatedEvidenceIds as string[]) ?? [],
        relatedAuthorityIds: (params.body.relatedAuthorityIds as string[]) ?? [],
        relatedWarrantIds: (params.body.relatedWarrantIds as string[]) ?? [],
        relatedDefendantIds: (params.body.relatedDefendantIds as string[]) ?? [],
        relatedOfficerIds: (params.body.relatedOfficerIds as string[]) ?? [],
        relatedWitnessIds: (params.body.relatedWitnessIds as string[]) ?? [],
        relatedTimelineEventIds: (params.body.relatedTimelineEventIds as string[]) ?? [],
        missingFacts: (params.body.missingFacts as string[]) ?? [],
        supportingFacts: (params.body.supportingFacts as string[]) ?? [],
        contraryFacts: (params.body.contraryFacts as string[]) ?? [],
        status: (params.body.status as string) ?? "open",
        humanReviewStatus: (params.body.humanReviewStatus as string) ?? "UNREVIEWED",
        humanConclusion: (params.body.humanConclusion as string) ?? null,
        notes: (params.body.notes as string) ?? null,
        confidence: (params.body.confidence as string) ?? "low",
        provenance,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.procedure_issue_modified",
      targetType: "procedure_issue",
      targetId: row?.id,
      metadata: {
        criminalCaseId,
        issueType,
        hasHumanConclusion: Boolean(params.body.humanConclusion),
      },
    });
    return row;
  }

  if (params.resource === "warrants") {
    const seizedEvidenceIds = Array.isArray(params.body.seizedEvidenceIds)
      ? params.body.seizedEvidenceIds.map(String)
      : [];
    await assertEvidenceIdsInCase(db, {
      organizationId,
      criminalCaseId,
      evidenceIds: seizedEvidenceIds,
    });
    const applicationDate = assertDateProvidedOrUnknown({
      value: params.body.applicationDate as string | null | undefined,
      fieldLabel: "applicationDate",
    });
    const issueDate = assertDateProvidedOrUnknown({
      value: params.body.issueDate as string | null | undefined,
      fieldLabel: "issueDate",
    });
    const executionDate = assertDateProvidedOrUnknown({
      value: params.body.executionDate as string | null | undefined,
      fieldLabel: "executionDate",
    });
    const [row] = await db
      .insert(prosecutionWarrants)
      .values({
        organizationId,
        criminalCaseId,
        warrantType: String(params.body.warrantType ?? "search"),
        issuingCourt: (params.body.issuingCourt as string) ?? null,
        issuingJudge: (params.body.issuingJudge as string) ?? null,
        applicationDate: applicationDate,
        issueDate: issueDate,
        executionDate: executionDate,
        scope: (params.body.scope as string) ?? null,
        targetLocation: (params.body.targetLocation as string) ?? null,
        targetPerson: (params.body.targetPerson as string) ?? null,
        targetDevice: (params.body.targetDevice as string) ?? null,
        targetProperty: (params.body.targetProperty as string) ?? null,
        probableCauseFacts: (params.body.probableCauseFacts as string[]) ?? [],
        seizedEvidenceIds,
        relatedDefendantIds: (params.body.relatedDefendantIds as string[]) ?? [],
        relatedOfficerIds: (params.body.relatedOfficerIds as string[]) ?? [],
        relatedDocumentIds: (params.body.relatedDocumentIds as string[]) ?? [],
        relatedSuppressionIssueIds: (params.body.relatedSuppressionIssueIds as string[]) ?? [],
        status: (params.body.status as string) ?? "RECORDED",
        notes: (params.body.notes as string) ?? null,
        provenance,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.warrant_modified",
      targetType: "warrant",
      targetId: row?.id,
      metadata: { criminalCaseId, automaticInvalidityConclusion: null },
    });
    if (issueDate) {
      await db.insert(prosecutionTimelineEvents).values({
        organizationId,
        criminalCaseId,
        matterId: criminalCase.matterId,
        eventType: "WARRANT_ISSUED",
        title: `Warrant recorded: ${String(params.body.warrantType ?? "warrant")}`,
        eventDate: new Date(`${issueDate}T12:00:00.000Z`),
        provenance,
      });
    }
    if (executionDate) {
      await db.insert(prosecutionTimelineEvents).values({
        organizationId,
        criminalCaseId,
        matterId: criminalCase.matterId,
        eventType: "WARRANT_EXECUTED",
        title: `Warrant execution recorded: ${String(params.body.warrantType ?? "warrant")}`,
        eventDate: new Date(`${executionDate}T12:00:00.000Z`),
        provenance,
      });
    }
    return row;
  }

  if (
    params.resource === "warrant-affidavits" ||
    params.resource === "warrant-executions" ||
    params.resource === "warrant-returns"
  ) {
    const warrantId = String(params.body.warrantId ?? "");
    const [warrant] = await db
      .select()
      .from(prosecutionWarrants)
      .where(
        and(
          eq(prosecutionWarrants.id, warrantId),
          eq(prosecutionWarrants.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!warrant) throw new ProsecutionError("ORPHAN_REFERENCE", "Warrant not found.");
    assertSameCase(criminalCaseId, warrant.criminalCaseId);
  }

  if (params.resource === "warrant-affidavits") {
    const [row] = await db
      .insert(prosecutionWarrantAffidavits)
      .values({
        organizationId,
        warrantId: String(params.body.warrantId ?? ""),
        affiant: (params.body.affiant as string) ?? null,
        statement: String(params.body.statement ?? ""),
        provenance,
      })
      .returning();
    return row;
  }

  if (params.resource === "warrant-executions") {
    const [row] = await db
      .insert(prosecutionWarrantExecutions)
      .values({
        organizationId,
        warrantId: String(params.body.warrantId ?? ""),
        executedBy: (params.body.executedBy as string) ?? null,
        notes: (params.body.notes as string) ?? null,
        provenance,
      })
      .returning();
    return row;
  }

  if (params.resource === "warrant-returns") {
    const [row] = await db
      .insert(prosecutionWarrantReturns)
      .values({
        organizationId,
        warrantId: String(params.body.warrantId ?? ""),
        inventory: (params.body.inventory as string[]) ?? [],
        provenance,
      })
      .returning();
    return row;
  }

  if (params.resource === "motions") {
    const motionType = normalizeMotionType(String(params.body.motionType ?? "OTHER"));
    const filedDate = assertDateProvidedOrUnknown({
      value: params.body.filedDate as string | null | undefined,
      fieldLabel: "filedDate",
    });
    const responseDueDate = assertDateProvidedOrUnknown({
      value: params.body.responseDueDate as string | null | undefined,
      fieldLabel: "responseDueDate",
    });
    const hearingDate = assertDateProvidedOrUnknown({
      value: params.body.hearingDate as string | null | undefined,
      fieldLabel: "hearingDate",
    });
    const rulingDate = assertDateProvidedOrUnknown({
      value: params.body.rulingDate as string | null | undefined,
      fieldLabel: "rulingDate",
    });
    const [row] = await db
      .insert(prosecutionMotions)
      .values({
        organizationId,
        criminalCaseId,
        motionType: String(motionType),
        filingParty: String(params.body.filingParty ?? ""),
        filedDate,
        responseDueDate,
        hearingDate,
        rulingDate,
        issueIds: (params.body.issueIds as string[]) ?? [],
        relatedAuthorityIds: (params.body.relatedAuthorityIds as string[]) ?? [],
        relatedEvidenceIds: (params.body.relatedEvidenceIds as string[]) ?? [],
        relatedDefendantIds: (params.body.relatedDefendantIds as string[]) ?? [],
        relatedDocumentIds: (params.body.relatedDocumentIds as string[]) ?? [],
        relatedDraftIds: (params.body.relatedDraftIds as string[]) ?? [],
        assignedAttorneyUserId: (params.body.assignedAttorneyUserId as string) ?? null,
        status: (params.body.status as string) ?? "filed",
        response: (params.body.response as string) ?? null,
        ruling: (params.body.ruling as string) ?? null,
        notes: (params.body.notes as string) ?? null,
        provenance,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.motion_modified",
      targetType: "motion",
      targetId: row?.id,
      metadata: { criminalCaseId, inventedDeadline: false, autonomousFiling: false },
    });
    if (filedDate) {
      await db.insert(prosecutionTimelineEvents).values({
        organizationId,
        criminalCaseId,
        matterId: criminalCase.matterId,
        eventType: "MOTION_FILED",
        title: `Motion recorded: ${String(motionType)}`,
        eventDate: new Date(`${filedDate}T12:00:00.000Z`),
        provenance,
      });
    }
    return row;
  }

  if (params.resource === "hearings") {
    const dateTimeRaw = assertDateProvidedOrUnknown({
      value: params.body.dateTime as string | null | undefined,
      fieldLabel: "dateTime",
    });
    const dateTime = dateTimeRaw ? new Date(dateTimeRaw) : null;
    if (dateTimeRaw && Number.isNaN(dateTime?.getTime())) {
      throw new ProsecutionError(
        "INVALID_HEARING_DATE",
        "Hearing date must be a valid source-backed or human-entered timestamp, or omitted as UNKNOWN / NOT PROVIDED.",
      );
    }
    const [row] = await db
      .insert(prosecutionHearings)
      .values({
        organizationId,
        criminalCaseId,
        hearingType: String(params.body.hearingType ?? ""),
        dateTime,
        court: (params.body.court as string) ?? null,
        courtroom: (params.body.courtroom as string) ?? null,
        judge: (params.body.judge as string) ?? null,
        participants: (params.body.participants as string[]) ?? [],
        issueIds: (params.body.issueIds as string[]) ?? [],
        relatedMotionIds: (params.body.relatedMotionIds as string[]) ?? [],
        relatedDefendantIds: (params.body.relatedDefendantIds as string[]) ?? [],
        relatedDraftIds: (params.body.relatedDraftIds as string[]) ?? [],
        outcome: (params.body.outcome as string) ?? null,
        notes: (params.body.notes as string) ?? null,
        provenance,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.hearing_modified",
      targetType: "hearing",
      targetId: row?.id,
      metadata: { criminalCaseId, dateProvided: Boolean(dateTime) },
    });
    if (dateTime) {
      await db.insert(prosecutionTimelineEvents).values({
        organizationId,
        criminalCaseId,
        matterId: criminalCase.matterId,
        eventType: "HEARING",
        title: `Hearing recorded: ${String(params.body.hearingType ?? "hearing")}`,
        eventDate: dateTime,
        provenance,
      });
      await notifyProsecutionEvent(db, {
        organizationId,
        userId: params.userId,
        kind: "upcoming_hearing",
        title: `Hearing scheduled: ${String(params.body.hearingType ?? "hearing")}`,
        body: `Case ${criminalCase.caseNumber} hearing recorded.`,
        href: `/app/prosecution/${criminalCaseId}/hearings`,
        matterId: criminalCase.matterId,
      });
    }
    return row;
  }

  if (params.resource === "subpoenas") {
    if (params.body.autonomousIssue === true || params.body.sendExternally === true) {
      throw new ProsecutionError(
        "AUTONOMOUS_LEGAL_ACTION_FORBIDDEN",
        "Nyaya does not issue or send subpoenas. Tracking only.",
        403,
      );
    }
    const [row] = await db
      .insert(prosecutionSubpoenas)
      .values({
        organizationId,
        criminalCaseId,
        recipient: String(params.body.recipient ?? ""),
        recipientType: (params.body.recipientType as string) ?? "OTHER",
        requestScope: String(params.body.requestScope ?? ""),
        preparedDate: assertDateProvidedOrUnknown({
          value: params.body.preparedDate as string | null | undefined,
          fieldLabel: "preparedDate",
        }),
        issueDate: assertDateProvidedOrUnknown({
          value: params.body.issueDate as string | null | undefined,
          fieldLabel: "issueDate",
        }),
        serviceDate: assertDateProvidedOrUnknown({
          value: params.body.serviceDate as string | null | undefined,
          fieldLabel: "serviceDate",
        }),
        returnDate: assertDateProvidedOrUnknown({
          value: params.body.returnDate as string | null | undefined,
          fieldLabel: "returnDate",
        }),
        issuingAuthority: (params.body.issuingAuthority as string) ?? null,
        status: (params.body.status as string) ?? "prepared",
        relatedDefendantIds: (params.body.relatedDefendantIds as string[]) ?? [],
        relatedWitnessIds: (params.body.relatedWitnessIds as string[]) ?? [],
        relatedEvidenceIds: (params.body.relatedEvidenceIds as string[]) ?? [],
        relatedDiscoveryIds: (params.body.relatedDiscoveryIds as string[]) ?? [],
        documentsReceived: (params.body.documentsReceived as string[]) ?? [],
        returnStatus: (params.body.returnStatus as string) ?? "PENDING",
        returnNotes: (params.body.returnNotes as string) ?? null,
        returnReceivedDate: assertDateProvidedOrUnknown({
          value: params.body.returnReceivedDate as string | null | undefined,
          fieldLabel: "returnReceivedDate",
        }),
        returnDocumentIds: (params.body.returnDocumentIds as string[]) ?? [],
        notes: (params.body.notes as string) ?? null,
        provenance,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.subpoena_modified",
      targetType: "subpoena",
      targetId: row?.id,
      metadata: { criminalCaseId, autonomousIssuance: false, externalSend: false },
    });
    await notifyProsecutionEvent(db, {
      organizationId,
      userId: params.userId,
      kind: "subpoena_return_due",
      title: `Subpoena tracked: ${String(params.body.recipient ?? "recipient")}`,
      body: `Case ${criminalCase.caseNumber} subpoena recorded for tracking only.`,
      href: `/app/prosecution/${criminalCaseId}/subpoenas`,
      matterId: criminalCase.matterId,
    });
    return row;
  }

  if (params.resource === "pleas") {
    assertSafeLegalWorkflowCopy(params.body.terms as string | undefined);
    assertSafeLegalWorkflowCopy(params.body.prosecutorNotes as string | undefined);
    if (
      params.body.pleaRecommendation != null ||
      params.body.acceptRejectRecommendation != null ||
      params.body.pleaValueScore != null
    ) {
      throw new ProsecutionError(
        "PLEA_RECOMMENDATION_FORBIDDEN",
        "Nyaya does not recommend accepting or rejecting pleas or score plea value.",
      );
    }
    const [row] = await db
      .insert(prosecutionPleaOffers)
      .values({
        organizationId,
        criminalCaseId,
        terms: String(params.body.terms ?? ""),
        offerDate: assertDateProvidedOrUnknown({
          value: params.body.offerDate as string | null | undefined,
          fieldLabel: "offerDate",
        }),
        expiration: assertDateProvidedOrUnknown({
          value: params.body.expiration as string | null | undefined,
          fieldLabel: "expiration",
        }),
        status: (params.body.status as string) ?? "draft",
        history: (params.body.history as string[]) ?? [],
        relatedChargeIds: (params.body.relatedChargeIds as string[]) ?? [],
        conditions: (params.body.conditions as string[]) ?? [],
        defenseResponse: (params.body.defenseResponse as string) ?? null,
        prosecutorNotes: (params.body.prosecutorNotes as string) ?? null,
        supervisorReviewStatus: (params.body.supervisorReviewStatus as string) ?? "UNREVIEWED",
        documentIds: (params.body.documentIds as string[]) ?? [],
        versionLabel: (params.body.versionLabel as string) ?? null,
        parentOfferId: (params.body.parentOfferId as string) ?? null,
        sentencingRecommendationReference:
          (params.body.sentencingRecommendationReference as string) ?? null,
        humanOwnerId: params.userId,
        provenance,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.plea_modified",
      targetType: "plea_offer",
      targetId: row?.id,
      metadata: { criminalCaseId, pleaRecommendation: null },
    });
    await db.insert(prosecutionTimelineEvents).values({
      organizationId,
      criminalCaseId,
      matterId: criminalCase.matterId,
      eventType: "PLEA_EVENT",
      title: `Plea offer tracked: ${String(params.body.versionLabel ?? "offer")}`,
      eventDate: new Date(),
      provenance,
    });
    return row;
  }

  if (params.resource === "case-authorities") {
    const persistInput = {
      citation: String(params.body.citation ?? ""),
      proposition: String(params.body.proposition ?? ""),
      jurisdiction: (params.body.jurisdiction as string) ?? criminalCase.jurisdiction,
      court: (params.body.court as string) ?? criminalCase.court,
      hierarchyStatus: String(params.body.hierarchyStatus ?? "UNKNOWN"),
      treatmentStatus: (params.body.treatmentStatus as string) ?? "UNKNOWN",
      relation: (params.body.relation as string) ?? "RELEVANT",
      sourceSpan: (params.body.sourceSpan as string) ?? null,
      sourcePage: (params.body.sourcePage as number) ?? null,
      authorityId: (params.body.authorityId as string) ?? null,
      relatedIssueIds: (params.body.relatedIssueIds as string[]) ?? [],
      relatedMotionIds: (params.body.relatedMotionIds as string[]) ?? [],
      relatedWarrantIds: (params.body.relatedWarrantIds as string[]) ?? [],
      provenance,
    };
    assertPersistedAuthorityGrounded(persistInput);
    const [row] = await db
      .insert(prosecutionCaseAuthorities)
      .values({
        organizationId,
        criminalCaseId,
        authorityId: persistInput.authorityId,
        citation: persistInput.citation,
        proposition: persistInput.proposition,
        jurisdiction: persistInput.jurisdiction,
        court: persistInput.court,
        hierarchyStatus: persistInput.hierarchyStatus,
        treatmentStatus: persistInput.treatmentStatus,
        relation: persistInput.relation,
        sourceSpan: persistInput.sourceSpan,
        sourcePage: persistInput.sourcePage,
        relatedIssueIds: persistInput.relatedIssueIds,
        relatedMotionIds: persistInput.relatedMotionIds,
        relatedWarrantIds: persistInput.relatedWarrantIds,
        humanReviewStatus: (params.body.humanReviewStatus as string) ?? "UNREVIEWED",
        provenance,
        createdByUserId: params.userId,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.case_authority_persisted",
      targetType: "case_authority",
      targetId: row?.id,
      metadata: {
        criminalCaseId,
        hierarchyStatus: persistInput.hierarchyStatus,
        citation: persistInput.citation,
      },
    });
    return row;
  }

  if (params.resource === "case-drafts") {
    if (params.body.fileExternally === true || params.body.autonomousFiling === true) {
      throw new ProsecutionError(
        "AUTONOMOUS_LEGAL_ACTION_FORBIDDEN",
        "Nyaya does not file drafts. Content remains DRAFT until human approval.",
        403,
      );
    }
    const title = String(params.body.title ?? "Prosecution draft");
    const draftType = String(params.body.draftType ?? "motion");
    const content = String(params.body.content ?? "");
    assertSafeLegalWorkflowCopy(content);
    const retrievedAuthorityIds = Array.isArray(params.body.relatedAuthorityIds)
      ? params.body.relatedAuthorityIds.map(String)
      : [];
    const citationMarkers = Array.isArray(params.body.citationMarkers)
      ? (
          params.body.citationMarkers as Array<{ text: string; matchedAuthorityId?: string | null }>
        ).map((marker) => ({
          text: marker.text,
          status: classifyDraftCitationMarker({
            citationText: marker.text,
            retrievedAuthorityIds,
            matchedAuthorityId: marker.matchedAuthorityId,
          }),
        }))
      : [];
    let linkedDraftId: string | null = null;
    if (criminalCase.matterId) {
      const created = await createDraft({
        db,
        organizationId,
        matterId: criminalCase.matterId,
        userId: params.userId,
        title,
        draftType,
        content,
        aiGenerated: Boolean(params.body.aiGenerated),
      });
      linkedDraftId = created.draft.id;
    }
    const [row] = await db
      .insert(prosecutionCaseDrafts)
      .values({
        organizationId,
        criminalCaseId,
        draftId: linkedDraftId,
        draftType,
        title,
        content,
        status: "DRAFT",
        relatedMotionIds: (params.body.relatedMotionIds as string[]) ?? [],
        relatedHearingIds: (params.body.relatedHearingIds as string[]) ?? [],
        relatedIssueIds: (params.body.relatedIssueIds as string[]) ?? [],
        relatedEvidenceIds: (params.body.relatedEvidenceIds as string[]) ?? [],
        relatedAuthorityIds: retrievedAuthorityIds,
        citationMarkers,
        aiGenerated: Boolean(params.body.aiGenerated),
        provenance,
        createdByUserId: params.userId,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.case_draft_created",
      targetType: "case_draft",
      targetId: row?.id,
      metadata: {
        criminalCaseId,
        draftId: linkedDraftId,
        status: "DRAFT",
        autonomousFiling: false,
      },
    });
    return row;
  }

  if (params.resource === "dispositions") {
    const chargeId = String(params.body.chargeId ?? "");
    const [charge] = await db
      .select()
      .from(prosecutionCharges)
      .where(
        and(
          eq(prosecutionCharges.id, chargeId),
          eq(prosecutionCharges.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!charge) throw new ProsecutionError("ORPHAN_REFERENCE", "Charge not found.");
    assertSameCase(criminalCaseId, charge.criminalCaseId);
    const [row] = await db
      .insert(prosecutionDispositions)
      .values({
        organizationId,
        criminalCaseId,
        chargeId,
        result: String(params.body.result ?? ""),
        notes: (params.body.notes as string) ?? null,
        provenance,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.disposition_modified",
      targetType: "disposition",
      targetId: row?.id,
      metadata: { criminalCaseId },
    });
    return row;
  }

  if (params.resource === "sentences") {
    const chargeId = String(params.body.chargeId ?? "");
    const [charge] = await db
      .select()
      .from(prosecutionCharges)
      .where(
        and(
          eq(prosecutionCharges.id, chargeId),
          eq(prosecutionCharges.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!charge) throw new ProsecutionError("ORPHAN_REFERENCE", "Charge not found.");
    assertSameCase(criminalCaseId, charge.criminalCaseId);
    const [row] = await db
      .insert(prosecutionSentences)
      .values({
        organizationId,
        criminalCaseId,
        chargeId,
        conviction: String(params.body.conviction ?? ""),
        sentenceTerms: String(params.body.sentenceTerms ?? ""),
        custodial: typeof params.body.custodial === "boolean" ? params.body.custodial : null,
        conditions: (params.body.conditions as string[]) ?? [],
        notes: (params.body.notes as string) ?? null,
        provenance,
      })
      .returning();
    return row;
  }

  if (params.resource === "timeline") {
    const eventType = String(params.body.eventType ?? "");
    assertTimelineEventType(eventType);
    const rawEventDate = params.body.eventDate;
    const eventDate =
      typeof rawEventDate === "string" && rawEventDate.trim()
        ? new Date(rawEventDate)
        : rawEventDate instanceof Date
          ? rawEventDate
          : null;
    const [row] = await db
      .insert(prosecutionTimelineEvents)
      .values({
        organizationId,
        criminalCaseId,
        matterId: criminalCase.matterId,
        eventType,
        title: String(params.body.title ?? ""),
        eventDate: eventDate && !Number.isNaN(eventDate.getTime()) ? eventDate : null,
        provenance,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.timeline_event_created",
      targetType: "timeline_event",
      targetId: row?.id,
      metadata: { criminalCaseId, eventType },
    });
    return row;
  }

  if (params.resource === "tasks") {
    const dueAtRaw = params.body.dueAt as string | null | undefined;
    const dueAt = dueAtRaw ? new Date(dueAtRaw) : null;
    if (dueAtRaw && Number.isNaN(dueAt?.getTime())) {
      throw new ProsecutionError(
        "INVALID_TASK_DUE_DATE",
        "Task due date must be source-backed or human-entered, or omitted.",
      );
    }
    const dueDateOrigin = dueAt ? String(params.body.dueDateOrigin ?? "USER_ENTERED") : "UNKNOWN";
    const [row] = await db
      .insert(prosecutionTasks)
      .values({
        organizationId,
        criminalCaseId,
        title: String(params.body.title ?? ""),
        description: (params.body.description as string) ?? null,
        ownerUserId: (params.body.ownerUserId as string) ?? params.userId,
        createdByUserId: params.userId,
        priority: (params.body.priority as string) ?? "normal",
        status: (params.body.status as string) ?? "open",
        dueAt,
        dueDateOrigin,
        relatedEvidenceIds: (params.body.relatedEvidenceIds as string[]) ?? [],
        relatedWitnessIds: (params.body.relatedWitnessIds as string[]) ?? [],
        relatedDiscoveryIds: (params.body.relatedDiscoveryIds as string[]) ?? [],
        relatedDisclosureIds: (params.body.relatedDisclosureIds as string[]) ?? [],
        relatedMotionIds: (params.body.relatedMotionIds as string[]) ?? [],
        relatedHearingIds: (params.body.relatedHearingIds as string[]) ?? [],
        relatedWarrantIds: (params.body.relatedWarrantIds as string[]) ?? [],
        relatedIssueIds: (params.body.relatedIssueIds as string[]) ?? [],
        notes: (params.body.notes as string) ?? null,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.task_created",
      targetType: "prosecution_task",
      targetId: row?.id,
      metadata: {
        criminalCaseId,
        dueDateOrigin,
        ownerUserId: row?.ownerUserId ?? null,
      },
    });
    if (row?.ownerUserId && row.ownerUserId !== params.userId) {
      await notifyProsecutionEvent(db, {
        organizationId,
        userId: row.ownerUserId,
        kind: "task_due",
        title: `Task assigned: ${row.title}`,
        body: `Case ${criminalCase.caseNumber}: ${row.title}`,
        href: `/app/prosecution/${criminalCaseId}/tasks`,
        matterId: criminalCase.matterId,
      });
    }
    return row;
  }

  if (params.resource === "agencies") {
    const [row] = await db
      .insert(prosecutionAgencies)
      .values({
        organizationId,
        name: String(params.body.name ?? ""),
        agencyType: String(params.body.agencyType ?? "police"),
        jurisdiction: (params.body.jurisdiction as string) ?? null,
        contact: (params.body.contact as Record<string, string>) ?? {},
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.agency_modified",
      targetType: "agency",
      targetId: row?.id,
      metadata: { criminalCaseId },
    });
    return row;
  }

  if (params.resource === "officers") {
    const agencyId = String(params.body.agencyId ?? "");
    const [agency] = await db
      .select()
      .from(prosecutionAgencies)
      .where(
        and(
          eq(prosecutionAgencies.id, agencyId),
          eq(prosecutionAgencies.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!agency)
      throw new ProsecutionError("ORPHAN_REFERENCE", "Agency not found in this organization.");
    const [row] = await db
      .insert(prosecutionOfficers)
      .values({
        organizationId,
        criminalCaseId,
        agencyId,
        name: String(params.body.name ?? ""),
        role: String(params.body.role ?? "investigator"),
        badgeIdentifier: (params.body.badgeIdentifier as string) ?? null,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.officer_modified",
      targetType: "officer",
      targetId: row?.id,
      metadata: { criminalCaseId },
    });
    return row;
  }

  throw new ProsecutionError("UNKNOWN_RESOURCE", "Unsupported prosecution resource.");
}

export async function createChargeWithElements(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    caseId: string;
    charge: {
      defendantId: string;
      countNumber: string;
      offenseName: string;
      jurisdiction: string;
      statuteCitation?: string | null;
      provenance: RecordProvenance;
    };
    elements: Array<{
      elementOrder: number;
      elementText: string;
      elementType: string;
      status?: string;
      provenance: RecordProvenance;
    }>;
  },
) {
  await authorize(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    action: "charge.manage",
  });
  const criminalCase = await requireCase(db, params.organizationId, params.caseId);
  const provenance = provenanceOf(params.charge.provenance);
  for (const element of params.elements) provenanceOf(element.provenance);
  return db
    .transaction(async (tx) => {
      const [defendant] = await tx
        .select()
        .from(prosecutionDefendants)
        .where(
          and(
            eq(prosecutionDefendants.id, params.charge.defendantId),
            eq(prosecutionDefendants.organizationId, params.organizationId),
          ),
        )
        .limit(1);
      if (!defendant) throw new ProsecutionError("ORPHAN_REFERENCE", "Defendant not found.", 404);
      assertSameCase(criminalCase.id, defendant.criminalCaseId);
      const [charge] = await tx
        .insert(prosecutionCharges)
        .values({
          organizationId: params.organizationId,
          criminalCaseId: criminalCase.id,
          defendantId: defendant.id,
          countNumber: params.charge.countNumber,
          offenseName: params.charge.offenseName,
          jurisdiction: params.charge.jurisdiction,
          statuteCitation: params.charge.statuteCitation ?? null,
          provenance,
        })
        .returning();
      if (!charge) throw new ProsecutionError("ORPHAN_REFERENCE", "Charge was not created.");
      const elements = [];
      for (const element of params.elements) {
        const status = element.status ?? "UNKNOWN";
        assertElementStatus(status);
        const [row] = await tx
          .insert(prosecutionChargeElements)
          .values({
            organizationId: params.organizationId,
            criminalCaseId: criminalCase.id,
            chargeId: charge.id,
            elementOrder: element.elementOrder,
            elementText: element.elementText,
            elementType: element.elementType,
            status,
            provenance: provenanceOf(element.provenance),
          })
          .returning();
        elements.push(row);
      }
      return { charge, elements };
    })
    .then(async (created) => {
      await writeAuditEvent(db, {
        organizationId: params.organizationId,
        actorUserId: params.userId,
        matterId: criminalCase.matterId,
        action: "prosecution.charge_modified",
        targetType: "charge",
        targetId: created.charge.id,
        metadata: { criminalCaseId: criminalCase.id, elementCount: created.elements.length },
      });
      return created;
    });
}
