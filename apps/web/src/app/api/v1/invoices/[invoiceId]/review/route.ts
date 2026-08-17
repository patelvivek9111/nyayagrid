import { eq } from "drizzle-orm";
import { invoices } from "@nyayagrid/database";
import { reviewInvoiceSchema } from "@nyayagrid/validation";
import { requireCapability, writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ invoiceId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { invoiceId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = reviewInvoiceSchema.parse(await request.json());

    const [existing] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!existing) return jsonError("NOT_FOUND", "Invoice not found", 404);

    await requireCapability(db, {
      userId: user.id,
      organizationId: existing.organizationId,
      capability: "organization.manage",
    });

    if (body.action === "issue" && existing.status !== "draft") {
      return jsonError("CONFLICT", "Only draft invoices can be issued", 409);
    }
    if (body.action === "void" && existing.status === "void") {
      return jsonError("CONFLICT", "Invoice is already void", 409);
    }

    const [invoice] = await db
      .update(invoices)
      .set({
        status: body.action === "issue" ? "issued" : "void",
        issuedAt: body.action === "issue" ? new Date() : existing.issuedAt,
        voidedAt: body.action === "void" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId))
      .returning();

    await writeAuditEvent(db, {
      organizationId: existing.organizationId,
      actorUserId: user.id,
      matterId: existing.matterId,
      action: body.action === "issue" ? "invoice.issued" : "invoice.voided",
      targetType: "invoice",
      targetId: invoiceId,
    });

    return jsonOk({ invoice });
  } catch (error) {
    return handleRouteError(error);
  }
}
