import { explainGuideDocument } from "@nyayagrid/workspaces";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { getAI } from "@/lib/infra";

type Params = { params: Promise<{ documentId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { documentId } = await params;
    const { db, user } = await requireUser(request.headers);

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
