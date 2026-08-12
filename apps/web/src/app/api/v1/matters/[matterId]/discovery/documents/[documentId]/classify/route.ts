import { proposeDiscoveryClassificationSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { proposeDiscoveryClassification } from "@nyayagrid/intelligence";
import { MockAIProvider } from "@nyayagrid/ai";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; documentId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, documentId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });
    const body = proposeDiscoveryClassificationSchema.parse(await request.json().catch(() => ({})));
    const result = await proposeDiscoveryClassification({
      db,
      organizationId: matter.organizationId,
      matterId,
      documentId,
      userId: user.id,
      requestSummary: body.requestSummary,
      ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
    });
    return jsonOk(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
