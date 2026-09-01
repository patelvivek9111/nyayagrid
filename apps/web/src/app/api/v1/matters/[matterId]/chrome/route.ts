import { clients } from "@nyayagrid/database";
import { eq } from "drizzle-orm";
import { getReviewQueueCounts } from "@nyayagrid/intelligence";
import {
  resolveMatterJurisdictionContext,
  uiJurisdictionContract,
} from "@nyayagrid/jurisdiction";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { totalPendingReviewCount } from "@/lib/review-queue";

type Params = { params: Promise<{ matterId: string }> };

/** Lightweight matter metadata for shared tab chrome — avoids the full overview payload. */
export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter, membership } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });
    const canReview =
      membership.capabilities.has("timeline.manage") ||
      membership.capabilities.has("organization.manage");
    const canReviewAnalysis =
      membership.capabilities.has("documents.edit") ||
      membership.capabilities.has("organization.manage");
    let pendingCount = 0;
    try {
      const queues = await getReviewQueueCounts({
        db,
        organizationId: matter.organizationId,
        matterId: matter.id,
      });
      pendingCount = typeof queues.pendingCount === "number"
        ? queues.pendingCount
        : totalPendingReviewCount(queues);
    } catch {
      pendingCount = 0;
    }
    const [clientRow] = await db
      .select({ displayName: clients.displayName })
      .from(clients)
      .where(eq(clients.id, matter.clientId))
      .limit(1);
    const jurisdictionContext = await resolveMatterJurisdictionContext({
      db,
      organizationId: matter.organizationId,
      matterId: matter.id,
    });
    return jsonOk({
      matter: {
        id: matter.id,
        title: matter.title,
        matterNumber: matter.matterNumber,
        status: matter.status,
      },
      client: clientRow ? { displayName: clientRow.displayName } : null,
      organizationId: matter.organizationId,
      jurisdictionContext: jurisdictionContext
        ? uiJurisdictionContract(jurisdictionContext)
        : null,
      review: {
        pendingCount,
        canReview,
        canReviewAnalysis,
      },
      canUpload: membership.capabilities.has("documents.upload"),
      canEdit: membership.capabilities.has("matters.edit"),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
