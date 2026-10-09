/**
 * Persist / load adapters between the D4 DiscoveryLedgerReview shape and DB rows.
 * Reconstructs Chat A prototype model without redesign.
 */

import { and, eq } from "drizzle-orm";
import {
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
  matterEntities,
  type Database,
  type RecordProvenance,
} from "@nyayagrid/database";
import { requireMatterAccess } from "@nyayagrid/permissions";
import {
  createDiscoveryBatesRange,
  createDiscoveryDeficiency,
  createDiscoveryMeetAndConferIssue,
  createDiscoveryObjection,
  createDiscoveryPrivilegeAssertion,
  createDiscoveryProduction,
  createDiscoveryRequestItem,
  createDiscoveryRequestSet,
  createDiscoveryResponse,
  linkDiscoveryProductionCustodian,
  linkDiscoveryProductionItem,
  linkDiscoveryResponseProduction,
} from "./postgres";
import type {
  DiscoveryDeficiency,
  DiscoveryItemStatus,
  DiscoveryLedgerReview,
  DiscoveryObjection,
  DiscoveryProduction,
  DiscoveryProvenance,
  DiscoveryRequestItem,
  DiscoveryRequestSet,
  DiscoveryRequestType,
  DiscoveryResponse,
  MeetAndConferIssue,
  PrivilegeAssertion,
  PrivilegeReviewStatus,
  DiscoveryDeficiencyKind,
  DiscoveryDeficiencyStatus,
} from "./types";
import { DiscoveryError } from "./domain";

function toAppProvenance(p: RecordProvenance | null | undefined): DiscoveryProvenance {
  const origin = p?.extractionOrigin;
  const extractionOrigin: DiscoveryProvenance["extractionOrigin"] =
    origin === "deterministic_fixture"
      ? "deterministic_fixture"
      : origin === "source_metadata"
        ? "source_metadata"
        : "user_entry";
  return {
    documentId: p?.documentId ?? null,
    sourceSpan: p?.sourceSpan ?? null,
    sourcePage: p?.sourcePage ?? null,
    humanEntered: p?.humanEntered ?? false,
    extractionOrigin,
  };
}

