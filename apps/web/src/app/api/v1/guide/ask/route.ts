import { askGuideSchema } from "@nyayagrid/validation";
import { askGuide } from "@nyayagrid/workspaces";
import { recordUsage } from "@nyayagrid/platform";
import { requireGuideUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";
import { getAI, getEmbeddings } from "@/lib/infra";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Ask Nyaya Guide a question. `requireUser` is the entire authorization boundary — Guide never
 * checks matter/organization access, and any conversation/document/situation id supplied here is
 * proven to belong to this user inside `askGuide` itself.
 *
 * Provider selection is canonical (`getAI()`). Schema/provider failures must not silently fall
 * back to MockAIProvider.
 */
export async function POST(request: Request) {
  try {
    const { db, user } = await requireGuideUser(request.headers);
    const limited = await enforceRateLimit(request, { endpointClass: "guide", userId: user.id });
    if (limited) return limited;

    const body = askGuideSchema.parse(await request.json());

    const startedAt = Date.now();
    const result = await askGuide({
      db,
      userId: user.id,
      embeddings: getEmbeddings(),
      question: body.question,
      jurisdiction: body.jurisdiction,
      conversationId: body.conversationId,
      documentId: body.documentId,
      situationId: body.situationId,
      ai: getAI(),
    });

    // Guide has no organizationId/matterId — usage is tracked by userId alone.
    await recordUsage(db, {
      userId: user.id,
      feature: "guide.ask",
      provider: result.assistantMessage.provider ?? "unknown",
      model: result.assistantMessage.model ?? "unknown",
      latencyMs: Date.now() - startedAt,
    });

    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
