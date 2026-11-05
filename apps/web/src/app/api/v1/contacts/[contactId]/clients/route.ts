import { and, eq } from "drizzle-orm";
import { clientContacts, clients, contacts } from "@nyayagrid/database";
import { linkClientContactSchema } from "@nyayagrid/validation";
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
    const links = await db
      .select({
        id: clientContacts.id,
        clientId: clientContacts.clientId,
        contactId: clientContacts.contactId,
        relationshipRole: clientContacts.relationshipRole,
        createdAt: clientContacts.createdAt,
        clientDisplayName: clients.displayName,
      })
      .from(clientContacts)
      .innerJoin(clients, eq(clients.id, clientContacts.clientId))
      .where(
        and(
          eq(clientContacts.contactId, contactId),
          eq(clientContacts.organizationId, contact.organizationId),
        ),
      );
    return jsonOk({ links });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { contactId } = await params;
    const { db, user } = await requireUser(request.headers);
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!contact) return jsonError("NOT_FOUND", "Contact not found", 404);
    await requireCapability(db, {
      userId: user.id,
      organizationId: contact.organizationId,
      capability: "clients.edit",
    });
    const body = linkClientContactSchema.parse(await request.json());
    if (!body.clientId) return jsonError("VALIDATION_ERROR", "clientId is required", 400);

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, body.clientId), eq(clients.organizationId, contact.organizationId)))
      .limit(1);
    if (!client) return jsonError("NOT_FOUND", "Client not found in organization", 404);

    const [link] = await db
      .insert(clientContacts)
      .values({
        organizationId: contact.organizationId,
        clientId: client.id,
        contactId: contact.id,
        relationshipRole: body.relationshipRole,
        createdByUserId: user.id,
      })
      .onConflictDoNothing()
      .returning();

    if (!link) {
      const [existing] = await db
        .select()
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clientId, client.id),
            eq(clientContacts.contactId, contact.id),
            eq(clientContacts.organizationId, contact.organizationId),
          ),
        )
        .limit(1);
      return jsonOk({ link: existing });
    }

    await writeAuditEvent(db, {
      organizationId: contact.organizationId,
      actorUserId: user.id,
      action: "contact.linked_client",
      targetType: "client_contact",
      targetId: link.id,
      metadata: {
        clientId: client.id,
        contactId: contact.id,
        relationshipRole: body.relationshipRole,
      },
    });
    return jsonOk({ link }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { contactId } = await params;
    const { db, user } = await requireUser(request.headers);
    const url = new URL(request.url);
    const linkId = url.searchParams.get("linkId");
    if (!linkId) return jsonError("VALIDATION_ERROR", "linkId is required", 400);

    const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!contact) return jsonError("NOT_FOUND", "Contact not found", 404);
    await requireCapability(db, {
      userId: user.id,
      organizationId: contact.organizationId,
      capability: "clients.edit",
    });

    const [removed] = await db
      .delete(clientContacts)
      .where(
        and(
          eq(clientContacts.id, linkId),
          eq(clientContacts.contactId, contactId),
          eq(clientContacts.organizationId, contact.organizationId),
        ),
      )
      .returning();
    if (!removed) return jsonError("NOT_FOUND", "Client link not found", 404);

    await writeAuditEvent(db, {
      organizationId: contact.organizationId,
      actorUserId: user.id,
      action: "contact.unlinked_client",
      targetType: "client_contact",
      targetId: removed.id,
      metadata: {
        clientId: removed.clientId,
        contactId: removed.contactId,
      },
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
