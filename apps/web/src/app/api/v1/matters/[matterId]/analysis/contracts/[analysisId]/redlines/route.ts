import { generateRedlinesSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { generateRedlineSuggestions, listRedlineSuggestions } from "@nyayagrid/intelligence";
import { MockAIProvider } from "@nyayagrid/ai";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; analysisId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId, analysisId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });
    const suggestions = await listRedlineSuggestions({
      db,
      organizationId: matter.organizationId,
      matterId,
      analysisId,
    });
    return jsonOk({ suggestions });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, analysisId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "documents.edit",
    });
    const body = generateRedlinesSchema.parse(await request.json().catch(() => ({})));
    const result = await generateRedlineSuggestions({
      db,
      organizationId: matter.organizationId,
      matterId,
      analysisId,
      userId: user.id,
      focus: body.focus,
      ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
    });
    return jsonOk(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
