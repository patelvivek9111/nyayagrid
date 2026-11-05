import { and, eq } from "drizzle-orm";
import { clientContacts, clients, contacts } from "@nyayagrid/database";
import { linkClientContactSchema } from "@nyayagrid/validation";
import { requireCapability, writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ clientId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const { db, user } = await requireUser(request.headers);
    const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!client) return jsonError("NOT_FOUND", "Client not found", 404);
    await requireCapability(db, {
      userId: user.id,
      organizationId: client.organizationId,
      capability: "clients.view",
    });
    const links = await db
      .select({
        id: clientContacts.id,
        clientId: clientContacts.clientId,
        contactId: clientContacts.contactId,
        relationshipRole: clientContacts.relationshipRole,
        createdAt: clientContacts.createdAt,
        contactDisplayName: contacts.displayName,
        contactEmail: contacts.email,
        contactPhone: contacts.phone,
        contactTitle: contacts.title,
      })
      .from(clientContacts)
      .innerJoin(contacts, eq(contacts.id, clientContacts.contactId))
      .where(
        and(
          eq(clientContacts.clientId, clientId),
          eq(clientContacts.organizationId, client.organizationId),
        ),
      );
    return jsonOk({ links });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const { db, user } = await requireUser(request.headers);
    const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!client) return jsonError("NOT_FOUND", "Client not found", 404);
    await requireCapability(db, {
      userId: user.id,
      organizationId: client.organizationId,
      capability: "clients.edit",
    });
    const body = linkClientContactSchema.parse(await request.json());
    if (!body.contactId) return jsonError("VALIDATION_ERROR", "contactId is required", 400);

    const [contact] = await db
      .select()
      .from(contacts)
      .where(
        and(eq(contacts.id, body.contactId), eq(contacts.organizationId, client.organizationId)),
      )
      .limit(1);
    if (!contact) return jsonError("NOT_FOUND", "Contact not found in organization", 404);

    const [link] = await db
      .insert(clientContacts)
      .values({
        organizationId: client.organizationId,
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
            eq(clientContacts.organizationId, client.organizationId),
          ),
        )
        .limit(1);
      return jsonOk({ link: existing });
    }

    await writeAuditEvent(db, {
      organizationId: client.organizationId,
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
