import { getApproval, reviewApproval } from "@nyayagrid/agents";
import { reviewAgentApprovalSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { getEmbeddings } from "@/lib/infra";

type Params = { params: Promise<{ matterId: string; approvalId: string }> };

/**
 * Reviews a proposed agent action. Approving performs the underlying write attributed to the
 * reviewing user; rejecting leaves nothing written.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, approvalId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });

    const approval = await getApproval({ db, organizationId: matter.organizationId, approvalId });
    if (!approval || approval.matterId !== matterId) {
      return jsonError("NOT_FOUND", "Approval not found", 404);
    }

    const body = reviewAgentApprovalSchema.parse(await request.json());
    const result = await reviewApproval({
      db,
      organizationId: matter.organizationId,
      approvalId,
      userId: user.id,
      action: body.action,
      edits: body.edits,
      note: body.note,
      embeddings: getEmbeddings(),
    });

    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
