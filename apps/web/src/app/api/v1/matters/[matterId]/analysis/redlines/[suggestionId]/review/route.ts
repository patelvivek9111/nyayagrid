import { reviewRedlineSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { reviewRedlineSuggestion } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; suggestionId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, suggestionId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "documents.edit",
    });
    const body = reviewRedlineSchema.parse(await request.json());
    const suggestion = await reviewRedlineSuggestion({
      db,
      organizationId: matter.organizationId,
      matterId,
      suggestionId,
      userId: user.id,
      status: body.status,
    });
    return jsonOk({ suggestion });
  } catch (error) {
    return handleRouteError(error);
  }
}
