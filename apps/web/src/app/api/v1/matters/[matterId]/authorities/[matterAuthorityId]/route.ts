import { eq, and } from "@nyayagrid/database";
import { matterAuthorities } from "@nyayagrid/database";
import { updateMatterAuthoritySchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { updateMatterAuthorityStatus } from "@nyayagrid/research";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; matterAuthorityId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { matterId, matterAuthorityId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "research.run",
    });
    const body = updateMatterAuthoritySchema.parse(await request.json());

    const [link] = await db
      .select({ authorityId: matterAuthorities.authorityId })
      .from(matterAuthorities)
      .where(
        and(
          eq(matterAuthorities.id, matterAuthorityId),
          eq(matterAuthorities.organizationId, matter.organizationId),
          eq(matterAuthorities.matterId, matterId),
        ),
      )
      .limit(1);
    if (!link) return jsonError("NOT_FOUND", "Matter authority not found", 404);

    const matterAuthority = await updateMatterAuthorityStatus({
      db,
      organizationId: matter.organizationId,
      matterId,
      authorityId: link.authorityId,
      userId: user.id,
      status: body.status,
      relevanceNote: body.relevanceNote,
    });
    return jsonOk({ matterAuthority });
  } catch (error) {
    return handleRouteError(error);
  }
}
