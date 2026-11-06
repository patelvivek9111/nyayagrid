/**
 * Local docker DB-backed PROF-BILL-01 workflow smoke.
 * Inserts unique suffix rows and deletes them afterward. Not for shared/staging/prod.
 */
import { and, eq } from "drizzle-orm";
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

const url = process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  throw new Error("Refusing non-localhost DATABASE_URL");
}

const db = createDb(url);
const suffix = Date.now().toString(36);
const ids = {};

try {
  const [ownerA] = await db
    .insert(users)
    .values({
      authSubject: `bill_smoke_a_${suffix}`,
      email: `bill_smoke_a_${suffix}@example.nyayagrid.local`,
      name: "ownerA",
    })
    .returning();
  const [ownerB] = await db
    .insert(users)
    .values({
      authSubject: `bill_smoke_b_${suffix}`,
      email: `bill_smoke_b_${suffix}@example.nyayagrid.local`,
      name: "ownerB",
    })
    .returning();
  ids.ownerA = ownerA.id;
  ids.ownerB = ownerB.id;

  const orgA = await createOrganizationWithDefaults(db, {
    name: `Bill Smoke A ${suffix}`,
    slug: `bill-smoke-a-${suffix}`,
    type: "firm",
    ownerUserId: ids.ownerA,
  });
  const orgB = await createOrganizationWithDefaults(db, {
    name: `Bill Smoke B ${suffix}`,
    slug: `bill-smoke-b-${suffix}`,
    type: "firm",
    ownerUserId: ids.ownerB,
  });
  ids.orgA = orgA.organization.id;
  ids.orgB = orgB.organization.id;

  const [clientA] = await db
    .insert(clients)
    .values({
      organizationId: ids.orgA,
      clientType: "individual",
      displayName: `Smoke Client A ${suffix}`,
      createdByUserId: ids.ownerA,
    })
    .returning();
  const [clientB] = await db
    .insert(clients)
    .values({
      organizationId: ids.orgB,
      clientType: "individual",
      displayName: `Smoke Client B ${suffix}`,
      createdByUserId: ids.ownerB,
    })
    .returning();

  const [matterA] = await db
    .insert(matters)
    .values({
      organizationId: ids.orgA,
      clientId: clientA.id,
      matterNumber: `SMOKE-A-${suffix}`,
      title: "Billing smoke A",
      createdByUserId: ids.ownerA,
    })
    .returning();
  ids.matterA = matterA.id;
  await db.insert(matterMembers).values({
    organizationId: ids.orgA,
    matterId: matterA.id,
    userId: ids.ownerA,
    access: "manage",
  });

  const [matterB] = await db
    .insert(matters)
    .values({
      organizationId: ids.orgB,
      clientId: clientB.id,
      matterNumber: `SMOKE-B-${suffix}`,
      title: "Billing smoke B",
      createdByUserId: ids.ownerB,
    })
    .returning();
  await db.insert(matterMembers).values({
    organizationId: ids.orgB,
    matterId: matterB.id,
    userId: ids.ownerB,
    access: "manage",
  });

  await requireCapability(db, {
    userId: ids.ownerA,
    organizationId: ids.orgA,
    capability: "matters.edit",
  });
  let denied = false;
  try {
    await requireCapability(db, {
      userId: ids.ownerB,
      organizationId: ids.orgA,
      capability: "matters.edit",
    });
  } catch (err) {
    denied = err instanceof AuthorizationError;
  }
  if (!denied) throw new Error("cross-firm capability should fail");

  denied = false;
  try {
    await requireMatterAccess(db, {
      userId: ids.ownerB,
      matterId: ids.matterA,
      minAccess: "read",
      capability: "matters.view",
    });
  } catch (err) {
    denied = err instanceof AuthorizationError;
  }
  if (!denied) throw new Error("cross-firm matter access should fail");

  const [suggested] = await db
    .insert(timeEntries)
    .values({
      organizationId: ids.orgA,
      matterId: ids.matterA,
      userId: ids.ownerA,
      source: "manual",
      status: "suggested",
      description: "Intake",
      minutes: 30,
      billable: true,
      hourlyRateCents: 30000,
    })
    .returning();

  await db
    .update(timeEntries)
    .set({ status: "posted", postedAt: new Date(), updatedAt: new Date() })
    .where(eq(timeEntries.id, suggested.id));

  await db.insert(timeEntries).values({
    organizationId: ids.orgA,
    matterId: ids.matterA,
    userId: ids.ownerA,
    source: "manual",
    status: "posted",
    description: "Admin",
    minutes: 45,
    billable: false,
    hourlyRateCents: 30000,
    postedAt: new Date(),
  });

  await db.insert(timeEntries).values({
    organizationId: ids.orgA,
    matterId: ids.matterA,
    userId: ids.ownerA,
    source: "manual",
    status: "posted",
    description: "Review",
    minutes: 90,
    billable: true,
    hourlyRateCents: 30000,
    postedAt: new Date(),
  });

  const posted = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.organizationId, ids.orgA), eq(timeEntries.matterId, ids.matterA)));

  const eligible = selectPostedUnbilledEntries(
    posted.map((entry) => ({
      id: entry.id,
      status: entry.status,
      minutes: entry.minutes,
      billable: entry.billable,
      hourlyRateCents: entry.hourlyRateCents,
      description: entry.description,
    })),
    new Set(),
  );
  if (eligible.length !== 2) throw new Error(`expected 2 eligible got ${eligible.length}`);

  const drafts = buildInvoiceLineDrafts(eligible);
  const totals = rollupInvoiceTotals(drafts);
  if (totals.totalMinutes !== 120 || totals.totalCents !== 60000) {
    throw new Error(`bad totals ${JSON.stringify(totals)}`);
  }

  const [invoice] = await db
    .insert(invoices)
    .values({
      organizationId: ids.orgA,
      matterId: ids.matterA,
      invoiceNumber: `SYNTH-INV-${suffix}`,
      status: "draft",
      notes: "smoke",
      totalMinutes: totals.totalMinutes,
      totalCents: totals.totalCents,
      createdByUserId: ids.ownerA,
    })
    .returning();

  await db.insert(invoiceLineItems).values(
    drafts.map((line) => ({
      invoiceId: invoice.id,
      organizationId: ids.orgA,
      timeEntryId: line.timeEntryId,
      description: line.description,
      minutes: line.minutes,
      billable: line.billable,
      hourlyRateCents: line.hourlyRateCents,
      amountCents: line.amountCents,
    })),
  );

  const lines = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoice.id));
  const [line] = lines;
  await db
    .update(invoiceLineItems)
    .set({
      description: "Revised",
      hourlyRateCents: 40000,
      amountCents: Math.round((line.minutes / 60) * 40000),
      updatedAt: new Date(),
    })
    .where(eq(invoiceLineItems.id, line.id));

  const refreshedLines = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoice.id));
  const refreshed = rollupInvoiceTotals(
    refreshedLines.map((row) => ({
      minutes: row.minutes,
      billable: row.billable,
      amountCents: row.amountCents,
    })),
  );
  await db
    .update(invoices)
    .set({
      totalMinutes: refreshed.totalMinutes,
      totalCents: refreshed.totalCents,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoice.id));

  const [reopened] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
  if (reopened.status !== "draft") throw new Error("expected draft after reopen");

  if (!canTransitionInvoiceStatus("draft", "issue").ok) throw new Error("cannot issue");
  await db
    .update(invoices)
    .set({ status: "issued", issuedAt: new Date(), updatedAt: new Date() })
    .where(eq(invoices.id, invoice.id));
  if (canTransitionInvoiceStatus("issued", "issue").ok) throw new Error("should not re-issue");
  await db
    .update(invoices)
    .set({ status: "void", voidedAt: new Date(), updatedAt: new Date() })
    .where(eq(invoices.id, invoice.id));

  await db.insert(auditEvents).values([
    {
      organizationId: ids.orgA,
      actorUserId: ids.ownerA,
      matterId: ids.matterA,
      action: "invoice.drafted",
      targetType: "invoice",
      targetId: invoice.id,
    },
    {
      organizationId: ids.orgA,
      actorUserId: ids.ownerA,
      matterId: ids.matterA,
      action: "invoice.issued",
      targetType: "invoice",
      targetId: invoice.id,
    },
    {
      organizationId: ids.orgA,
      actorUserId: ids.ownerA,
      matterId: ids.matterA,
      action: "invoice.voided",
      targetType: "invoice",
      targetId: invoice.id,
    },
  ]);

  const billed = await db
    .select({ id: invoiceLineItems.timeEntryId })
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.organizationId, ids.orgA));
  const again = selectPostedUnbilledEntries(
    posted.map((entry) => ({
      id: entry.id,
      status: entry.status,
      minutes: entry.minutes,
      billable: entry.billable,
      hourlyRateCents: entry.hourlyRateCents,
      description: entry.description,
    })),
    new Set(billed.map((row) => row.id)),
  );
  if (again.length !== 0) throw new Error("duplicate billing allowed");

  const leaked = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, ids.orgB), eq(invoices.id, invoice.id)));
  if (leaked.length !== 0) throw new Error("cross-firm invoice leak");

  console.log(
    JSON.stringify({
      ok: true,
      invoiceId: invoice.id,
      totalMinutes: refreshed.totalMinutes,
      totalCents: refreshed.totalCents,
      audits: 3,
    }),
  );
} finally {
  if (ids.orgA) {
    await db.delete(invoiceLineItems).where(eq(invoiceLineItems.organizationId, ids.orgA));
    await db.delete(invoices).where(eq(invoices.organizationId, ids.orgA));
    await db.delete(timeEntries).where(eq(timeEntries.organizationId, ids.orgA));
    await db.delete(auditEvents).where(eq(auditEvents.organizationId, ids.orgA));
  }
  if (ids.orgB) {
    await db.delete(invoiceLineItems).where(eq(invoiceLineItems.organizationId, ids.orgB));
    await db.delete(invoices).where(eq(invoices.organizationId, ids.orgB));
    await db.delete(timeEntries).where(eq(timeEntries.organizationId, ids.orgB));
  }
  await closeDb(db);
}
