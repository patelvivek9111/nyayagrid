import { and, eq, inArray } from "drizzle-orm";
import {
  civilAuthorityRelations,
  civilClaimElements,
  civilClaimParties,
  civilClaims,
  civilDefenseClaimRelations,
  civilDefenseParties,
  civilDefenses,
  civilEvidenceItems,
  civilEvidenceRelations,
  civilFactRelations,
  civilLegalIssueRelations,
  civilPleadings,
  civilStandardRelations,
  matterEntities,
  matterFacts,
  matters,
  type Database,
  type RecordProvenance,
} from "@nyayagrid/database";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import {
  assertAuthorityRelation,
  assertClaimKind,
  assertDefenseKind,
  assertEvidenceRole,
  assertPartyRole,
  assertProceduralStatus,
  assertSameMatter,
  assertSameOrg,
  assertSupportStatus,
  CivilError,
  defaultCivilProvenance,
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
  return defaultCivilProvenance(value ?? undefined) as RecordProvenance;
}

async function requireMatterRow(db: Database, organizationId: string, matterId: string) {
  const [row] = await db
    .select()
    .from(matters)
    .where(and(eq(matters.id, matterId), eq(matters.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new CivilError("NOT_FOUND", "Matter not found.", 404);
  return row;
}

export async function createCivilPleading(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    label: string;
    pleadingType?: string;
    documentId?: string | null;
    filedAt?: Date | null;
    isCurrent?: boolean;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  await requireMatterRow(db, params.organizationId, params.matterId);
  const [created] = await db
    .insert(civilPleadings)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      label: params.label,
      pleadingType: params.pleadingType ?? "complaint",
      documentId: params.documentId ?? null,
      filedAt: params.filedAt ?? null,
      isCurrent: params.isCurrent ?? true,
      provenance: provenanceOf(params.provenance),
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();
  if (!created) throw new CivilError("INSERT_FAILED", "Pleading was not created.", 500);
  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "civil.pleading_created",
    targetType: "civil_pleading",
    targetId: created.id,
  });
  return created;
}

export async function createCivilClaim(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    kind: string;
    category?: string;
    label: string;
    description?: string;
    pleadingId?: string | null;
    supportStatus?: string;
    proceduralStatus?: string;
    isCurrent?: boolean;
    damagesOrRemedy?: { category: string | null; remedySought: string | null; notes: string | null } | null;
    uncertainty?: string[];
    provenance?: RecordProvenance;
    parties?: Array<{ partyEntityId: string; role: string }>;
  },
) {
  await authorizeWrite(db, params);
  await requireMatterRow(db, params.organizationId, params.matterId);
  assertClaimKind(params.kind);
  const supportStatus = params.supportStatus ?? "UNKNOWN";
  const proceduralStatus = params.proceduralStatus ?? "PLED";
  assertSupportStatus(supportStatus);
  assertProceduralStatus(proceduralStatus);

  if (params.pleadingId) {
    const [pleading] = await db
      .select()
      .from(civilPleadings)
      .where(
        and(
          eq(civilPleadings.id, params.pleadingId),
          eq(civilPleadings.matterId, params.matterId),
          eq(civilPleadings.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!pleading) throw new CivilError("NOT_FOUND", "Pleading not found in matter.", 404);
  }

  const [created] = await db
    .insert(civilClaims)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      pleadingId: params.pleadingId ?? null,
      kind: params.kind,
      category: params.category ?? "OTHER",
      label: params.label,
      description: params.description ?? "",
      supportStatus,
      proceduralStatus,
      isCurrent: params.isCurrent ?? true,
      damagesOrRemedy: params.damagesOrRemedy ?? null,
      uncertainty: params.uncertainty ?? [],
      provenance: provenanceOf(params.provenance),
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();
  if (!created) throw new CivilError("INSERT_FAILED", "Claim was not created.", 500);

  for (const party of params.parties ?? []) {
    await addCivilClaimParty(db, {
      userId: params.userId,
      organizationId: params.organizationId,
      matterId: params.matterId,
      claimId: created.id,
      partyEntityId: party.partyEntityId,
      role: party.role,
      skipAuth: true,
    });
  }

  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "civil.claim_created",
    targetType: "civil_claim",
    targetId: created.id,
    metadata: { kind: created.kind },
  });
  return created;
}

