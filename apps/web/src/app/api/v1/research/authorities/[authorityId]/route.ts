import { requireAnyCapability } from "@nyayagrid/permissions";
import { getAuthorityDetail } from "@nyayagrid/research";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

const RESEARCH_CAPABILITIES = ["research.run", "matters.view"] as const;

type Params = { params: Promise<{ authorityId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { authorityId } = await params;
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
    const detail = await getAuthorityDetail({ db, authorityId });
    if (!detail) return jsonError("NOT_FOUND", "Authority not found", 404);
    return jsonOk(detail);
  } catch (error) {
    return handleRouteError(error);
  }
}
