import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  civilClaimElements,
  civilClaims,
  civilDefenses,
  civilEvidenceItems,
  deadlineCandidates,
  discoveryDeficiencies,
  discoveryMeetAndConferIssues,
  discoveryPrivilegeAssertions,
  discoveryRequestItems,
  discoveryResponses,
  documents,
  legalIssues,
  matterCommunicationLinks,
  matterCommunications,
  matterEntities,
  matterMotionDocuments,
  matterMotionLinks,
  matterMotions,
  matters,
  tasks,
  type Database,
  type RecordProvenance,
} from "@nyayagrid/database";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import {
  assertCommunicationDirection,
  assertCommunicationLinkType,
  assertCommunicationStatus,
  assertCommunicationType,
  assertMotionDisposition,
  assertMotionDocumentRole,
  assertMotionLinkType,
  assertMotionStatus,
  assertMotionType,
  assertSameMatter,
  assertSameOrg,
  defaultMcProvenance,
  MotionsCommunicationsError,
} from "./domain";

type AuthParams = { userId: string; matterId: string };

async function authorizeRead(db: Database, params: AuthParams) {
  return requireMatterAccess(db, {
    userId: params.userId,
    matterId: params.matterId,
    minAccess: "read",
    capability: "matters.view",
  });
}

async function authorizeWrite(db: Database, params: AuthParams) {
  return requireMatterAccess(db, {
    userId: params.userId,
    matterId: params.matterId,
    minAccess: "edit",
    capability: "matters.edit",
  });
}

function provenanceOf(value?: RecordProvenance | null): RecordProvenance {
  return defaultMcProvenance(value ?? undefined) as RecordProvenance;
}

