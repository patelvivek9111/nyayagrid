import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  matters,
  matterMembers,
  memberships,
  users,
} from "@nyayagrid/database";
import { AuthorizationError } from "@nyayagrid/permissions";
import {
  addCivilClaimElement,
  addCivilClaimParty,
  buildCivilClaimMatrix,
  buildCivilWholeMatterView,
  createAmendedPleading,
  createCivilClaim,
  createCivilCounterclaim,
  createCivilDefense,
  createCivilEvidenceItem,
  createCivilPleading,
  CivilError,
  linkCivilEvidence,
  linkCivilFact,
  listCivilClaimsByMatter,
  loadCivilClaimsReview,
  persistCivilClaimsReview,
  runComplexCivilClaimsFixture,
  supersedeCivilClaim,
  updateCivilClaimStatus,
} from "@nyayagrid/intelligence";
import { and, eq } from "@nyayagrid/database";
import { matterEntities, matterFacts, civilClaims, civilPleadings } from "@nyayagrid/database";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const provenance = { extractionOrigin: "human" as const, humanEntered: true };

describe.runIf(runDbTests)("civil claims schema integration", () => {
  const db = createDb(
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  );
  const suffix = Date.now().toString(36);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `civil_owner_${suffix}`,
        email: `civil_owner_${suffix}@example.nyayagrid.local`,
        name: "Civil Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `civil_out_${suffix}`,
        email: `civil_out_${suffix}@example.nyayagrid.local`,
        name: "Outsider",
      })
      .returning();
    const [guest] = await db
      .insert(users)
      .values({
        authSubject: `civil_guest_${suffix}`,
        email: `civil_guest_${suffix}@example.nyayagrid.local`,
        name: "Guest",
      })
      .returning();
    ids.owner = owner!.id;
    ids.outsider = outsider!.id;
    ids.guest = guest!.id;

    const orgA = await createOrganizationWithDefaults(db, {
      name: `Civil A ${suffix}`,
      slug: `civil-a-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    const orgB = await createOrganizationWithDefaults(db, {
      name: `Civil B ${suffix}`,
      slug: `civil-b-${suffix}`,
      type: "firm",
      ownerUserId: ids.outsider!,
    });
    ids.orgA = orgA.organization.id;
    ids.orgB = orgB.organization.id;

    const guestRoleId = orgA.roleIdByKey.get("client_guest");
    if (guestRoleId) {
      await db.insert(memberships).values({
        organizationId: ids.orgA!,
        userId: ids.guest!,
        roleId: guestRoleId,
        status: "active",
      });
    }

    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgA!,
        clientType: "organization",
        displayName: "River Supply",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgB!,
        clientType: "organization",
        displayName: "Other Client",
        createdByUserId: ids.outsider!,
      })
      .returning();

    const [matterA] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgA!,
        clientId: clientA!.id,
        matterNumber: `CIV-${suffix}`,
        title: "Civil Schema Matter A",
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [matterB] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgB!,
        clientId: clientB!.id,
        matterNumber: `CIVB-${suffix}`,
        title: "Civil Schema Matter B",
        status: "open",
        createdByUserId: ids.outsider!,
      })
      .returning();
    ids.matterA = matterA!.id;
    ids.matterB = matterB!.id;

    if (guestRoleId) {
      await db.insert(matterMembers).values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        userId: ids.guest!,
        access: "read",
      });
    }

    const [plaintiff] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        entityType: "organization",
        displayName: "River Supply Co",
        normalizedName: "river supply co",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [defendant] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        entityType: "organization",
        displayName: "Acme Parts",
        normalizedName: "acme parts",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [defendant2] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        entityType: "organization",
        displayName: "Beta Logistics",
        normalizedName: "beta logistics",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.plaintiff = plaintiff!.id;
    ids.defendant = defendant!.id;
    ids.defendant2 = defendant2!.id;

    const [fact] = await db
      .insert(matterFacts)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        factKey: `notice_${suffix}`,
        label: "Cure notice sent",
        value: "River sent a cure notice on the recorded date.",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.fact = fact!.id;
  });

  afterAll(async () => {
    await closeDb(db);
  });

  it("has civil tables and isolation indexes", async () => {
    const tables = await db.execute(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name like 'civil_%'
      order by table_name
    `);
    const names = (tables as unknown as Array<{ table_name: string }>).map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "civil_pleadings",
        "civil_claims",
        "civil_claim_parties",
        "civil_claim_elements",
        "civil_defenses",
        "civil_defense_claim_relations",
        "civil_defense_parties",
        "civil_evidence_items",
        "civil_evidence_relations",
        "civil_fact_relations",
        "civil_legal_issue_relations",
        "civil_authority_relations",
        "civil_standard_relations",
      ]),
    );
    const chk = await db.execute(sql`
      select conname from pg_constraint where conname = 'civil_claims_support_status_chk'
    `);
    expect((chk as unknown as unknown[]).length).toBe(1);
  });

  it("creates claims, counterclaims, defenses, elements, and relations with multi-party scope", async () => {
    const pleading = await createCivilPleading(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      label: "Complaint",
      pleadingType: "complaint",
      provenance,
    });
    ids.pleading = pleading.id;

    const claim = await createCivilClaim(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "CLAIM",
      category: "CONTRACT",
      label: "Breach of contract",
      pleadingId: pleading.id,
      supportStatus: "PARTIALLY_SUPPORTED",
      proceduralStatus: "PLED",
      parties: [
        { partyEntityId: ids.plaintiff!, role: "PLAINTIFF" },
        { partyEntityId: ids.defendant!, role: "DEFENDANT" },
        { partyEntityId: ids.defendant2!, role: "DEFENDANT" },
      ],
      provenance,
    });
    ids.claim = claim.id;

    const element = await addCivilClaimElement(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      claimId: claim.id,
      label: "Breach",
      requirementText: "Defendant failed to perform.",
      status: "PARTIALLY_SUPPORTED",
      provenance,
    });
    ids.element = element.id;

    const evidence = await createCivilEvidenceItem(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      label: "Cure notice letter",
      provenance,
    });
    ids.evidence = evidence.id;

    await linkCivilEvidence(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      elementId: element.id,
      evidenceId: evidence.id,
      role: "SUPPORTS",
      partyEntityIds: [],
      provenance,
    });
    await linkCivilEvidence(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      elementId: element.id,
      evidenceId: evidence.id,
      role: "UNDERMINES",
      partyEntityIds: [ids.defendant2!],
      note: "Defendant-specific framing",
      provenance,
    });
    await linkCivilEvidence(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      elementId: element.id,
      role: "MISSING_EXPECTED",
      note: "Delivery receipt missing from the record.",
      provenance,
    });
    await linkCivilFact(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      elementId: element.id,
      factId: ids.fact!,
      role: "SUPPORTS",
      provenance,
    });

    const counter = await createCivilCounterclaim(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      label: "Unpaid invoice",
      category: "CONTRACT",
      pleadingId: pleading.id,
      parties: [
        { partyEntityId: ids.defendant!, role: "COUNTERCLAIMANT" },
        { partyEntityId: ids.plaintiff!, role: "COUNTERCLAIM_DEFENDANT" },
      ],
      provenance,
    });
    ids.counter = counter.id;

    const defense = await createCivilDefense(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "AFFIRMATIVE",
      label: "Waiver",
      againstClaimIds: [claim.id],
      assertingPartyIds: [ids.defendant!],
      targetPartyIds: [ids.plaintiff!],
      pleadingId: pleading.id,
      supportStatus: "NO_EVIDENCE_FOUND",
      provenance,
    });
    ids.defense = defense.id;

    const listed = await listCivilClaimsByMatter(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      currentOnly: true,
    });
    expect(listed.map((c) => c.id)).toEqual(expect.arrayContaining([claim.id, counter.id]));
    expect(listed.every((c) => c.supportStatus !== "WIN" && c.supportStatus !== "LIABLE")).toBe(true);
  });

  it("rejects cross-org and cross-matter mutations", async () => {
    await expect(
      createCivilClaim(db, {
        userId: ids.outsider!,
        organizationId: ids.orgB!,
        matterId: ids.matterA!,
        kind: "CLAIM",
        label: "Cross org attempt",
        provenance,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      addCivilClaimParty(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        claimId: ids.claim!,
        partyEntityId: "00000000-0000-4000-8000-000000000099",
        role: "DEFENDANT",
      }),
    ).rejects.toBeInstanceOf(CivilError);

    await expect(
      createCivilDefense(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        kind: "NOTICE",
        label: "Bad cross-matter defense",
        againstClaimIds: [ids.claim!, "00000000-0000-4000-8000-000000000088"],
        provenance,
      }),
    ).rejects.toBeInstanceOf(CivilError);
  });

  it("denies client_guest mutations", async () => {
    await expect(
      updateCivilClaimStatus(db, {
        userId: ids.guest!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        claimId: ids.claim!,
        supportStatus: "SUPPORTED",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("persists amendments and keeps historical claims", async () => {
    const { amended } = await createAmendedPleading(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      label: "Amended Complaint",
      supersedesPleadingId: ids.pleading!,
      provenance,
    });
    const { replacement, prior } = await supersedeCivilClaim(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      priorClaimId: ids.claim!,
      label: "Breach of contract (amended)",
      pleadingId: amended.id,
      provenance,
    });
    expect(replacement.isCurrent).toBe(true);
    expect(replacement.proceduralStatus).toBe("AMENDED");

    const [priorRow] = await db
      .select()
      .from(civilClaims)
      .where(eq(civilClaims.id, prior.id));
    expect(priorRow?.isCurrent).toBe(false);
    expect(priorRow?.proceduralStatus).toBe("SUPERSEDED");
    expect(priorRow?.supersededById).toBe(replacement.id);

    const currentOnly = await listCivilClaimsByMatter(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      currentOnly: true,
    });
    expect(currentOnly.some((c) => c.id === prior.id)).toBe(false);
    expect(currentOnly.some((c) => c.id === replacement.id)).toBe(true);

    const history = await listCivilClaimsByMatter(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      currentOnly: false,
    });
    expect(history.some((c) => c.id === prior.id)).toBe(true);

    const [oldPleading] = await db
      .select()
      .from(civilPleadings)
      .where(eq(civilPleadings.id, ids.pleading!));
    expect(oldPleading?.isCurrent).toBe(false);
    expect(oldPleading?.supersededById).toBe(amended.id);
  });

  it("rejects liability statuses at the database", async () => {
    await expect(
      db.execute(sql`
        insert into civil_claims (
          organization_id, matter_id, kind, category, label, support_status, procedural_status, provenance
        ) values (
          ${ids.orgA!}::uuid, ${ids.matterA!}::uuid, 'CLAIM', 'OTHER', 'Bad', 'LIABLE', 'PLED', '{}'::jsonb
        )
      `),
    ).rejects.toThrow();
  });

  it("reconstructs claim matrix from persisted D3-shaped review without liability", async () => {
    const [matterD3] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgA!,
        clientId: (
          await db
            .select()
            .from(clients)
            .where(and(eq(clients.organizationId, ids.orgA!)))
            .limit(1)
        )[0]!.id,
        matterNumber: `D3-${suffix}`,
        title: "D3 Civil Persist Matter",
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();

    const fixture = runComplexCivilClaimsFixture();
    const review = {
      ...fixture.review,
      organizationId: ids.orgA!,
      matterId: matterD3!.id,
    };
    await persistCivilClaimsReview(db, { userId: ids.owner!, review });
    const loaded = await loadCivilClaimsReview(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: matterD3!.id,
    });

    expect(loaded.liabilityConclusion).toBeNull();
    expect(loaded.outcomeConclusion).toBeNull();
    expect(loaded.claims.some((c) => c.kind === "COUNTERCLAIM")).toBe(true);
    expect(loaded.defenses.length).toBeGreaterThan(0);
    expect(loaded.claims.some((c) => !c.isCurrent && c.proceduralStatus === "SUPERSEDED")).toBe(true);
    expect(loaded.claims.some((c) => c.isCurrent && c.proceduralStatus === "AMENDED")).toBe(true);

    const matrix = buildCivilClaimMatrix(loaded);
    expect(matrix.length).toBeGreaterThan(0);
    expect(matrix.every((row) => !("liabilityConclusion" in row) || (row as { liabilityConclusion?: null }).liabilityConclusion == null)).toBe(
      true,
    );

    const whole = buildCivilWholeMatterView(loaded);
    expect(whole.liabilityConclusion).toBeNull();
    expect(whole.currentClaims.length).toBeGreaterThan(0);
    expect(whole.supersededClaims.length).toBeGreaterThan(0);
    expect(whole.counterclaims.length).toBeGreaterThan(0);
    expect(whole.sharedEvidenceRoles.length).toBeGreaterThan(0);
  });
});
