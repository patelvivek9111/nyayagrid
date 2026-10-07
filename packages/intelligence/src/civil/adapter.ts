/**
 * Persist / load adapters between the validated civil prototype shape and DB rows.
 * Does not invent liability conclusions.
 */

import { and, eq } from "drizzle-orm";
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
  legalAuthorities,
  legalIssues,
  legalStandards,
  matterEntities,
  matterFacts,
  type Database,
  type RecordProvenance,
} from "@nyayagrid/database";
import { requireMatterAccess } from "@nyayagrid/permissions";
import {
  type CivilAuthorityLink,
  type CivilClaim,
  type CivilClaimElement,
  type CivilClaimsReview,
  type CivilDefense,
  type CivilElementStatus,
  type CivilEvidenceItem,
  type CivilEvidenceRelation,
  type CivilEvidenceRole,
  type CivilFact,
  type CivilFactRelation,
  type CivilParty,
  type CivilPartyRole,
  type CivilPleading,
  type CivilSourceProvenance,
  type CivilStandardLink,
} from "./claims-model";
import { CivilError } from "./domain";

function toAppProvenance(p: RecordProvenance | null | undefined, pleadingId: string | null = null): CivilSourceProvenance {
  const origin = p?.extractionOrigin;
  const extractionOrigin: CivilSourceProvenance["extractionOrigin"] =
    origin === "deterministic_fixture"
      ? "deterministic_fixture"
      : origin === "source_metadata"
        ? "source_metadata"
        : "user_entry";
  return {
    documentId: p?.documentId ?? null,
    sourceSpan: p?.sourceSpan ?? null,
    sourcePage: p?.sourcePage ?? null,
    pleadingId,
    humanEntered: p?.humanEntered ?? false,
    extractionOrigin,
  };
}

function toDbProvenance(p: CivilSourceProvenance): RecordProvenance {
  return {
    documentId: p.documentId,
    sourceSpan: p.sourceSpan,
    sourcePage: p.sourcePage,
    humanEntered: p.humanEntered,
    extractionOrigin: p.extractionOrigin === "deterministic_fixture" ? "deterministic_fixture" : p.extractionOrigin === "source_metadata" ? "source_metadata" : "human",
  };
}

function mapEvidenceRelations(
  rows: Array<{
    evidenceId: string | null;
    role: string;
    partyEntityIds: string[] | null;
    note: string | null;
  }>,
): { supporting: CivilEvidenceRelation[]; contrary: CivilEvidenceRelation[]; missing: Array<{ id: string; description: string }>; all: CivilEvidenceRelation[] } {
  const supporting: CivilEvidenceRelation[] = [];
  const contrary: CivilEvidenceRelation[] = [];
  const missing: Array<{ id: string; description: string }> = [];
  const all: CivilEvidenceRelation[] = [];
  for (const row of rows) {
    if (row.role === "MISSING_EXPECTED") {
      missing.push({ id: row.evidenceId ?? `missing-${missing.length}`, description: row.note ?? "" });
      continue;
    }
    if (!row.evidenceId) continue;
    const rel: CivilEvidenceRelation = {
      evidenceId: row.evidenceId,
      role: row.role as CivilEvidenceRole,
      partyIds: row.partyEntityIds ?? [],
      note: row.note,
    };
    all.push(rel);
    if (row.role === "SUPPORTS" || row.role === "CORROBORATES") supporting.push(rel);
    if (row.role === "UNDERMINES" || row.role === "CONTRADICTS") contrary.push(rel);
  }
  return { supporting, contrary, missing, all };
}

function mapFactRelations(
  rows: Array<{ factId: string; role: string; partyEntityIds: string[] | null; note: string | null }>,
): CivilFactRelation[] {
  return rows.map((row) => ({
    factId: row.factId,
    role: row.role as CivilEvidenceRole,
    partyIds: row.partyEntityIds ?? [],
    note: row.note,
  }));
}

