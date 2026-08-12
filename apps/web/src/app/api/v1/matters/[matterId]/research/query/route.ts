import { runResearchQuerySchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { createResearchSession, listResearchSessions, runResearchQuery } from "@nyayagrid/research";
import { MockAIProvider, MockEmbeddingProvider } from "@nyayagrid/ai";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

/**
 * Finds (or creates) the default active research session for a matter so the matter research
 * tab can run queries without the caller managing session ids explicitly.
 */
async function getOrCreateDefaultSession(params: {
  db: Parameters<typeof listResearchSessions>[0]["db"];
  organizationId: string;
  matterId: string;
  matterTitle: string;
  userId: string;
}) {
  const sessions = await listResearchSessions({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    status: "active",
  });
  if (sessions[0]) return sessions[0];
  return createResearchSession({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    userId: params.userId,
    title: `Research — ${params.matterTitle}`,
  });
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "research.run",
    });
    const body = runResearchQuerySchema.parse(await request.json());

    const session = await getOrCreateDefaultSession({
      db,
      organizationId: matter.organizationId,
      matterId,
      matterTitle: matter.title,
      userId: user.id,
    });

    // Matter context (verified facts/graph/memory only — never raw matter documents) is loaded
    // internally by runResearchQuery when includeMatterContext is on and matterId is set.
    const result = await runResearchQuery({
      db,
      organizationId: matter.organizationId,
      sessionId: session.id,
      matterId,
      userId: user.id,
      question: body.queryText,
      filters: body.filters,
      limit: body.limit,
      includeMatterContext: body.includeMatterContext !== false,
      embeddings:
        process.env.EMBEDDING_PROVIDER === "openai" ? undefined : new MockEmbeddingProvider(),
      ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
    });
    return jsonOk({ ...result, sessionId: session.id }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