export async function createCivilCounterclaim(
  db: Database,
  params: Omit<Parameters<typeof createCivilClaim>[1], "kind"> & { kind?: "COUNTERCLAIM" },
) {
  return createCivilClaim(db, { ...params, kind: "COUNTERCLAIM" });
}

export async function updateCivilClaimStatus(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    claimId: string;
    supportStatus?: string;
    proceduralStatus?: string;
  },
) {
  await authorizeWrite(db, params);
  if (params.supportStatus) assertSupportStatus(params.supportStatus);
  if (params.proceduralStatus) assertProceduralStatus(params.proceduralStatus);
  const [updated] = await db
    .update(civilClaims)
    .set({
      ...(params.supportStatus ? { supportStatus: params.supportStatus } : {}),
      ...(params.proceduralStatus ? { proceduralStatus: params.proceduralStatus } : {}),
      updatedAt: new Date(),
      updatedByUserId: params.userId,
    })
    .where(
      and(
        eq(civilClaims.id, params.claimId),
        eq(civilClaims.matterId, params.matterId),
        eq(civilClaims.organizationId, params.organizationId),
      ),
    )
    .returning();
  if (!updated) throw new CivilError("NOT_FOUND", "Claim not found.", 404);
  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "civil.claim_status_updated",
    targetType: "civil_claim",
    targetId: updated.id,
  });
  return updated;
}

export async function listCivilClaimsByMatter(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    currentOnly?: boolean;
  },
) {
  await authorizeRead(db, params);
  const conditions = [
    eq(civilClaims.organizationId, params.organizationId),
    eq(civilClaims.matterId, params.matterId),
  ];
  if (params.currentOnly !== false) {
    conditions.push(eq(civilClaims.isCurrent, true));
  }
  return db
    .select()
    .from(civilClaims)
    .where(and(...conditions));
}

