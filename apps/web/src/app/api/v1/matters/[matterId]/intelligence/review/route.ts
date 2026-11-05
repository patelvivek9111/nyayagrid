import { requireMatterAccess } from "@nyayagrid/permissions";
import {
  getReviewQueueCounts,
  listMatterMemories,
  listProposedAnalysisForReview,
  listProposedIntelligence,
} from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
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
    const [counts, proposed, analysis, memoryRows] = await Promise.all([
      getReviewQueueCounts({
        db,
        organizationId: matter.organizationId,
        matterId,
      }),
      listProposedIntelligence({
        db,
        organizationId: matter.organizationId,
        matterId,
      }),
      listProposedAnalysisForReview({
        db,
        organizationId: matter.organizationId,
        matterId,
      }),
      listMatterMemories({
        db,
        organizationId: matter.organizationId,
        matterId,
        status: "proposed",
      }),
    ]);
    const memories = memoryRows.filter((row) => !row.supersededBy);
    return jsonOk({ counts, ...proposed, analysis, memories });
  } catch (error) {
    return handleRouteError(error);
  }
}
