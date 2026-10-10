import { and, asc, desc, eq } from "drizzle-orm";
import {
  civilEvidenceItems,
  discoveryBatesRanges,
  discoveryDeficiencies,
  discoveryMeetAndConferDeficiencyLinks,
  discoveryMeetAndConferIssues,
  discoveryObjections,
  discoveryPrivilegeAssertions,
  discoveryProductionCustodians,
  discoveryProductionItems,
  discoveryProductions,
  discoveryRequestItems,
  discoveryRequestSets,
  discoveryResponseProductions,
  discoveryResponses,
  documents,
  matterCommunications,
  matterEntities,
  matterMotions,
  matters,
  tasks,
  type Database,
  type RecordProvenance,
} from "@nyayagrid/database";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import {
  assertDiscoveryDeficiencyKind,
  assertDiscoveryDeficiencyStatus,
  assertDiscoveryItemStatus,
  assertDiscoveryRequestType,
  assertPrivilegeReviewStatus,
  assertSameMatter,
  assertSameOrg,
  defaultDiscoveryProvenance,
  DiscoveryError,
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
  return defaultDiscoveryProvenance(value ?? undefined) as RecordProvenance;
}

async function requireMatterRow(db: Database, organizationId: string, matterId: string) {
  const [row] = await db
    .select()
    .from(matters)
    .where(and(eq(matters.id, matterId), eq(matters.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new DiscoveryError("NOT_FOUND", "Matter not found.", 404);
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
    .where(and(eq(matterEntities.id, entityId), eq(matterEntities.matterId, matterId)))
    .limit(1);
  if (!entity) throw new DiscoveryError("CROSS_MATTER", "Party entity not in matter.", 403);
  assertSameOrg(organizationId, organizationId);
  return entity;
}

async function requireDocumentInMatter(
  db: Database,
  organizationId: string,
  matterId: string,
  documentId: string,
) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) throw new DiscoveryError("NOT_FOUND", "Document not found.", 404);
  assertSameOrg(organizationId, doc.organizationId);
  assertSameMatter(matterId, doc.matterId);
  return doc;
}

async function requireEvidenceInMatter(
  db: Database,
  organizationId: string,
  matterId: string,
  evidenceId: string,
) {
  const [row] = await db
    .select()
    .from(civilEvidenceItems)
    .where(
      and(
        eq(civilEvidenceItems.id, evidenceId),
        eq(civilEvidenceItems.matterId, matterId),
        eq(civilEvidenceItems.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) throw new DiscoveryError("CROSS_MATTER", "Evidence not in matter.", 403);
  return row;
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
  if (!row) throw new DiscoveryError("CROSS_MATTER", "Task not in matter.", 403);
  return row;
}

async function requireMotionDocumentInMatter(
  db: Database,
  organizationId: string,
  matterId: string,
  motionDocumentId: string,
) {
  return requireDocumentInMatter(db, organizationId, matterId, motionDocumentId);
}

async function requireMatterMotionInMatter(
  db: Database,
  organizationId: string,
  matterId: string,
  motionId: string,
) {
  const [row] = await db
    .select({ id: matterMotions.id })
    .from(matterMotions)
    .where(
      and(
        eq(matterMotions.id, motionId),
        eq(matterMotions.matterId, matterId),
        eq(matterMotions.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) throw new DiscoveryError("FOREIGN_MOTION", "Motion not in matter.", 403);
  return row;
}

async function requireMatterCommunicationInMatter(
  db: Database,
  organizationId: string,
  matterId: string,
  communicationId: string,
) {
  const [row] = await db
    .select({ id: matterCommunications.id })
    .from(matterCommunications)
    .where(
      and(
        eq(matterCommunications.id, communicationId),
        eq(matterCommunications.matterId, matterId),
        eq(matterCommunications.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new DiscoveryError("FOREIGN_COMMUNICATION", "Communication not in matter.", 403);
  }
  return row;
}

export async function createDiscoveryRequestSet(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    label: string;
    discoveryType: string;
    requestingPartyEntityId: string;
    respondingPartyEntityId: string;
    servedAt?: Date | null;
    responseDueAt?: Date | null;
    sourceDocumentId?: string | null;
    isCurrent?: boolean;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  await requireMatterRow(db, params.organizationId, params.matterId);
  assertDiscoveryRequestType(params.discoveryType);
  await requireEntityInMatter(
    db,
    params.organizationId,
    params.matterId,
    params.requestingPartyEntityId,
  );
  await requireEntityInMatter(
    db,
    params.organizationId,
    params.matterId,
    params.respondingPartyEntityId,
  );
  if (params.sourceDocumentId) {
    await requireDocumentInMatter(
      db,
      params.organizationId,
      params.matterId,
      params.sourceDocumentId,
    );
  }

  const [created] = await db
    .insert(discoveryRequestSets)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      label: params.label,
      discoveryType: params.discoveryType,
      requestingPartyEntityId: params.requestingPartyEntityId,
      respondingPartyEntityId: params.respondingPartyEntityId,
      servedAt: params.servedAt ?? null,
      responseDueAt: params.responseDueAt ?? null,
      sourceDocumentId: params.sourceDocumentId ?? null,
      isCurrent: params.isCurrent ?? true,
      provenance: provenanceOf(params.provenance),
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();
  if (!created) throw new DiscoveryError("INSERT_FAILED", "Request set was not created.", 500);

  assertDiscoveryRequestType(params.discoveryType);
  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "discovery.request_set_created",
    targetType: "discovery_request_set",
    targetId: created.id,
  });
  return created;
}

export async function listDiscoveryRequestSets(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string },
) {
  await authorizeRead(db, params);
  await requireMatterRow(db, params.organizationId, params.matterId);
  return db
    .select()
    .from(discoveryRequestSets)
    .where(
      and(
        eq(discoveryRequestSets.organizationId, params.organizationId),
        eq(discoveryRequestSets.matterId, params.matterId),
      ),
    )
    .orderBy(desc(discoveryRequestSets.createdAt));
}

export async function getDiscoveryRequestSet(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string; setId: string },
) {
  await authorizeRead(db, params);
  const [row] = await db
    .select()
    .from(discoveryRequestSets)
    .where(
      and(
        eq(discoveryRequestSets.id, params.setId),
        eq(discoveryRequestSets.organizationId, params.organizationId),
        eq(discoveryRequestSets.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!row) throw new DiscoveryError("NOT_FOUND", "Request set not found.", 404);
  return row;
}

export async function createDiscoveryRequestItem(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    setId: string;
    requestNumber: string;
    title: string;
    requestText?: string;
    status?: string;
    requestingPartyEntityId: string;
    respondingPartyEntityId: string;
    servedAt?: Date | null;
    responseDueAt?: Date | null;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  const set = await getDiscoveryRequestSet(db, { ...params, userId: params.userId });
  assertSameMatter(params.matterId, set.matterId);
  assertSameOrg(params.organizationId, set.organizationId);
  await requireEntityInMatter(
    db,
    params.organizationId,
    params.matterId,
    params.requestingPartyEntityId,
  );
  await requireEntityInMatter(
    db,
    params.organizationId,
    params.matterId,
    params.respondingPartyEntityId,
  );
  const status = params.status ?? "OPEN";
  assertDiscoveryItemStatus(status);

  const [created] = await db
    .insert(discoveryRequestItems)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      setId: params.setId,
      requestNumber: params.requestNumber,
      title: params.title,
      requestText: params.requestText ?? "",
      status,
      requestingPartyEntityId: params.requestingPartyEntityId,
      respondingPartyEntityId: params.respondingPartyEntityId,
      servedAt: params.servedAt ?? null,
      responseDueAt: params.responseDueAt ?? null,
      provenance: provenanceOf(params.provenance),
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();
  if (!created) throw new DiscoveryError("INSERT_FAILED", "Request item was not created.", 500);
  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "discovery.request_item_created",
    targetType: "discovery_request_item",
    targetId: created.id,
  });
  return created;
}

export async function listDiscoveryRequestItems(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string; setId?: string },
) {
  await authorizeRead(db, params);
  const conditions = [
    eq(discoveryRequestItems.organizationId, params.organizationId),
    eq(discoveryRequestItems.matterId, params.matterId),
  ];
  if (params.setId) conditions.push(eq(discoveryRequestItems.setId, params.setId));
  return db
    .select()
    .from(discoveryRequestItems)
    .where(and(...conditions))
    .orderBy(asc(discoveryRequestItems.requestNumber));
}

export async function getDiscoveryRequestItem(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string; itemId: string },
) {
  await authorizeRead(db, params);
  const [row] = await db
    .select()
    .from(discoveryRequestItems)
    .where(
      and(
        eq(discoveryRequestItems.id, params.itemId),
        eq(discoveryRequestItems.organizationId, params.organizationId),
        eq(discoveryRequestItems.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!row) throw new DiscoveryError("NOT_FOUND", "Request item not found.", 404);
  return row;
}

export async function createDiscoveryResponse(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    itemId: string;
    label: string;
    respondedAt?: Date | null;
    isSupplemental?: boolean;
    supplementsResponseId?: string | null;
    substantiveText?: string | null;
    sourceDocumentId?: string | null;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  const item = await getDiscoveryRequestItem(db, params);
  assertSameMatter(params.matterId, item.matterId);
  if (params.supplementsResponseId) {
    const [prior] = await db
      .select()
      .from(discoveryResponses)
      .where(
        and(
          eq(discoveryResponses.id, params.supplementsResponseId),
          eq(discoveryResponses.matterId, params.matterId),
          eq(discoveryResponses.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!prior) throw new DiscoveryError("CROSS_MATTER", "Prior response not in matter.", 403);
  }
  if (params.sourceDocumentId) {
    await requireDocumentInMatter(
      db,
      params.organizationId,
      params.matterId,
      params.sourceDocumentId,
    );
  }

  const [created] = await db
    .insert(discoveryResponses)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      itemId: params.itemId,
      label: params.label,
      respondedAt: params.respondedAt ?? null,
      isSupplemental: params.isSupplemental ?? false,
      supplementsResponseId: params.supplementsResponseId ?? null,
      substantiveText: params.substantiveText ?? null,
      sourceDocumentId: params.sourceDocumentId ?? null,
      provenance: provenanceOf(params.provenance),
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();
  if (!created) throw new DiscoveryError("INSERT_FAILED", "Response was not created.", 500);
  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "discovery.response_created",
    targetType: "discovery_response",
    targetId: created.id,
    metadata: { isSupplemental: created.isSupplemental },
  });
  return created;
}

export async function listDiscoveryResponsesForItem(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string; itemId: string },
) {
  await authorizeRead(db, params);
  await getDiscoveryRequestItem(db, params);
  return db
    .select()
    .from(discoveryResponses)
    .where(
      and(
        eq(discoveryResponses.itemId, params.itemId),
        eq(discoveryResponses.matterId, params.matterId),
        eq(discoveryResponses.organizationId, params.organizationId),
      ),
    )
    .orderBy(asc(discoveryResponses.respondedAt), asc(discoveryResponses.createdAt));
}

export async function createDiscoveryObjection(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    itemId: string;
    responseId: string;
    basis: string;
    text?: string;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  await getDiscoveryRequestItem(db, params);
  const [response] = await db
    .select()
    .from(discoveryResponses)
    .where(
      and(
        eq(discoveryResponses.id, params.responseId),
        eq(discoveryResponses.matterId, params.matterId),
        eq(discoveryResponses.organizationId, params.organizationId),
        eq(discoveryResponses.itemId, params.itemId),
      ),
    )
    .limit(1);
  if (!response) throw new DiscoveryError("CROSS_MATTER", "Response not in matter/item.", 403);

  const [created] = await db
    .insert(discoveryObjections)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      itemId: params.itemId,
      responseId: params.responseId,
      basis: params.basis,
      text: params.text ?? "",
      provenance: provenanceOf(params.provenance),
      createdByUserId: params.userId,
    })
    .returning();
  if (!created) throw new DiscoveryError("INSERT_FAILED", "Objection was not created.", 500);
  return created;
}