export async function addCivilClaimParty(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    claimId: string;
    partyEntityId: string;
    role: string;
    skipAuth?: boolean;
  },
) {
  if (!params.skipAuth) await authorizeWrite(db, params);
  assertPartyRole(params.role);
  const [claim] = await db
    .select()
    .from(civilClaims)
    .where(
      and(
        eq(civilClaims.id, params.claimId),
        eq(civilClaims.matterId, params.matterId),
        eq(civilClaims.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!claim) throw new CivilError("NOT_FOUND", "Claim not found.", 404);
  const [entity] = await db
    .select()
    .from(matterEntities)
    .where(
      and(
        eq(matterEntities.id, params.partyEntityId),
        eq(matterEntities.matterId, params.matterId),
        eq(matterEntities.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!entity) throw new CivilError("CROSS_MATTER", "Party entity not in matter.", 403);

  const [created] = await db
    .insert(civilClaimParties)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      claimId: params.claimId,
      partyEntityId: params.partyEntityId,
      role: params.role,
    })
    .returning();
  return created;
}

export async function removeCivilClaimParty(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    claimId: string;
    partyEntityId: string;
    role?: string;
  },
) {
  await authorizeWrite(db, params);
  const conditions = [
    eq(civilClaimParties.claimId, params.claimId),
    eq(civilClaimParties.partyEntityId, params.partyEntityId),
    eq(civilClaimParties.matterId, params.matterId),
    eq(civilClaimParties.organizationId, params.organizationId),
  ];
  if (params.role) conditions.push(eq(civilClaimParties.role, params.role));
  await db.delete(civilClaimParties).where(and(...conditions));
}

export async function addCivilClaimElement(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    claimId?: string | null;
    defenseId?: string | null;
    label: string;
    requirementText?: string | null;
    status?: string;
    sortOrder?: number;
    uncertainty?: string[];
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  const hasClaim = Boolean(params.claimId);
  const hasDefense = Boolean(params.defenseId);
  if (hasClaim === hasDefense) {
    throw new CivilError("INVALID_PARENT", "Element requires exactly one of claimId or defenseId.");
  }
  const status = params.status ?? "UNKNOWN";
  assertSupportStatus(status);

  if (params.claimId) {
    const [claim] = await db
      .select()
      .from(civilClaims)
      .where(
        and(
          eq(civilClaims.id, params.claimId),
          eq(civilClaims.matterId, params.matterId),
          eq(civilClaims.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!claim) throw new CivilError("NOT_FOUND", "Claim not found.", 404);
  }
  if (params.defenseId) {
    const [defense] = await db
      .select()
      .from(civilDefenses)
      .where(
        and(
          eq(civilDefenses.id, params.defenseId),
          eq(civilDefenses.matterId, params.matterId),
          eq(civilDefenses.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!defense) throw new CivilError("NOT_FOUND", "Defense not found.", 404);
  }

  const [created] = await db
    .insert(civilClaimElements)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      claimId: params.claimId ?? null,
      defenseId: params.defenseId ?? null,
      label: params.label,
      requirementText: params.requirementText ?? null,
      status,
      sortOrder: params.sortOrder ?? 0,
      uncertainty: params.uncertainty ?? [],
      provenance: provenanceOf(params.provenance),
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();
  if (!created) throw new CivilError("INSERT_FAILED", "Element was not created.", 500);
  return created;
}

export async function createCivilDefense(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    kind: string;
    label: string;
    description?: string;
    pleadingId?: string | null;
    againstClaimIds: string[];
    assertingPartyIds?: string[];
    targetPartyIds?: string[];
    supportStatus?: string;
    proceduralStatus?: string;
    isCurrent?: boolean;
    uncertainty?: string[];
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  await requireMatterRow(db, params.organizationId, params.matterId);
  assertDefenseKind(params.kind);
  const supportStatus = params.supportStatus ?? "UNKNOWN";
  const proceduralStatus = params.proceduralStatus ?? "PLED";
  assertSupportStatus(supportStatus);
  assertProceduralStatus(proceduralStatus);

  if (params.againstClaimIds.length === 0) {
    throw new CivilError("INVALID_RELATION", "Defense must target at least one claim.");
  }

  const claims = await db
    .select()
    .from(civilClaims)
    .where(
      and(
        inArray(civilClaims.id, params.againstClaimIds),
        eq(civilClaims.matterId, params.matterId),
        eq(civilClaims.organizationId, params.organizationId),
      ),
    );
  if (claims.length !== params.againstClaimIds.length) {
    throw new CivilError("CROSS_MATTER", "Defense cannot target claims outside the matter.", 403);
  }

  const [created] = await db
    .insert(civilDefenses)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      pleadingId: params.pleadingId ?? null,
      kind: params.kind,
      label: params.label,
      description: params.description ?? "",
      supportStatus,
      proceduralStatus,
      isCurrent: params.isCurrent ?? true,
      uncertainty: params.uncertainty ?? [],
      provenance: provenanceOf(params.provenance),
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();
  if (!created) throw new CivilError("INSERT_FAILED", "Defense was not created.", 500);

  for (const claimId of params.againstClaimIds) {
    await db.insert(civilDefenseClaimRelations).values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      defenseId: created.id,
      claimId,
    });
  }
  for (const partyEntityId of params.assertingPartyIds ?? []) {
    await db.insert(civilDefenseParties).values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      defenseId: created.id,
      partyEntityId,
      role: "ASSERTING",
    });
  }
  for (const partyEntityId of params.targetPartyIds ?? []) {
    await db.insert(civilDefenseParties).values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      defenseId: created.id,
      partyEntityId,
      role: "TARGET",
    });
  }

  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "civil.defense_created",
    targetType: "civil_defense",
    targetId: created.id,
  });
  return created;
}

export async function createCivilEvidenceItem(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    label: string;
    documentId?: string | null;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  const [created] = await db
    .insert(civilEvidenceItems)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      label: params.label,
      documentId: params.documentId ?? null,
      provenance: provenanceOf(params.provenance),
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();
  if (!created) throw new CivilError("INSERT_FAILED", "Evidence item was not created.", 500);
  return created;
}

