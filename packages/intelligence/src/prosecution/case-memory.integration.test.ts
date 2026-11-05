import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  auditEvents,
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  memberships,
  prosecutionCaseMemories,
  users,
  eq,
  and,
} from "@nyayagrid/database";
import { AuthorizationError } from "@nyayagrid/permissions";
import {
  createCriminalCase,
  createProsecutionCaseMemory,
  listProsecutionCaseMemories,
  reviewProsecutionCaseMemory,
  ProsecutionError,
} from "@nyayagrid/intelligence";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const provenance = { extractionOrigin: "human" as const, humanEntered: true };

describe.runIf(runDbTests)("prosecution case memory isolation + proposed≠verified", () => {
  const db = createDb(
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  );
  const suffix = Date.now().toString(36);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const table = await db.execute(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = 'prosecution_case_memories'
    `);
    expect(table.length).toBe(1);

    async function user(key: string) {
      const [row] = await db
        .insert(users)
        .values({
          authSubject: `pcm_${key}_${suffix}`,
          email: `pcm_${key}_${suffix}@example.nyayagrid.local`,
          name: key,
        })
        .returning();
      ids[key] = row!.id;
    }
    await user("ownerA");
    await user("ownerB");
    await user("prosecutor");

    const orgA = await createOrganizationWithDefaults(db, {
      name: `PCM A ${suffix}`,
      slug: `pcm-a-${suffix}`,
      type: "firm",
      ownerUserId: ids.ownerA!,
    });
    const orgB = await createOrganizationWithDefaults(db, {
      name: `PCM B ${suffix}`,
      slug: `pcm-b-${suffix}`,
      type: "firm",
      ownerUserId: ids.ownerB!,
    });
    ids.orgA = orgA.organization.id;
    ids.orgB = orgB.organization.id;

    await db.insert(memberships).values({
      organizationId: ids.orgA!,
      userId: ids.prosecutor!,
      roleId: orgA.roleIdByKey.get("prosecutor")!,
      status: "active",
    });

    const caseA = await createCriminalCase(db, {
      userId: ids.ownerA!,
      organizationId: ids.orgA!,
      caseNumber: `PCM-${suffix}`,
      jurisdiction: "PA",
      court: "st-pa-trial",
    });
    ids.caseA = caseA.id;

    const caseB = await createCriminalCase(db, {
      userId: ids.ownerB!,
      organizationId: ids.orgB!,
      caseNumber: `PCM-B-${suffix}`,
      jurisdiction: "PA",
      court: "st-pa-trial",
    });
    ids.caseB = caseB.id;
  });

  afterAll(async () => {
    if (ids.caseA) {
      await db
        .delete(prosecutionCaseMemories)
        .where(eq(prosecutionCaseMemories.criminalCaseId, ids.caseA));
    }
    await closeDb(db);
  });

  it("AI-proposed memory is not a verified fact until human approve", async () => {
    const proposed = await createProsecutionCaseMemory(db, {
      userId: ids.prosecutor!,
      organizationId: ids.orgA!,
      caseId: ids.caseA!,
      memoryType: "allegation",
      content: "Synthetic note: witness reported a blue vehicle near the scene.",
      origin: "ai",
      status: "approved",
      confidence: "high",
      provenance,
    });
    expect(proposed.status).toBe("proposed");
    expect(proposed.isVerifiedFact).toBe(false);
    expect(proposed.attorneyBadge).toBe("suggested");

    const audits = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, ids.orgA!), eq(auditEvents.targetId, proposed.id)));
    expect(audits.some((a) => a.action === "prosecution.memory_proposed")).toBe(true);
    expect(
      audits.every(
        (a) => a.metadata && (a.metadata as { isVerifiedFact?: boolean }).isVerifiedFact !== true,
      ),
    ).toBe(true);

    const approved = await reviewProsecutionCaseMemory(db, {
      userId: ids.prosecutor!,
      organizationId: ids.orgA!,
      caseId: ids.caseA!,
      memoryId: proposed.id,
      action: "approve",
    });
    expect(approved.status).toBe("approved");
    expect(approved.isVerifiedFact).toBe(true);
    expect(approved.attorneyBadge).toBe("verified");

    const approveAudits = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, ids.orgA!),
          eq(auditEvents.action, "prosecution.memory_approved"),
          eq(auditEvents.targetId, proposed.id),
        ),
      );
    expect(approveAudits.length).toBeGreaterThanOrEqual(1);
  });

  it("denies cross-tenant list and create", async () => {
    await expect(
      listProsecutionCaseMemories(db, {
        userId: ids.ownerB!,
        organizationId: ids.orgB!,
        caseId: ids.caseA!,
      }),
    ).rejects.toBeInstanceOf(ProsecutionError);

    await expect(
      listProsecutionCaseMemories(db, {
        userId: ids.ownerB!,
        organizationId: ids.orgA!,
        caseId: ids.caseA!,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      createProsecutionCaseMemory(db, {
        userId: ids.ownerB!,
        organizationId: ids.orgA!,
        caseId: ids.caseA!,
        memoryType: "other",
        content: "cross-tenant leak attempt",
        provenance,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const listed = await listProsecutionCaseMemories(db, {
      userId: ids.ownerB!,
      organizationId: ids.orgB!,
      caseId: ids.caseB!,
    });
    expect(listed.every((m) => m.criminalCaseId === ids.caseB)).toBe(true);
    expect(listed.some((m) => m.criminalCaseId === ids.caseA)).toBe(false);
  });

  it("supports human edit correction and supersede with audit", async () => {
    const created = await createProsecutionCaseMemory(db, {
      userId: ids.prosecutor!,
      organizationId: ids.orgA!,
      caseId: ids.caseA!,
      memoryType: "open_question",
      content: "Was the search warrant returned filed?",
      origin: "manual",
      provenance,
    });
    expect(created.isVerifiedFact).toBe(false);

    const edited = await reviewProsecutionCaseMemory(db, {
      userId: ids.prosecutor!,
      organizationId: ids.orgA!,
      caseId: ids.caseA!,
      memoryId: created.id,
      action: "edit",
      content: "Confirm whether the search warrant return was filed (date unknown).",
    });
    expect(edited.status).toBe("approved");
    expect(edited.isVerifiedFact).toBe(true);
    expect(edited.content).toContain("date unknown");

    const replacement = await reviewProsecutionCaseMemory(db, {
      userId: ids.prosecutor!,
      organizationId: ids.orgA!,
      caseId: ids.caseA!,
      memoryId: edited.id,
      action: "supersede",
      content: "Warrant return filing status remains an open question pending clerk confirmation.",
      memoryType: "open_question",
    });
    expect(replacement.status).toBe("approved");
    expect(replacement.isVerifiedFact).toBe(true);

    const [old] = await db
      .select()
      .from(prosecutionCaseMemories)
      .where(eq(prosecutionCaseMemories.id, edited.id));
    expect(old?.status).toBe("superseded");
    expect(old?.supersededBy).toBe(replacement.id);

    const supersedeAudits = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, ids.orgA!),
          eq(auditEvents.action, "prosecution.memory_superseded"),
          eq(auditEvents.targetId, edited.id),
        ),
      );
    expect(supersedeAudits.length).toBeGreaterThanOrEqual(1);
  });
});
