import { ZodError } from "zod";
import { MockAIProvider } from "@nyayagrid/ai";
import { explainGuideDocument } from "@nyayagrid/workspaces";
import { requireGuideUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";
import { getAI } from "@/lib/infra";

type Params = { params: Promise<{ documentId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { documentId } = await params;
    const { db, user } = await requireGuideUser(request.headers);

    const input = {
      db,
      documentId,
      userId: user.id,
    };
    let result;
    try {
      result = await explainGuideDocument({ ...input, ai: getAI() });
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      result = await explainGuideDocument({ ...input, ai: new MockAIProvider() });
    }

    return jsonOk({
      explanation: result.explanation,
      record: result.record,
      rejectedQuoteCount: result.rejectedQuoteCount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
