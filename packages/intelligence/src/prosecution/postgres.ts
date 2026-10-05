import { and, eq } from "drizzle-orm";
import {
  criminalCases,
  ensureProsecutionRoles,
  prosecutionAgencies,
  prosecutionChargeElements,
  prosecutionCharges,
  prosecutionDefendants,
  prosecutionDisclosureCandidates,
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
  type Database,
  type RecordProvenance,
} from "@nyayagrid/database";
import { requireAnyCapability, requireCapability, writeAuditEvent } from "@nyayagrid/permissions";
import { assertProvenance } from "../legal/standards";
import {
  EVIDENCE_RELATIONSHIPS,
  PROCEDURE_ISSUE_TYPES,
  ProsecutionError,
  assertElementStatus,
  assertSameCase,
  assertTenant,
  assertTimelineEventType,
  buildElementsMatrix,
  deriveElementStatus,
  transitionDisclosure,
  type ChargeElementStatus,
} from "./domain";

async function authorize(
  db: Database,
  params: { userId: string; organizationId: string; action: "view" | "edit" | "review" | "evidence" },
) {
  await ensureProsecutionRoles(db, params.organizationId);
  if (params.action === "view") {
    await requireAnyCapability(db, {
      userId: params.userId,
      organizationId: params.organizationId,
      capabilities: ["prosecution.view", "prosecution.edit", "prosecution.review"],
    });
    return;
  }
  if (params.action === "review") {
    await requireCapability(db, {
      userId: params.userId,
      organizationId: params.organizationId,
      capability: "prosecution.review",
    });
    return;
  }
  if (params.action === "evidence") {
    const membership = await requireAnyCapability(db, {
      userId: params.userId,
      organizationId: params.organizationId,
      capabilities: ["prosecution.edit", "documents.upload"],
    });
    if (!membership.capabilities.has("prosecution.view") && !membership.capabilities.has("prosecution.edit")) {
      throw new ProsecutionError("FORBIDDEN", "Evidence writes require prosecution access.", 403);
    }
    return;
  }
  await requireCapability(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    capability: "prosecution.edit",
  });
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

export async function listCriminalCases(db: Database, params: { userId: string; organizationId: string }) {
  await authorize(db, { ...params, action: "view" });
  return db.select().from(criminalCases).where(eq(criminalCases.organizationId, params.organizationId));
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
  await authorize(db, { userId: params.userId, organizationId: params.organizationId, action: "edit" });
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

export async function getProsecutionOverview(db: Database, params: { userId: string; organizationId: string; caseId: string }) {
  await authorize(db, { userId: params.userId, organizationId: params.organizationId, action: "view" });
  const criminalCase = await requireCase(db, params.organizationId, params.caseId);
  const [defendants, charges, elements, evidence, discovery, witnesses, hearings, tasks, issues] = await Promise.all([
    db.select().from(prosecutionDefendants).where(eq(prosecutionDefendants.criminalCaseId, criminalCase.id)),
    db.select().from(prosecutionCharges).where(eq(prosecutionCharges.criminalCaseId, criminalCase.id)),
    db.select().from(prosecutionChargeElements).where(eq(prosecutionChargeElements.criminalCaseId, criminalCase.id)),
    db.select().from(prosecutionEvidenceItems).where(eq(prosecutionEvidenceItems.criminalCaseId, criminalCase.id)),
    db.select().from(prosecutionDiscoveryItems).where(eq(prosecutionDiscoveryItems.criminalCaseId, criminalCase.id)),
    db.select().from(prosecutionWitnesses).where(eq(prosecutionWitnesses.criminalCaseId, criminalCase.id)),
    db.select().from(prosecutionHearings).where(eq(prosecutionHearings.criminalCaseId, criminalCase.id)),
    db.select().from(prosecutionTasks).where(eq(prosecutionTasks.criminalCaseId, criminalCase.id)),
    db.select().from(prosecutionProcedureIssues).where(eq(prosecutionProcedureIssues.criminalCaseId, criminalCase.id)),
  ]);
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
    })),
  });
  return {
    case: criminalCase,
    defendants,
    charges,
    hearings,
    openTasks: tasks.filter((task) => task.status === "open"),
    evidenceCount: evidence.length,
    discoveryCount: discovery.length,
    witnessCount: witnesses.length,
    elementGaps: matrix.filter((row) => row.status !== "SUPPORTED"),
    issueFlags: issues,
    matrix,
    guiltConclusion: null,
  };
}

