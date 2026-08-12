import { MockAIProvider } from "@nyayagrid/ai";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { getLatestMatterSummary, regenerateMatterSummary } from "@nyayagrid/intelligence";
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
    const summary = await getLatestMatterSummary({
      db,
      organizationId: matter.organizationId,
      matterId,
    });
    return jsonOk({ summary });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "timeline.manage",
    });
    const summary = await regenerateMatterSummary({
      db,
      organizationId: matter.organizationId,
      matterId,
      matterTitle: matter.title,
      userId: user.id,
      ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
    });
    return jsonOk({ summary }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