export async function linkCivilEvidence(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    role: string;
    claimId?: string | null;
    elementId?: string | null;
    defenseId?: string | null;
    evidenceId?: string | null;
    partyEntityIds?: string[];
    note?: string | null;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  assertEvidenceRole(params.role);
  const targets = [params.claimId, params.elementId, params.defenseId].filter(Boolean);
  if (targets.length !== 1) {
    throw new CivilError("INVALID_TARGET", "Evidence relation requires exactly one target.");
  }
  if (params.role === "MISSING_EXPECTED") {
    if (!params.note) throw new CivilError("INVALID_MISSING", "MISSING_EXPECTED requires a note.");
  } else if (!params.evidenceId) {
    throw new CivilError("INVALID_EVIDENCE", "Evidence id required for non-missing roles.");
  }

  if (params.evidenceId) {
    const [ev] = await db
      .select()
      .from(civilEvidenceItems)
      .where(
        and(
          eq(civilEvidenceItems.id, params.evidenceId),
          eq(civilEvidenceItems.matterId, params.matterId),
          eq(civilEvidenceItems.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!ev) throw new CivilError("CROSS_MATTER", "Evidence not in matter.", 403);
  }

  const [created] = await db
    .insert(civilEvidenceRelations)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      claimId: params.claimId ?? null,
      elementId: params.elementId ?? null,
      defenseId: params.defenseId ?? null,
      evidenceId: params.evidenceId ?? null,
      role: params.role,
      partyEntityIds: params.partyEntityIds ?? [],
      note: params.note ?? null,
      provenance: provenanceOf(params.provenance),
    })
    .returning();
  return created;
}

export async function unlinkCivilEvidence(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string; relationId: string },
) {
  await authorizeWrite(db, params);
  await db
    .delete(civilEvidenceRelations)
    .where(
      and(
        eq(civilEvidenceRelations.id, params.relationId),
        eq(civilEvidenceRelations.matterId, params.matterId),
        eq(civilEvidenceRelations.organizationId, params.organizationId),
      ),
    );
}

export async function linkCivilFact(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    factId: string;
    role: string;
    claimId?: string | null;
    elementId?: string | null;
    defenseId?: string | null;
    partyEntityIds?: string[];
    note?: string | null;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  assertEvidenceRole(params.role);
  const targets = [params.claimId, params.elementId, params.defenseId].filter(Boolean);
  if (targets.length !== 1) {
    throw new CivilError("INVALID_TARGET", "Fact relation requires exactly one target.");
  }
  const [fact] = await db
    .select()
    .from(matterFacts)
    .where(
      and(
        eq(matterFacts.id, params.factId),
        eq(matterFacts.matterId, params.matterId),
        eq(matterFacts.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!fact) throw new CivilError("CROSS_MATTER", "Fact not in matter.", 403);

  const [created] = await db
    .insert(civilFactRelations)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      claimId: params.claimId ?? null,
      elementId: params.elementId ?? null,
      defenseId: params.defenseId ?? null,
      factId: params.factId,
      role: params.role,
      partyEntityIds: params.partyEntityIds ?? [],
      note: params.note ?? null,
      provenance: provenanceOf(params.provenance),
    })
    .returning();
  return created;
}

export async function linkCivilLegalIssue(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    legalIssueId: string;
    claimId?: string | null;
    elementId?: string | null;
    defenseId?: string | null;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  const targets = [params.claimId, params.elementId, params.defenseId].filter(Boolean);
  if (targets.length !== 1) {
    throw new CivilError("INVALID_TARGET", "Legal issue relation requires exactly one target.");
  }
  const [created] = await db
    .insert(civilLegalIssueRelations)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      claimId: params.claimId ?? null,
      elementId: params.elementId ?? null,
      defenseId: params.defenseId ?? null,
      legalIssueId: params.legalIssueId,
      provenance: provenanceOf(params.provenance),
    })
    .returning();
  return created;
}