export async function createDiscoveryProduction(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    label: string;
    producingPartyEntityId: string;
    receivingPartyEntityId: string;
    producedAt?: Date | null;
    isSupplemental?: boolean;
    supplementsProductionId?: string | null;
    transmittalDocumentId?: string | null;
    notes?: string | null;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  await requireMatterRow(db, params.organizationId, params.matterId);
  await requireEntityInMatter(
    db,
    params.organizationId,
    params.matterId,
    params.producingPartyEntityId,
  );
  await requireEntityInMatter(
    db,
    params.organizationId,
    params.matterId,
    params.receivingPartyEntityId,
  );
  if (params.supplementsProductionId) {
    const [prior] = await db
      .select()
      .from(discoveryProductions)
      .where(
        and(
          eq(discoveryProductions.id, params.supplementsProductionId),
          eq(discoveryProductions.matterId, params.matterId),
          eq(discoveryProductions.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!prior) throw new DiscoveryError("CROSS_MATTER", "Prior production not in matter.", 403);
  }
  if (params.transmittalDocumentId) {
    await requireDocumentInMatter(
      db,
      params.organizationId,
      params.matterId,
      params.transmittalDocumentId,
    );
  }

  const [created] = await db
    .insert(discoveryProductions)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      label: params.label,
      producingPartyEntityId: params.producingPartyEntityId,
      receivingPartyEntityId: params.receivingPartyEntityId,
      producedAt: params.producedAt ?? null,
      isSupplemental: params.isSupplemental ?? false,
      supplementsProductionId: params.supplementsProductionId ?? null,
      transmittalDocumentId: params.transmittalDocumentId ?? null,
      notes: params.notes ?? null,
      provenance: provenanceOf(params.provenance),
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();
  if (!created) throw new DiscoveryError("INSERT_FAILED", "Production was not created.", 500);
  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "discovery.production_created",
    targetType: "discovery_production",
    targetId: created.id,
  });
  return created;
}

