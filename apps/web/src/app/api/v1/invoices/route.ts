import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import {
  buildInvoiceLineDrafts,
  invoiceLineItems,
  invoices,
  rollupInvoiceTotals,
  selectPostedUnbilledEntries,
  timeEntries,
} from "@nyayagrid/database";
import { createInvoiceFromTimeSchema } from "@nyayagrid/validation";
import { requireCapability, requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) return jsonError("VALIDATION_ERROR", "organizationId required", 400);

    await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability: "matters.edit",
    });

    const rows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.organizationId, organizationId))
      .orderBy(desc(invoices.createdAt));

    const ids = rows.map((row) => row.id);
    const lines =
      ids.length === 0
        ? []
        : await db
            .select()
            .from(invoiceLineItems)
            .where(
              and(
                eq(invoiceLineItems.organizationId, organizationId),
                inArray(invoiceLineItems.invoiceId, ids),
              ),
            );

    return jsonOk({
      invoices: rows.map((invoice) => {
        const lineItems = lines.filter((line) => line.invoiceId === invoice.id);
        const totals = rollupInvoiceTotals(
          lineItems.map((line) => ({
            minutes: line.minutes,
            billable: line.billable,
            amountCents: line.amountCents,
          })),
        );
        return {
          ...invoice,
          lineItems,
          totalMinutes: invoice.totalMinutes ?? totals.totalMinutes,
          totalCents: invoice.totalCents ?? totals.totalCents,
          hasCompleteRates: totals.hasCompleteRates,
        };
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = createInvoiceFromTimeSchema.parse(await request.json());
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId: body.matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });
    if (matter.organizationId !== body.organizationId) {
      return jsonError("FORBIDDEN", "That case is not in this firm.", 403);
    }

    const billed = await db
      .select({ timeEntryId: invoiceLineItems.timeEntryId })
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.organizationId, matter.organizationId));
    const billedIds = billed.map((row) => row.timeEntryId);

    const postedRows = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.organizationId, matter.organizationId),
          eq(timeEntries.matterId, body.matterId),
          eq(timeEntries.status, "posted"),
          billedIds.length > 0 ? notInArray(timeEntries.id, billedIds) : undefined,
        ),
      );

    const eligible = selectPostedUnbilledEntries(
      postedRows.map((entry) => ({
        id: entry.id,
        status: entry.status,
        minutes: entry.minutes,
        billable: entry.billable,
        hourlyRateCents: entry.hourlyRateCents,
        description: entry.description,
      })),
      new Set(billedIds),
    );

    if (eligible.length === 0) {
      return jsonError(
        "VALIDATION_ERROR",
        "No unbilled posted billable time on this case",
        400,
      );
    }

    const lineDrafts = buildInvoiceLineDrafts(eligible);
    const totals = rollupInvoiceTotals(lineDrafts);
    const invoiceNumber = `SYNTH-INV-${Date.now().toString(36).toUpperCase()}`;
    const created = await db.transaction(async (tx) => {
      const [invoice] = await tx
        .insert(invoices)
        .values({
          organizationId: body.organizationId,
          matterId: body.matterId,
          invoiceNumber,
          status: "draft",
          notes:
            body.notes ??
            "Draft invoice from posted billable time. Fee totals are assistance only — not payment collection or trust accounting.",
          totalMinutes: totals.totalMinutes,
          totalCents: totals.totalCents,
          createdByUserId: user.id,
        })
        .returning();
      if (!invoice) throw new Error("Failed to create invoice");
      await tx.insert(invoiceLineItems).values(
        lineDrafts.map((line) => ({
          invoiceId: invoice.id,
          organizationId: body.organizationId,
          timeEntryId: line.timeEntryId,
          description: line.description,
          minutes: line.minutes,
          billable: line.billable,
          hourlyRateCents: line.hourlyRateCents,
          amountCents: line.amountCents,
        })),
      );
      return invoice;
    });

    await writeAuditEvent(db, {
      organizationId: body.organizationId,
      actorUserId: user.id,
      matterId: body.matterId,
      action: "invoice.drafted",
      targetType: "invoice",
      targetId: created.id,
      metadata: {
        totalMinutes: totals.totalMinutes,
        totalCents: totals.totalCents,
        lineCount: lineDrafts.length,
      },
    });

    return jsonOk({ invoice: created }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
