import { runResearchQuerySchema } from "@nyayagrid/validation";
import { requireAnyCapability } from "@nyayagrid/permissions";
import { getResearchSession, runResearchQuery } from "@nyayagrid/research";
import { MockAIProvider, MockEmbeddingProvider } from "@nyayagrid/ai";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

const RESEARCH_CAPABILITIES = ["research.run", "matters.view"] as const;

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
    await requireAnyCapability(db, {
      userId: user.id,
      organizationId,
      capabilities: [...RESEARCH_CAPABILITIES],
    });
    const session = await getResearchSession({ db, organizationId, sessionId });
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
      embeddings:
        process.env.EMBEDDING_PROVIDER === "openai" ? undefined : new MockEmbeddingProvider(),
      ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
    });
    return jsonOk(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
