import { and, desc, eq } from "drizzle-orm";
import { conversations, messages } from "@nyayagrid/database";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { conversationListPreview } from "@/lib/conversation-list-preview";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "50") || 50, 100);

    const rows = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        createdByUserId: conversations.createdByUserId,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.matterId, matterId),
          eq(conversations.organizationId, matter.organizationId),
        ),
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(limit);

    const withPreview = await Promise.all(
      rows.map(async (row) => {
        const recent = await db
          .select({ content: messages.content, role: messages.role })
          .from(messages)
          .where(eq(messages.conversationId, row.id))
          .orderBy(desc(messages.createdAt))
          .limit(20);
        const snippet = conversationListPreview(recent);
        return {
          ...row,
          preview: snippet.preview,
          lastRole: snippet.lastRole,
        };
      }),
    );

    return jsonOk({ conversations: withPreview });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "matters.view",
    });
    const body = (await request.json().catch(() => ({}))) as { title?: string };
    const [created] = await db
      .insert(conversations)
      .values({
        organizationId: matter.organizationId,
        matterId,
        createdByUserId: user.id,
        title: body.title?.trim() || "New chat",
      })
      .returning();
    return jsonOk({ conversation: created }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
