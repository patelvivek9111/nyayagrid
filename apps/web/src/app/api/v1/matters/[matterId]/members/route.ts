import { and, eq } from "drizzle-orm";
import { matterMembers, memberships } from "@nyayagrid/database";
import { assignMatterMemberSchema } from "@nyayagrid/validation";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = assignMatterMemberSchema.parse(await request.json());
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });

    const [membership] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, matter.organizationId),
          eq(memberships.userId, body.userId),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    if (!membership) {
      return jsonError("VALIDATION_ERROR", "User is not an active member of this organization", 400);
    }

    const [existing] = await db
      .select()
      .from(matterMembers)
      .where(and(eq(matterMembers.matterId, matterId), eq(matterMembers.userId, body.userId)))
      .limit(1);

    const member =
      existing ??
      (
        await db
          .insert(matterMembers)
          .values({
            organizationId: matter.organizationId,
            matterId,
            userId: body.userId,
            access: body.access,
          })
          .returning()
      )[0];

    await writeAuditEvent(db, {
      organizationId: matter.organizationId,
      actorUserId: user.id,
      matterId,
      action: "matter_member.assigned",
      targetType: "matter_member",
      targetId: member!.id,
      metadata: { userId: body.userId, access: body.access },
    });

    return jsonOk({ member }, { status: existing ? 200 : 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
