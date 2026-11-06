import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  auditEvents,
  buildInvoiceLineDrafts,
  canTransitionInvoiceStatus,
  clients,
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  invoiceLineItems,
  invoices,
  matterMembers,
  matters,
  rollupInvoiceTotals,
  selectPostedUnbilledEntries,
  timeEntries,
  users,
} from "@nyayagrid/database";
import { AuthorizationError, requireCapability, requireMatterAccess } from "@nyayagrid/permissions";

const runDbTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDbTests)("PROF-BILL-01 firm time/invoice isolation", () => {
  const db = createDb(
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  );
  const suffix = Date.now().toString(36);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    for (const column of ["billable", "hourly_rate_cents"]) {
      const rows = await db.execute(sql`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'time_entries' and column_name = ${column}
      `);
      expect(rows.length).toBe(1);
    }
    for (const column of ["total_minutes", "total_cents"]) {
      const rows = await db.execute(sql`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'invoices' and column_name = ${column}
      `);
      expect(rows.length).toBe(1);
    }

    async function user(key: string) {
      const [row] = await db
        .insert(users)
        .values({
          authSubject: `bill_${key}_${suffix}`,
          email: `bill_${key}_${suffix}@example.nyayagrid.local`,
          name: key,
        })
        .returning();
      ids[key] = row!.id;
    }
    await user("ownerA");
    await user("ownerB");
    await user("outsider");

    const orgA = await createOrganizationWithDefaults(db, {
      name: `Bill A ${suffix}`,
      slug: `bill-a-${suffix}`,
      type: "firm",
      ownerUserId: ids.ownerA!,
    });
    const orgB = await createOrganizationWithDefaults(db, {
      name: `Bill B ${suffix}`,
      slug: `bill-b-${suffix}`,
      type: "firm",
      ownerUserId: ids.ownerB!,
    });
    ids.orgA = orgA.organization.id;
    ids.orgB = orgB.organization.id;

    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgA!,
        clientType: "individual",
        displayName: `Bill Client A ${suffix}`,
        createdByUserId: ids.ownerA!,
      })
      .returning();
    ids.clientA = clientA!.id;
    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgB!,
        clientType: "individual",
        displayName: `Bill Client B ${suffix}`,
        createdByUserId: ids.ownerB!,
      })
      .returning();
    ids.clientB = clientB!.id;

    const [matterA] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgA!,
        clientId: ids.clientA!,
        matterNumber: `BILL-A-${suffix}`,
        title: "Synthetic billing matter A",
        createdByUserId: ids.ownerA!,
      })
      .returning();
    ids.matterA = matterA!.id;
    await db.insert(matterMembers).values({
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.ownerA!,
      access: "manage",
    });

    const [matterB] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgB!,
        clientId: ids.clientB!,
        matterNumber: `BILL-B-${suffix}`,
        title: "Synthetic billing matter B",
        createdByUserId: ids.ownerB!,
      })
      .returning();
    ids.matterB = matterB!.id;
    await db.insert(matterMembers).values({
      organizationId: ids.orgB!,
      matterId: ids.matterB!,
      userId: ids.ownerB!,
      access: "manage",
    });
  }, 60000);

  afterAll(async () => {
    if (ids.orgA) {
      await db.delete(invoiceLineItems).where(eq(invoiceLineItems.organizationId, ids.orgA));
      await db.delete(invoices).where(eq(invoices.organizationId, ids.orgA));
      await db.delete(timeEntries).where(eq(timeEntries.organizationId, ids.orgA));
    }
    if (ids.orgB) {
      await db.delete(invoiceLineItems).where(eq(invoiceLineItems.organizationId, ids.orgB));
      await db.delete(invoices).where(eq(invoices.organizationId, ids.orgB));
      await db.delete(timeEntries).where(eq(timeEntries.organizationId, ids.orgB));
    }
    await closeDb(db);
  });

  it("creates posted billable time, drafts invoice with rates, updates lines, transitions status", async () => {
    await requireCapability(db, {
      userId: ids.ownerA!,
      organizationId: ids.orgA!,
      capability: "matters.edit",
    });
    await expect(
      requireCapability(db, {
        userId: ids.outsider!,
        organizationId: ids.orgA!,
        capability: "matters.edit",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const [suggested] = await db
      .insert(timeEntries)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        userId: ids.ownerA!,
        source: "manual",
        status: "suggested",
        description: "Intake call",
        minutes: 30,
        billable: true,
        hourlyRateCents: 30000,
      })
      .returning();
    ids.entrySuggested = suggested!.id;

    const [nonBillable] = await db
      .insert(timeEntries)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        userId: ids.ownerA!,
        source: "manual",
        status: "posted",
        description: "Internal admin",
        minutes: 45,
        billable: false,
        hourlyRateCents: 30000,
        postedAt: new Date(),
      })
      .returning();
    ids.entryNonBillable = nonBillable!.id;

    const [posted] = await db
      .update(timeEntries)
      .set({ status: "posted", postedAt: new Date(), updatedAt: new Date() })
      .where(eq(timeEntries.id, suggested!.id))
      .returning();
    expect(posted!.status).toBe("posted");

    const [extra] = await db
      .insert(timeEntries)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        userId: ids.ownerA!,
        source: "manual",
        status: "posted",
        description: "Document review",
        minutes: 90,
        billable: true,
        hourlyRateCents: 30000,
        postedAt: new Date(),
      })
      .returning();
    ids.entryExtra = extra!.id;

    await db.insert(auditEvents).values({
      organizationId: ids.orgA!,
      actorUserId: ids.ownerA!,
      matterId: ids.matterA!,
      action: "time_entry.posted",
      targetType: "time_entry",
      targetId: posted!.id,
    });

    const matterEntries = await db
      .select()
      .from(timeEntries)
      .where(
        and(eq(timeEntries.organizationId, ids.orgA!), eq(timeEntries.matterId, ids.matterA!)),
      );

    const eligible = selectPostedUnbilledEntries(
      matterEntries.map((entry) => ({
        id: entry.id,
        status: entry.status,
        minutes: entry.minutes,
        billable: entry.billable,
        hourlyRateCents: entry.hourlyRateCents,
        description: entry.description,
      })),
      new Set(),
    );
    expect(eligible.map((e) => e.id).sort()).toEqual([posted!.id, extra!.id].sort());
    expect(eligible.some((e) => e.id === nonBillable!.id)).toBe(false);

    const lineDrafts = buildInvoiceLineDrafts(eligible);
    const totals = rollupInvoiceTotals(lineDrafts);
    expect(totals.totalMinutes).toBe(120);
    expect(totals.totalCents).toBe(60000);
    expect(totals.hasCompleteRates).toBe(true);

    const [invoice] = await db
      .insert(invoices)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        invoiceNumber: `SYNTH-INV-${suffix}`,
        status: "draft",
        notes: "Draft assistance only",
        totalMinutes: totals.totalMinutes,
        totalCents: totals.totalCents,
        createdByUserId: ids.ownerA!,
      })
      .returning();
    ids.invoiceA = invoice!.id;

    await db.insert(invoiceLineItems).values(
      lineDrafts.map((line) => ({
        invoiceId: invoice!.id,
        organizationId: ids.orgA!,
        timeEntryId: line.timeEntryId,
        description: line.description,
        minutes: line.minutes,
        billable: line.billable,
        hourlyRateCents: line.hourlyRateCents,
        amountCents: line.amountCents,
      })),
    );

    await db.insert(auditEvents).values({
      organizationId: ids.orgA!,
      actorUserId: ids.ownerA!,
      matterId: ids.matterA!,
      action: "invoice.drafted",
      targetType: "invoice",
      targetId: invoice!.id,
      metadata: { totalMinutes: totals.totalMinutes, totalCents: totals.totalCents },
    });

    const lines = await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoice!.id));
    expect(lines).toHaveLength(2);

    const [lineToPatch] = lines;
    await db
      .update(invoiceLineItems)
      .set({
        description: "Document review (revised)",
        hourlyRateCents: 40000,
        amountCents: Math.round((lineToPatch!.minutes / 60) * 40000),
        updatedAt: new Date(),
      })
      .where(eq(invoiceLineItems.id, lineToPatch!.id));

    const refreshedLines = await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoice!.id));
    const refreshedTotals = rollupInvoiceTotals(
      refreshedLines.map((line) => ({
        minutes: line.minutes,
        billable: line.billable,
        amountCents: line.amountCents,
      })),
    );
    await db
      .update(invoices)
      .set({
        totalMinutes: refreshedTotals.totalMinutes,
        totalCents: refreshedTotals.totalCents,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoice!.id));

    const [reopened] = await db.select().from(invoices).where(eq(invoices.id, invoice!.id));
    expect(reopened!.status).toBe("draft");
    expect(reopened!.totalMinutes).toBe(120);
    expect(reopened!.totalCents).toBeGreaterThan(0);

    expect(canTransitionInvoiceStatus("draft", "issue")).toEqual({ ok: true });
    const [issued] = await db
      .update(invoices)
      .set({ status: "issued", issuedAt: new Date(), updatedAt: new Date() })
      .where(eq(invoices.id, invoice!.id))
      .returning();
    expect(issued!.status).toBe("issued");
    expect(canTransitionInvoiceStatus("issued", "issue").ok).toBe(false);

    const [voided] = await db
      .update(invoices)
      .set({ status: "void", voidedAt: new Date(), updatedAt: new Date() })
      .where(eq(invoices.id, invoice!.id))
      .returning();
    expect(voided!.status).toBe("void");

    await db.insert(auditEvents).values([
      {
        organizationId: ids.orgA!,
        actorUserId: ids.ownerA!,
        matterId: ids.matterA!,
        action: "invoice.issued",
        targetType: "invoice",
        targetId: invoice!.id,
      },
      {
        organizationId: ids.orgA!,
        actorUserId: ids.ownerA!,
        matterId: ids.matterA!,
        action: "invoice.voided",
        targetType: "invoice",
        targetId: invoice!.id,
      },
    ]);

    const audits = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, ids.orgA!), eq(auditEvents.targetId, invoice!.id)));
    expect(audits.some((a) => a.action === "invoice.drafted")).toBe(true);
    expect(audits.some((a) => a.action === "invoice.issued")).toBe(true);
    expect(audits.some((a) => a.action === "invoice.voided")).toBe(true);
  });

  it("rejects cross-firm matter access and does not leak invoices", async () => {
    await expect(
      requireMatterAccess(db, {
        userId: ids.ownerB!,
        matterId: ids.matterA!,
        minAccess: "read",
        capability: "matters.view",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const leaked = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.organizationId, ids.orgB!), eq(invoices.id, ids.invoiceA!)));
    expect(leaked).toHaveLength(0);

    const orgScoped = await db
      .select()
      .from(invoices)
      .where(eq(invoices.organizationId, ids.orgA!));
    expect(orgScoped.every((row) => row.organizationId === ids.orgA)).toBe(true);
  });

  it("prevents duplicate billing of the same time entry", async () => {
    const billed = await db
      .select({ timeEntryId: invoiceLineItems.timeEntryId })
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.organizationId, ids.orgA!));
    const billedIds = new Set(billed.map((row) => row.timeEntryId));

    const posted = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.organizationId, ids.orgA!),
          eq(timeEntries.matterId, ids.matterA!),
          eq(timeEntries.status, "posted"),
        ),
      );
    const eligible = selectPostedUnbilledEntries(
      posted.map((entry) => ({
        id: entry.id,
        status: entry.status,
        minutes: entry.minutes,
        billable: entry.billable,
        hourlyRateCents: entry.hourlyRateCents,
        description: entry.description,
      })),
      billedIds,
    );
    expect(eligible).toHaveLength(0);
  });
});
