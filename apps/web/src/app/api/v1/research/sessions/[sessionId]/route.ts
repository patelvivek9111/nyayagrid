import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { requireResearchSessionAccess } from "@/server/research-access";
import { listResearchSessionThread } from "@nyayagrid/research";

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
    const session = await requireResearchSessionAccess(db, {
      userId: user.id,
      organizationId,
      sessionId,
    });
    if (!session) return jsonError("NOT_FOUND", "Research session not found", 404);
    const queries = await listResearchSessionThread({
      db,
      organizationId,
      sessionId: session.id,
    });
    return jsonOk({ session, queries });
  } catch (error) {
    return handleRouteError(error);
  }
}