function toDbProvenance(p: DiscoveryProvenance): RecordProvenance {
  return {
    documentId: p.documentId,
    sourceSpan: p.sourceSpan,
    sourcePage: p.sourcePage,
    humanEntered: p.humanEntered,
    extractionOrigin:
      p.extractionOrigin === "deterministic_fixture"
        ? "deterministic_fixture"
        : p.extractionOrigin === "source_metadata"
          ? "source_metadata"
          : "human",
  };
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export async function loadDiscoveryLedgerReview(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string },
): Promise<DiscoveryLedgerReview> {
  await requireMatterAccess(db, {
    userId: params.userId,
    matterId: params.matterId,
    minAccess: "read",
    capability: "matters.view",
  });

  const scope = and(
    eq(discoveryRequestSets.organizationId, params.organizationId),
    eq(discoveryRequestSets.matterId, params.matterId),
  );

  const [
    sets,
    items,
    responses,
    objections,
    productions,
    productionItems,
    bates,
    custodians,
    responseProductions,
    deficiencies,
    privileges,
    meetAndConfers,
    macLinks,
    entities,
  ] = await Promise.all([
    db.select().from(discoveryRequestSets).where(scope),
    db
      .select()
      .from(discoveryRequestItems)
      .where(
        and(
          eq(discoveryRequestItems.organizationId, params.organizationId),
          eq(discoveryRequestItems.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(discoveryResponses)
      .where(
        and(
          eq(discoveryResponses.organizationId, params.organizationId),
          eq(discoveryResponses.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(discoveryObjections)
      .where(
        and(
          eq(discoveryObjections.organizationId, params.organizationId),
          eq(discoveryObjections.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(discoveryProductions)
      .where(
        and(
          eq(discoveryProductions.organizationId, params.organizationId),
          eq(discoveryProductions.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(discoveryProductionItems)
      .where(
        and(
          eq(discoveryProductionItems.organizationId, params.organizationId),
          eq(discoveryProductionItems.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(discoveryBatesRanges)
      .where(
        and(
          eq(discoveryBatesRanges.organizationId, params.organizationId),
          eq(discoveryBatesRanges.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(discoveryProductionCustodians)
      .where(
        and(
          eq(discoveryProductionCustodians.organizationId, params.organizationId),
          eq(discoveryProductionCustodians.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(discoveryResponseProductions)
      .where(
        and(
          eq(discoveryResponseProductions.organizationId, params.organizationId),
          eq(discoveryResponseProductions.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(discoveryDeficiencies)
      .where(
        and(
          eq(discoveryDeficiencies.organizationId, params.organizationId),
          eq(discoveryDeficiencies.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(discoveryPrivilegeAssertions)
      .where(
        and(
          eq(discoveryPrivilegeAssertions.organizationId, params.organizationId),
          eq(discoveryPrivilegeAssertions.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(discoveryMeetAndConferIssues)
      .where(
        and(
          eq(discoveryMeetAndConferIssues.organizationId, params.organizationId),
          eq(discoveryMeetAndConferIssues.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(discoveryMeetAndConferDeficiencyLinks)
      .where(
        and(
          eq(discoveryMeetAndConferDeficiencyLinks.organizationId, params.organizationId),
          eq(discoveryMeetAndConferDeficiencyLinks.matterId, params.matterId),
        ),
      ),
    db.select().from(matterEntities).where(eq(matterEntities.matterId, params.matterId)),
  ]);

  const objectionsByResponse = new Map<string, string[]>();
  for (const row of objections) {
    const list = objectionsByResponse.get(row.responseId) ?? [];
    list.push(row.id);
    objectionsByResponse.set(row.responseId, list);
  }

  const productionsByResponse = new Map<string, string[]>();
  for (const row of responseProductions) {
    const list = productionsByResponse.get(row.responseId) ?? [];
    list.push(row.productionId);
    productionsByResponse.set(row.responseId, list);
  }

  const mappedObjections: DiscoveryObjection[] = objections.map((row) => ({
    id: row.id,
    itemId: row.itemId,
    responseId: row.responseId,
    basis: row.basis,
    text: row.text,
    provenance: toAppProvenance(row.provenance),
  }));

  const mappedResponses: DiscoveryResponse[] = responses.map((row) => ({
    id: row.id,
    itemId: row.itemId,
    label: row.label,
    respondedAt: iso(row.respondedAt),
    isSupplemental: row.isSupplemental,
    supplementsResponseId: row.supplementsResponseId,
    substantiveText: row.substantiveText,
    objectionIds: objectionsByResponse.get(row.id) ?? [],
    productionIds: productionsByResponse.get(row.id) ?? [],
    sourceDocumentId: row.sourceDocumentId,
    provenance: toAppProvenance(row.provenance),
  }));

  const mappedSets: DiscoveryRequestSet[] = sets.map((row) => ({
    id: row.id,
    label: row.label,
    discoveryType: row.discoveryType as DiscoveryRequestType,
    requestingPartyId: row.requestingPartyEntityId,
    respondingPartyId: row.respondingPartyEntityId,
    servedAt: iso(row.servedAt),
    responseDueAt: iso(row.responseDueAt),
    isCurrent: row.isCurrent,
    supersededBySetId: row.supersededById,
    sourceDocumentId: row.sourceDocumentId,
    provenance: toAppProvenance(row.provenance),
  }));

  const mappedItems: DiscoveryRequestItem[] = items.map((row) => ({
    id: row.id,
    setId: row.setId,
    requestNumber: row.requestNumber,
    title: row.title,
    requestText: row.requestText,
    status: row.status as DiscoveryItemStatus,
    requestingPartyId: row.requestingPartyEntityId,
    respondingPartyId: row.respondingPartyEntityId,
    servedAt: iso(row.servedAt),
    responseDueAt: iso(row.responseDueAt),
    provenance: toAppProvenance(row.provenance),
  }));

  const mappedProductions: DiscoveryProduction[] = productions.map((row) => {
    const links = productionItems.filter((link) => link.productionId === row.id);
    const ranges = bates.filter((range) => range.productionId === row.id);
    const custodianIds = custodians
      .filter((c) => c.productionId === row.id)
      .map((c) => c.custodianEntityId);
    return {
      id: row.id,
      label: row.label,
      producingPartyId: row.producingPartyEntityId,
      receivingPartyId: row.receivingPartyEntityId,
      producedAt: iso(row.producedAt),
      isSupplemental: row.isSupplemental,
      supplementsProductionId: row.supplementsProductionId,
      transmittalDocumentId: row.transmittalDocumentId,
      documentIds: links.map((l) => l.documentId).filter((id): id is string => Boolean(id)),
      evidenceIds: links.map((l) => l.evidenceId).filter((id): id is string => Boolean(id)),
      custodianIds,
      batesRanges: ranges.map((range) => ({
        id: range.id,
        productionId: range.productionId,
        prefix: range.prefix,
        start: range.startNumber,
        end: range.endNumber,
        rawText: range.rawText,
        provenance: toAppProvenance(range.provenance),
      })),
      requestItemIds: links
        .map((l) => l.requestItemId)
        .filter((id): id is string => Boolean(id)),
      notes: row.notes,
      provenance: toAppProvenance(row.provenance),
    };
  });

  const mappedDeficiencies: DiscoveryDeficiency[] = deficiencies.map((row) => ({
    id: row.id,
    kind: row.kind as DiscoveryDeficiencyKind,
    itemId: row.itemId,
    productionId: row.productionId,
    description: row.description,
    status: row.status as DiscoveryDeficiencyStatus,
    openedAt: iso(row.openedAt),
    responsiblePartyId: row.responsiblePartyEntityId,
    communicationId: row.communicationId,
    meetAndConferId: row.meetAndConferId,
    motionId: row.motionId,
    isReviewSignal: row.isReviewSignal,
    provenance: toAppProvenance(row.provenance),
  }));

  const mappedPrivileges: PrivilegeAssertion[] = privileges.map((row) => ({
    id: row.id,
    status: row.status as PrivilegeReviewStatus,
    assertedBasis: row.assertedBasis,
    assertingPartyId: row.assertingPartyEntityId,
    assertedAt: iso(row.assertedAt),
    documentId: row.documentId,
    evidenceId: row.evidenceId,
    productionId: row.productionId,
    privilegeLogDocumentId: row.privilegeLogDocumentId,
    reviewNotes: row.reviewNotes,
    courtRulingReferenced: row.courtRulingReferenced,
    provenance: toAppProvenance(row.provenance),
  }));

  const mappedMac: MeetAndConferIssue[] = meetAndConfers.map((row) => ({
    id: row.id,
    label: row.label,
    deficiencyIds: macLinks
      .filter((link) => link.meetAndConferId === row.id)
      .map((link) => link.deficiencyId),
    communicationId: row.communicationId,
    occurredAt: iso(row.occurredAt),
    outcomeNotes: row.outcomeNotes,
    provenance: toAppProvenance(row.provenance),
  }));

  const motionLinks = deficiencies
    .filter((row) => row.motionId)
    .map((row) => ({
      id: `motion-link-${row.id}`,
      motionId: row.motionId!,
      motionLabel: "Linked motion",
      motionType: "OTHER" as const,
      deficiencyIds: [row.id],
      documentId: row.motionDocumentId,
    }));

  const partyIds = new Set<string>();
  for (const set of mappedSets) {
    partyIds.add(set.requestingPartyId);
    partyIds.add(set.respondingPartyId);
  }
  for (const production of mappedProductions) {
    partyIds.add(production.producingPartyId);
    partyIds.add(production.receivingPartyId);
  }

  return {
    matterId: params.matterId,
    organizationId: params.organizationId,
    parties: entities
      .filter((entity) => partyIds.has(entity.id))
      .map((entity) => ({ partyId: entity.id, displayName: entity.displayName })),
    requestSets: mappedSets,
    items: mappedItems,
    responses: mappedResponses,
    objections: mappedObjections,
    productions: mappedProductions,
    deficiencies: mappedDeficiencies,
    privilegeAssertions: mappedPrivileges,
    meetAndConferIssues: mappedMac,
    motionLinks,
    batesSignals: [],
    coverageWarnings: [],
    sanctionsConclusion: null,
    privilegeLegalConclusion: null,
  };
}

export async function persistDiscoveryLedgerReview(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    review: DiscoveryLedgerReview;
  },
): Promise<DiscoveryLedgerReview> {
  if (
    params.review.matterId !== params.matterId ||
    params.review.organizationId !== params.organizationId
  ) {
    throw new DiscoveryError("CROSS_ORG", "Review org/matter must match persistence scope.", 403);
  }

  const setIdMap = new Map<string, string>();
  const itemIdMap = new Map<string, string>();
  const responseIdMap = new Map<string, string>();
  const productionIdMap = new Map<string, string>();
  const deficiencyIdMap = new Map<string, string>();

  for (const set of params.review.requestSets) {
    const created = await createDiscoveryRequestSet(db, {
      userId: params.userId,
      organizationId: params.organizationId,
      matterId: params.matterId,
      label: set.label,
      discoveryType: set.discoveryType,
      requestingPartyEntityId: set.requestingPartyId,
      respondingPartyEntityId: set.respondingPartyId,
      servedAt: set.servedAt ? new Date(set.servedAt) : null,
      responseDueAt: set.responseDueAt ? new Date(set.responseDueAt) : null,
      sourceDocumentId: set.sourceDocumentId,
      isCurrent: set.isCurrent,
      provenance: toDbProvenance(set.provenance),
    });
    setIdMap.set(set.id, created.id);
  }

  for (const item of params.review.items) {
    const setId = setIdMap.get(item.setId);
    if (!setId) throw new DiscoveryError("INVALID_LINK", `Unknown set id ${item.setId}`);
    const created = await createDiscoveryRequestItem(db, {
      userId: params.userId,
      organizationId: params.organizationId,
      matterId: params.matterId,
      setId,
      requestNumber: item.requestNumber,
      title: item.title,
      requestText: item.requestText,
      status: item.status,
      requestingPartyEntityId: item.requestingPartyId,
      respondingPartyEntityId: item.respondingPartyId,
      servedAt: item.servedAt ? new Date(item.servedAt) : null,
      responseDueAt: item.responseDueAt ? new Date(item.responseDueAt) : null,
      provenance: toDbProvenance(item.provenance),
    });
    itemIdMap.set(item.id, created.id);
  }

  for (const production of params.review.productions) {
    const created = await createDiscoveryProduction(db, {
      userId: params.userId,
      organizationId: params.organizationId,
      matterId: params.matterId,
      label: production.label,
      producingPartyEntityId: production.producingPartyId,
      receivingPartyEntityId: production.receivingPartyId,
      producedAt: production.producedAt ? new Date(production.producedAt) : null,
      isSupplemental: production.isSupplemental,
      supplementsProductionId: production.supplementsProductionId
        ? productionIdMap.get(production.supplementsProductionId) ?? null
        : null,
      transmittalDocumentId: production.transmittalDocumentId,
      notes: production.notes,
      provenance: toDbProvenance(production.provenance),
    });
    productionIdMap.set(production.id, created.id);

    for (const documentId of production.documentIds) {
      await linkDiscoveryProductionItem(db, {
        userId: params.userId,
        organizationId: params.organizationId,
        matterId: params.matterId,
        productionId: created.id,
        documentId,
      });
    }
    for (const evidenceId of production.evidenceIds) {
      await linkDiscoveryProductionItem(db, {
        userId: params.userId,
        organizationId: params.organizationId,
        matterId: params.matterId,
        productionId: created.id,
        evidenceId,
      });
    }
    for (const requestItemId of production.requestItemIds) {
      const mappedItemId = itemIdMap.get(requestItemId);
      if (!mappedItemId) continue;
      await linkDiscoveryProductionItem(db, {
        userId: params.userId,
        organizationId: params.organizationId,
        matterId: params.matterId,
        productionId: created.id,
        requestItemId: mappedItemId,
      });
    }
    for (const custodianId of production.custodianIds) {
      await linkDiscoveryProductionCustodian(db, {
        userId: params.userId,
        organizationId: params.organizationId,
        matterId: params.matterId,
        productionId: created.id,
        custodianEntityId: custodianId,
      });
    }
    for (const range of production.batesRanges) {
      await createDiscoveryBatesRange(db, {
        userId: params.userId,
        organizationId: params.organizationId,
        matterId: params.matterId,
        productionId: created.id,
        prefix: range.prefix,
        startNumber: range.start,
        endNumber: range.end,
        rawText: range.rawText,
        provenance: toDbProvenance(range.provenance),
      });
    }
  }

  for (const response of params.review.responses) {
    const itemId = itemIdMap.get(response.itemId);
    if (!itemId) throw new DiscoveryError("INVALID_LINK", `Unknown item id ${response.itemId}`);
    const created = await createDiscoveryResponse(db, {
      userId: params.userId,
      organizationId: params.organizationId,
      matterId: params.matterId,
      itemId,
      label: response.label,
      respondedAt: response.respondedAt ? new Date(response.respondedAt) : null,
      isSupplemental: response.isSupplemental,
      supplementsResponseId: response.supplementsResponseId
        ? responseIdMap.get(response.supplementsResponseId) ?? null
        : null,
      substantiveText: response.substantiveText,
      sourceDocumentId: response.sourceDocumentId,
      provenance: toDbProvenance(response.provenance),
    });
    responseIdMap.set(response.id, created.id);

    for (const productionId of response.productionIds) {
      const mappedProductionId = productionIdMap.get(productionId);
      if (!mappedProductionId) continue;
      await linkDiscoveryResponseProduction(db, {
        userId: params.userId,
        organizationId: params.organizationId,
        matterId: params.matterId,
        responseId: created.id,
        productionId: mappedProductionId,
      });
    }
  }

  for (const objection of params.review.objections) {
    const itemId = itemIdMap.get(objection.itemId);
    const responseId = responseIdMap.get(objection.responseId);
    if (!itemId || !responseId) continue;
    await createDiscoveryObjection(db, {
      userId: params.userId,
      organizationId: params.organizationId,
      matterId: params.matterId,
      itemId,
      responseId,
      basis: objection.basis,
      text: objection.text,
      provenance: toDbProvenance(objection.provenance),
    });
  }

  for (const deficiency of params.review.deficiencies) {
    const created = await createDiscoveryDeficiency(db, {
      userId: params.userId,
      organizationId: params.organizationId,
      matterId: params.matterId,
      kind: deficiency.kind,
      status: deficiency.status,
      description: deficiency.description,
      itemId: deficiency.itemId ? itemIdMap.get(deficiency.itemId) ?? null : null,
      productionId: deficiency.productionId
        ? productionIdMap.get(deficiency.productionId) ?? null
        : null,
      openedAt: deficiency.openedAt ? new Date(deficiency.openedAt) : null,
      responsiblePartyEntityId: deficiency.responsiblePartyId,
      communicationId: deficiency.communicationId,
      motionId: deficiency.motionId,
      motionDocumentId: params.review.motionLinks.find((m) => m.motionId === deficiency.motionId)
        ?.documentId,
      provenance: toDbProvenance(deficiency.provenance),
    });
    deficiencyIdMap.set(deficiency.id, created.id);
  }

  for (const mac of params.review.meetAndConferIssues) {
    await createDiscoveryMeetAndConferIssue(db, {
      userId: params.userId,
      organizationId: params.organizationId,
      matterId: params.matterId,
      label: mac.label,
      occurredAt: mac.occurredAt ? new Date(mac.occurredAt) : null,
      communicationId: mac.communicationId,
      outcomeNotes: mac.outcomeNotes,
      deficiencyIds: mac.deficiencyIds
        .map((id) => deficiencyIdMap.get(id))
        .filter((id): id is string => Boolean(id)),
      provenance: toDbProvenance(mac.provenance),
    });
  }

  for (const privilege of params.review.privilegeAssertions) {
    await createDiscoveryPrivilegeAssertion(db, {
      userId: params.userId,
      organizationId: params.organizationId,
      matterId: params.matterId,
      status: privilege.status,
      assertedBasis: privilege.assertedBasis,
      assertingPartyEntityId: privilege.assertingPartyId,
      assertedAt: privilege.assertedAt ? new Date(privilege.assertedAt) : null,
      documentId: privilege.documentId,
      evidenceId: privilege.evidenceId,
      productionId: privilege.productionId
        ? productionIdMap.get(privilege.productionId) ?? null
        : null,
      privilegeLogDocumentId: privilege.privilegeLogDocumentId,
      reviewNotes: privilege.reviewNotes,
      courtRulingReferenced: privilege.courtRulingReferenced,
      provenance: toDbProvenance(privilege.provenance),
    });
  }

  return loadDiscoveryLedgerReview(db, params);
}