export async function loadCivilClaimsReview(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string },
): Promise<CivilClaimsReview> {
  await requireMatterAccess(db, {
    userId: params.userId,
    matterId: params.matterId,
    minAccess: "read",
    capability: "matters.view",
  });

  const scope = and(
    eq(civilClaims.organizationId, params.organizationId),
    eq(civilClaims.matterId, params.matterId),
  );

  const [pleadings, claims, defenses, parties, entities, facts, evidenceItems, elements] =
    await Promise.all([
      db
        .select()
        .from(civilPleadings)
        .where(
          and(
            eq(civilPleadings.organizationId, params.organizationId),
            eq(civilPleadings.matterId, params.matterId),
          ),
        ),
      db.select().from(civilClaims).where(scope),
      db
        .select()
        .from(civilDefenses)
        .where(
          and(
            eq(civilDefenses.organizationId, params.organizationId),
            eq(civilDefenses.matterId, params.matterId),
          ),
        ),
      db
        .select()
        .from(civilClaimParties)
        .where(
          and(
            eq(civilClaimParties.organizationId, params.organizationId),
            eq(civilClaimParties.matterId, params.matterId),
          ),
        ),
      db
        .select()
        .from(matterEntities)
        .where(
          and(
            eq(matterEntities.organizationId, params.organizationId),
            eq(matterEntities.matterId, params.matterId),
          ),
        ),
      db
        .select()
        .from(matterFacts)
        .where(
          and(
            eq(matterFacts.organizationId, params.organizationId),
            eq(matterFacts.matterId, params.matterId),
          ),
        ),
      db
        .select()
        .from(civilEvidenceItems)
        .where(
          and(
            eq(civilEvidenceItems.organizationId, params.organizationId),
            eq(civilEvidenceItems.matterId, params.matterId),
          ),
        ),
      db
        .select()
        .from(civilClaimElements)
        .where(
          and(
            eq(civilClaimElements.organizationId, params.organizationId),
            eq(civilClaimElements.matterId, params.matterId),
          ),
        ),
    ]);

  const [
    defenseClaimRels,
    defenseParties,
    evidenceRels,
    factRels,
    issueRels,
    authorityRels,
    standardRels,
    issueRows,
    authorityRows,
    standardRows,
  ] = await Promise.all([
    db
      .select()
      .from(civilDefenseClaimRelations)
      .where(
        and(
          eq(civilDefenseClaimRelations.organizationId, params.organizationId),
          eq(civilDefenseClaimRelations.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(civilDefenseParties)
      .where(
        and(
          eq(civilDefenseParties.organizationId, params.organizationId),
          eq(civilDefenseParties.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(civilEvidenceRelations)
      .where(
        and(
          eq(civilEvidenceRelations.organizationId, params.organizationId),
          eq(civilEvidenceRelations.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(civilFactRelations)
      .where(
        and(
          eq(civilFactRelations.organizationId, params.organizationId),
          eq(civilFactRelations.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(civilLegalIssueRelations)
      .where(
        and(
          eq(civilLegalIssueRelations.organizationId, params.organizationId),
          eq(civilLegalIssueRelations.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(civilAuthorityRelations)
      .where(
        and(
          eq(civilAuthorityRelations.organizationId, params.organizationId),
          eq(civilAuthorityRelations.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(civilStandardRelations)
      .where(
        and(
          eq(civilStandardRelations.organizationId, params.organizationId),
          eq(civilStandardRelations.matterId, params.matterId),
        ),
      ),
    db
      .select()
      .from(legalIssues)
      .where(
        and(
          eq(legalIssues.organizationId, params.organizationId),
          eq(legalIssues.matterId, params.matterId),
        ),
      ),
    db.select().from(legalAuthorities),
    db
      .select()
      .from(legalStandards)
      .where(eq(legalStandards.organizationId, params.organizationId)),
  ]);

  const authorityById = new Map(authorityRows.map((a) => [a.id, a]));
  const standardById = new Map(standardRows.map((s) => [s.id, s]));

  const priorBySuperseded = new Map<string, string>();
  for (const claim of claims) {
    if (claim.supersededById) priorBySuperseded.set(claim.supersededById, claim.id);
  }

  const buildAuthorities = (
    target: "claim" | "element" | "defense" | "legal_issue",
    targetId: string,
  ): CivilAuthorityLink[] =>
    authorityRels
      .filter((row) => {
        if (target === "claim") return row.claimId === targetId;
        if (target === "element") return row.elementId === targetId;
        if (target === "defense") return row.defenseId === targetId;
        return row.legalIssueId === targetId;
      })
      .map((row) => {
        const auth = authorityById.get(row.authorityId);
        return {
          authorityId: row.authorityId,
          citation: auth?.citation ?? null,
          title: auth?.title ?? null,
          relation: row.relation as CivilAuthorityLink["relation"],
          treatment: (row.treatment === "VERIFIED" ? "VERIFIED" : "UNVERIFIED") as "VERIFIED" | "UNVERIFIED",
          currentness: row.currentness,
          proposition: row.proposition,
          sourceSpan: row.sourceSpan,
          sourceSupported: row.sourceSupported,
          target,
          targetId,
        };
      });

  const buildStandards = (
    target: "claim" | "element" | "defense",
    targetId: string,
  ): CivilStandardLink[] =>
    standardRels
      .filter((row) => {
        if (target === "claim") return row.claimId === targetId;
        if (target === "element") return row.elementId === targetId;
        return row.defenseId === targetId;
      })
      .map((row) => {
        const std = standardById.get(row.standardId);
        return {
          id: row.standardId,
          label: std?.ruleText?.slice(0, 80) ?? row.standardId,
          standardType: (std?.standardType as CivilStandardLink["standardType"]) ?? "OTHER",
          text: std?.ruleText ?? null,
          sourceSpan: std?.sourceSpan ?? null,
          target,
          targetId,
        };
      });

  const buildElement = (el: (typeof elements)[number]): CivilClaimElement => {
    const parentId = el.claimId ?? el.defenseId!;
    const ev = mapEvidenceRelations(
      evidenceRels.filter((r) => r.elementId === el.id),
    );
    return {
      id: el.id,
      claimId: parentId,
      label: el.label,
      requirementText: el.requirementText ?? "",
      status: el.status as CivilElementStatus,
      supportingEvidence: ev.supporting,
      contraryEvidence: ev.contrary,
      missingEvidence: ev.missing,
      factRelations: mapFactRelations(factRels.filter((r) => r.elementId === el.id)),
      authorities: buildAuthorities("element", el.id),
      standards: buildStandards("element", el.id),
      uncertainty: el.uncertainty ?? [],
      provenance: toAppProvenance(el.provenance),
    };
  };

  const appParties: CivilParty[] = entities.map((e) => ({
    id: e.id,
    displayName: e.displayName,
    entityType: e.entityType,
  }));

  const appPleadings: CivilPleading[] = pleadings.map((p) => {
    const supersedes = pleadings.find((x) => x.supersededById === p.id);
    return {
      id: p.id,
      label: p.label,
      filedAt: p.filedAt ? p.filedAt.toISOString() : null,
      supersededByPleadingId: p.supersededById,
      supersedesPleadingId: supersedes?.id ?? null,
      isCurrent: p.isCurrent,
      provenance: toAppProvenance(p.provenance, p.id),
    };
  });

  const appFacts: CivilFact[] = facts.map((f) => ({
    id: f.id,
    text: f.value,
    relatedPartyIds: [],
    provenance: toAppProvenance(null),
  }));

  const appEvidence: CivilEvidenceItem[] = evidenceItems.map((e) => ({
    id: e.id,
    label: e.label,
    documentId: e.documentId,
    relatedPartyIds: [],
    provenance: toAppProvenance(e.provenance),
  }));

  const appClaims: CivilClaim[] = claims.map((claim) => {
    const claimParties = parties
      .filter((p) => p.claimId === claim.id)
      .map((p) => ({ partyId: p.partyEntityId, role: p.role as CivilPartyRole }));
    const claimElements = elements.filter((e) => e.claimId === claim.id).map(buildElement);
    const legalIssueIds = issueRels.filter((r) => r.claimId === claim.id).map((r) => r.legalIssueId);
    return {
      id: claim.id,
      kind: claim.kind as CivilClaim["kind"],
      category: claim.category as CivilClaim["category"],
      label: claim.label,
      description: claim.description,
      parties: claimParties,
      supportStatus: claim.supportStatus as CivilElementStatus,
      proceduralStatus: claim.proceduralStatus as CivilClaim["proceduralStatus"],
      pleadingId: claim.pleadingId ?? "",
      supersededByClaimId: claim.supersededById,
      supersedesClaimId: priorBySuperseded.get(claim.id) ?? null,
      isCurrent: claim.isCurrent,
      elements: claimElements,
      legalIssueIds,
      authorities: buildAuthorities("claim", claim.id),
      standards: buildStandards("claim", claim.id),
      damagesOrRemedy: claim.damagesOrRemedy,
      uncertainty: claim.uncertainty ?? [],
      provenance: toAppProvenance(claim.provenance, claim.pleadingId),
      liabilityConclusion: null,
    };
  });

  const appDefenses: CivilDefense[] = defenses.map((defense) => {
    const againstClaimIds = defenseClaimRels
      .filter((r) => r.defenseId === defense.id)
      .map((r) => r.claimId);
    const assertingPartyIds = defenseParties
      .filter((r) => r.defenseId === defense.id && r.role === "ASSERTING")
      .map((r) => r.partyEntityId);
    const targetPartyIds = defenseParties
      .filter((r) => r.defenseId === defense.id && r.role === "TARGET")
      .map((r) => r.partyEntityId);
    const defenseElements = elements.filter((e) => e.defenseId === defense.id).map(buildElement);
    const ev = mapEvidenceRelations(evidenceRels.filter((r) => r.defenseId === defense.id));
    return {
      id: defense.id,
      kind: defense.kind as CivilDefense["kind"],
      label: defense.label,
      description: defense.description,
      againstClaimIds,
      assertingPartyIds,
      targetPartyIds,
      supportStatus: defense.supportStatus as CivilElementStatus,
      proceduralStatus: defense.proceduralStatus as CivilDefense["proceduralStatus"],
      pleadingId: defense.pleadingId ?? "",
      isCurrent: defense.isCurrent,
      elements: defenseElements,
      evidence: ev.all,
      factRelations: mapFactRelations(factRels.filter((r) => r.defenseId === defense.id)),
      authorities: buildAuthorities("defense", defense.id),
      standards: buildStandards("defense", defense.id),
      legalIssueIds: issueRels.filter((r) => r.defenseId === defense.id).map((r) => r.legalIssueId),
      uncertainty: defense.uncertainty ?? [],
      provenance: toAppProvenance(defense.provenance, defense.pleadingId),
      validityConclusion: null,
    };
  });

  const legalIssueLinks = issueRows.map((issue) => ({
    issueId: issue.id,
    label: issue.description,
    claimIds: issueRels.filter((r) => r.legalIssueId === issue.id && r.claimId).map((r) => r.claimId!),
    defenseIds: issueRels
      .filter((r) => r.legalIssueId === issue.id && r.defenseId)
      .map((r) => r.defenseId!),
  }));

  return {
    matterId: params.matterId,
    organizationId: params.organizationId,
    jurisdiction: null,
    forumCourtId: null,
    parties: appParties,
    pleadings: appPleadings,
    facts: appFacts,
    evidence: appEvidence,
    claims: appClaims,
    defenses: appDefenses,
    legalIssues: legalIssueLinks,
    theories: [],
    coverageWarnings: [],
    liabilityConclusion: null,
    outcomeConclusion: null,
  };
}

/** Persist a prototype CivilClaimsReview into DB (ids preserved when valid UUIDs). */
export async function persistCivilClaimsReview(
  db: Database,
  params: {
    userId: string;
    review: CivilClaimsReview;
    idMap?: Map<string, string>;
  },
): Promise<{ idMap: Map<string, string> }> {
  await requireMatterAccess(db, {
    userId: params.userId,
    matterId: params.review.matterId,
    minAccess: "edit",
    capability: "matters.edit",
  });

  const { review } = params;
  const idMap = params.idMap ?? new Map<string, string>();
  const mapId = (protoId: string, dbId: string) => {
    idMap.set(protoId, dbId);
    return dbId;
  };
  const resolve = (protoId: string) => idMap.get(protoId) ?? protoId;

  for (const party of review.parties) {
    if (idMap.has(party.id)) continue;
    const [row] = await db
      .insert(matterEntities)
      .values({
        organizationId: review.organizationId,
        matterId: review.matterId,
        entityType: party.entityType,
        displayName: party.displayName,
        normalizedName: party.displayName.toLowerCase(),
        status: "approved",
        origin: "manual",
        createdByUserId: params.userId,
      })
      .returning();
    if (!row) throw new CivilError("INSERT_FAILED", "Party entity insert failed.", 500);
    mapId(party.id, row.id);
  }

  for (const pleading of review.pleadings) {
    const [row] = await db
      .insert(civilPleadings)
      .values({
        organizationId: review.organizationId,
        matterId: review.matterId,
        label: pleading.label,
        pleadingType: pleading.label.toLowerCase().includes("answer")
          ? "answer"
          : pleading.label.toLowerCase().includes("amended")
            ? "amended_complaint"
            : "complaint",
        filedAt: pleading.filedAt ? new Date(pleading.filedAt) : null,
        isCurrent: pleading.isCurrent,
        provenance: toDbProvenance(pleading.provenance),
        createdByUserId: params.userId,
        updatedByUserId: params.userId,
      })
      .returning();
    if (!row) throw new CivilError("INSERT_FAILED", "Pleading insert failed.", 500);
    mapId(pleading.id, row.id);
  }

  // Second pass: pleading supersession links
  for (const pleading of review.pleadings) {
    if (!pleading.supersededByPleadingId) continue;
    await db
      .update(civilPleadings)
      .set({
        supersededById: resolve(pleading.supersededByPleadingId),
        isCurrent: false,
        updatedAt: new Date(),
      })
      .where(eq(civilPleadings.id, resolve(pleading.id)));
  }

  for (const fact of review.facts) {
    const [row] = await db
      .insert(matterFacts)
      .values({
        organizationId: review.organizationId,
        matterId: review.matterId,
        factKey: `civil_${fact.id}`,
        label: fact.text.slice(0, 80),
        value: fact.text,
        status: "approved",
        origin: "manual",
        createdByUserId: params.userId,
      })
      .returning();
    if (!row) throw new CivilError("INSERT_FAILED", "Fact insert failed.", 500);
    mapId(fact.id, row.id);
  }

  for (const evidence of review.evidence) {
    const [row] = await db
      .insert(civilEvidenceItems)
      .values({
        organizationId: review.organizationId,
        matterId: review.matterId,
        label: evidence.label,
        documentId: null,
        provenance: toDbProvenance(evidence.provenance),
        createdByUserId: params.userId,
        updatedByUserId: params.userId,
      })
      .returning();
    if (!row) throw new CivilError("INSERT_FAILED", "Evidence insert failed.", 500);
    mapId(evidence.id, row.id);
  }

  for (const issue of review.legalIssues) {
    const [row] = await db
      .insert(legalIssues)
      .values({
        organizationId: review.organizationId,
        matterId: review.matterId,
        issueType: "civil",
        description: issue.label,
        provenance: { humanEntered: true, extractionOrigin: "deterministic_fixture" },
      })
      .returning();
    if (!row) throw new CivilError("INSERT_FAILED", "Legal issue insert failed.", 500);
    mapId(issue.issueId, row.id);
  }

  // Claims: insert historical first so supersession can link
  const orderedClaims = [...review.claims].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  for (const claim of orderedClaims.filter((c) => !c.isCurrent)) {
    await insertClaim(db, params.userId, review, claim, resolve, mapId);
  }
  for (const claim of orderedClaims.filter((c) => c.isCurrent)) {
    await insertClaim(db, params.userId, review, claim, resolve, mapId);
  }

  for (const claim of review.claims) {
    if (!claim.supersededByClaimId) continue;
    await db
      .update(civilClaims)
      .set({
        supersededById: resolve(claim.supersededByClaimId),
        isCurrent: false,
        proceduralStatus: "SUPERSEDED",
        updatedAt: new Date(),
      })
      .where(eq(civilClaims.id, resolve(claim.id)));
  }

  for (const defense of review.defenses) {
    await insertDefense(db, params.userId, review, defense, resolve, mapId);
  }

  return { idMap };
}

async function insertClaim(
  db: Database,
  userId: string,
  review: CivilClaimsReview,
  claim: CivilClaim,
  resolve: (id: string) => string,
  mapId: (proto: string, dbId: string) => string,
) {
  const [row] = await db
    .insert(civilClaims)
    .values({
      organizationId: review.organizationId,
      matterId: review.matterId,
      pleadingId: claim.pleadingId ? resolve(claim.pleadingId) : null,
      kind: claim.kind,
      category: claim.category,
      label: claim.label,
      description: claim.description,
      supportStatus: claim.supportStatus,
      proceduralStatus: claim.proceduralStatus,
      isCurrent: claim.isCurrent,
      damagesOrRemedy: claim.damagesOrRemedy,
      uncertainty: claim.uncertainty,
      provenance: toDbProvenance(claim.provenance),
      createdByUserId: userId,
      updatedByUserId: userId,
    })
    .returning();
  if (!row) throw new CivilError("INSERT_FAILED", "Claim insert failed.", 500);
  mapId(claim.id, row.id);

  for (const party of claim.parties) {
    await db.insert(civilClaimParties).values({
      organizationId: review.organizationId,
      matterId: review.matterId,
      claimId: row.id,
      partyEntityId: resolve(party.partyId),
      role: party.role,
    });
  }

  for (const issueId of claim.legalIssueIds) {
    await db.insert(civilLegalIssueRelations).values({
      organizationId: review.organizationId,
      matterId: review.matterId,
      claimId: row.id,
      legalIssueId: resolve(issueId),
      provenance: toDbProvenance(claim.provenance),
    });
  }

  for (const auth of claim.authorities) {
    await insertAuthorityLink(db, review, auth, { claimId: row.id }, resolve);
  }

  for (const [index, element] of claim.elements.entries()) {
    await insertElement(db, userId, review, element, { claimId: row.id }, index, resolve, mapId);
  }
}

async function insertDefense(
  db: Database,
  userId: string,
  review: CivilClaimsReview,
  defense: CivilDefense,
  resolve: (id: string) => string,
  mapId: (proto: string, dbId: string) => string,
) {
  const [row] = await db
    .insert(civilDefenses)
    .values({
      organizationId: review.organizationId,
      matterId: review.matterId,
      pleadingId: defense.pleadingId ? resolve(defense.pleadingId) : null,
      kind: defense.kind,
      label: defense.label,
      description: defense.description,
      supportStatus: defense.supportStatus,
      proceduralStatus: defense.proceduralStatus,
      isCurrent: defense.isCurrent,
      uncertainty: defense.uncertainty,
      provenance: toDbProvenance(defense.provenance),
      createdByUserId: userId,
      updatedByUserId: userId,
    })
    .returning();
  if (!row) throw new CivilError("INSERT_FAILED", "Defense insert failed.", 500);
  mapId(defense.id, row.id);

  for (const claimId of defense.againstClaimIds) {
    await db.insert(civilDefenseClaimRelations).values({
      organizationId: review.organizationId,
      matterId: review.matterId,
      defenseId: row.id,
      claimId: resolve(claimId),
    });
  }
  for (const partyId of defense.assertingPartyIds) {
    await db.insert(civilDefenseParties).values({
      organizationId: review.organizationId,
      matterId: review.matterId,
      defenseId: row.id,
      partyEntityId: resolve(partyId),
      role: "ASSERTING",
    });
  }
  for (const partyId of defense.targetPartyIds) {
    await db.insert(civilDefenseParties).values({
      organizationId: review.organizationId,
      matterId: review.matterId,
      defenseId: row.id,
      partyEntityId: resolve(partyId),
      role: "TARGET",
    });
  }
  for (const issueId of defense.legalIssueIds) {
    await db.insert(civilLegalIssueRelations).values({
      organizationId: review.organizationId,
      matterId: review.matterId,
      defenseId: row.id,
      legalIssueId: resolve(issueId),
      provenance: toDbProvenance(defense.provenance),
    });
  }
  for (const auth of defense.authorities) {
    await insertAuthorityLink(db, review, auth, { defenseId: row.id }, resolve);
  }
  for (const rel of defense.evidence) {
    await db.insert(civilEvidenceRelations).values({
      organizationId: review.organizationId,
      matterId: review.matterId,
      defenseId: row.id,
      evidenceId: resolve(rel.evidenceId),
      role: rel.role,
      partyEntityIds: rel.partyIds.map(resolve),
      note: rel.note,
      provenance: toDbProvenance(defense.provenance),
    });
  }
  for (const rel of defense.factRelations) {
    await db.insert(civilFactRelations).values({
      organizationId: review.organizationId,
      matterId: review.matterId,
      defenseId: row.id,
      factId: resolve(rel.factId),
      role: rel.role,
      partyEntityIds: rel.partyIds.map(resolve),
      note: rel.note,
      provenance: toDbProvenance(defense.provenance),
    });
  }
  for (const [index, element] of defense.elements.entries()) {
    await insertElement(db, userId, review, element, { defenseId: row.id }, index, resolve, mapId);
  }
}

async function insertElement(
  db: Database,
  userId: string,
  review: CivilClaimsReview,
  element: CivilClaimElement,
  parent: { claimId?: string; defenseId?: string },
  sortOrder: number,
  resolve: (id: string) => string,
  mapId: (proto: string, dbId: string) => string,
) {
  const [row] = await db
    .insert(civilClaimElements)
    .values({
      organizationId: review.organizationId,
      matterId: review.matterId,
      claimId: parent.claimId ?? null,
      defenseId: parent.defenseId ?? null,
      label: element.label,
      requirementText: element.requirementText,
      status: element.status,
      sortOrder,
      uncertainty: element.uncertainty,
      provenance: toDbProvenance(element.provenance),
      createdByUserId: userId,
      updatedByUserId: userId,
    })
    .returning();
  if (!row) throw new CivilError("INSERT_FAILED", "Element insert failed.", 500);
  mapId(element.id, row.id);

  for (const rel of [...element.supportingEvidence, ...element.contraryEvidence]) {
    await db.insert(civilEvidenceRelations).values({
      organizationId: review.organizationId,
      matterId: review.matterId,
      elementId: row.id,
      evidenceId: resolve(rel.evidenceId),
      role: rel.role,
      partyEntityIds: rel.partyIds.map(resolve),
      note: rel.note,
      provenance: toDbProvenance(element.provenance),
    });
  }
  for (const missing of element.missingEvidence) {
    await db.insert(civilEvidenceRelations).values({
      organizationId: review.organizationId,
      matterId: review.matterId,
      elementId: row.id,
      evidenceId: null,
      role: "MISSING_EXPECTED",
      partyEntityIds: [],
      note: missing.description,
      provenance: toDbProvenance(element.provenance),
    });
  }
  for (const rel of element.factRelations) {
    await db.insert(civilFactRelations).values({
      organizationId: review.organizationId,
      matterId: review.matterId,
      elementId: row.id,
      factId: resolve(rel.factId),
      role: rel.role,
      partyEntityIds: rel.partyIds.map(resolve),
      note: rel.note,
      provenance: toDbProvenance(element.provenance),
    });
  }
  for (const auth of element.authorities) {
    await insertAuthorityLink(db, review, auth, { elementId: row.id }, resolve);
  }
}

async function insertAuthorityLink(
  db: Database,
  review: CivilClaimsReview,
  auth: CivilAuthorityLink,
  target: { claimId?: string; elementId?: string; defenseId?: string; legalIssueId?: string },
  resolve: (id: string) => string,
) {
  // Authorities in the fixture are synthetic string ids — skip if not UUID in legal_authorities.
  // Service-layer tests insert real authorities; D3 persist path stores proposition metadata only when authority exists.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const authorityId = resolve(auth.authorityId);
  if (!uuidRe.test(authorityId)) return;

  await db.insert(civilAuthorityRelations).values({
    organizationId: review.organizationId,
    matterId: review.matterId,
    claimId: target.claimId ?? null,
    elementId: target.elementId ?? null,
    defenseId: target.defenseId ?? null,
    legalIssueId: target.legalIssueId ?? null,
    authorityId,
    relation: auth.relation,
    proposition: auth.proposition,
    sourceSpan: auth.sourceSpan,
    sourceSupported: auth.sourceSupported,
    treatment: auth.treatment,
    currentness: auth.currentness,
    provenance: {
      humanEntered: true,
      extractionOrigin: "deterministic_fixture",
      sourceSpan: auth.sourceSpan,
    },
  });
}