export async function addProsecutionRecord(
  db: Database,
  params: { userId: string; organizationId: string; caseId: string; resource: string; body: Record<string, unknown> },
) {
  const reviewResources = new Set(["disclosure"]);
  const evidenceResources = new Set(["evidence", "evidence-links"]);
  await authorize(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    action: reviewResources.has(params.resource) ? "review" : evidenceResources.has(params.resource) ? "evidence" : "edit",
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
      .where(and(eq(prosecutionDefendants.id, defendantId), eq(prosecutionDefendants.organizationId, organizationId)))
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
      .where(and(eq(prosecutionCharges.id, chargeId), eq(prosecutionCharges.organizationId, organizationId)))
      .limit(1);
    if (!charge) throw new ProsecutionError("ORPHAN_REFERENCE", "Charge not found.");
    assertSameCase(criminalCaseId, charge.criminalCaseId);
    const supportingEvidenceIds = (params.body.supportingEvidenceIds as string[]) ?? [];
    const contraryEvidenceIds = (params.body.contraryEvidenceIds as string[]) ?? [];
    const uncertainEvidenceIds = (params.body.uncertainEvidenceIds as string[]) ?? [];
    const missingEvidenceIds = (params.body.missingEvidenceIds as string[]) ?? [];
    const status = (params.body.status as string) ?? deriveElementStatus({
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
    const [row] = await db
      .insert(prosecutionEvidenceItems)
      .values({
        organizationId,
        criminalCaseId,
        evidenceType: String(params.body.evidenceType ?? "other"),
        sourceAgency: (params.body.sourceAgency as string) ?? null,
        collector: (params.body.collector as string) ?? null,
        storageReference: (params.body.storageReference as string) ?? null,
        chainOfCustody: (params.body.chainOfCustody as string[]) ?? [],
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
      .where(and(eq(prosecutionEvidenceItems.id, evidenceId), eq(prosecutionEvidenceItems.organizationId, organizationId)))
      .limit(1);
    if (!evidence) throw new ProsecutionError("ORPHAN_REFERENCE", "Evidence item not found.");
    assertSameCase(criminalCaseId, evidence.criminalCaseId);
    const relationship = String(params.body.relationship ?? "");
    if (!(EVIDENCE_RELATIONSHIPS as readonly string[]).includes(relationship)) {
      throw new ProsecutionError("INVALID_EVIDENCE_RELATIONSHIP", "Unsupported evidence relationship.");
    }
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
      .where(and(eq(prosecutionWitnesses.id, witnessId), eq(prosecutionWitnesses.organizationId, organizationId)))
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
    const [row] = await db
      .insert(prosecutionDiscoveryItems)
      .values({
        organizationId,
        criminalCaseId,
        source: String(params.body.source ?? ""),
        category: String(params.body.category ?? ""),
        reviewStatus: (params.body.reviewStatus as string) ?? "RECEIVED",
        productionStatus: (params.body.productionStatus as string) ?? "RECEIVED",
        notes: (params.body.notes as string) ?? null,
        provenance,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.discovery_review_changed",
      targetType: "discovery_item",
      targetId: row?.id,
      metadata: { criminalCaseId },
    });
    return row;
  }

  if (params.resource === "disclosure") {
    const status = transitionDisclosure({
      next: (params.body.status as "UNREVIEWED") ?? "UNREVIEWED",
      humanActor: true,
    });
    const [row] = await db
      .insert(prosecutionDisclosureCandidates)
      .values({
        organizationId,
        criminalCaseId,
        category: String(params.body.category ?? "UNKNOWN"),
        status,
        notes: (params.body.notes as string) ?? null,
        humanActorId: params.userId,
        provenance,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.disclosure_review_changed",
      targetType: "disclosure_review",
      targetId: row?.id,
      metadata: { criminalCaseId },
    });
    return row;
  }

  if (params.resource === "procedure-issues") {
    const issueType = String(params.body.issueType ?? "UNKNOWN");
    if (!(PROCEDURE_ISSUE_TYPES as readonly string[]).includes(issueType)) {
      throw new ProsecutionError("INVALID_PROCEDURE_ISSUE", "Unsupported suppression issue type.");
    }
    const [row] = await db
      .insert(prosecutionProcedureIssues)
      .values({
        organizationId,
        criminalCaseId,
        issueType,
        missingFacts: (params.body.missingFacts as string[]) ?? [],
        status: (params.body.status as string) ?? "open",
        confidence: (params.body.confidence as string) ?? "low",
        provenance,
      })
      .returning();
    return row;
  }

  if (params.resource === "warrants") {
    const [row] = await db
      .insert(prosecutionWarrants)
      .values({
        organizationId,
        criminalCaseId,
        warrantType: String(params.body.warrantType ?? "search"),
        issuingCourt: (params.body.issuingCourt as string) ?? null,
        issuingJudge: (params.body.issuingJudge as string) ?? null,
        scope: (params.body.scope as string) ?? null,
        probableCauseFacts: (params.body.probableCauseFacts as string[]) ?? [],
        provenance,
      })
      .returning();
    return row;
  }

  if (params.resource === "warrant-affidavits" || params.resource === "warrant-executions" || params.resource === "warrant-returns") {
    const warrantId = String(params.body.warrantId ?? "");
    const [warrant] = await db
      .select()
      .from(prosecutionWarrants)
      .where(and(eq(prosecutionWarrants.id, warrantId), eq(prosecutionWarrants.organizationId, organizationId)))
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
    const [row] = await db
      .insert(prosecutionMotions)
      .values({
        organizationId,
        criminalCaseId,
        motionType: String(params.body.motionType ?? ""),
        filingParty: String(params.body.filingParty ?? ""),
        status: (params.body.status as string) ?? "filed",
        response: (params.body.response as string) ?? null,
        ruling: (params.body.ruling as string) ?? null,
        provenance,
      })
      .returning();
    return row;
  }

  if (params.resource === "hearings") {
    const [row] = await db
      .insert(prosecutionHearings)
      .values({
        organizationId,
        criminalCaseId,
        hearingType: String(params.body.hearingType ?? ""),
        court: (params.body.court as string) ?? null,
        judge: (params.body.judge as string) ?? null,
        participants: (params.body.participants as string[]) ?? [],
        outcome: (params.body.outcome as string) ?? null,
        provenance,
      })
      .returning();
    return row;
  }

  if (params.resource === "subpoenas") {
    const [row] = await db
      .insert(prosecutionSubpoenas)
      .values({
        organizationId,
        criminalCaseId,
        recipient: String(params.body.recipient ?? ""),
        requestScope: String(params.body.requestScope ?? ""),
        status: (params.body.status as string) ?? "issued",
        provenance,
      })
      .returning();
    return row;
  }

  if (params.resource === "pleas") {
    const [row] = await db
      .insert(prosecutionPleaOffers)
      .values({
        organizationId,
        criminalCaseId,
        terms: String(params.body.terms ?? ""),
        status: (params.body.status as string) ?? "draft",
        history: (params.body.history as string[]) ?? [],
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
      metadata: { criminalCaseId },
    });
    return row;
  }

  if (params.resource === "dispositions") {
    const chargeId = String(params.body.chargeId ?? "");
    const [charge] = await db
      .select()
      .from(prosecutionCharges)
      .where(and(eq(prosecutionCharges.id, chargeId), eq(prosecutionCharges.organizationId, organizationId)))
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
      .where(and(eq(prosecutionCharges.id, chargeId), eq(prosecutionCharges.organizationId, organizationId)))
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
    const [row] = await db
      .insert(prosecutionTimelineEvents)
      .values({
        organizationId,
        criminalCaseId,
        matterId: criminalCase.matterId,
        eventType,
        title: String(params.body.title ?? ""),
        provenance,
      })
      .returning();
    return row;
  }

  if (params.resource === "tasks") {
    const [row] = await db
      .insert(prosecutionTasks)
      .values({
        organizationId,
        criminalCaseId,
        title: String(params.body.title ?? ""),
        status: (params.body.status as string) ?? "open",
      })
      .returning();
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
    return row;
  }

  if (params.resource === "officers") {
    const agencyId = String(params.body.agencyId ?? "");
    const [agency] = await db
      .select()
      .from(prosecutionAgencies)
      .where(and(eq(prosecutionAgencies.id, agencyId), eq(prosecutionAgencies.organizationId, organizationId)))
      .limit(1);
    if (!agency) throw new ProsecutionError("ORPHAN_REFERENCE", "Agency not found in this organization.");
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
    return row;
  }

  throw new ProsecutionError("UNKNOWN_RESOURCE", "Unsupported prosecution resource.");
}
