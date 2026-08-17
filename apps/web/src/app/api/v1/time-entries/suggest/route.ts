import { and, desc, eq } from "drizzle-orm";
import { conversations, messages, timeEntries } from "@nyayagrid/database";
import { suggestTimeFromChatSchema } from "@nyayagrid/validation";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { createNotification } from "@/server/notifications";

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = suggestTimeFromChatSchema.parse(await request.json());
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId: body.matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, body.conversationId),
          eq(conversations.matterId, body.matterId),
          eq(conversations.organizationId, matter.organizationId),
        ),
      )
      .limit(1);
    if (!conversation) return jsonError("NOT_FOUND", "Conversation not found on this matter", 404);

    const [lastMessage] = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(desc(messages.createdAt))
      .limit(1);

    const description = [
      conversation.title?.trim() || "Matter chat",
      lastMessage?.content ? lastMessage.content.slice(0, 280) : null,
    ]
      .filter(Boolean)
      .join(" — ");

    const [entry] = await db
      .insert(timeEntries)
      .values({
        organizationId: matter.organizationId,
        matterId: body.matterId,
        userId: user.id,
        source: "chat",
        status: "suggested",
        description,
        minutes: body.minutes ?? 6,
        conversationId: conversation.id,
      })
      .returning();

    await createNotification(db, {
      organizationId: matter.organizationId,
      userId: user.id,
      kind: "time_suggestion",
      title: "Time suggestion from chat",
      body: description,
      href: "/app/time",
      matterId: body.matterId,
    });

    await writeAuditEvent(db, {
      organizationId: matter.organizationId,
      actorUserId: user.id,
      matterId: body.matterId,
      action: "time_entry.suggested",
      targetType: "time_entry",
      targetId: entry!.id,
    });

    return jsonOk({ entry }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