export async function linkDiscoveryProductionItem(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    productionId: string;
    documentId?: string | null;
    evidenceId?: string | null;
    requestItemId?: string | null;
  },
) {
  await authorizeWrite(db, params);
  const [production] = await db
    .select()
    .from(discoveryProductions)
    .where(
      and(
        eq(discoveryProductions.id, params.productionId),
        eq(discoveryProductions.matterId, params.matterId),
        eq(discoveryProductions.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!production) throw new DiscoveryError("NOT_FOUND", "Production not found.", 404);

  if (!params.documentId && !params.evidenceId && !params.requestItemId) {
    throw new DiscoveryError(
      "INVALID_LINK",
      "Production item requires document, evidence, or request item.",
    );
  }
  if (params.documentId) {
    await requireDocumentInMatter(db, params.organizationId, params.matterId, params.documentId);
  }
  if (params.evidenceId) {
    await requireEvidenceInMatter(db, params.organizationId, params.matterId, params.evidenceId);
  }
  if (params.requestItemId) {
    await getDiscoveryRequestItem(db, { ...params, itemId: params.requestItemId });
  }

  const [created] = await db
    .insert(discoveryProductionItems)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      productionId: params.productionId,
      documentId: params.documentId ?? null,
      evidenceId: params.evidenceId ?? null,
      requestItemId: params.requestItemId ?? null,
    })
    .returning();
  if (!created) throw new DiscoveryError("INSERT_FAILED", "Production item was not created.", 500);
  return created;
}

