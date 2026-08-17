import { desc, eq } from "drizzle-orm";
import { inboundEmails } from "@nyayagrid/database";
import { createInboundEmailSchema } from "@nyayagrid/validation";
import { requireCapability, writeAuditEvent } from "@nyayagrid/permissions";
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
      capability: "documents.upload",
    });

    const rows = await db
      .select()
      .from(inboundEmails)
      .where(eq(inboundEmails.organizationId, organizationId))
      .orderBy(desc(inboundEmails.createdAt));

    return jsonOk({ emails: rows });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = createInboundEmailSchema.parse(await request.json());
    await requireCapability(db, {
      userId: user.id,
      organizationId: body.organizationId,
      capability: "documents.upload",
    });

    const [email] = await db
      .insert(inboundEmails)
      .values({
        organizationId: body.organizationId,
        fromAddress: body.fromAddress,
        subject: body.subject,
        body: body.body,
        status: "pending",
        createdByUserId: user.id,
      })
      .returning();

    await writeAuditEvent(db, {
      organizationId: body.organizationId,
      actorUserId: user.id,
      action: "inbound_email.captured",
      targetType: "inbound_email",
      targetId: email!.id,
    });

    return jsonOk({ email }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
