import { summarizeAuthoritySchema } from "@nyayagrid/validation";
import { requireAnyCapability } from "@nyayagrid/permissions";
import { summarizeAuthority } from "@nyayagrid/research";
import { MockAIProvider } from "@nyayagrid/ai";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

const RESEARCH_CAPABILITIES = ["research.run", "matters.view"] as const;

type Params = { params: Promise<{ authorityId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { authorityId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = summarizeAuthoritySchema.parse(await request.json().catch(() => ({})));
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
    const result = await summarizeAuthority({
      db,
      organizationId,
      authorityId,
      researchQuestion: body.researchQuestion,
      sessionId: body.sessionId,
      userId: user.id,
      ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
    });
    return jsonOk(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
