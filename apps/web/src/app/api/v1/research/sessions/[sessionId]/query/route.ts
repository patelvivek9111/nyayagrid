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

    // Explicit source boundary: Research session is legal corpus by default.
    // Web is never implied. Case context only when explicitly requested via
    // sourceScope=case_plus_legal or includeMatterContext.
    const sourceScope = body.sourceScope ?? (body.includeMatterContext ? "case_plus_legal" : "legal_research");
    if (sourceScope === "web") {
      return jsonError(
        "VALIDATION_ERROR",
        "Web Research is not available on the legal research session endpoint; use Ask with sourceScope=web",
        400,
      );
    }
    if (sourceScope === "case") {
      return jsonError(
        "VALIDATION_ERROR",
        "Case-only Ask belongs on the matter Ask endpoint; research sessions use legal_research or case_plus_legal",
        400,
      );
    }

    const result = await runResearchQuery({
      db,
      organizationId,
      sessionId: session.id,
      matterId: session.matterId,
      userId: user.id,
      question: body.queryText,
      filters: body.filters,
      limit: body.limit,
      includeMatterContext:
        sourceScope === "case_plus_legal" ? true : body.includeMatterContext === true,
      executionStrategy: body.executionStrategy,
      modelId: body.modelId,
      embeddings:
        process.env.EMBEDDING_PROVIDER === "openai" ? undefined : new MockEmbeddingProvider(),
      ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
    });
    return jsonOk(
      {
        ...result,
        sourceScope,
        provenance: {
          sourceScope,
          headline: sourceScope === "case_plus_legal" ? "Case + Legal research" : "Legal research",
          detail:
            sourceScope === "case_plus_legal"
              ? "NyayaGrid authorities with optional case context · No external web sources"
              : "NyayaGrid authorities · No general web sources",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
