import { and, eq } from "drizzle-orm";
import { contacts } from "@nyayagrid/database";
import { updateContactSchema } from "@nyayagrid/validation";
import { requireCapability, writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ contactId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { contactId } = await params;
    const { db, user } = await requireUser(request.headers);
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!contact) return jsonError("NOT_FOUND", "Contact not found", 404);
    await requireCapability(db, {
      userId: user.id,
      organizationId: contact.organizationId,
      capability: "clients.view",
    });
    return jsonOk({ contact });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { contactId } = await params;
    const { db, user } = await requireUser(request.headers);
    const [existing] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!existing) return jsonError("NOT_FOUND", "Contact not found", 404);
    await requireCapability(db, {
      userId: user.id,
      organizationId: existing.organizationId,
      capability: "clients.edit",
    });
    const body = updateContactSchema.parse(await request.json());
    const [updated] = await db
      .update(contacts)
      .set({
        displayName: body.displayName ?? existing.displayName,
        email:
          body.email === undefined
            ? existing.email
            : body.email === "" || body.email == null
              ? null
              : body.email,
        phone: body.phone === undefined ? existing.phone : body.phone || null,
        title: body.title === undefined ? existing.title : body.title || null,
        notes: body.notes === undefined ? existing.notes : body.notes || null,
        updatedAt: new Date(),
      })
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, existing.organizationId)))
      .returning();
    await writeAuditEvent(db, {
      organizationId: existing.organizationId,
      actorUserId: user.id,
      action: "contact.updated",
      targetType: "contact",
      targetId: contactId,
    });
    return jsonOk({ contact: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { contactId } = await params;
    const { db, user } = await requireUser(request.headers);
    const [existing] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!existing) return jsonError("NOT_FOUND", "Contact not found", 404);
    await requireCapability(db, {
      userId: user.id,
      organizationId: existing.organizationId,
      capability: "clients.edit",
    });
    await db
      .delete(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, existing.organizationId)));
    await writeAuditEvent(db, {
      organizationId: existing.organizationId,
      actorUserId: user.id,
      action: "contact.deleted",
      targetType: "contact",
      targetId: contactId,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
