import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  auditEvents,
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  criminalCases,
  memberships,
  prosecutionChargeElements,
  prosecutionWitnessStatements,
  users,
  eq,
  and,
} from "@nyayagrid/database";
import { AuthorizationError, requireCapability } from "@nyayagrid/permissions";
import {
  addProsecutionRecord,
  createChargeWithElements,
  createCriminalCase,
  getProsecutionOverview,
  listCriminalCases,
  ProsecutionError,
} from "@nyayagrid/intelligence";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const provenance = { extractionOrigin: "human" as const, humanEntered: true };

describe.runIf(runDbTests)("week 3 live prosecution database", () => {
  const db = createDb(process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid");
  const suffix = Date.now().toString(36);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    async function user(key: string) {
      const [row] = await db
        .insert(users)
        .values({
          authSubject: `w3_${key}_${suffix}`,
          email: `w3_${key}_${suffix}@example.nyayagrid.local`,
          name: key,
        })
        .returning();
      ids[key] = row!.id;
    }
    await user("ownerA");
    await user("ownerB");
    await user("reader");
    await user("investigator");
    await user("support");
    await user("prosecutor");
    await user("supervisor");

    const orgA = await createOrganizationWithDefaults(db, {
      name: `Week3 A ${suffix}`,
      slug: `week3-a-${suffix}`,
      type: "firm",
      ownerUserId: ids.ownerA!,
    });
    const orgB = await createOrganizationWithDefaults(db, {
      name: `Week3 B ${suffix}`,
      slug: `week3-b-${suffix}`,
      type: "firm",
      ownerUserId: ids.ownerB!,
    });
    ids.orgA = orgA.organization.id;
    ids.orgB = orgB.organization.id;

    async function member(userId: string, roleKey: string) {
      await db.insert(memberships).values({
        organizationId: ids.orgA!,
        userId,
        roleId: orgA.roleIdByKey.get(roleKey)!,
        status: "active",
      });
    }
    await member(ids.reader!, "prosecution_read_only");
    await member(ids.investigator!, "investigator");
    await member(ids.support!, "legal_support");
    await member(ids.prosecutor!, "prosecutor");
    await member(ids.supervisor!, "supervising_prosecutor");
  });

  afterAll(async () => {
    await closeDb(db);
  });

  it("has the week 3 tables and case isolation constraints", async () => {
    const tables = await db.execute(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'criminal_cases', 'prosecution_defendants', 'prosecution_charges', 'prosecution_charge_elements',
          'prosecution_evidence_items', 'prosecution_witnesses', 'prosecution_witness_statements',
          'prosecution_discovery_items', 'prosecution_disclosure_candidates', 'prosecution_procedure_issues',
          'prosecution_warrants', 'prosecution_motions', 'prosecution_hearings', 'prosecution_plea_offers',
          'prosecution_dispositions', 'prosecution_sentences', 'legal_standards', 'legal_issues', 'authority_treatments'
        )
    `);
    expect(tables.length).toBe(19);
    const constraint = await db.execute(sql`
      select conname from pg_constraint where conname = 'prosecution_witness_statements_witness_case_fk'
    `);
    expect(constraint.length).toBe(1);
  });

  it("denies cross-tenant reads, writes, and deletes", async () => {
    const created = await createCriminalCase(db, {
      userId: ids.ownerA!,
      organizationId: ids.orgA!,
      caseNumber: `SYN-${suffix}`,
      jurisdiction: "PA",
      court: "st-pa-trial",
    });
    ids.caseA = created.id;
    const listed = await listCriminalCases(db, { userId: ids.ownerB!, organizationId: ids.orgB! });
    expect(listed.some((row) => row.id === created.id || row.caseNumber === created.caseNumber)).toBe(false);
    await expect(
      getProsecutionOverview(db, { userId: ids.ownerB!, organizationId: ids.orgB!, caseId: created.id }),
    ).rejects.toBeInstanceOf(ProsecutionError);
    await expect(
      getProsecutionOverview(db, { userId: ids.ownerB!, organizationId: ids.orgA!, caseId: created.id }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      addProsecutionRecord(db, {
        userId: ids.ownerB!,
        organizationId: ids.orgA!,
        caseId: created.id,
        resource: "defendants",
        body: { displayName: "Leak", provenance },
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const deleted = await db
      .delete(criminalCases)
      .where(and(eq(criminalCases.id, created.id), eq(criminalCases.organizationId, ids.orgB!)))
      .returning();
    expect(deleted).toHaveLength(0);
    const still = await db.select().from(criminalCases).where(eq(criminalCases.id, created.id));
    expect(still).toHaveLength(1);
    expect(still[0]?.summary ?? "").not.toContain("leak");
  });

  it("rejects cross-case links in the service and the database", async () => {
    const caseB = await createCriminalCase(db, {
      userId: ids.ownerA!,
      organizationId: ids.orgA!,
      caseNumber: `SYN-B-${suffix}`,
      jurisdiction: "PA",
      court: "st-pa-trial",
    });
    ids.caseB = caseB.id;
    const defendantA = await addProsecutionRecord(db, {
      userId: ids.ownerA!,
      organizationId: ids.orgA!,
      caseId: ids.caseA!,
      resource: "defendants",
      body: { displayName: "Defendant A", provenance },
    });
    const defendantB = await addProsecutionRecord(db, {
      userId: ids.ownerA!,
      organizationId: ids.orgA!,
      caseId: caseB.id,
      resource: "defendants",
      body: { displayName: "Defendant B", provenance },
    });
    await expect(
      addProsecutionRecord(db, {
        userId: ids.ownerA!,
        organizationId: ids.orgA!,
        caseId: ids.caseA!,
        resource: "charges",
        body: {
          defendantId: (defendantB as { id: string }).id,
          countNumber: "1",
          offenseName: "Synthetic count",
          jurisdiction: "PA",
          provenance,
        },
      }),
    ).rejects.toMatchObject({ code: "CROSS_CASE" });
    const evidenceB = await addProsecutionRecord(db, {
      userId: ids.ownerA!,
      organizationId: ids.orgA!,
      caseId: caseB.id,
      resource: "evidence",
      body: { evidenceType: "report", provenance },
    });
    await expect(
      addProsecutionRecord(db, {
        userId: ids.ownerA!,
        organizationId: ids.orgA!,
        caseId: ids.caseA!,
        resource: "warrants",
        body: { warrantType: "search", seizedEvidenceIds: [(evidenceB as { id: string }).id], provenance },
      }),
    ).rejects.toMatchObject({ code: "CROSS_CASE" });
    const witnessB = await addProsecutionRecord(db, {
      userId: ids.ownerA!,
      organizationId: ids.orgA!,
      caseId: caseB.id,
      resource: "witnesses",
      body: { displayName: "Witness B", witnessType: "civilian", provenance },
    });
    await expect(
      db.insert(prosecutionWitnessStatements).values({
        organizationId: ids.orgA!,
        criminalCaseId: ids.caseA!,
        witnessId: (witnessB as { id: string }).id,
        statementType: "interview",
        provenance,
      }),
    ).rejects.toThrow();
    ids.defendantA = (defendantA as { id: string }).id;
  });

  it("enforces prosecution roles", async () => {
    await expect(
      addProsecutionRecord(db, {
        userId: ids.reader!,
        organizationId: ids.orgA!,
        caseId: ids.caseA!,
        resource: "charges",
        body: { defendantId: ids.defendantA, countNumber: "9", offenseName: "No", jurisdiction: "PA", provenance },
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const overview = await getProsecutionOverview(db, { userId: ids.reader!, organizationId: ids.orgA!, caseId: ids.caseA! });
    expect(overview.guiltConclusion).toBeNull();
    await expect(
      addProsecutionRecord(db, {
        userId: ids.investigator!,
        organizationId: ids.orgA!,
        caseId: ids.caseA!,
        resource: "disclosure",
        body: { category: "OTHER", status: "REVIEWED_DISCLOSE", provenance },
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      addProsecutionRecord(db, {
        userId: ids.prosecutor!,
        organizationId: ids.orgA!,
        caseId: ids.caseA!,
        resource: "disclosure",
        body: { category: "OTHER", status: "REVIEWED_DISCLOSE", provenance },
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const evidence = await addProsecutionRecord(db, {
      userId: ids.investigator!,
      organizationId: ids.orgA!,
      caseId: ids.caseA!,
      resource: "evidence",
      body: { evidenceType: "report", provenance },
    });
    expect((evidence as { id: string }).id).toBeTruthy();
    const disclosed = await addProsecutionRecord(db, {
      userId: ids.supervisor!,
      organizationId: ids.orgA!,
      caseId: ids.caseA!,
      resource: "disclosure",
      body: { category: "OTHER", status: "REVIEWED_NOT_DISCLOSE", provenance },
    });
    expect((disclosed as { humanActorId: string }).humanActorId).toBe(ids.supervisor);
    await expect(
      addProsecutionRecord(db, {
        userId: ids.investigator!,
        organizationId: ids.orgA!,
        caseId: ids.caseA!,
        resource: "charges",
        body: { defendantId: ids.defendantA, countNumber: "8", offenseName: "No", jurisdiction: "PA", provenance },
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      requireCapability(db, {
        userId: ids.support!,
        organizationId: ids.orgA!,
        capability: "organization.manage",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      addProsecutionRecord(db, {
        userId: ids.support!,
        organizationId: ids.orgA!,
        caseId: ids.caseA!,
        resource: "disclosure",
        body: { category: "OTHER", status: "REVIEWED_DISCLOSE", provenance },
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rolls back a charge when an element status is a guilt verdict", async () => {
    await expect(
      createChargeWithElements(db, {
        userId: ids.ownerA!,
        organizationId: ids.orgA!,
        caseId: ids.caseA!,
        charge: {
          defendantId: ids.defendantA!,
          countNumber: `tx-${suffix}`,
          offenseName: "Synthetic transactional count",
          jurisdiction: "PA",
          provenance,
        },
        elements: [
          { elementOrder: 1, elementText: "Act", elementType: "element", status: "UNKNOWN", provenance },
          { elementOrder: 2, elementText: "Intent", elementType: "element", status: "GUILTY", provenance },
        ],
      }),
    ).rejects.toMatchObject({ code: "GUILT_STATUS_FORBIDDEN" });
    const leftover = await db
      .select()
      .from(criminalCases)
      .where(eq(criminalCases.id, ids.caseA!));
    expect(leftover).toHaveLength(1);
    const charges = await db.execute(sql`
      select id from prosecution_charges
      where criminal_case_id = ${ids.caseA!} and count_number = ${`tx-${suffix}`}
    `);
    expect(charges.length).toBe(0);
  });

  it("writes audit events and keeps plea and sentencing as records", async () => {
    const charge = await addProsecutionRecord(db, {
      userId: ids.prosecutor!,
      organizationId: ids.orgA!,
      caseId: ids.caseA!,
      resource: "charges",
      body: {
        defendantId: ids.defendantA,
        countNumber: `audit-${suffix}`,
        offenseName: "Synthetic audit count",
        jurisdiction: "PA",
        provenance,
      },
    });
    const audits = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, ids.orgA!), eq(auditEvents.action, "prosecution.charge_modified")));
    expect(audits.length).toBeGreaterThan(0);
    await addProsecutionRecord(db, {
      userId: ids.prosecutor!,
      organizationId: ids.orgA!,
      caseId: ids.caseA!,
      resource: "discovery",
      body: { source: "police", category: "reports", provenance },
    });
    const discoveryAudits = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, ids.orgA!), eq(auditEvents.action, "prosecution.discovery_review_changed")));
    expect(discoveryAudits.length).toBeGreaterThan(0);
    const plea = await addProsecutionRecord(db, {
      userId: ids.prosecutor!,
      organizationId: ids.orgA!,
      caseId: ids.caseA!,
      resource: "pleas",
      body: { terms: "Synthetic offer. No recommendation.", provenance },
    });
    expect((plea as { humanOwnerId: string }).humanOwnerId).toBe(ids.prosecutor);
    const sentence = await addProsecutionRecord(db, {
      userId: ids.prosecutor!,
      organizationId: ids.orgA!,
      caseId: ids.caseA!,
      resource: "sentences",
      body: {
        chargeId: (charge as { id: string }).id,
        conviction: "record only",
        sentenceTerms: "Synthetic record. Not a sentence recommendation.",
        provenance,
      },
    });
    expect((sentence as { sentenceTerms: string }).sentenceTerms).toMatch(/Not a sentence recommendation/);
    await expect(
      db.insert(prosecutionChargeElements).values({
        organizationId: ids.orgA!,
        criminalCaseId: ids.caseA!,
        chargeId: (charge as { id: string }).id,
        elementOrder: 1,
        elementText: "Act",
        elementType: "element",
        status: "GUILTY",
        provenance,
      }),
    ).rejects.toThrow();
  });
});
