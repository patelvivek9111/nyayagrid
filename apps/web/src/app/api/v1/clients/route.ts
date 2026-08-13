import { and, eq, ne } from "drizzle-orm";
import { clients } from "@nyayagrid/database";
import { createClientSchema, updateClientSchema } from "@nyayagrid/validation";
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
    const includeArchived = url.searchParams.get("includeArchived") === "1";
    const rows = await db
      .select()
      .from(clients)
      .where(
        includeArchived
          ? eq(clients.organizationId, organizationId)
          : and(eq(clients.organizationId, organizationId), ne(clients.status, "archived")),
      );
    return jsonOk({ clients: rows });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = createClientSchema.parse(await request.json());
    await requireCapability(db, {
      userId: user.id,
      organizationId: body.organizationId,
      capability: "clients.edit",
    });
    const [created] = await db
      .insert(clients)
      .values({
        organizationId: body.organizationId,
        clientType: body.clientType,
        displayName: body.displayName,
        firstName: body.firstName || null,
        lastName: body.lastName || null,
        organizationName: body.organizationName || null,
        email: body.email || null,
        phone: body.phone || null,
        notes: body.notes || null,
        createdByUserId: user.id,
      })
      .returning();
    await writeAuditEvent(db, {
      organizationId: body.organizationId,
      actorUserId: user.id,
      action: "client.created",
      targetType: "client",
      targetId: created!.id,
    });
    return jsonOk({ client: created }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
