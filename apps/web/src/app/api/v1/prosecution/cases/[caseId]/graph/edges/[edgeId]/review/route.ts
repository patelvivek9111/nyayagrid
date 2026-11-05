import { z } from "zod";
import { reviewProsecutionGraphEdge } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ caseId: string; edgeId: string }> };

const reviewSchema = z.object({
  organizationId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  rejectionReason: z.string().trim().max(4000).nullable().optional(),
});

export async function POST(request: Request, { params }: Params) {
  try {
    const { caseId, edgeId } = await params;
    if (
      !z.string().uuid().safeParse(caseId).success ||
      !z.string().uuid().safeParse(edgeId).success
    ) {
      return jsonError("VALIDATION_ERROR", "caseId and edgeId must be UUIDs", 400);
    }
    const { db, user } = await requireUser(request.headers);
    const body = reviewSchema.parse(await request.json());
    const edge = await reviewProsecutionGraphEdge(db, {
      userId: user.id,
      organizationId: body.organizationId,
      caseId,
      edgeId,
      action: body.action,
      rejectionReason: body.rejectionReason,
    });
    return jsonOk({ edge });
  } catch (error) {
    return handleRouteError(error);
  }
}
