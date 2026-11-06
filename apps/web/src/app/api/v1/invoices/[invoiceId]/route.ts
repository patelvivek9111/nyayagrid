import { and, eq } from "drizzle-orm";
import {
  computeLineAmountCents,
  invoiceLineItems,
  invoices,
  rollupInvoiceTotals,
} from "@nyayagrid/database";
import { updateDraftInvoiceSchema } from "@nyayagrid/validation";
import { requireCapability, requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ invoiceId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { invoiceId } = await params;
    const { db, user } = await requireUser(request.headers);

    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!invoice) return jsonError("NOT_FOUND", "Invoice not found", 404);

    await requireCapability(db, {
      userId: user.id,
      organizationId: invoice.organizationId,
      capability: "matters.edit",
    });
    await requireMatterAccess(db, {
      userId: user.id,
      matterId: invoice.matterId,
      minAccess: "read",
      capability: "matters.view",
    });

    const lineItems = await db
      .select()
      .from(invoiceLineItems)
      .where(
        and(
          eq(invoiceLineItems.invoiceId, invoice.id),
          eq(invoiceLineItems.organizationId, invoice.organizationId),
        ),
      );

    const totals = rollupInvoiceTotals(
      lineItems.map((line) => ({
        minutes: line.minutes,
        billable: line.billable,
        amountCents: line.amountCents,
      })),
    );

    return jsonOk({
      invoice: {
        ...invoice,
        lineItems,
        totalMinutes: invoice.totalMinutes ?? totals.totalMinutes,
        totalCents: invoice.totalCents ?? totals.totalCents,
        hasCompleteRates: totals.hasCompleteRates,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { invoiceId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = updateDraftInvoiceSchema.parse(await request.json());

    const [existing] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!existing) return jsonError("NOT_FOUND", "Invoice not found", 404);

    await requireCapability(db, {
      userId: user.id,
      organizationId: existing.organizationId,
      capability: "matters.edit",
    });
    await requireMatterAccess(db, {
      userId: user.id,
      matterId: existing.matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });

    if (existing.status !== "draft") {
      return jsonError("CONFLICT", "Only draft invoices can be updated", 409);
    }

    const updated = await db.transaction(async (tx) => {
      if (body.lineItems?.length) {
        for (const patch of body.lineItems) {
          const [line] = await tx
            .select()
            .from(invoiceLineItems)
            .where(
              and(
                eq(invoiceLineItems.id, patch.id),
                eq(invoiceLineItems.invoiceId, invoiceId),
                eq(invoiceLineItems.organizationId, existing.organizationId),
              ),
            )
            .limit(1);
          if (!line) {
            throw Object.assign(new Error("Invoice line item not found on this draft"), {
              code: "NOT_FOUND",
              status: 404,
            });
          }
          const nextRate =
            patch.hourlyRateCents !== undefined ? patch.hourlyRateCents : line.hourlyRateCents;
          const nextDescription =
            patch.description !== undefined ? patch.description : line.description;
          await tx
            .update(invoiceLineItems)
            .set({
              description: nextDescription,
              hourlyRateCents: nextRate,
              amountCents: computeLineAmountCents(line.minutes, nextRate, line.billable),
              updatedAt: new Date(),
            })
            .where(eq(invoiceLineItems.id, line.id));
        }
      }

      const lineItems = await tx
        .select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.invoiceId, invoiceId));
      const totals = rollupInvoiceTotals(
        lineItems.map((line) => ({
          minutes: line.minutes,
          billable: line.billable,
          amountCents: line.amountCents,
        })),
      );

      const [invoice] = await tx
        .update(invoices)
        .set({
          notes: body.notes !== undefined ? body.notes : existing.notes,
          totalMinutes: totals.totalMinutes,
          totalCents: totals.totalCents,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoiceId))
        .returning();

      return { invoice: invoice!, lineItems, totals };
    });

    await writeAuditEvent(db, {
      organizationId: existing.organizationId,
      actorUserId: user.id,
      matterId: existing.matterId,
      action: "invoice.updated",
      targetType: "invoice",
      targetId: invoiceId,
      metadata: {
        totalMinutes: updated.totals.totalMinutes,
        totalCents: updated.totals.totalCents,
      },
    });

    return jsonOk({
      invoice: {
        ...updated.invoice,
        lineItems: updated.lineItems,
        hasCompleteRates: updated.totals.hasCompleteRates,
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "NOT_FOUND"
    ) {
      const message =
        error instanceof Error
          ? error.message
          : "Invoice line item not found on this draft";
      return jsonError("NOT_FOUND", message, 404);
    }
    return handleRouteError(error);
  }
}
