import { detectContradictionsSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { detectContradictionCandidates } from "@nyayagrid/intelligence";
import { MockAIProvider } from "@nyayagrid/ai";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

type Params = { params: Promise<{ matterId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "documents.edit",
    });
    const limited = await enforceRateLimit(request, {
      endpointClass: "expensive_ai",
      organizationId: matter.organizationId,
      userId: user.id,
    });
    if (limited) return limited;
    const body = detectContradictionsSchema.parse(await request.json().catch(() => ({})));
    const result = await detectContradictionCandidates({
      db,
      organizationId: matter.organizationId,
      matterId,
      documentId: body.documentId,
      userId: user.id,
      force: body.force,
      ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
    });
    return jsonOk(result, { status: result.skipped ? 200 : 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