export async function linkCivilAuthority(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    authorityId: string;
    relation: string;
    claimId?: string | null;
    elementId?: string | null;
    defenseId?: string | null;
    legalIssueId?: string | null;
    proposition?: string | null;
    sourceSpan?: string | null;
    sourceSupported?: boolean;
    treatment?: string;
    currentness?: string;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  assertAuthorityRelation(params.relation);
  const targets = [params.claimId, params.elementId, params.defenseId, params.legalIssueId].filter(Boolean);
  if (targets.length !== 1) {
    throw new CivilError("INVALID_TARGET", "Authority relation requires exactly one target.");
  }
  const [created] = await db
    .insert(civilAuthorityRelations)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      claimId: params.claimId ?? null,
      elementId: params.elementId ?? null,
      defenseId: params.defenseId ?? null,
      legalIssueId: params.legalIssueId ?? null,
      authorityId: params.authorityId,
      relation: params.relation,
      proposition: params.proposition ?? null,
      sourceSpan: params.sourceSpan ?? null,
      sourceSupported: params.sourceSupported ?? false,
      treatment: params.treatment ?? "UNVERIFIED",
      currentness: params.currentness ?? "unknown",
      provenance: provenanceOf(params.provenance),
    })
    .returning();
  return created;
}

/** Create amended pleading and optionally supersede the prior pleading. */
export async function createAmendedPleading(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    label: string;
    pleadingType?: string;
    documentId?: string | null;
    filedAt?: Date | null;
    supersedesPleadingId: string;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  const [prior] = await db
    .select()
    .from(civilPleadings)
    .where(
      and(
        eq(civilPleadings.id, params.supersedesPleadingId),
        eq(civilPleadings.matterId, params.matterId),
        eq(civilPleadings.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!prior) throw new CivilError("NOT_FOUND", "Prior pleading not found.", 404);

  const amended = await createCivilPleading(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    matterId: params.matterId,
    label: params.label,
    pleadingType: params.pleadingType ?? "amended_complaint",
    documentId: params.documentId,
    filedAt: params.filedAt,
    isCurrent: true,
    provenance: params.provenance,
  });

  await db
    .update(civilPleadings)
    .set({
      isCurrent: false,
      supersededById: amended.id,
      updatedAt: new Date(),
      updatedByUserId: params.userId,
    })
    .where(eq(civilPleadings.id, prior.id));

  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "civil.pleading_amended",
    targetType: "civil_pleading",
    targetId: amended.id,
    metadata: { supersedesPleadingId: prior.id },
  });
  return { amended, prior };
}

/** Supersede an existing claim with a new current claim (amendment). Historical row retained. */
export async function supersedeCivilClaim(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    matterId: string;
    priorClaimId: string;
    label: string;
    kind?: string;
    category?: string;
    description?: string;
    pleadingId?: string | null;
    supportStatus?: string;
    proceduralStatus?: string;
    parties?: Array<{ partyEntityId: string; role: string }>;
    provenance?: RecordProvenance;
  },
) {
  await authorizeWrite(db, params);
  const [prior] = await db
    .select()
    .from(civilClaims)
    .where(
      and(
        eq(civilClaims.id, params.priorClaimId),
        eq(civilClaims.matterId, params.matterId),
        eq(civilClaims.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!prior) throw new CivilError("NOT_FOUND", "Prior claim not found.", 404);

  const replacement = await createCivilClaim(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    matterId: params.matterId,
    kind: params.kind ?? prior.kind,
    category: params.category ?? prior.category,
    label: params.label,
    description: params.description ?? prior.description,
    pleadingId: params.pleadingId ?? prior.pleadingId,
    supportStatus: params.supportStatus ?? prior.supportStatus,
    proceduralStatus: params.proceduralStatus ?? "AMENDED",
    isCurrent: true,
    parties: params.parties,
    provenance: params.provenance,
  });

  await db
    .update(civilClaims)
    .set({
      isCurrent: false,
      proceduralStatus: "SUPERSEDED",
      supersededById: replacement.id,
      updatedAt: new Date(),
      updatedByUserId: params.userId,
    })
    .where(eq(civilClaims.id, prior.id));

  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "civil.claim_superseded",
    targetType: "civil_claim",
    targetId: replacement.id,
    metadata: { priorClaimId: prior.id },
  });
  return { replacement, prior };
}

export async function assertCivilTenantSafe(
  expected: { organizationId: string; matterId: string },
  actual: { organizationId: string; matterId: string },
) {
  assertSameOrg(expected.organizationId, actual.organizationId);
  assertSameMatter(expected.matterId, actual.matterId);
}