async function requireMatterRow(db: Database, organizationId: string, matterId: string) {
  const [row] = await db
    .select()
    .from(matters)
    .where(and(eq(matters.id, matterId), eq(matters.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new MotionsCommunicationsError("NOT_FOUND", "Matter not found.", 404);
  return row;
}

async function requireEntityInMatter(
  db: Database,
  organizationId: string,
  matterId: string,
  entityId: string,
) {
  const [entity] = await db
    .select()
    .from(matterEntities)
    .where(
      and(
        eq(matterEntities.id, entityId),
        eq(matterEntities.matterId, matterId),
        eq(matterEntities.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!entity) throw new MotionsCommunicationsError("CROSS_MATTER", "Entity not in matter.", 403);
  return entity;
}

async function requireDocumentInMatter(
  db: Database,
  organizationId: string,
  matterId: string,
  documentId: string,
) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) throw new MotionsCommunicationsError("NOT_FOUND", "Document not found.", 404);
  assertSameOrg(organizationId, doc.organizationId);
  assertSameMatter(matterId, doc.matterId);
  return doc;
}

async function requireTaskInMatter(
  db: Database,
  organizationId: string,
  matterId: string,
  taskId: string,
) {
  const [row] = await db
    .select()
    .from(tasks)
    .where(
      and(eq(tasks.id, taskId), eq(tasks.matterId, matterId), eq(tasks.organizationId, organizationId)),
    )
    .limit(1);
  if (!row) throw new MotionsCommunicationsError("CROSS_MATTER", "Task not in matter.", 403);
  return row;
}

async function requireMotionInMatter(
  db: Database,
  params: { organizationId: string; matterId: string; motionId: string },
) {
  const [row] = await db
    .select()
    .from(matterMotions)
    .where(
      and(
        eq(matterMotions.id, params.motionId),
        eq(matterMotions.matterId, params.matterId),
        eq(matterMotions.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!row) throw new MotionsCommunicationsError("NOT_FOUND", "Motion not found in matter.", 404);
  return row;
}

async function requireCommunicationInMatter(
  db: Database,
  params: { organizationId: string; matterId: string; communicationId: string },
) {
  const [row] = await db
    .select()
    .from(matterCommunications)
    .where(
      and(
        eq(matterCommunications.id, params.communicationId),
        eq(matterCommunications.matterId, params.matterId),
        eq(matterCommunications.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new MotionsCommunicationsError("NOT_FOUND", "Communication not found in matter.", 404);
  }
  return row;
}

async function validateMotionLinkTarget(
  db: Database,
  params: {
    organizationId: string;
    matterId: string;
    linkType: string;
    targetId: string;
  },
) {
  const { organizationId, matterId, linkType, targetId } = params;
  switch (linkType) {
    case "CLAIM": {
      const [row] = await db
        .select({ id: civilClaims.id })
        .from(civilClaims)
        .where(
          and(
            eq(civilClaims.id, targetId),
            eq(civilClaims.matterId, matterId),
            eq(civilClaims.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new MotionsCommunicationsError("CROSS_MATTER", "Claim not in matter.", 403);
      return;
    }
    case "DEFENSE": {
      const [row] = await db
        .select({ id: civilDefenses.id })
        .from(civilDefenses)
        .where(
          and(
            eq(civilDefenses.id, targetId),
            eq(civilDefenses.matterId, matterId),
            eq(civilDefenses.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new MotionsCommunicationsError("CROSS_MATTER", "Defense not in matter.", 403);
      return;
    }
    case "CLAIM_ELEMENT": {
      const [row] = await db
        .select({ id: civilClaimElements.id })
        .from(civilClaimElements)
        .where(
          and(
            eq(civilClaimElements.id, targetId),
            eq(civilClaimElements.matterId, matterId),
            eq(civilClaimElements.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new MotionsCommunicationsError("CROSS_MATTER", "Claim element not in matter.", 403);
      return;
    }
    case "DEFENSE_ELEMENT": {
      const [row] = await db
        .select({ id: civilClaimElements.id, defenseId: civilClaimElements.defenseId })
        .from(civilClaimElements)
        .where(
          and(
            eq(civilClaimElements.id, targetId),
            eq(civilClaimElements.matterId, matterId),
            eq(civilClaimElements.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row?.defenseId) {
        throw new MotionsCommunicationsError("CROSS_MATTER", "Defense element not in matter.", 403);
      }
      return;
    }
    case "LEGAL_ISSUE": {
      const [row] = await db
        .select({ id: legalIssues.id })
        .from(legalIssues)
        .where(
          and(
            eq(legalIssues.id, targetId),
            eq(legalIssues.matterId, matterId),
            eq(legalIssues.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new MotionsCommunicationsError("CROSS_MATTER", "Legal issue not in matter.", 403);
      return;
    }
    case "DISCOVERY_REQUEST_ITEM": {
      const [row] = await db
        .select({ id: discoveryRequestItems.id })
        .from(discoveryRequestItems)
        .where(
          and(
            eq(discoveryRequestItems.id, targetId),
            eq(discoveryRequestItems.matterId, matterId),
            eq(discoveryRequestItems.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) {
        throw new MotionsCommunicationsError("CROSS_MATTER", "Discovery request item not in matter.", 403);
      }
      return;
    }
    case "DISCOVERY_DEFICIENCY": {
      const [row] = await db
        .select({ id: discoveryDeficiencies.id })
        .from(discoveryDeficiencies)
        .where(
          and(
            eq(discoveryDeficiencies.id, targetId),
            eq(discoveryDeficiencies.matterId, matterId),
            eq(discoveryDeficiencies.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new MotionsCommunicationsError("CROSS_MATTER", "Deficiency not in matter.", 403);
      return;
    }
    case "PRIVILEGE_ASSERTION": {
      const [row] = await db
        .select({ id: discoveryPrivilegeAssertions.id })
        .from(discoveryPrivilegeAssertions)
        .where(
          and(
            eq(discoveryPrivilegeAssertions.id, targetId),
            eq(discoveryPrivilegeAssertions.matterId, matterId),
            eq(discoveryPrivilegeAssertions.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) {
        throw new MotionsCommunicationsError("CROSS_MATTER", "Privilege assertion not in matter.", 403);
      }
      return;
    }
    case "EVIDENCE": {
      const [row] = await db
        .select({ id: civilEvidenceItems.id })
        .from(civilEvidenceItems)
        .where(
          and(
            eq(civilEvidenceItems.id, targetId),
            eq(civilEvidenceItems.matterId, matterId),
            eq(civilEvidenceItems.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new MotionsCommunicationsError("CROSS_MATTER", "Evidence not in matter.", 403);
      return;
    }
    case "COMMUNICATION":
      await requireCommunicationInMatter(db, { organizationId, matterId, communicationId: targetId });
      return;
    case "TASK":
      await requireTaskInMatter(db, organizationId, matterId, targetId);
      return;
    case "DEADLINE_CANDIDATE": {
      const [row] = await db
        .select({ id: deadlineCandidates.id })
        .from(deadlineCandidates)
        .where(
          and(
            eq(deadlineCandidates.id, targetId),
            eq(deadlineCandidates.matterId, matterId),
            eq(deadlineCandidates.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) {
        throw new MotionsCommunicationsError("CROSS_MATTER", "Deadline candidate not in matter.", 403);
      }
      return;
    }
    default:
      throw new MotionsCommunicationsError("INVALID_LINK_TYPE", `Unsupported link type: ${linkType}`);
  }
}

async function validateCommunicationLinkTarget(
  db: Database,
  params: {
    organizationId: string;
    matterId: string;
    linkType: string;
    targetId: string;
  },
) {
  const { organizationId, matterId, linkType, targetId } = params;
  switch (linkType) {
    case "DISCOVERY_REQUEST_ITEM":
      return validateMotionLinkTarget(db, { ...params, linkType: "DISCOVERY_REQUEST_ITEM" });
    case "DISCOVERY_RESPONSE": {
      const [row] = await db
        .select({ id: discoveryResponses.id })
        .from(discoveryResponses)
        .where(
          and(
            eq(discoveryResponses.id, targetId),
            eq(discoveryResponses.matterId, matterId),
            eq(discoveryResponses.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new MotionsCommunicationsError("CROSS_MATTER", "Response not in matter.", 403);
      return;
    }
    case "DISCOVERY_DEFICIENCY":
      return validateMotionLinkTarget(db, { ...params, linkType: "DISCOVERY_DEFICIENCY" });
    case "MEET_AND_CONFER": {
      const [row] = await db
        .select({ id: discoveryMeetAndConferIssues.id })
        .from(discoveryMeetAndConferIssues)
        .where(
          and(
            eq(discoveryMeetAndConferIssues.id, targetId),
            eq(discoveryMeetAndConferIssues.matterId, matterId),
            eq(discoveryMeetAndConferIssues.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new MotionsCommunicationsError("CROSS_MATTER", "MAC issue not in matter.", 403);
      return;
    }
    case "MOTION":
      await requireMotionInMatter(db, { organizationId, matterId, motionId: targetId });
      return;
    case "PRIVILEGE_ASSERTION":
      return validateMotionLinkTarget(db, { ...params, linkType: "PRIVILEGE_ASSERTION" });
    case "CLAIM":
      return validateMotionLinkTarget(db, { ...params, linkType: "CLAIM" });
    case "DEFENSE":
      return validateMotionLinkTarget(db, { ...params, linkType: "DEFENSE" });
    case "EVIDENCE":
      return validateMotionLinkTarget(db, { ...params, linkType: "EVIDENCE" });
    case "DOCUMENT":
      await requireDocumentInMatter(db, organizationId, matterId, targetId);
      return;
    case "TASK":
      await requireTaskInMatter(db, organizationId, matterId, targetId);
      return;
    default:
      throw new MotionsCommunicationsError("INVALID_LINK_TYPE", `Unsupported link type: ${linkType}`);
  }
}

export async function createMatterMotion(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    motionType: string;
    title: string;
    summary?: string | null;
    status?: string;
    movingPartyEntityId?: string | null;
    opposingPartyEntityId?: string | null;
    filedAt?: Date | null;
    servedAt?: Date | null;
    oppositionDueAt?: Date | null;
    oppositionFiledAt?: Date | null;
    replyDueAt?: Date | null;
    replyFiledAt?: Date | null;
    hearingAt?: Date | null;
    rulingAt?: Date | null;
    disposition?: string | null;
    rulingSummary?: string | null;
    courtName?: string | null;
    judgeName?: string | null;
    primaryDocumentId?: string | null;
    orderDocumentId?: string | null;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  await requireMatterRow(db, params.organizationId, params.matterId);
  assertMotionType(params.motionType);
  const status = params.status ?? "DRAFT";
  assertMotionStatus(status);
  assertMotionDisposition(params.disposition);
  if (params.movingPartyEntityId) {
    await requireEntityInMatter(db, params.organizationId, params.matterId, params.movingPartyEntityId);
  }
  if (params.opposingPartyEntityId) {
    await requireEntityInMatter(db, params.organizationId, params.matterId, params.opposingPartyEntityId);
  }
  if (params.primaryDocumentId) {
    await requireDocumentInMatter(db, params.organizationId, params.matterId, params.primaryDocumentId);
  }
  if (params.orderDocumentId) {
    await requireDocumentInMatter(db, params.organizationId, params.matterId, params.orderDocumentId);
  }

  const [created] = await db
    .insert(matterMotions)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      motionType: params.motionType,
      title: params.title,
      summary: params.summary ?? null,
      status,
      movingPartyEntityId: params.movingPartyEntityId ?? null,
      opposingPartyEntityId: params.opposingPartyEntityId ?? null,
      filedAt: params.filedAt ?? null,
      servedAt: params.servedAt ?? null,
      oppositionDueAt: params.oppositionDueAt ?? null,
      oppositionFiledAt: params.oppositionFiledAt ?? null,
      replyDueAt: params.replyDueAt ?? null,
      replyFiledAt: params.replyFiledAt ?? null,
      hearingAt: params.hearingAt ?? null,
      rulingAt: params.rulingAt ?? null,
      disposition: params.disposition ?? null,
      rulingSummary: params.rulingSummary ?? null,
      courtName: params.courtName ?? null,
      judgeName: params.judgeName ?? null,
      primaryDocumentId: params.primaryDocumentId ?? null,
      orderDocumentId: params.orderDocumentId ?? null,
      provenance: provenanceOf(params.provenance),
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();
  if (!created) throw new MotionsCommunicationsError("INSERT_FAILED", "Motion was not created.", 500);
  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "matter_motion.created",
    targetType: "matter_motion",
    targetId: created.id,
    metadata: { motionType: created.motionType, status: created.status },
  });
  return created;
}

export async function updateMatterMotion(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    motionId: string;
    patch: Partial<{
      motionType: string;
      title: string;
      summary: string | null;
      status: string;
      movingPartyEntityId: string | null;
      opposingPartyEntityId: string | null;
      filedAt: Date | null;
      servedAt: Date | null;
      oppositionDueAt: Date | null;
      oppositionFiledAt: Date | null;
      replyDueAt: Date | null;
      replyFiledAt: Date | null;
      hearingAt: Date | null;
      rulingAt: Date | null;
      disposition: string | null;
      rulingSummary: string | null;
      courtName: string | null;
      judgeName: string | null;
      primaryDocumentId: string | null;
      orderDocumentId: string | null;
    }>;
  },
) {
  await authorizeWrite(db, params);
  await requireMotionInMatter(db, params);
  const patch = params.patch;
  if (patch.motionType) assertMotionType(patch.motionType);
  if (patch.status) assertMotionStatus(patch.status);
  if ("disposition" in patch) assertMotionDisposition(patch.disposition);
  if (patch.movingPartyEntityId) {
    await requireEntityInMatter(db, params.organizationId, params.matterId, patch.movingPartyEntityId);
  }
  if (patch.opposingPartyEntityId) {
    await requireEntityInMatter(db, params.organizationId, params.matterId, patch.opposingPartyEntityId);
  }
  if (patch.primaryDocumentId) {
    await requireDocumentInMatter(db, params.organizationId, params.matterId, patch.primaryDocumentId);
  }
  if (patch.orderDocumentId) {
    await requireDocumentInMatter(db, params.organizationId, params.matterId, patch.orderDocumentId);
  }

  const [updated] = await db
    .update(matterMotions)
    .set({ ...patch, updatedByUserId: params.userId, updatedAt: new Date() })
    .where(
      and(
        eq(matterMotions.id, params.motionId),
        eq(matterMotions.matterId, params.matterId),
        eq(matterMotions.organizationId, params.organizationId),
      ),
    )
    .returning();
  if (!updated) throw new MotionsCommunicationsError("NOT_FOUND", "Motion not found.", 404);
  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "matter_motion.updated",
    targetType: "matter_motion",
    targetId: updated.id,
    metadata: { status: updated.status, disposition: updated.disposition },
  });
  return updated;
}

export async function getMatterMotion(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string; motionId: string },
) {
  await authorizeRead(db, params);
  return requireMotionInMatter(db, params);
}

export async function listMatterMotions(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string; limit?: number },
) {
  await authorizeRead(db, params);
  return db
    .select()
    .from(matterMotions)
    .where(
      and(
        eq(matterMotions.matterId, params.matterId),
        eq(matterMotions.organizationId, params.organizationId),
      ),
    )
    .orderBy(desc(matterMotions.updatedAt))
    .limit(params.limit ?? 200);
}

export async function linkMotionDocument(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    motionId: string;
    documentId: string;
    role: string;
    sortOrder?: number;
  },
) {
  await authorizeWrite(db, params);
  await requireMotionInMatter(db, params);
  assertMotionDocumentRole(params.role);
  await requireDocumentInMatter(db, params.organizationId, params.matterId, params.documentId);
  const [row] = await db
    .insert(matterMotionDocuments)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      motionId: params.motionId,
      documentId: params.documentId,
      role: params.role,
      sortOrder: params.sortOrder ?? 0,
    })
    .onConflictDoUpdate({
      target: [matterMotionDocuments.motionId, matterMotionDocuments.documentId, matterMotionDocuments.role],
      set: { sortOrder: params.sortOrder ?? 0 },
    })
    .returning();
  if (!row) throw new MotionsCommunicationsError("INSERT_FAILED", "Motion document link failed.", 500);
  return row;
}

export async function listMotionDocuments(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string; motionId: string },
) {
  await authorizeRead(db, params);
  await requireMotionInMatter(db, params);
  const links = await db
    .select()
    .from(matterMotionDocuments)
    .where(
      and(
        eq(matterMotionDocuments.motionId, params.motionId),
        eq(matterMotionDocuments.matterId, params.matterId),
      ),
    )
    .orderBy(asc(matterMotionDocuments.sortOrder), asc(matterMotionDocuments.createdAt));
  if (links.length === 0) return [];
  const docIds = [...new Set(links.map((l) => l.documentId))];
  const docs = await db
    .select()
    .from(documents)
    .where(
      and(
        inArray(documents.id, docIds),
        eq(documents.organizationId, params.organizationId),
        eq(documents.matterId, params.matterId),
      ),
    );
  const byId = new Map(docs.map((d) => [d.id, d]));
  // Stale/foreign document IDs remain linked but never leak foreign document rows.
  return links.map((link) => ({
    ...link,
    document: byId.get(link.documentId) ?? null,
  }));
}

export async function linkMatterMotionTarget(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    motionId: string;
    linkType: string;
    targetId: string;
    note?: string | null;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  await requireMotionInMatter(db, params);
  assertMotionLinkType(params.linkType);
  await validateMotionLinkTarget(db, params);
  const [row] = await db
    .insert(matterMotionLinks)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      motionId: params.motionId,
      linkType: params.linkType,
      targetId: params.targetId,
      note: params.note ?? null,
      provenance: provenanceOf(params.provenance),
    })
    .onConflictDoUpdate({
      target: [matterMotionLinks.motionId, matterMotionLinks.linkType, matterMotionLinks.targetId],
      set: { note: params.note ?? null, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new MotionsCommunicationsError("INSERT_FAILED", "Motion link failed.", 500);
  return row;
}

export async function listMatterMotionLinks(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string; motionId: string },
) {
  await authorizeRead(db, params);
  await requireMotionInMatter(db, params);
  return db
    .select()
    .from(matterMotionLinks)
    .where(
      and(
        eq(matterMotionLinks.motionId, params.motionId),
        eq(matterMotionLinks.matterId, params.matterId),
      ),
    )
    .orderBy(asc(matterMotionLinks.linkType), asc(matterMotionLinks.createdAt));
}

export async function createMatterCommunication(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    communicationType: string;
    subject: string;
    summary?: string | null;
    direction?: string;
    status?: string;
    occurredAt?: Date | null;
    senderEntityId?: string | null;
    recipientEntityId?: string | null;
    primaryDocumentId?: string | null;
    inboundEmailId?: string | null;
    followUpNeeded?: boolean;
    followUpDueAt?: Date | null;
    followUpTaskId?: string | null;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  await requireMatterRow(db, params.organizationId, params.matterId);
  assertCommunicationType(params.communicationType);
  const direction = params.direction ?? "UNKNOWN";
  assertCommunicationDirection(direction);
  const status = params.status ?? "DRAFT";
  assertCommunicationStatus(status);
  if (params.senderEntityId) {
    await requireEntityInMatter(db, params.organizationId, params.matterId, params.senderEntityId);
  }
  if (params.recipientEntityId) {
    await requireEntityInMatter(db, params.organizationId, params.matterId, params.recipientEntityId);
  }
  if (params.primaryDocumentId) {
    await requireDocumentInMatter(db, params.organizationId, params.matterId, params.primaryDocumentId);
  }
  if (params.followUpTaskId) {
    await requireTaskInMatter(db, params.organizationId, params.matterId, params.followUpTaskId);
  }

  const [created] = await db
    .insert(matterCommunications)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      communicationType: params.communicationType,
      direction,
      status,
      occurredAt: params.occurredAt ?? null,
      subject: params.subject,
      summary: params.summary ?? null,
      senderEntityId: params.senderEntityId ?? null,
      recipientEntityId: params.recipientEntityId ?? null,
      primaryDocumentId: params.primaryDocumentId ?? null,
      inboundEmailId: params.inboundEmailId ?? null,
      followUpNeeded: params.followUpNeeded ?? false,
      followUpDueAt: params.followUpDueAt ?? null,
      followUpTaskId: params.followUpTaskId ?? null,
      provenance: provenanceOf(params.provenance),
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();
  if (!created) {
    throw new MotionsCommunicationsError("INSERT_FAILED", "Communication was not created.", 500);
  }
  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "matter_communication.created",
    targetType: "matter_communication",
    targetId: created.id,
    metadata: { communicationType: created.communicationType, status: created.status },
  });
  return created;
}

export async function updateMatterCommunication(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    communicationId: string;
    patch: Partial<{
      communicationType: string;
      subject: string;
      summary: string | null;
      direction: string;
      status: string;
      occurredAt: Date | null;
      senderEntityId: string | null;
      recipientEntityId: string | null;
      primaryDocumentId: string | null;
      inboundEmailId: string | null;
      followUpNeeded: boolean;
      followUpDueAt: Date | null;
      followUpTaskId: string | null;
    }>;
  },
) {
  await authorizeWrite(db, params);
  await requireCommunicationInMatter(db, params);
  const patch = params.patch;
  if (patch.communicationType) assertCommunicationType(patch.communicationType);
  if (patch.direction) assertCommunicationDirection(patch.direction);
  if (patch.status) assertCommunicationStatus(patch.status);
  if (patch.senderEntityId) {
    await requireEntityInMatter(db, params.organizationId, params.matterId, patch.senderEntityId);
  }
  if (patch.recipientEntityId) {
    await requireEntityInMatter(db, params.organizationId, params.matterId, patch.recipientEntityId);
  }
  if (patch.primaryDocumentId) {
    await requireDocumentInMatter(db, params.organizationId, params.matterId, patch.primaryDocumentId);
  }
  if (patch.followUpTaskId) {
    await requireTaskInMatter(db, params.organizationId, params.matterId, patch.followUpTaskId);
  }

  const [updated] = await db
    .update(matterCommunications)
    .set({ ...patch, updatedByUserId: params.userId, updatedAt: new Date() })
    .where(
      and(
        eq(matterCommunications.id, params.communicationId),
        eq(matterCommunications.matterId, params.matterId),
        eq(matterCommunications.organizationId, params.organizationId),
      ),
    )
    .returning();
  if (!updated) throw new MotionsCommunicationsError("NOT_FOUND", "Communication not found.", 404);
  return updated;
}

export async function getMatterCommunication(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string; communicationId: string },
) {
  await authorizeRead(db, params);
  return requireCommunicationInMatter(db, params);
}

export async function listMatterCommunications(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string; limit?: number },
) {
  await authorizeRead(db, params);
  return db
    .select()
    .from(matterCommunications)
    .where(
      and(
        eq(matterCommunications.matterId, params.matterId),
        eq(matterCommunications.organizationId, params.organizationId),
      ),
    )
    .orderBy(desc(matterCommunications.occurredAt), desc(matterCommunications.updatedAt))
    .limit(params.limit ?? 500);
}

export async function linkMatterCommunicationTarget(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    communicationId: string;
    linkType: string;
    targetId: string;
    note?: string | null;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  await requireCommunicationInMatter(db, params);
  assertCommunicationLinkType(params.linkType);
  await validateCommunicationLinkTarget(db, params);
  const [row] = await db
    .insert(matterCommunicationLinks)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      communicationId: params.communicationId,
      linkType: params.linkType,
      targetId: params.targetId,
      note: params.note ?? null,
      provenance: provenanceOf(params.provenance),
    })
    .onConflictDoUpdate({
      target: [
        matterCommunicationLinks.communicationId,
        matterCommunicationLinks.linkType,
        matterCommunicationLinks.targetId,
      ],
      set: { note: params.note ?? null },
    })
    .returning();
  if (!row) throw new MotionsCommunicationsError("INSERT_FAILED", "Communication link failed.", 500);
  return row;
}

export async function listMatterCommunicationLinks(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string; communicationId: string },
) {
  await authorizeRead(db, params);
  await requireCommunicationInMatter(db, params);
  return db
    .select()
    .from(matterCommunicationLinks)
    .where(
      and(
        eq(matterCommunicationLinks.communicationId, params.communicationId),
        eq(matterCommunicationLinks.matterId, params.matterId),
      ),
    )
    .orderBy(asc(matterCommunicationLinks.linkType), asc(matterCommunicationLinks.createdAt));
}

/** Load a matter-scoped motions/communications review without N+1 list queries. */
export async function loadMatterMotionsCommunicationsReview(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string },
) {
  await authorizeRead(db, params);
  const [motions, communications, motionLinks, communicationLinks, motionDocuments] =
    await Promise.all([
      db
        .select()
        .from(matterMotions)
        .where(
          and(
            eq(matterMotions.matterId, params.matterId),
            eq(matterMotions.organizationId, params.organizationId),
          ),
        )
        .orderBy(desc(matterMotions.updatedAt)),
      db
        .select()
        .from(matterCommunications)
        .where(
          and(
            eq(matterCommunications.matterId, params.matterId),
            eq(matterCommunications.organizationId, params.organizationId),
          ),
        )
        .orderBy(desc(matterCommunications.occurredAt)),
      db
        .select()
        .from(matterMotionLinks)
        .where(
          and(
            eq(matterMotionLinks.matterId, params.matterId),
            eq(matterMotionLinks.organizationId, params.organizationId),
          ),
        ),
      db
        .select()
        .from(matterCommunicationLinks)
        .where(
          and(
            eq(matterCommunicationLinks.matterId, params.matterId),
            eq(matterCommunicationLinks.organizationId, params.organizationId),
          ),
        ),
      db
        .select()
        .from(matterMotionDocuments)
        .where(
          and(
            eq(matterMotionDocuments.matterId, params.matterId),
            eq(matterMotionDocuments.organizationId, params.organizationId),
          ),
        )
        .orderBy(asc(matterMotionDocuments.sortOrder)),
    ]);

  return {
    organizationId: params.organizationId,
    matterId: params.matterId,
    motions,
    communications,
    motionLinks,
    communicationLinks,
    motionDocuments,
  };
}

export type MatterMotionsCommunicationsReview = Awaited<
  ReturnType<typeof loadMatterMotionsCommunicationsReview>
>;
