import { asc, eq } from "drizzle-orm";
import { contacts } from "@nyayagrid/database";
import { createContactSchema } from "@nyayagrid/validation";
import { requireCapability, writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) {
      return jsonOk(
        { error: { code: "VALIDATION_ERROR", message: "organizationId required" } },
        { status: 400 },
      );
    }
    await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability: "clients.view",
    });
    const rows = await db
      .select()
      .from(contacts)
      .where(eq(contacts.organizationId, organizationId))
      .orderBy(asc(contacts.displayName));
    return jsonOk({ contacts: rows });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = createContactSchema.parse(await request.json());
    await requireCapability(db, {
      userId: user.id,
      organizationId: body.organizationId,
      capability: "clients.edit",
    });
    const [created] = await db
      .insert(contacts)
      .values({
        organizationId: body.organizationId,
        displayName: body.displayName,
        email: body.email === "" || body.email == null ? null : body.email,
        phone: body.phone || null,
        title: body.title || null,
        notes: body.notes || null,
        createdByUserId: user.id,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId: body.organizationId,
      actorUserId: user.id,
      action: "contact.created",
      targetType: "contact",
      targetId: created!.id,
    });
    return jsonOk({ contact: created }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
