import { z } from "zod";
import { getProsecutionOverview } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

export async function GET(request: Request, context: { params: Promise<{ caseId: string }> }) {
  try {
    const { db, user } = await requireUser(request.headers);
    const { caseId } = await context.params;
    const organizationId = new URL(request.url).searchParams.get("organizationId");
    if (!organizationId || !z.string().uuid().safeParse(organizationId).success || !z.string().uuid().safeParse(caseId).success) {
      return jsonError("VALIDATION_ERROR", "organizationId and caseId must be ids", 400);
    }
    const overview = await getProsecutionOverview(db, { userId: user.id, organizationId, caseId });
    return jsonOk({ overview });
  } catch (error) {
    return handleRouteError(error);
  }
}
