import { runResearchQuerySchema } from "@nyayagrid/validation";
import { runResearchQuery } from "@nyayagrid/research";
import { MockAIProvider, MockEmbeddingProvider } from "@nyayagrid/ai";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireResearchSessionAccess } from "@/server/research-access";

type Params = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { sessionId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = runResearchQuerySchema.parse(await request.json());
    const url = new URL(request.url);
    const organizationId = body.organizationId ?? url.searchParams.get("organizationId");
    if (!organizationId) {
      return jsonError("VALIDATION_ERROR", "organizationId is required", 400);
    }
    const limited = await enforceRateLimit(request, {
      endpointClass: "research",
      organizationId,
      userId: user.id,
    });
    if (limited) return limited;

    const session = await requireResearchSessionAccess(db, {
      userId: user.id,
      organizationId,
      sessionId,
    });
    if (!session) return jsonError("NOT_FOUND", "Research session not found", 404);

    const result = await runResearchQuery({
      db,
      organizationId,
      sessionId: session.id,
      matterId: session.matterId,
      userId: user.id,
      question: body.queryText,
      filters: body.filters,
      limit: body.limit,
      includeMatterContext: body.includeMatterContext,
      executionStrategy: body.executionStrategy,
      modelId: body.modelId,
      embeddings:
        process.env.EMBEDDING_PROVIDER === "openai" ? undefined : new MockEmbeddingProvider(),
      ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
    });
    return jsonOk(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
