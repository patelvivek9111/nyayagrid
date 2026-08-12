import { askProfessorSchema } from "@nyayagrid/validation";
import { askProfessor } from "@nyayagrid/workspaces";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { getAI, getEmbeddings } from "@/lib/infra";
import { enforceRateLimit } from "@/lib/rate-limit";

type Params = { params: Promise<{ id: string }> };

/**
 * Ask a question inside an existing Professor conversation. `requireUser` is the entire
 * authorization boundary here — Professor never checks matter/organization access, and the
 * conversation id is proven to belong to this user inside `askProfessor` itself.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireUser(request.headers);
    const limited = await enforceRateLimit(request, {
      endpointClass: "professor",
      userId: user.id,
    });
    if (limited) return limited;

    const body = askProfessorSchema.parse(await request.json());

    const result = await askProfessor({
      db,
      userId: user.id,
      conversationId: id,
      question: body.question,
      explanationLevel: body.explanationLevel,
      caseId: body.caseId,
      ai: getAI(),
      embeddings: getEmbeddings(),
    });

    return jsonOk({
      conversation: result.conversation,
      message: result.message,
      answer: result.answer,
      sources: result.sources,
      socraticFollowUp: result.socraticFollowUp,
      grounded: result.grounded,
      caseHitCount: result.caseHitCount,
      authorityChunkCount: result.authorityChunkCount,
      validation: result.validation,
      provider: result.provider,
      model: result.model,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
