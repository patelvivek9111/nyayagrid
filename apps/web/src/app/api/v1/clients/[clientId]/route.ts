import { and, eq } from "drizzle-orm";
import { clients } from "@nyayagrid/database";
import { updateClientSchema } from "@nyayagrid/validation";
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
    return jsonOk({ client });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const { db, user } = await requireUser(request.headers);
    const [existing] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!existing) return jsonError("NOT_FOUND", "Client not found", 404);
    await requireCapability(db, {
      userId: user.id,
      organizationId: existing.organizationId,
      capability: "clients.edit",
    });
    const body = updateClientSchema.parse(await request.json());
    const [updated] = await db
      .update(clients)
      .set({
        ...body,
        email: body.email === "" ? null : body.email,
        updatedAt: new Date(),
      })
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, existing.organizationId)))
      .returning();
    await writeAuditEvent(db, {
      organizationId: existing.organizationId,
      actorUserId: user.id,
      action: body.status === "archived" ? "client.archived" : "client.updated",
      targetType: "client",
      targetId: clientId,
    });
    return jsonOk({ client: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}
