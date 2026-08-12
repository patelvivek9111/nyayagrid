import { generateResearchMemoSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { generateResearchMemo } from "@nyayagrid/research";
import { MockAIProvider, MockEmbeddingProvider } from "@nyayagrid/ai";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

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
    const body = generateResearchMemoSchema.parse(await request.json());

    const result = await generateResearchMemo({
      db,
      organizationId: matter.organizationId,
      matterId,
      userId: user.id,
      question: body.researchQuestion,
      includeMatterFacts: body.includeMatterContext,
      ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
      embeddings:
        process.env.EMBEDDING_PROVIDER === "openai" ? undefined : new MockEmbeddingProvider(),
    });
    return jsonOk(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
