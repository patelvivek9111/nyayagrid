import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { invoiceLineItems, invoices, timeEntries } from "@nyayagrid/database";
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
        : await db.select().from(invoiceLineItems).where(inArray(invoiceLineItems.invoiceId, ids));

    return jsonOk({
      invoices: rows.map((invoice) => ({
        ...invoice,
        lineItems: lines.filter((line) => line.invoiceId === invoice.id),
        totalMinutes: lines
          .filter((line) => line.invoiceId === invoice.id)
          .reduce((sum, line) => sum + line.minutes, 0),
      })),
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
      return jsonError("FORBIDDEN", "Matter is not in this organization", 403);
    }

    const billed = await db.select({ timeEntryId: invoiceLineItems.timeEntryId }).from(invoiceLineItems);
    const billedIds = billed.map((row) => row.timeEntryId);

    const posted = await db
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

    if (posted.length === 0) {
      return jsonError("VALIDATION_ERROR", "No unbilled posted time on this matter", 400);
    }

    const invoiceNumber = `SYNTH-INV-${Date.now().toString(36).toUpperCase()}`;
    const created = await db.transaction(async (tx) => {
      const [invoice] = await tx
        .insert(invoices)
        .values({
          organizationId: body.organizationId,
          matterId: body.matterId,
          invoiceNumber,
          status: "draft",
          notes: body.notes ?? "Draft invoice from posted time. Minutes only — not a billable amount.",
          createdByUserId: user.id,
        })
        .returning();
      if (!invoice) throw new Error("Failed to create invoice");
      await tx.insert(invoiceLineItems).values(
        posted.map((entry) => ({
          invoiceId: invoice.id,
          organizationId: body.organizationId,
          timeEntryId: entry.id,
          description: entry.description,
          minutes: entry.minutes,
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
    });

    return jsonOk({ invoice: created }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
