import { and, desc, eq, inArray } from "drizzle-orm";
import { clients, matterMembers, matters } from "@nyayagrid/database";
import { createMatterSchema } from "@nyayagrid/validation";
import {
  listAuthorizedMatterIds,
  requireCapability,
  writeAuditEvent,
} from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const organizationId = new URL(request.url).searchParams.get("organizationId");
    if (!organizationId) return jsonError("VALIDATION_ERROR", "organizationId required", 400);
    await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability: "matters.view",
    });
    const allowed = await listAuthorizedMatterIds(db, { userId: user.id, organizationId });
    if (allowed !== "all" && allowed.length === 0) return jsonOk({ matters: [] });

    const rows = await db
      .select({
        matter: matters,
        clientDisplayName: clients.displayName,
      })
      .from(matters)
      .innerJoin(clients, eq(matters.clientId, clients.id))
      .where(
        allowed === "all"
          ? eq(matters.organizationId, organizationId)
          : and(eq(matters.organizationId, organizationId), inArray(matters.id, allowed)),
      )
      .orderBy(desc(matters.updatedAt));

    return jsonOk({
      matters: rows.map((r) => ({ ...r.matter, clientDisplayName: r.clientDisplayName })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = createMatterSchema.parse(await request.json());
    await requireCapability(db, {
      userId: user.id,
      organizationId: body.organizationId,
      capability: "matters.create",
    });

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, body.clientId), eq(clients.organizationId, body.organizationId)))
      .limit(1);
    if (!client) return jsonError("VALIDATION_ERROR", "Client not found in organization", 400);

    const matterNumber =
      body.matterNumber?.trim() ||
      `M-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`;

    const created = await db.transaction(async (tx) => {
      const [matter] = await tx
        .insert(matters)
        .values({
          organizationId: body.organizationId,
          clientId: body.clientId,
          matterNumber,
          title: body.title,
          description: body.description ?? null,
          practiceArea: body.practiceArea ?? null,
          jurisdiction: body.jurisdiction ?? null,
          court: body.court ?? null,
          status: body.status ?? "open",
          createdByUserId: user.id,
        })
        .returning();
      await tx.insert(matterMembers).values({
        organizationId: body.organizationId,
        matterId: matter!.id,
        userId: user.id,
        access: "manage",
      });
      return matter!;
    });

    await writeAuditEvent(db, {
      organizationId: body.organizationId,
      actorUserId: user.id,
      matterId: created.id,
      action: "matter.created",
      targetType: "matter",
      targetId: created.id,
    });

    return jsonOk({ matter: created }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
