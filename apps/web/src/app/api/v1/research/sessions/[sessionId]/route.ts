import { requireAnyCapability } from "@nyayagrid/permissions";
import { getResearchSession } from "@nyayagrid/research";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

const RESEARCH_CAPABILITIES = ["research.run", "matters.view"] as const;

type Params = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { sessionId } = await params;
    const { db, user } = await requireUser(request.headers);
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) {
      return jsonError("VALIDATION_ERROR", "organizationId is required", 400);
    }
    await requireAnyCapability(db, {
      userId: user.id,
      organizationId,
      capabilities: [...RESEARCH_CAPABILITIES],
    });
    const session = await getResearchSession({ db, organizationId, sessionId });
    if (!session) return jsonError("NOT_FOUND", "Research session not found", 404);
    return jsonOk({ session });
  } catch (error) {
    return handleRouteError(error);
  }
}
