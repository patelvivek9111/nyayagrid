import { eq } from "drizzle-orm";
import { inboundEmails } from "@nyayagrid/database";
import { requireCapability, writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ emailId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { emailId } = await params;
    const { db, user } = await requireUser(request.headers);
    const [existing] = await db
      .select()
      .from(inboundEmails)
      .where(eq(inboundEmails.id, emailId))
      .limit(1);
    if (!existing) return jsonError("NOT_FOUND", "Inbound email not found", 404);
    if (existing.status !== "pending") {
      return jsonError("CONFLICT", "Only pending emails can be discarded", 409);
    }

    await requireCapability(db, {
      userId: user.id,
      organizationId: existing.organizationId,
      capability: "documents.upload",
    });

    const [email] = await db
      .update(inboundEmails)
      .set({ status: "discarded", updatedAt: new Date() })
      .where(eq(inboundEmails.id, emailId))
      .returning();

    await writeAuditEvent(db, {
      organizationId: existing.organizationId,
      actorUserId: user.id,
      action: "inbound_email.discarded",
      targetType: "inbound_email",
      targetId: emailId,
    });

    return jsonOk({ email });
  } catch (error) {
    return handleRouteError(error);
  }
}