export async function createDiscoveryBatesRange(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    productionId: string;
    prefix?: string;
    startNumber?: number | null;
    endNumber?: number | null;
    rawText?: string;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  const [production] = await db
    .select()
    .from(discoveryProductions)
    .where(
      and(
        eq(discoveryProductions.id, params.productionId),
        eq(discoveryProductions.matterId, params.matterId),
        eq(discoveryProductions.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!production) throw new DiscoveryError("NOT_FOUND", "Production not found.", 404);

  const [created] = await db
    .insert(discoveryBatesRanges)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      productionId: params.productionId,
      prefix: params.prefix ?? "",
      startNumber: params.startNumber ?? null,
      endNumber: params.endNumber ?? null,
      rawText: params.rawText ?? "",
      provenance: provenanceOf(params.provenance),
      createdByUserId: params.userId,
    })
    .returning();
  if (!created) throw new DiscoveryError("INSERT_FAILED", "Bates range was not created.", 500);
  return created;
}

export async function linkDiscoveryProductionCustodian(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    productionId: string;
    custodianEntityId: string;
  },
) {
  await authorizeWrite(db, params);
  await requireEntityInMatter(db, params.organizationId, params.matterId, params.custodianEntityId);
  const [created] = await db
    .insert(discoveryProductionCustodians)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      productionId: params.productionId,
      custodianEntityId: params.custodianEntityId,
    })
    .returning();
  if (!created) throw new DiscoveryError("INSERT_FAILED", "Custodian link was not created.", 500);
  return created;
}

