import { eq } from "drizzle-orm";
import { inboundEmails } from "@nyayagrid/database";
import { fileInboundEmailSchema } from "@nyayagrid/validation";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { filePlainTextToMatter } from "@/server/file-text-to-matter";

type Params = { params: Promise<{ emailId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { emailId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = fileInboundEmailSchema.parse(await request.json());

    const [existing] = await db
      .select()
      .from(inboundEmails)
      .where(eq(inboundEmails.id, emailId))
      .limit(1);
    if (!existing) return jsonError("NOT_FOUND", "Inbound email not found", 404);
    if (existing.status !== "pending") {
      return jsonError("CONFLICT", "Only pending emails can be filed", 409);
    }

    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId: body.matterId,
      minAccess: "edit",
      capability: "documents.upload",
    });
    if (matter.organizationId !== existing.organizationId) {
      return jsonError("FORBIDDEN", "Matter is not in this organization", 403);
    }

    const text = `From: ${existing.fromAddress}\nSubject: ${existing.subject}\n\n${existing.body}`;
    const filename = `email-${emailId.slice(0, 8)}.txt`;
    const { documentId } = await filePlainTextToMatter({
      db,
      organizationId: existing.organizationId,
      matterId: body.matterId,
      userId: user.id,
      filename,
      title: existing.subject,
      text,
      auditAction: "inbound_email.filed",
    });

    const [email] = await db
      .update(inboundEmails)
      .set({
        status: "filed",
        matterId: body.matterId,
        documentId,
        updatedAt: new Date(),
      })
      .where(eq(inboundEmails.id, emailId))
      .returning();

    await writeAuditEvent(db, {
      organizationId: existing.organizationId,
      actorUserId: user.id,
      matterId: body.matterId,
      action: "inbound_email.filed",
      targetType: "inbound_email",
      targetId: emailId,
      metadata: { documentId },
    });

    return jsonOk({ email });
  } catch (error) {
    return handleRouteError(error);
  }
}
