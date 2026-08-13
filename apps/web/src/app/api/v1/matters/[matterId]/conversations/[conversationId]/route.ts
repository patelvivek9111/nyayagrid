import { and, asc, eq } from "drizzle-orm";
import { aiArtifacts, conversations, messages } from "@nyayagrid/database";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; conversationId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId, conversationId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.matterId, matterId),
          eq(conversations.organizationId, matter.organizationId),
        ),
      )
      .limit(1);
    if (!conversation) return jsonError("NOT_FOUND", "Conversation not found", 404);

    const messageRows = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.matterId, matterId),
          eq(messages.organizationId, matter.organizationId),
        ),
      )
      .orderBy(asc(messages.createdAt));

    const artifacts = await db
      .select()
      .from(aiArtifacts)
      .where(
        and(
          eq(aiArtifacts.conversationId, conversationId),
          eq(aiArtifacts.matterId, matterId),
          eq(aiArtifacts.organizationId, matter.organizationId),
        ),
      )
      .orderBy(asc(aiArtifacts.createdAt));

    return jsonOk({ conversation, messages: messageRows, artifacts });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { matterId, conversationId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "matters.view",
    });
    const body = (await request.json()) as { title?: string };
    if (!body.title?.trim()) {
      return jsonError("VALIDATION_ERROR", "title is required", 400);
    }
    const [updated] = await db
      .update(conversations)
      .set({ title: body.title.trim(), updatedAt: new Date() })
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.matterId, matterId),
          eq(conversations.organizationId, matter.organizationId),
        ),
      )
      .returning();
    if (!updated) return jsonError("NOT_FOUND", "Conversation not found", 404);
    return jsonOk({ conversation: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}