export async function linkDiscoveryResponseProduction(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    responseId: string;
    productionId: string;
  },
) {
  await authorizeWrite(db, params);
  const [response] = await db
    .select()
    .from(discoveryResponses)
    .where(
      and(
        eq(discoveryResponses.id, params.responseId),
        eq(discoveryResponses.matterId, params.matterId),
        eq(discoveryResponses.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!response) throw new DiscoveryError("CROSS_MATTER", "Response not in matter.", 403);
  const [production] = await db
    .select()
    .from(discoveryProductions)
    .where(
      and(
        eq(discoveryProductions.id, params.productionId),
        eq(discoveryProductions.matterId, params.matterId),
        eq(discoveryProductions.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!production) throw new DiscoveryError("CROSS_MATTER", "Production not in matter.", 403);

  const [created] = await db
    .insert(discoveryResponseProductions)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      responseId: params.responseId,
      productionId: params.productionId,
    })
    .returning();
  if (!created) throw new DiscoveryError("INSERT_FAILED", "Response-production link failed.", 500);
  return created;
}

export async function createDiscoveryDeficiency(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    kind: string;
    status?: string;
    description?: string;
    itemId?: string | null;
    productionId?: string | null;
    openedAt?: Date | null;
    responsiblePartyEntityId?: string | null;
    communicationId?: string | null;
    meetAndConferId?: string | null;
    motionId?: string | null;
    motionDocumentId?: string | null;
    isReviewSignal?: boolean;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  await requireMatterRow(db, params.organizationId, params.matterId);
  assertDiscoveryDeficiencyKind(params.kind);
  const status = params.status ?? "OPEN";
  assertDiscoveryDeficiencyStatus(status);

  if (params.itemId) {
    await getDiscoveryRequestItem(db, { ...params, itemId: params.itemId });
  }
  if (params.productionId) {
    const [production] = await db
      .select()
      .from(discoveryProductions)
      .where(
        and(
          eq(discoveryProductions.id, params.productionId),
          eq(discoveryProductions.matterId, params.matterId),
          eq(discoveryProductions.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!production) throw new DiscoveryError("CROSS_MATTER", "Production not in matter.", 403);
  }
  if (params.responsiblePartyEntityId) {
    await requireEntityInMatter(
      db,
      params.organizationId,
      params.matterId,
      params.responsiblePartyEntityId,
    );
  }
  if (params.meetAndConferId) {
    const [mac] = await db
      .select()
      .from(discoveryMeetAndConferIssues)
      .where(
        and(
          eq(discoveryMeetAndConferIssues.id, params.meetAndConferId),
          eq(discoveryMeetAndConferIssues.matterId, params.matterId),
          eq(discoveryMeetAndConferIssues.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!mac) throw new DiscoveryError("CROSS_MATTER", "Meet-and-confer not in matter.", 403);
  }
  if (params.communicationId) {
    await requireMatterCommunicationInMatter(
      db,
      params.organizationId,
      params.matterId,
      params.communicationId,
    );
  }
  if (params.motionDocumentId) {
    await requireMotionDocumentInMatter(
      db,
      params.organizationId,
      params.matterId,
      params.motionDocumentId,
    );
  }
  if (params.motionId) {
    await requireMatterMotionInMatter(
      db,
      params.organizationId,
      params.matterId,
      params.motionId,
    );
  }

  const [created] = await db
    .insert(discoveryDeficiencies)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      kind: params.kind,
      status,
      description: params.description ?? "",
      itemId: params.itemId ?? null,
      productionId: params.productionId ?? null,
      openedAt: params.openedAt ?? null,
      responsiblePartyEntityId: params.responsiblePartyEntityId ?? null,
      communicationId: params.communicationId ?? null,
      meetAndConferId: params.meetAndConferId ?? null,
      motionId: params.motionId ?? null,
      motionDocumentId: params.motionDocumentId ?? null,
      isReviewSignal: params.isReviewSignal ?? false,
      provenance: provenanceOf(params.provenance),
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();
  if (!created) throw new DiscoveryError("INSERT_FAILED", "Deficiency was not created.", 500);
  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "discovery.deficiency_created",
    targetType: "discovery_deficiency",
    targetId: created.id,
    metadata: { kind: created.kind, status: created.status },
  });
  return created;
}

export async function createDiscoveryPrivilegeAssertion(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    status?: string;
    assertedBasis: string;
    assertingPartyEntityId: string;
    assertedAt?: Date | null;
    documentId?: string | null;
    evidenceId?: string | null;
    productionId?: string | null;
    privilegeLogDocumentId?: string | null;
    reviewNotes?: string | null;
    courtRulingReferenced?: boolean;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  await requireMatterRow(db, params.organizationId, params.matterId);
  const status = params.status ?? "ASSERTED";
  assertPrivilegeReviewStatus(status);
  await requireEntityInMatter(
    db,
    params.organizationId,
    params.matterId,
    params.assertingPartyEntityId,
  );
  if (params.documentId) {
    await requireDocumentInMatter(db, params.organizationId, params.matterId, params.documentId);
  }
  if (params.evidenceId) {
    await requireEvidenceInMatter(db, params.organizationId, params.matterId, params.evidenceId);
  }
  if (params.privilegeLogDocumentId) {
    await requireDocumentInMatter(
      db,
      params.organizationId,
      params.matterId,
      params.privilegeLogDocumentId,
    );
  }
  if (params.productionId) {
    const [production] = await db
      .select()
      .from(discoveryProductions)
      .where(
        and(
          eq(discoveryProductions.id, params.productionId),
          eq(discoveryProductions.matterId, params.matterId),
          eq(discoveryProductions.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!production) throw new DiscoveryError("CROSS_MATTER", "Production not in matter.", 403);
  }

  const [created] = await db
    .insert(discoveryPrivilegeAssertions)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      status,
      assertedBasis: params.assertedBasis,
      assertingPartyEntityId: params.assertingPartyEntityId,
      assertedAt: params.assertedAt ?? null,
      documentId: params.documentId ?? null,
      evidenceId: params.evidenceId ?? null,
      productionId: params.productionId ?? null,
      privilegeLogDocumentId: params.privilegeLogDocumentId ?? null,
      reviewNotes: params.reviewNotes ?? null,
      courtRulingReferenced: params.courtRulingReferenced ?? false,
      provenance: provenanceOf(params.provenance),
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();
  if (!created) throw new DiscoveryError("INSERT_FAILED", "Privilege assertion was not created.", 500);
  return created;
}

export async function createDiscoveryMeetAndConferIssue(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    label: string;
    occurredAt?: Date | null;
    communicationId?: string | null;
    taskId?: string | null;
    outcomeNotes?: string | null;
    deficiencyIds?: string[];
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  await requireMatterRow(db, params.organizationId, params.matterId);
  if (params.taskId) {
    await requireTaskInMatter(db, params.organizationId, params.matterId, params.taskId);
  }
  if (params.communicationId) {
    await requireMatterCommunicationInMatter(
      db,
      params.organizationId,
      params.matterId,
      params.communicationId,
    );
  }

  const [created] = await db
    .insert(discoveryMeetAndConferIssues)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      label: params.label,
      occurredAt: params.occurredAt ?? null,
      communicationId: params.communicationId ?? null,
      taskId: params.taskId ?? null,
      outcomeNotes: params.outcomeNotes ?? null,
      provenance: provenanceOf(params.provenance),
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();
  if (!created) throw new DiscoveryError("INSERT_FAILED", "Meet-and-confer was not created.", 500);

  for (const deficiencyId of params.deficiencyIds ?? []) {
    const [deficiency] = await db
      .select()
      .from(discoveryDeficiencies)
      .where(
        and(
          eq(discoveryDeficiencies.id, deficiencyId),
          eq(discoveryDeficiencies.matterId, params.matterId),
          eq(discoveryDeficiencies.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!deficiency) {
      throw new DiscoveryError("CROSS_MATTER", "Deficiency not in matter for meet-and-confer.", 403);
    }
    await db.insert(discoveryMeetAndConferDeficiencyLinks).values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      meetAndConferId: created.id,
      deficiencyId,
    });
    await db
      .update(discoveryDeficiencies)
      .set({ meetAndConferId: created.id, updatedByUserId: params.userId, updatedAt: new Date() })
      .where(
        and(
          eq(discoveryDeficiencies.id, deficiencyId),
          eq(discoveryDeficiencies.matterId, params.matterId),
        ),
      );
  }

  return created;
}

export async function listDiscoveryProductions(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string },
) {
  await authorizeRead(db, params);
  return db
    .select()
    .from(discoveryProductions)
    .where(
      and(
        eq(discoveryProductions.organizationId, params.organizationId),
        eq(discoveryProductions.matterId, params.matterId),
      ),
    )
    .orderBy(desc(discoveryProductions.producedAt), desc(discoveryProductions.createdAt));
}

export async function listDiscoveryDeficiencies(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string; status?: string },
) {
  await authorizeRead(db, params);
  const conditions = [
    eq(discoveryDeficiencies.organizationId, params.organizationId),
    eq(discoveryDeficiencies.matterId, params.matterId),
  ];
  if (params.status) conditions.push(eq(discoveryDeficiencies.status, params.status));
  return db
    .select()
    .from(discoveryDeficiencies)
    .where(and(...conditions))
    .orderBy(desc(discoveryDeficiencies.openedAt), desc(discoveryDeficiencies.createdAt));
}

export async function listDiscoveryPrivilegeAssertions(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string; status?: string },
) {
  await authorizeRead(db, params);
  const conditions = [
    eq(discoveryPrivilegeAssertions.organizationId, params.organizationId),
    eq(discoveryPrivilegeAssertions.matterId, params.matterId),
  ];
  if (params.status) conditions.push(eq(discoveryPrivilegeAssertions.status, params.status));
  return db
    .select()
    .from(discoveryPrivilegeAssertions)
    .where(and(...conditions))
    .orderBy(desc(discoveryPrivilegeAssertions.assertedAt), desc(discoveryPrivilegeAssertions.createdAt));
}
