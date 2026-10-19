import { explainGuideDocument } from "@nyayagrid/workspaces";
import { requireGuideUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";
import { getAI } from "@/lib/infra";

type Params = { params: Promise<{ documentId: string }> };

/**
 * Guide document explanation. Uses canonical `getAI()` only — never silent Mock on Zod/provider errors.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { documentId } = await params;
    const { db, user } = await requireGuideUser(request.headers);

    const result = await explainGuideDocument({
      db,
      documentId,
      userId: user.id,
      ai: getAI(),
    });

    return jsonOk({
      explanation: result.explanation,
      record: result.record,
      rejectedQuoteCount: result.rejectedQuoteCount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
